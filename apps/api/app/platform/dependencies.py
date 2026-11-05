"""HTTP resource access, admission and optional API authentication."""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Annotated, Protocol, cast

from fastapi import Depends, Header, HTTPException, Request

from app.config import Settings
from app.core.diagnostics import report_database_stall
from app.infra.database import Conn
from app.infra.transactions import DatabaseBusyError, transaction
from app.platform.runtime import RuntimeResources

logger = logging.getLogger("uvicorn.error")
DATABASE_WAIT_SECONDS = 30.0


def get_resources(request: Request) -> RuntimeResources:
    return cast(RuntimeResources, request.app.state.resources)


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


SettingsDep = Annotated[Settings, Depends(get_settings)]


def _busy(stage: str) -> HTTPException:
    report_database_stall(stage)
    return HTTPException(
        503,
        "database is busy; retry shortly",
        headers={"Retry-After": "1", "Cache-Control": "no-store"},
    )


async def _database_slot(request: Request) -> AsyncIterator[None]:
    """Queue without occupying the workers needed by the lock holder."""
    db = get_resources(request).database()
    try:
        async with asyncio.timeout(DATABASE_WAIT_SECONDS):
            await db.request_slot.acquire()
    except TimeoutError:
        raise _busy("request queue") from None
    try:
        yield
    finally:
        db.request_slot.release()


def get_conn(request: Request, _slot: None = Depends(_database_slot)) -> Iterator[Conn]:
    resources = get_resources(request)

    def committed(elapsed_ms: float) -> None:
        if request.method != "GET":
            logger.info("db commit %.0fms  %s %s", elapsed_ms, request.method, request.url.path)
            if resources.push_scheduler is not None:
                resources.push_scheduler.notify_write()

    try:
        with transaction(
            resources.database(),
            begin=request.method not in {"GET", "HEAD", "OPTIONS"},
            timeout=DATABASE_WAIT_SECONDS,
            after_commit=committed,
        ) as conn:
            yield conn
    except DatabaseBusyError:
        raise _busy("connection lock") from None


ConnDep = Annotated[Conn, Depends(get_conn)]


class _Service(Protocol):
    def __init__(self, conn: Conn) -> None: ...


def service_factory[S: _Service](service_cls: type[S]) -> Callable[[Conn], S]:
    """Compatibility for in-process clients of the former core dependency helper."""

    def get_service(conn: ConnDep) -> S:
        return service_cls(conn)

    return get_service


def require_api_key(settings: SettingsDep, x_api_key: str | None = Header(default=None)) -> None:
    if settings.api_key is not None and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="missing or invalid X-API-Key")

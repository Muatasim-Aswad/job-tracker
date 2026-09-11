"""Request-scoped dependencies: the DB connection, the service-factory builder,
and the optional API-key gate.

`get_conn` yields the shared connection under the database lock and commits at
the end of a successful request (rolling back on error), so services and
repositories never manage transactions themselves.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Protocol

from fastapi import Depends, Header, HTTPException, Request

from app.core.config import Settings, get_settings
from app.core.db import Conn, Database
from app.core.diagnostics import report_database_stall

# Route through uvicorn's own logger so the line renders in the console; a bare app
# logger emitting at INFO has no handler and is dropped.
logger = logging.getLogger("uvicorn.error")

DATABASE_WAIT_SECONDS = 30.0


async def _database_slot(request: Request) -> AsyncIterator[None]:
    """Queue requests without occupying the workers needed by the lock holder."""
    db: Database = request.app.state.db
    try:
        async with asyncio.timeout(DATABASE_WAIT_SECONDS):
            await db.request_slot.acquire()
    except TimeoutError:
        report_database_stall("request queue")
        raise HTTPException(
            503,
            "database is busy; retry shortly",
            headers={"Retry-After": "1", "Cache-Control": "no-store"},
        ) from None
    try:
        yield
    finally:
        db.request_slot.release()


def get_conn(request: Request, _slot: None = Depends(_database_slot)) -> Iterator[Conn]:
    db: Database = request.app.state.db
    # Only the admitted request can wait here. Bound a stalled background sync too.
    if not db.lock.acquire(timeout=DATABASE_WAIT_SECONDS):
        report_database_stall("connection lock")
        raise HTTPException(
            503,
            "database is busy; retry shortly",
            headers={"Retry-After": "1", "Cache-Control": "no-store"},
        )
    try:
        try:
            yield db.conn
            start = time.perf_counter()
            db.conn.commit()
            elapsed_ms = (time.perf_counter() - start) * 1000
            # In embedded-replica mode `commit()` is the write-through round-trip to
            # the primary; in pyturso sync mode it's a local ~ms commit and the network
            # happens later on push. Log it for mutating requests only — a GET's commit
            # is a local no-op, so skipping keeps the read stream quiet — and nudge the
            # background pusher so local-first writes replicate.
            if request.method != "GET":
                logger.info("db commit %.0fms  %s %s", elapsed_ms, request.method, request.url.path)
                scheduler = getattr(request.app.state, "push_scheduler", None)
                if scheduler is not None:
                    scheduler.notify_write()
        except BaseException:
            db.conn.rollback()
            raise
    finally:
        db.lock.release()


class _Service(Protocol):
    def __init__(self, conn: Conn) -> None: ...


def service_factory[S: _Service](service_cls: type[S]) -> Callable[[Conn], S]:
    """Build a router's `get_service` dependency. Every feature module's is
    identical but for which `<Domain>Service(conn)` it constructs, so routers call
    `service_factory(XService)` instead of hand-writing the same one-liner."""

    def get_service(conn: Conn = Depends(get_conn)) -> S:
        return service_cls(conn)

    return get_service


def require_api_key(
    x_api_key: str | None = Header(default=None), settings: Settings = Depends(get_settings)
) -> None:
    """Gate every /api route behind `Settings.api_key` when one is configured, and
    no-op while it's unset, matching a purely-localhost personal tool. `settings`
    comes through `Depends` rather than a bare `get_settings()` call so tests can
    override it via `app.dependency_overrides`, same as `get_conn`."""
    if settings.api_key is None:
        return
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="missing or invalid X-API-Key")

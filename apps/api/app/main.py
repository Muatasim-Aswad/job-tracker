"""FastAPI app: wires the feature routers, initializes the schema on startup,
and (once the Turso env vars are set) opens the libSQL embedded replica."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from app.blocked.router import router as blocked_router
from app.core.config import get_settings
from app.core.db import Database, connect, init_schema
from app.core.deps import require_api_key
from app.core.errors import ConflictError, InvalidCursorError, NotFoundError, ValidationError
from app.core.lifecycle import ServerLock, private_creation_mask, protect_new_database
from app.core.paths import settings_paths
from app.core.sync import PushScheduler
from app.core.version import PRODUCT_VERSION
from app.documents.router import router as documents_router
from app.events.router import router as events_router
from app.form_fill.router import router as form_fill_router
from app.jobs.router import router as jobs_router
from app.listings.router import router as listings_router
from app.meta.router import router as meta_router
from app.search_log.router import router as search_log_router
from app.stats.router import router as stats_router

# uvicorn's logger is the one with a console handler attached, so app lines — errors,
# the per-write commit log — render alongside access logs.
logger = logging.getLogger("uvicorn.error")


class DashboardStaticFiles(StaticFiles):
    """Keep the SPA entry document fresh across dashboard rebuilds."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache"
        return response


def _timestamp_uvicorn_logs() -> None:
    """Prepend a timestamp to uvicorn's log lines. Its default formatter omits the
    clock, making it impossible to correlate an access line, its in-request commit
    log, and a later background-push warning. Runs in lifespan, once uvicorn has
    installed its handlers, re-wrapping each formatter in the same class with an
    `asctime` prefix. Reuses the existing format string rather than hardcoding
    uvicorn's, so it survives version bumps."""
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            fmt = handler.formatter
            if fmt is None:
                continue
            base = getattr(fmt, "_fmt", None)
            if not base or "asctime" in base:
                continue
            try:
                handler.setFormatter(type(fmt)(f"%(asctime)s {base}", datefmt="%Y-%m-%d %H:%M:%S"))
            except Exception:  # never let log cosmetics break startup
                logger.debug("could not add timestamp to %s handler", name, exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    _timestamp_uvicorn_logs()
    settings = get_settings()
    paths = settings_paths(settings)
    lock = ServerLock(paths, port=settings.port, version=PRODUCT_VERSION)
    with private_creation_mask():
        lock.acquire()  # before open/pull/init; direct Uvicorn cannot bypass it
        conn = None
        scheduler = None
        live_path = (
            paths.database.with_name(f"{paths.database.name}.sync")
            if settings.turso_local_first and settings.turso_database_url
            else paths.database
        )
        existed_before_open = live_path.exists()
        try:
            conn = connect(settings)  # pyturso mode already pulled the latest remote state
            protect_new_database(live_path, existed_before_open=existed_before_open)
            init_schema(conn, paths.schema_file)
            db = Database(conn)
            app.state.db = db

            # In local-first mode, a debounced background push keeps local writes off the
            # request path, and a periodic pull surfaces another laptop's writes without a
            # restart.
            scheduler = (
                PushScheduler(
                    db, settings.turso_push_debounce_seconds, settings.turso_pull_interval_seconds
                )
                if db.syncable
                else None
            )
            app.state.push_scheduler = scheduler
            if scheduler is not None:
                scheduler.start()

            yield
        finally:
            try:
                if scheduler is not None:
                    scheduler.stop()  # flushes pending writes before database close
            finally:
                try:
                    if conn is not None:
                        conn.close()
                finally:
                    lock.release()  # only after database cleanup has been attempted


app = FastAPI(title="Job Tracker API", version=PRODUCT_VERSION, lifespan=lifespan)


def _form_fill_headers(request: Request) -> dict[str, str]:
    return {"Cache-Control": "no-store"} if request.url.path.startswith("/api/form-fill/") else {}


settings = get_settings()
paths = settings_paths(settings)

# Browser-facing allowlist: only the Vite dev server and the extension's fixed
# chrome-extension:// origin ever legitimately call this API from a browser. Prod
# serves the SPA same-origin, which CORS doesn't gate at all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_dev_origin, f"chrome-extension://{settings.extension_id}"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# DNS-rebinding guard: reject requests whose Host header isn't one of these. Added
# last so it wraps outermost and runs before CORS gets a look. On a local-only personal
# tool this, the CORS allowlist above, and the optional X-API-Key gate below are
# proportionate hardening, not a substitute for real auth on a service that left
# localhost.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)


@app.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok", "version": PRODUCT_VERSION}


# 404 is routine here — the deep-link `/listings/lookup` misses by design — so logging
# it would be noise. 400 and 500 are logged with request context.
@app.exception_handler(NotFoundError)
async def not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
    return JSONResponse(
        status_code=404, content={"detail": exc.message}, headers=_form_fill_headers(request)
    )


@app.exception_handler(ValidationError)
async def validation_handler(request: Request, exc: ValidationError) -> JSONResponse:
    # A client error worth seeing: a refused funnel move, a non-note event delete.
    # WARNING carries the reason and the request, but no stack trace — it isn't a bug.
    logger.warning("400 %s %s — %s", request.method, request.url.path, exc.message)
    return JSONResponse(
        status_code=400, content={"detail": exc.message}, headers=_form_fill_headers(request)
    )


@app.exception_handler(ConflictError)
async def conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={"detail": exc.message, "current": exc.current},
        headers=_form_fill_headers(request),
    )


@app.exception_handler(InvalidCursorError)
async def invalid_cursor_handler(request: Request, exc: InvalidCursorError) -> JSONResponse:
    return JSONResponse(
        status_code=422, content={"detail": exc.message}, headers=_form_fill_headers(request)
    )


@app.exception_handler(RequestValidationError)
async def request_validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(exc.errors())},
        headers=_form_fill_headers(request),
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    # Anything uncaught is a bug. Log the full traceback *with* the request that
    # triggered it, since uvicorn alone logs the trace but not the path, and return a
    # consistent JSON body instead of Starlette's plain-text default.
    logger.error("500 %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"},
        headers=_form_fill_headers(request),
    )


# Every feature router mounts under /api, the SPA taking / (see the StaticFiles mount
# below). One parent router declares the optional X-API-Key gate once rather than per
# router. /docs and /openapi.json are FastAPI's own routes, outside this router, so
# they stay unprefixed and ungated.
api_router = APIRouter(dependencies=[Depends(require_api_key)])
for _router in (
    jobs_router,
    listings_router,
    events_router,
    documents_router,
    stats_router,
    search_log_router,
    meta_router,
    blocked_router,
    form_fill_router,
):
    api_router.include_router(_router)
app.include_router(api_router, prefix="/api")

# Serve the built dashboard SPA at the root, *after* the API routers so their paths
# win. Mounted only when `apps/web/dist` exists, so `uv run` works whether or not the
# frontend has been built; frontend dev uses Vite's own server, which proxies the API
# back here. `html=True` makes it a real SPA host, falling unknown paths back to
# index.html for client routing.
if paths.web_dist.is_dir():
    app.mount("/", DashboardStaticFiles(directory=paths.web_dist, html=True), name="dashboard")

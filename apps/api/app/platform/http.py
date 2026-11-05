"""HTTP security, error translation, public identity and dashboard hosting."""

import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings
from app.core.version import PRODUCT_VERSION
from app.shared.errors import ConflictError, InvalidCursorError, NotFoundError, ValidationError

logger = logging.getLogger("uvicorn.error")


class DashboardStaticFiles(StaticFiles):
    """Keep the SPA entry document fresh across dashboard rebuilds."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache"
        return response


def _private_path(path: str) -> bool:
    path = path.rstrip("/")
    return (
        path == "/api/form-fill"
        or path.startswith("/api/form-fill/")
        or path.endswith("/application-workflow")
        or path == "/api/settings"
        or path.startswith("/api/settings/")
        or path == "/api/document-operations"
        or path == "/api/event-operations"
    )


def _private_headers(request: Request) -> dict[str, str]:
    return {"Cache-Control": "no-store"} if _private_path(request.url.path) else {}


class PrivateResponseHeaders:
    """Apply the private policy to framework and security responses without buffering bodies."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not _private_path(scope["path"]):
            await self.app(scope, receive, send)
            return

        async def send_private(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_private)


async def health(request: Request) -> dict[str, str]:
    return {
        "status": "ok",
        "version": PRODUCT_VERSION,
        "revision": request.app.state.build_info["revision"],
    }


async def version_json(request: Request) -> Response:
    response = JSONResponse(request.app.state.build_info, headers={"Cache-Control": "no-store"})
    if request.method == "HEAD":
        return Response(headers=dict(response.headers), media_type="application/json")
    return response


# 404 is routine here — the deep-link `/listings/lookup` misses by design — so logging
# it would be noise. 400 and 500 are logged with request context.
async def not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
    return JSONResponse(
        status_code=404, content={"detail": exc.message}, headers=_private_headers(request)
    )


async def validation_handler(request: Request, exc: ValidationError) -> JSONResponse:
    # A client error worth seeing: a refused funnel move, a non-note event delete.
    # WARNING carries the reason and the request, but no stack trace — it isn't a bug.
    logger.warning("400 %s %s — %s", request.method, request.url.path, exc.message)
    return JSONResponse(
        status_code=400, content={"detail": exc.message}, headers=_private_headers(request)
    )


async def conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
    # Conflicts carry current state, which may be private even on listing routes.
    return JSONResponse(
        status_code=409,
        content={"detail": exc.message, "current": exc.current},
        headers={"Cache-Control": "no-store"},
    )


async def invalid_cursor_handler(request: Request, exc: InvalidCursorError) -> JSONResponse:
    return JSONResponse(
        status_code=422, content={"detail": exc.message}, headers=_private_headers(request)
    )


async def request_validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(exc.errors())},
        headers=_private_headers(request),
    )


async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    # Anything uncaught is a bug. Log the full traceback *with* the request that
    # triggered it, since uvicorn alone logs the trace but not the path, and return a
    # consistent JSON body instead of Starlette's plain-text default.
    logger.error("500 %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"},
        headers=_private_headers(request),
    )


def configure_http(app: FastAPI, settings: Settings) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_dev_origin, f"chrome-extension://{settings.extension_id}"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Wrap host checks and CORS too: early rejections may contain private context.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
    app.add_middleware(PrivateResponseHeaders)
    app.add_api_route("/health", health, methods=["GET"], include_in_schema=False)
    app.add_api_route(
        "/version.json", version_json, methods=["GET", "HEAD"], include_in_schema=False
    )
    app.add_exception_handler(NotFoundError, not_found_handler)  # type: ignore[arg-type]
    app.add_exception_handler(ValidationError, validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(ConflictError, conflict_handler)  # type: ignore[arg-type]
    app.add_exception_handler(InvalidCursorError, invalid_cursor_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, request_validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_handler)

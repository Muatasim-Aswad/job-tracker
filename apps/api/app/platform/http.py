"""HTTP security, error translation, public identity and dashboard hosting."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings
from app.core.version import PRODUCT_VERSION
from app.platform.dependencies import get_resources
from app.platform.errors import (
    application_error_handler,
    error_response,
    http_error_handler,
    request_validation_handler,
)
from app.platform.requests import RequestBoundary
from app.shared.errors import AppError


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
        or path == "/api/notifications"
        or path.startswith("/api/notifications/")
        or path == "/api/document-operations"
        or path == "/api/event-operations"
    )


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


async def readiness(request: Request) -> JSONResponse:
    probe = get_resources(request).readiness
    if probe is None or not await probe.check():
        return error_response(
            request,
            503,
            "service_unavailable",
            "Database is not ready.",
            headers={"Retry-After": "1"},
        )
    return JSONResponse({"status": "ready"}, headers={"Cache-Control": "no-store"})


def configure_http(app: FastAPI, settings: Settings) -> None:
    allowed_origins = [settings.web_dev_origin, f"chrome-extension://{settings.extension_id}"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    # Wrap host checks and CORS too: early rejections may contain private context.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
    app.add_middleware(PrivateResponseHeaders)
    app.add_middleware(RequestBoundary, allowed_origins=allowed_origins)
    app.add_api_route("/health", health, methods=["GET"], include_in_schema=False)
    app.add_api_route("/health/ready", readiness, methods=["GET"], include_in_schema=False)
    app.add_api_route(
        "/version.json", version_json, methods=["GET", "HEAD"], include_in_schema=False
    )
    app.add_exception_handler(AppError, application_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(HTTPException, http_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, request_validation_handler)  # type: ignore[arg-type]

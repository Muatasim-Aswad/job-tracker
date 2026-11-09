"""Correlate requests and handle failures outside host/origin and routing policy."""

import logging
import time
from dataclasses import dataclass
from uuid import UUID, uuid4

from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.platform.errors import HTTP_CODES, error_response
from app.platform.logging import request_id_context

logger = logging.getLogger("uvicorn.error")


def _request_id(request: Request) -> str:
    supplied = request.headers.get("X-Request-ID", "")
    try:
        return str(UUID(supplied))
    except ValueError:
        return str(uuid4())


@dataclass
class _Exchange:
    request: Request
    receive: Receive
    downstream: Send
    allowed_origin: str | None = None
    started: bool = False
    replaced: bool = False
    status: int = 500

    async def correlated_send(self, message: Message) -> None:
        if message["type"] == "http.response.start":
            self.started = True
            self.status = message["status"]
            headers = MutableHeaders(scope=message)
            headers["X-Request-ID"] = self.request.state.request_id
            if self.allowed_origin is not None:
                headers["Access-Control-Allow-Origin"] = self.allowed_origin
                headers["Access-Control-Expose-Headers"] = "X-Request-ID"
                if "Origin" not in headers.get("Vary", "").split(", "):
                    headers.add_vary_header("Origin")
        await self.downstream(message)

    async def send(self, message: Message) -> None:
        if self.replaced:
            return
        if message["type"] != "http.response.start" or message["status"] < 400:
            await self.correlated_send(message)
            return

        headers = MutableHeaders(scope=message)
        if headers.get("content-type", "").startswith("application/json"):
            await self.correlated_send(message)
            return

        # Host/CORS middleware can reject before exception handlers run.
        self.replaced = True
        status = message["status"]
        response = error_response(
            self.request,
            status,
            HTTP_CODES.get(status, "http_error"),
            headers={
                key: value
                for key, value in headers.items()
                if key not in {"content-type", "content-length"}
            },
        )
        await response(self.request.scope, self.receive, self.correlated_send)

    def log(self, started_at: float, failure: Exception | None) -> None:
        scope = self.request.scope
        logger.log(
            logging.ERROR if failure or self.status >= 500 else logging.INFO,
            "http request",
            extra={
                "event": "http.request",
                "request_id": self.request.state.request_id,
                "method": scope["method"],
                "route": getattr(scope.get("route"), "path", "<unmatched>"),
                "status": self.status,
                "code": getattr(self.request.state, "error_code", None),
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
            exc_info=failure,
        )


class RequestBoundary:
    def __init__(self, app: ASGIApp, *, allowed_origins: list[str]) -> None:
        self.app = app
        self.allowed_origins = allowed_origins

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        request.state.request_id = request_id = _request_id(request)
        token = request_id_context.set(request_id)
        origin = request.headers.get("origin")
        exchange = _Exchange(
            request, receive, send, origin if origin in self.allowed_origins else None
        )
        started_at = time.perf_counter()
        failure = None
        try:
            try:
                await self.app(scope, receive, exchange.send)
            except Exception as exc:
                failure = exc
                if exchange.started:
                    raise
                response = error_response(request, 500, "internal_error")
                await response(scope, receive, exchange.correlated_send)
        finally:
            try:
                exchange.log(started_at, failure)
            finally:
                request_id_context.reset(token)

"""Public HTTP errors and OpenAPI contracts, independent of private diagnostics."""

from collections.abc import Mapping
from http import HTTPStatus

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, JsonValue
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from app.shared.errors import AppError, ConflictError, InvalidCursorError, NotFoundError


class ValidationIssue(BaseModel):
    path: list[str | int]
    code: str
    message: str


class HttpError(BaseModel):
    status: int
    code: str
    message: str
    request_id: str
    details: JsonValue = None
    issues: list[ValidationIssue] | None = None


class ErrorResponse(BaseModel):
    error: HttpError


HTTP_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    413: "request_too_large",
    422: "request_validation_error",
    429: "rate_limited",
    500: "internal_error",
    503: "service_unavailable",
}


def error_response(
    request: Request,
    status: int,
    code: str,
    message: str | None = None,
    *,
    details: object = None,
    issues: list[ValidationIssue] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    request.state.error_code = code
    public = ErrorResponse(
        error=HttpError(
            status=status,
            code=code,
            message=message or HTTPStatus(status).phrase,
            request_id=request.state.request_id,
            details=jsonable_encoder(details),
            issues=issues,
        )
    )
    return JSONResponse(
        status_code=status,
        content=public.model_dump(exclude_none=True),
        headers={
            **{key.lower(): value for key, value in (headers or {}).items()},
            "cache-control": "no-store",
        },
    )


async def application_error_handler(request: Request, exc: AppError) -> JSONResponse:
    status = 400
    if isinstance(exc, NotFoundError):
        status = 404
    elif isinstance(exc, ConflictError):
        status = 409
    elif isinstance(exc, InvalidCursorError):
        status = 422

    return error_response(
        request, status, exc.code, exc.message, details=exc.details.public if exc.details else None
    )


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return error_response(
        request,
        exc.status_code,
        HTTP_CODES.get(exc.status_code, "http_error"),
        exc.detail if isinstance(exc.detail, str) else None,
        headers=exc.headers,
    )


async def request_validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Inputs, validator contexts and custom exception text can contain private values.
    issues = [
        ValidationIssue(path=list(issue["loc"]), code=issue["type"], message="Invalid value.")
        for issue in exc.errors()
    ]
    return error_response(
        request, 422, "request_validation_error", "Request validation failed.", issues=issues
    )

"""Public failure contracts, request isolation and private diagnostic boundaries."""

import asyncio
import io
import json
import logging
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.config import Settings
from app.platform.errors import ErrorResponse
from app.platform.http import configure_http
from app.platform.logging import JsonFormatter, request_id_context
from app.shared.errors import AppError, ConflictError, ErrorDetails, ValidationError


class Input(BaseModel):
    count: int


def _app() -> FastAPI:
    app = FastAPI()
    configure_http(app, Settings())

    @app.get("/fail/{kind}")
    async def fail(kind: str) -> None:
        if kind == "conflict":
            raise ConflictError("stale_revision", {"revision": 2})
        if kind == "domain":
            raise ValidationError("Choose an active answer.", code="answer_inactive")
        if kind == "private":
            raise AppError(
                "operation_refused",
                "Cannot complete this action.",
                internal="PRIVATE INTERNAL",
                cause=ValueError("PRIVATE CAUSE"),
                details=ErrorDetails(public={"revision": 3}, private="PRIVATE DETAILS"),
            )
        raise RuntimeError("PRIVATE FAILURE")

    @app.post("/validate")
    async def validate(body: Input) -> Input:
        return body

    @app.get("/worker")
    def worker() -> dict[str, str | None]:
        logging.getLogger("uvicorn.error").info("worker step", extra={"event": "worker.step"})
        return {"request_id": request_id_context.get()}

    @app.get("/overlap/{key}")
    async def overlap(key: str, request: Request) -> dict[str, str | None]:
        before = request_id_context.get()
        await asyncio.sleep(0)
        return {"before": before, "after": request_id_context.get(), "id": request.state.request_id}

    return app


@pytest.mark.parametrize(
    ("path", "method", "status", "code"),
    [
        ("/missing", "get", 404, "not_found"),
        ("/validate", "get", 405, "method_not_allowed"),
        ("/fail/conflict", "get", 409, "stale_revision"),
        ("/fail/domain", "get", 400, "answer_inactive"),
        ("/fail/bug", "get", 500, "internal_error"),
    ],
)
def test_failures_share_the_documented_contract(path, method, status, code) -> None:
    response = getattr(TestClient(_app()), method)(path)
    envelope = ErrorResponse.model_validate(response.json()).error
    assert envelope.status == response.status_code == status
    assert envelope.code == code
    assert envelope.request_id == response.headers["X-Request-ID"]
    assert str(UUID(envelope.request_id)) == envelope.request_id
    assert envelope.issues is None
    assert response.headers["cache-control"] == "no-store"
    if status == 405:
        assert response.headers["allow"] == "POST"
    if status == 409:
        assert envelope.details == {"current": {"revision": 2}}


def test_validation_issues_never_echo_private_input_or_validator_context() -> None:
    response = TestClient(_app()).post("/validate", json={"count": "PRIVATE INPUT"})
    error = ErrorResponse.model_validate(response.json()).error
    assert error.status == 422
    assert error.code == "request_validation_error"
    assert error.issues and error.issues[0].path == ["body", "count"]
    assert error.issues[0].code == "int_parsing"
    assert "PRIVATE INPUT" not in response.text
    assert set(response.json()["error"]["issues"][0]) == {"path", "code", "message"}


@pytest.mark.parametrize(
    "headers",
    [
        {"Host": "evil.example.com"},
        {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "INVALID"},
    ],
)
def test_early_security_rejections_are_correlated_json(headers) -> None:
    response = TestClient(_app()).options("/validate", headers=headers)
    error = ErrorResponse.model_validate(response.json()).error
    assert error.status == response.status_code == 400
    assert error.request_id == response.headers["X-Request-ID"]
    assert response.headers["cache-control"] == "no-store"


def test_public_fields_are_explicit_and_unexpected_failures_are_logged_once() -> None:
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("uvicorn.error")
    previous_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    try:
        client = TestClient(_app())
        public = client.get("/fail/private?token=PRIVATE QUERY")
        worker = client.get("/worker")
        failed = client.get(
            "/fail/bug?token=PRIVATE QUERY", headers={"Origin": "http://localhost:5173"}
        )
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous_level)
    assert public.json()["error"]["details"] == {"revision": 3}
    assert all(
        value not in public.text
        for value in ("PRIVATE INTERNAL", "PRIVATE CAUSE", "PRIVATE DETAILS")
    )
    assert "PRIVATE" not in output.getvalue()
    assert "PRIVATE FAILURE" not in failed.text
    assert failed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert failed.headers["access-control-expose-headers"] == "X-Request-ID"
    records = [json.loads(line) for line in output.getvalue().splitlines()]
    worker_log = next(record for record in records if record.get("event") == "worker.step")
    assert worker_log["request_id"] == worker.headers["X-Request-ID"]
    assert worker.json()["request_id"] == worker_log["request_id"]
    failures = [
        record for record in records if record["request_id"] == failed.headers["X-Request-ID"]
    ]
    assert len(failures) == 1
    assert failures[0]["status"] == 500
    assert failures[0]["route"] == "/fail/{kind}"
    assert failures[0]["exception_type"] == "RuntimeError"
    assert failures[0]["trace"]
    assert request_id_context.get() is None


def test_parallel_requests_keep_separate_contexts_and_normalize_caller_ids() -> None:
    async def run() -> None:
        transport = httpx.ASGITransport(app=_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
            responses = await asyncio.gather(
                *[
                    client.get(
                        f"/overlap/{index}",
                        headers={"X-Request-ID": "00000000-0000-4000-8000-000000000001"}
                        if index == 0
                        else {"X-Request-ID": "PRIVATE INVALID ID"},
                    )
                    for index in range(6)
                ]
            )
        ids = set()
        for response in responses:
            body = response.json()
            assert body["before"] == body["after"] == body["id"] == response.headers["X-Request-ID"]
            ids.add(body["id"])
        assert len(ids) == 6
        assert responses[0].json()["id"] == "00000000-0000-4000-8000-000000000001"
        assert request_id_context.get() is None

    asyncio.run(run())

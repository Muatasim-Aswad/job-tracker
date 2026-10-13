"""CORS allowlist, TrustedHost, and the optional API-key gate."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.deps import get_conn
from app.main import app


def test_allowed_origin_gets_cors_header(client: TestClient) -> None:
    resp = client.get("/api/jobs", headers={"Origin": "http://localhost:5173"})
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_disallowed_origin_gets_no_cors_header(client: TestClient) -> None:
    # The server doesn't 4xx a disallowed origin (CORS is enforced by the
    # browser, not this middleware) — it just omits the header the browser
    # needs to let the page's JS read the response.
    resp = client.get("/api/jobs", headers={"Origin": "http://evil.example.com"})
    assert resp.status_code == 200
    assert "access-control-allow-origin" not in resp.headers


def test_extension_origin_is_allowed(client: TestClient) -> None:
    settings = get_settings()
    origin = f"chrome-extension://{settings.extension_id}"
    resp = client.get("/api/jobs", headers={"Origin": origin})
    assert resp.headers.get("access-control-allow-origin") == origin


def test_untrusted_host_header_is_rejected(client: TestClient) -> None:
    resp = client.get("/api/jobs", headers={"Host": "evil.example.com"})
    assert resp.status_code == 400


@pytest.fixture
def keyed_client(client: TestClient) -> Iterator[TestClient]:
    app.dependency_overrides[get_settings] = lambda: Settings(api_key="test-key")
    yield client
    del app.dependency_overrides[get_settings]


def test_no_api_key_configured_is_open(client: TestClient) -> None:
    # Default test Settings carries no api_key — matches the out-of-the-box,
    # purely-localhost tool with no auth configured.
    assert client.get("/api/jobs").status_code == 200


def test_missing_key_is_401_when_configured(keyed_client: TestClient) -> None:
    resp = keyed_client.get("/api/jobs")
    assert resp.status_code == 401


def test_wrong_key_is_401(keyed_client: TestClient) -> None:
    resp = keyed_client.get("/api/jobs", headers={"X-API-Key": "wrong"})
    assert resp.status_code == 401


def test_correct_key_is_allowed(keyed_client: TestClient) -> None:
    resp = keyed_client.get("/api/jobs", headers={"X-API-Key": "test-key"})
    assert resp.status_code == 200


def test_docs_route_is_not_gated_by_api_key(keyed_client: TestClient) -> None:
    # /docs and /openapi.json are FastAPI's own routes, outside the /api
    # router group the key dependency is attached to.
    assert keyed_client.get("/docs").status_code == 200


@pytest.mark.parametrize(
    "path", ["/api/form-fill/answers", "/api/jobs/missing/application-workflow"]
)
@pytest.mark.parametrize("key", [None, "wrong"])
def test_private_authorization_errors_are_no_store(
    keyed_client: TestClient, path: str, key: str | None
) -> None:
    response = keyed_client.get(path, headers={"X-API-Key": key} if key is not None else {})
    assert response.status_code == 401
    assert response.json() == {"detail": "missing or invalid X-API-Key"}
    assert response.headers.get("cache-control") == "no-store"


@pytest.mark.parametrize(
    "path", ["/api/form-fill/answers", "/api/jobs/missing/application-workflow"]
)
def test_private_host_rejections_are_no_store(client: TestClient, path: str) -> None:
    response = client.get(path, headers={"Host": "evil.example.com"})
    assert response.status_code == 400
    assert response.headers.get("cache-control") == "no-store"


def test_private_http_errors_preserve_retry_headers(client: TestClient) -> None:
    def unavailable() -> None:
        raise HTTPException(503, "synthetic busy", headers={"Retry-After": "7", "Allow": "GET"})

    previous = app.dependency_overrides[get_conn]
    app.dependency_overrides[get_conn] = unavailable
    try:
        response = client.get("/api/form-fill/answers")
    finally:
        app.dependency_overrides[get_conn] = previous
    assert response.status_code == 503
    assert response.json() == {"detail": "synthetic busy"}
    assert response.headers["retry-after"] == "7"
    assert response.headers["allow"] == "GET"
    assert response.headers.get("cache-control") == "no-store"


@pytest.mark.parametrize("path", ["/api/form-fill", "/api/form-fill/not-a-route"])
def test_private_framework_not_found_is_no_store(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 404
    assert response.headers.get("cache-control") == "no-store"

"""App-level exception handling, cache policy, and disposable runtime integration."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.lifecycle import LockHeldError, ServerLock
from app.core.paths import settings_paths
from app.infra.database import init_schema
from app.main import app, create_app
from app.platform.dependencies import get_conn
from app.platform.http import DashboardStaticFiles


def test_dashboard_html_revalidates_without_changing_asset_cache_policy(tmp_path) -> None:
    web_dist = tmp_path / "dist"
    assets = web_dist / "assets"
    assets.mkdir(parents=True)
    (web_dist / "index.html").write_text("<h1>Dashboard</h1>")
    (assets / "index-hash.js").write_text("export {};")

    dashboard_app = FastAPI()
    dashboard_app.mount("/", DashboardStaticFiles(directory=web_dist, html=True), name="dashboard")
    client = TestClient(dashboard_app)

    document = client.get("/")
    asset = client.get("/assets/index-hash.js")

    assert document.status_code == 200
    assert document.headers["cache-control"] == "no-cache"
    assert asset.status_code == 200
    assert asset.headers.get("cache-control") != "no-cache"


def test_unhandled_exception_returns_json_500() -> None:
    # A bug surfacing as an uncaught exception must come back as a consistent JSON
    # 500 (not Starlette's plain-text default), so every API error has one shape.
    conn = sqlite3.connect(":memory:")
    init_schema(conn)
    app.dependency_overrides[get_conn] = lambda: conn
    try:
        with patch(
            "app.modules.job_queries.service.JobQueries.search", side_effect=RuntimeError("boom")
        ):
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/api/jobs")
        assert resp.status_code == 500
        assert resp.headers["content-type"] == "application/json"
        assert resp.json()["error"] == {
            "status": resp.status_code,
            "code": "internal_error",
            "message": "Internal Server Error",
            "request_id": resp.headers["X-Request-ID"],
        }
    finally:
        app.dependency_overrides.clear()
        conn.close()


def test_lifespan_requests_commit_rollback_and_survive_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        os,
        "environ",
        {
            "JOB_TRACKER_PROFILE": "direct",
            "JOB_TRACKER_CONFIG_FILE": "/dev/null",
            "JOB_TRACKER_DATA_DIR": str(tmp_path / "data"),
            "JOB_TRACKER_CONFIG_DIR": str(tmp_path / "config"),
            "JOB_TRACKER_STATE_DIR": str(tmp_path / "state"),
            "JOB_TRACKER_BACKUP_DIR": str(tmp_path / "backups"),
            "DB_PATH": str(tmp_path / "data" / "jobs.db"),
            "SCRIPTS_OUTPUT_DIR": str(tmp_path / "output"),
        },
    )
    get_settings.cache_clear()
    try:
        paths = settings_paths(get_settings())
        with TestClient(create_app(get_settings())) as client:
            with pytest.raises(LockHeldError):
                ServerLock(paths, port=3456, version="test").acquire()

            created = client.post(
                "/api/listings",
                json={"platform": "test", "platform_id": "lifespan", "title": "Role"},
            )
            assert created.status_code == 200
            job_id = created.json()["job_id"]
            before = client.get(f"/api/jobs/{job_id}").json()
            failed = client.post(
                "/api/events",
                json={
                    "platform": "test",
                    "platform_id": "rolled-back-stub",
                    "expected_status": "seen",
                    "operation_key": "lifespan-operation",
                    "events": [{"event": "applied"}],
                },
            )
            assert failed.status_code == 409
            assert failed.json()["error"]["code"] == "stale_status"
            assert failed.headers["cache-control"] == "no-store"
            assert (
                client.get(
                    "/api/listings/lookup",
                    params={"platform": "test", "platform_id": "rolled-back-stub"},
                ).status_code
                == 404
            )
            assert client.get(f"/api/jobs/{job_id}").json() == before
            assert (
                client.get(
                    "/api/event-operations", params={"operation_key": "lifespan-operation"}
                ).status_code
                == 404
            )

            accepted = client.post(
                "/api/events",
                json={
                    "job_id": job_id,
                    "operation_key": "lifespan-operation",
                    "events": [{"event": "applied"}],
                },
            )
            assert accepted.status_code == 200
            result = accepted.json()
            assert result["status"] == "applied"
            assert len(result["event_ids"]) == 1
            settled = client.get(f"/api/jobs/{job_id}").json()

        with ServerLock(paths, port=3456, version="test"):
            pass

        with TestClient(create_app(get_settings())) as restarted:
            assert restarted.get(f"/api/jobs/{job_id}").json() == settled
            receipt = restarted.get(
                "/api/event-operations", params={"operation_key": "lifespan-operation"}
            )
            assert receipt.status_code == 200
            assert receipt.headers["cache-control"] == "no-store"
            assert receipt.json()["result"] == result

        with ServerLock(paths, port=3456, version="test"):
            pass
    finally:
        get_settings.cache_clear()

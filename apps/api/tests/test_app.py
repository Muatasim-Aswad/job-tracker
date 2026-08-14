"""App-level behaviors: the exception handlers in main.py."""

from __future__ import annotations

import sqlite3
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.db import init_schema
from app.core.deps import get_conn
from app.main import DashboardStaticFiles, app


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
        with patch("app.jobs.router.JobService.search", side_effect=RuntimeError("boom")):
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/api/jobs")
        assert resp.status_code == 500
        assert resp.headers["content-type"] == "application/json"
        assert resp.json() == {"detail": "Internal Server Error"}
    finally:
        app.dependency_overrides.clear()
        conn.close()

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import app as configured_app
from app.platform.http import DashboardStaticFiles, version_json


def test_version_route_wins_over_static_file_and_head_does_not_send_body(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("synthetic SPA")
    (tmp_path / "version.json").write_text('{"revision":"stale"}')
    app = FastAPI()
    app.state.build_info = configured_app.state.build_info
    app.add_api_route(
        "/version.json", version_json, methods=["GET", "HEAD"], include_in_schema=False
    )
    app.mount("/", DashboardStaticFiles(directory=tmp_path, html=True))
    client = TestClient(app)
    assert client.get("/version.json").json()["revision"] != "stale"
    assert client.head("/version.json").content == b""
    assert client.get("/version.json/missing").status_code == 404
    assert client.get("/").headers["cache-control"] == "no-cache"

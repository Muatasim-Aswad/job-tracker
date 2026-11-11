"""Readiness uses the active connection without blocking liveness or leaking diagnostics."""

import asyncio
import sqlite3
import threading
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.paths import settings_paths
from app.infra.database import Database
from app.infra.readiness import DatabaseReadiness
from app.main import create_app
from app.platform.errors import ErrorResponse
from app.platform.runtime import RuntimeResources


def _application(tmp_path: Path) -> tuple[FastAPI, RuntimeResources]:
    settings = Settings(
        _env_file=None,
        db_path=str(tmp_path / "jobs.db"),
        web_dist_path=tmp_path / "absent-dashboard",
        api_key="synthetic-key",
        turso_database_url=None,
    )
    paths = settings_paths(
        settings,
        environ={
            "JOB_TRACKER_PROFILE": "direct",
            "JOB_TRACKER_DATA_DIR": str(tmp_path),
            "JOB_TRACKER_CONFIG_DIR": str(tmp_path / "config"),
            "JOB_TRACKER_STATE_DIR": str(tmp_path / "state"),
            "JOB_TRACKER_BACKUP_DIR": str(tmp_path / "backups"),
        },
    )
    resources = RuntimeResources(paths)
    return create_app(settings, resources=resources), resources


def _unavailable(response: httpx.Response) -> None:
    error = ErrorResponse.model_validate(response.json()).error
    assert response.status_code == error.status == 503
    assert error.code == "service_unavailable"
    assert error.request_id == response.headers["X-Request-ID"]
    assert error.details is None
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["retry-after"] == "1"


def test_readiness_follows_runtime_lifecycle_and_retains_security(tmp_path: Path) -> None:
    app, resources = _application(tmp_path)
    client = TestClient(app)
    _unavailable(client.get("/health/ready"))
    with client:
        response = client.get("/health/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["X-Request-ID"]
        assert client.get("/api/jobs").status_code == 401
        assert client.get("/health/ready", headers={"Host": "untrusted.example"}).status_code == 400
        assert resources.readiness is not None
    _unavailable(client.get("/health/ready"))


def test_readiness_failure_is_private_and_recovers(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    app, resources = _application(tmp_path)
    wrapped = Mock(wraps=conn)
    wrapped.execute.side_effect = RuntimeError("PRIVATE DATABASE PATH AND CREDENTIALS")
    resources.db = Database(wrapped)
    resources.readiness = DatabaseReadiness(resources.db)

    async def exercise() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://localhost"
        ) as client:
            failed = await client.get("/health/ready")
            _unavailable(failed)
            assert "PRIVATE" not in failed.text
            assert (await client.get("/health")).status_code == 200
            wrapped.execute.side_effect = None
            assert (await client.get("/health/ready")).status_code == 200

    asyncio.run(exercise())


def test_busy_readiness_is_bounded_and_does_not_block_liveness(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    app, resources = _application(tmp_path)
    db = Database(conn)
    resources.db = db
    resources.readiness = DatabaseReadiness(db)

    async def exercise() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://localhost"
        ) as client:
            db.lock.acquire()
            try:
                pending = asyncio.create_task(client.get("/health/ready"))
                live = await asyncio.wait_for(client.get("/health"), timeout=0.5)
                assert live.status_code == 200
                _unavailable(await asyncio.wait_for(pending, timeout=1.5))
            finally:
                db.lock.release()
            assert (await client.get("/health/ready")).status_code == 200

    asyncio.run(exercise())


def test_stalled_driver_has_one_probe_and_shutdown_prevents_late_readiness(
    conn: sqlite3.Connection,
) -> None:
    started = threading.Event()
    release = threading.Event()

    def blocked_query(sql: str):
        started.set()
        assert release.wait(timeout=3)
        return conn.execute(sql)

    wrapped = Mock(wraps=conn)
    wrapped.execute.side_effect = blocked_query
    db = Database(wrapped)
    probe = DatabaseReadiness(db)

    async def exercise() -> None:
        first = asyncio.create_task(probe.check(timeout=0.03))
        try:
            assert await asyncio.to_thread(started.wait, 1)
            assert not await first
            assert not any(await asyncio.gather(*(probe.check(timeout=0.03) for _ in range(20))))
            assert wrapped.execute.call_count == 1
            assert db.lock.locked()
            probe.stop()
            release.set()
            assert not await probe.check()
        finally:
            release.set()

    asyncio.run(exercise())
    assert not db.lock.locked()


def test_cancelled_probe_request_does_not_release_an_owned_connection(
    conn: sqlite3.Connection,
) -> None:
    started = threading.Event()
    release = threading.Event()
    wrapped = Mock(wraps=conn)

    def blocked_query(sql: str):
        started.set()
        assert release.wait(timeout=3)
        return conn.execute(sql)

    wrapped.execute.side_effect = blocked_query
    db = Database(wrapped)
    probe = DatabaseReadiness(db)

    async def exercise() -> None:
        pending = asyncio.create_task(probe.check())
        try:
            assert await asyncio.to_thread(started.wait, 1)
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
            assert db.lock.locked()
            following = asyncio.create_task(probe.check())
            await asyncio.sleep(0)
            release.set()
            assert await following
        finally:
            release.set()

    asyncio.run(exercise())
    assert wrapped.execute.call_count == 1
    assert not db.lock.locked()


def test_readiness_never_commits_or_rolls_back(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE readiness_test (value INTEGER)")
    conn.execute("INSERT INTO readiness_test VALUES (42)")
    assert asyncio.run(DatabaseReadiness(Database(conn)).check())
    assert conn.in_transaction
    conn.rollback()
    assert conn.execute("SELECT * FROM readiness_test").fetchall() == []

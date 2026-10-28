"""Stale job-state writes are refused before any batched event takes effect."""

import sqlite3

import pytest
from fastapi.testclient import TestClient


def _job(client: TestClient, key: str) -> str:
    return client.post("/api/listings", json={"platform": "test", "platform_id": key}).json()[
        "job_id"
    ]


def _emit(client: TestClient, job_id: str, event: str, **extra):
    return client.post(
        "/api/events", json={"job_id": job_id, "events": [{"event": event}], **extra}
    )


@pytest.mark.parametrize("by_listing", [False, True])
def test_stale_skip_preserves_applied_status_flags_and_history(
    client: TestClient, conn: sqlite3.Connection, by_listing: bool
) -> None:
    job_id = _job(client, "first")
    _emit(client, job_id, "seen")
    _emit(client, job_id, "applied")
    before = client.get(f"/api/jobs/{job_id}").json()
    address = {"platform": "test", "platform_id": "first"} if by_listing else {"job_id": job_id}
    changes = conn.total_changes
    response = client.post(
        "/api/events",
        json={
            **address,
            "expected_status": "seen",
            "events": [
                {"event": "starred"},
                {"event": "note", "meta": {"note": "Must not persist"}},
                {"event": "skipped"},
            ],
        },
    )
    assert response.status_code == 409
    assert response.json() == {
        "detail": "stale_status",
        "current": {"job_id": job_id, "status": "applied", "hidden": False, "starred": False},
    }
    assert response.headers["cache-control"] == "no-store"
    assert client.get(f"/api/jobs/{job_id}").json() == before
    assert conn.total_changes == changes


def test_precondition_checks_initial_state_once_and_legacy_writes_remain_valid(
    client: TestClient,
) -> None:
    job_id = _job(client, "first")
    response = client.post(
        "/api/events",
        json={
            "job_id": job_id,
            "expected_status": "new",
            "events": [{"event": "seen"}, {"event": "to_apply"}, {"event": "starred"}],
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "to_apply"
    assert response.json()["starred"] is True
    assert _emit(client, job_id, "applied").json()["status"] == "applied"
    assert _emit(client, job_id, "skipped", expected_status="invalid").status_code == 422


def test_stale_listing_stub_is_rolled_back(client: TestClient, conn: sqlite3.Connection) -> None:
    response = client.post(
        "/api/events",
        json={
            "platform": "test",
            "platform_id": "missing",
            "expected_status": "seen",
            "events": [{"event": "skipped"}],
        },
    )
    assert response.status_code == 409
    assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone() == (0,)
    assert conn.execute("SELECT COUNT(*) FROM listings").fetchone() == (0,)
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone() == (0,)


def test_conditional_writes_resolve_aliases_and_guard_corrections_and_reverts(
    client: TestClient,
) -> None:
    source, target = _job(client, "source"), _job(client, "target")
    _emit(client, target, "applied")
    client.post(f"/api/jobs/{source}/link-job", json={"other_job_id": target})
    for path, body in (
        ("/api/events", {"job_id": source, "events": [{"event": "skipped"}]}),
        (f"/api/jobs/{source}/corrections", {"status": "skipped"}),
        (f"/api/jobs/{source}/status/revert", {}),
    ):
        response = client.post(path, json={**body, "expected_status": "seen"})
        assert response.status_code == 409
        assert response.json()["current"]["job_id"] == target
    correction = client.post(
        f"/api/jobs/{source}/corrections", json={"status": "to_apply", "expected_status": "applied"}
    )
    assert correction.status_code == 200
    reverted = client.post(
        f"/api/jobs/{source}/status/revert", json={"expected_status": "to_apply"}
    )
    assert reverted.status_code == 200
    assert reverted.json()["status"] == "applied"

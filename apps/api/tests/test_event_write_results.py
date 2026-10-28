"""Exact inserted/deleted event identities and explicit empty no-op results."""

import sqlite3
from unittest.mock import patch

from fastapi.testclient import TestClient


def _job(client: TestClient) -> str:
    return client.post("/api/listings", json={"platform": "test", "platform_id": "first"}).json()[
        "job_id"
    ]


def test_batch_returns_exact_ids_in_write_order_excluding_noops(client: TestClient) -> None:
    job_id = _job(client)
    response = client.post(
        "/api/events",
        json={
            "job_id": job_id,
            "events": [
                {"event": "seen"},
                {"event": "seen"},
                {"event": "starred"},
                {"event": "hidden", "meta": {"source": "test"}},
                {"event": "hidden", "meta": {"source": "test"}},
                {"event": "note", "meta": {"note": "First"}},
                {"event": "applied"},
            ],
        },
    )
    assert response.status_code == 200
    ids = response.json()["event_ids"]
    events = client.get(f"/api/jobs/{job_id}").json()["events"]
    assert ids == [event["id"] for event in events if event["event"] != "created"]
    assert [event["event"] for event in events if event["id"] in ids] == [
        "seen",
        "hidden",
        "note",
        "applied",
    ]
    assert response.json()["deleted_event_ids"] == []
    noop = client.post("/api/events", json={"job_id": job_id, "events": [{"event": "applied"}]})
    assert noop.json()["event_ids"] == []


def test_ids_are_exact_despite_backdating_and_shared_timestamps(client: TestClient) -> None:
    job_id = _job(client)
    client.post("/api/events", json={"job_id": job_id, "events": [{"event": "applied"}]})
    body = {"job_id": job_id, "ts": "2000-01-01T00:00:00Z", "events": [{"event": "note"}]}
    first = client.post("/api/events", json=body).json()["event_ids"]
    second = client.post("/api/events", json=body).json()["event_ids"]
    assert len(first) == len(second) == 1
    assert first != second
    updated = client.patch(f"/api/events/{first[0]}", json={"meta": {"note": "Exact row"}}).json()
    assert updated["id"] == first[0]
    assert updated["event"] == "note"


def test_correction_and_revert_return_created_and_deleted_ids(client: TestClient) -> None:
    job_id = _job(client)
    body = {"status": "applied"}
    correction = client.post(f"/api/jobs/{job_id}/corrections", json=body).json()
    [event_id] = correction["event_ids"]
    noop = client.post(f"/api/jobs/{job_id}/corrections", json=body).json()
    assert noop["event_ids"] == []
    reverted = client.post(f"/api/jobs/{job_id}/status/revert").json()
    assert reverted["event_ids"] == []
    assert reverted["deleted_event_ids"] == [event_id]
    assert reverted["status"] == "new"
    assert client.post(f"/api/jobs/{job_id}/status/revert").json()["deleted_event_ids"] == []


def test_listing_stub_event_is_not_misidentified_as_submitted_event(client: TestClient) -> None:
    response = client.post(
        "/api/events",
        json={"platform": "test", "platform_id": "new", "events": [{"event": "seen"}]},
    ).json()
    events = client.get(f"/api/jobs/{response['job_id']}").json()["events"]
    assert response["event_ids"] == [event["id"] for event in events if event["event"] == "seen"]


def test_event_insert_uses_returning_without_lastrowid(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    from app.events.repository import EventRepository

    job_id = _job(client)
    with patch("app.events.repository.execute", side_effect=AssertionError("Use RETURNING")):
        event_id = EventRepository(conn).insert(
            job_id, "note", "now", listing_id=None, meta=None, meta_hash=None
        )
    assert conn.execute("SELECT event FROM events WHERE id = ?", (event_id,)).fetchone() == (
        "note",
    )

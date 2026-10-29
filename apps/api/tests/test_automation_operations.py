"""Durable automation receipts survive edits, merges, reverts and deletion."""

import sqlite3
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.db import init_schema
from app.documents.repository import DocumentRepository
from app.events.repository import EventRepository


def _job(client: TestClient, key: str) -> str:
    response = client.post("/api/listings", json={"platform": "test", "platform_id": key})
    assert response.status_code == 200
    return response.json()["job_id"]


def _receipt(client: TestClient, kind: str, key: str) -> dict[str, Any]:
    response = client.get(f"/api/{kind}-operations", params={"operation_key": key})
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def test_document_operation_lookup_and_retry_preserve_identity_after_edit(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    job = _job(client, "document")
    body = {
        "operation_key": "run/doc?1",
        "type": "cv",
        "content": "Original",
        "meta": {"lang": "en"},
    }
    url = f"/api/jobs/{job}/documents"
    created = client.post(url, json=body)
    assert created.status_code == 201
    document = created.json()
    before = conn.total_changes
    receipt = _receipt(client, "document", body["operation_key"])
    assert receipt == {
        "operation_key": body["operation_key"],
        "document_id": document["id"],
        "job_id": job,
        "status": "present",
        "created_at": document["created_at"],
    }
    assert conn.total_changes == before
    edited = client.patch(f"/api/documents/{document['id']}", json={"content": "Edited"})
    before = conn.total_changes
    retry = client.post(url, json=body)
    assert retry.status_code == 200
    assert retry.json() == edited.json()
    assert _receipt(client, "document", body["operation_key"]) == receipt
    assert conn.total_changes == before
    for target, payload in ((job, {**body, "content": "Changed"}), (_job(client, "other"), body)):
        conflict = client.post(f"/api/jobs/{target}/documents", json=payload)
        assert conflict.status_code == 409
        assert conflict.json()["detail"] == "document_operation_key_conflict"


@pytest.mark.parametrize("delete_job", [False, True])
def test_deleted_document_operation_never_recreates(
    client: TestClient, conn: sqlite3.Connection, delete_job: bool
) -> None:
    job = _job(client, "deleted")
    url = f"/api/jobs/{job}/documents"
    body = {"operation_key": "deleted-doc", "type": "cv"}
    document = client.post(url, json=body).json()
    delete_url = f"/api/jobs/{job}" if delete_job else f"/api/documents/{document['id']}"
    assert client.delete(delete_url).status_code == 204
    before = conn.total_changes
    receipt = _receipt(client, "document", "deleted-doc")
    assert receipt["status"] == "deleted"
    retry = client.post(url, json=body)
    assert retry.status_code == 409
    assert retry.json() == {"detail": "document_operation_deleted", "current": receipt}
    assert conn.total_changes == before
    assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 0


@pytest.mark.parametrize("relink", [False, True])
def test_document_operations_follow_ownership_including_tombstones(
    client: TestClient, relink: bool
) -> None:
    source, target = _job(client, "source"), _job(client, "target")
    body = {"operation_key": "moving", "type": "cv"}
    document = client.post(f"/api/jobs/{source}/documents", json=body).json()
    tombstone = client.post(
        f"/api/jobs/{source}/documents", json={**body, "operation_key": "tombstone"}
    ).json()
    client.delete(f"/api/documents/{tombstone['id']}")
    if relink:
        listing = client.get(f"/api/jobs/{source}").json()["listings"][0]
        response = client.patch(f"/api/listings/{listing['id']}", json={"job_id": target})
    else:
        client.post("/api/events", json={"job_id": target, "events": [{"event": "applied"}]})
        response = client.post(f"/api/jobs/{source}/link-job", json={"other_job_id": target})
    assert response.status_code == 200
    for key in ("moving", "tombstone"):
        assert _receipt(client, "document", key)["job_id"] == target
    for address in (source, target):
        replay = client.post(f"/api/jobs/{address}/documents", json=body)
        assert replay.status_code == 200
        assert replay.json()["id"] == document["id"]
        assert replay.json()["job_id"] == target
        deleted = client.post(
            f"/api/jobs/{address}/documents", json={**body, "operation_key": "tombstone"}
        )
        assert deleted.status_code == 409
        assert deleted.json()["detail"] == "document_operation_deleted"


@pytest.mark.parametrize("verb", ["applied", "note", "starred"])
def test_event_operations_replay_original_result_after_later_changes(
    client: TestClient, conn: sqlite3.Connection, verb: str
) -> None:
    job = _job(client, verb)
    body = {
        "operation_key": "event",
        "job_id": job,
        "expected_status": "new",
        "events": [{"event": verb, "meta": {"note": "original"}}],
    }
    first = client.post("/api/events", json=body)
    assert first.status_code == 200
    result = first.json()
    assert len(result["event_ids"]) == 1
    if verb == "note":
        assert client.delete(f"/api/events/{result['event_ids'][0]}").status_code == 204
    elif verb == "applied":
        assert client.post(f"/api/jobs/{job}/status/revert").status_code == 200
    else:
        client.post("/api/events", json={"job_id": job, "events": [{"event": "unstarred"}]})
    client.post(f"/api/jobs/{job}/corrections", json={"status": "seen"})
    before = conn.total_changes
    assert client.post("/api/events", json=body).json() == result
    receipt = _receipt(client, "event", "event")
    assert receipt["result"] == result
    assert conn.total_changes == before
    conflict = client.post("/api/events", json={**body, "expected_status": "seen"})
    assert conflict.status_code == 409
    assert conflict.json() == {"detail": "event_operation_key_conflict", "current": receipt}
    assert conn.total_changes == before
    assert client.get(f"/api/jobs/{job}").json()["status"] == "seen"


def test_noop_event_operation_is_durable_even_after_job_deletion(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    body = {
        "operation_key": "noop",
        "platform": "test",
        "platform_id": "stub",
        "events": [{"event": "unstarred"}],
    }
    first = client.post("/api/events", json=body)
    assert first.status_code == 200
    result = first.json()
    assert result["event_ids"] == []
    assert client.delete(f"/api/jobs/{result['job_id']}").status_code == 204
    before = conn.total_changes
    assert _receipt(client, "event", "noop")["result"] == result
    assert client.post("/api/events", json=body).json() == result
    assert conn.total_changes == before
    assert client.get("/api/jobs").json() == []


def test_event_receipt_remains_historical_after_merge(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    source, target = _job(client, "source"), _job(client, "target")
    body = {"operation_key": "merged", "job_id": source, "events": [{"event": "note"}]}
    first = client.post("/api/events", json=body).json()
    client.post("/api/events", json={"job_id": target, "events": [{"event": "applied"}]})
    assert (
        client.post(f"/api/jobs/{source}/link-job", json={"other_job_id": target}).status_code
        == 200
    )
    before = conn.total_changes
    assert client.post("/api/events", json=body).json() == first
    assert _receipt(client, "event", "merged")["result"] == first
    assert conn.total_changes == before
    assert client.get(f"/api/jobs/{source}").json()["id"] == target


def test_failed_event_precondition_does_not_consume_key_or_materialize_stub(
    client: TestClient,
) -> None:
    body = {
        "operation_key": "failed",
        "platform": "test",
        "platform_id": "unseen",
        "events": [{"event": "note"}],
        "expected_status": "seen",
    }
    assert client.post("/api/events", json=body).status_code == 409
    assert (
        client.get("/api/event-operations", params={"operation_key": "failed"}).status_code == 404
    )
    assert client.get("/api/jobs").json() == []
    assert client.post("/api/events", json={**body, "expected_status": "new"}).status_code == 200


@pytest.mark.parametrize("kind", ["document", "event"])
def test_receipt_failure_rolls_back_the_write(
    client: TestClient, conn: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    job = _job(client, "rollback")
    before = client.get(f"/api/jobs/{job}").json()
    repository = DocumentRepository if kind == "document" else EventRepository
    original = repository.remember_operation

    def fail(*args: Any, **kwargs: Any) -> None:
        original(*args, **kwargs)
        raise RuntimeError("receipt failure")

    monkeypatch.setattr(repository, "remember_operation", fail)
    url = f"/api/jobs/{job}/documents" if kind == "document" else "/api/events"
    payload = (
        {"type": "cv"} if kind == "document" else {"job_id": job, "events": [{"event": "applied"}]}
    )
    with pytest.raises(RuntimeError, match="receipt failure"):
        client.post(url, json={**payload, "operation_key": "rollback"})
    assert client.get(f"/api/jobs/{job}").json() == before
    assert conn.execute(f"SELECT count(*) FROM {kind}_operations").fetchone()[0] == 0


@pytest.mark.parametrize("kind", ["document", "event"])
def test_operation_lookup_missing_and_invalid_keys_never_write(
    client: TestClient, conn: sqlite3.Connection, kind: str
) -> None:
    before = conn.total_changes
    missing = client.get(f"/api/{kind}-operations", params={"operation_key": "missing"})
    assert missing.status_code == 404
    assert missing.headers["cache-control"] == "no-store"
    for key in ("", " ", "x" * 201):
        response = client.get(f"/api/{kind}-operations", params={"operation_key": key})
        assert response.status_code == 422
        assert response.headers["cache-control"] == "no-store"
        job = "missing"
        url = f"/api/jobs/{job}/documents" if kind == "document" else "/api/events"
        payload = (
            {"type": "cv"} if kind == "document" else {"job_id": job, "events": [{"event": "note"}]}
        )
        assert client.post(url, json={**payload, "operation_key": key}).status_code == 422
    assert conn.total_changes == before


def test_document_retry_key_modes_are_exclusive(client: TestClient) -> None:
    job = _job(client, "exclusive")
    response = client.post(
        f"/api/jobs/{job}/documents",
        json={"operation_key": "new", "creation_key": "old", "type": "cv"},
    )
    assert response.status_code == 422


def test_operation_migrations_upgrade_and_repeat_without_rewriting_existing_data() -> None:
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    init_schema(conn)
    for kind in ("document", "event"):
        conn.execute(f"DROP TABLE {kind}_operations")
        conn.execute(
            "DELETE FROM schema_migrations WHERE key = ?", (f"create_{kind}_operations_v1",)
        )
    conn.execute("INSERT INTO jobs (id, created_at, updated_at) VALUES ('j1', 't', 't')")
    conn.execute(
        "INSERT INTO documents (job_id, type, created_at, updated_at) VALUES ('j1', 'cv', 't', 't')"
    )
    conn.commit()
    init_schema(conn)
    assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 1
    conn.execute("INSERT INTO document_operations VALUES ('doc', 1, 'j1', 'hash', 't')")
    conn.execute("INSERT INTO event_operations VALUES ('event', 'hash', '{}', 't')")
    conn.commit()
    before = conn.total_changes
    init_schema(conn)
    assert conn.total_changes == before
    for kind in ("document", "event"):
        assert conn.execute(f"SELECT count(*) FROM {kind}_operations").fetchone()[0] == 1
        assert (
            conn.execute(
                "SELECT count(*) FROM schema_migrations WHERE key = ?",
                (f"create_{kind}_operations_v1",),
            ).fetchone()[0]
            == 1
        )
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()


@pytest.mark.parametrize("kind", ["document", "event"])
def test_simultaneous_retries_commit_one_operation(kind: str) -> None:
    """Use production transaction/admission dependencies, not the fixture override."""
    import asyncio

    import httpx
    from fastapi import FastAPI

    from app.core.db import Database
    from app.documents.router import router as documents_router
    from app.events.router import router as events_router

    async def exercise() -> None:
        conn = sqlite3.connect(":memory:", check_same_thread=False)
        try:
            init_schema(conn)
            conn.execute("INSERT INTO jobs (id, created_at, updated_at) VALUES ('j1', 't', 't')")
            conn.commit()
            app = FastAPI()
            app.state.db = Database(conn)
            app.include_router(documents_router, prefix="/api")
            app.include_router(events_router, prefix="/api")
            url = "/api/jobs/j1/documents" if kind == "document" else "/api/events"
            body: dict[str, Any] = {"operation_key": "concurrent"}
            if kind == "document":
                body.update(type="cv", content="One document")
            else:
                body.update(
                    job_id="j1",
                    expected_status="new",
                    events=[{"event": "note"}, {"event": "applied"}],
                )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                responses = await asyncio.wait_for(
                    asyncio.gather(*(client.post(url, json=body) for _ in range(8))), timeout=10
                )
                assert all(r.is_success for r in responses), [r.text for r in responses]
                assert all(r.json() == responses[0].json() for r in responses)
                if kind == "document":
                    assert [r.status_code for r in responses].count(201) == 1
                    assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 1
                else:
                    assert len(responses[0].json()["event_ids"]) == 2
                    assert conn.execute("SELECT count(*) FROM events").fetchone()[0] == 2
                assert conn.execute(f"SELECT count(*) FROM {kind}_operations").fetchone()[0] == 1
        finally:
            conn.close()

    asyncio.run(exercise())

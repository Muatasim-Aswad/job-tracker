"""Document retry identity and its lifecycle through edits, merges, and deletion."""

import sqlite3

from fastapi.testclient import TestClient

from app.core.db import init_schema


def _job(client: TestClient, key: str) -> str:
    response = client.post("/api/listings", json={"platform": "test", "platform_id": key})
    assert response.status_code == 200
    return response.json()["job_id"]


def test_retry_returns_same_document_without_writes_and_original_payload_survives_edits(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    job_id = _job(client, "first")
    url = f"/api/jobs/{job_id}/documents"
    body = {"creation_key": "run:1:cv", "type": "cv", "content": "Original"}
    first = client.post(url, json=body)
    assert first.status_code == 201
    before = conn.total_changes
    retry = client.post(url, json=body)
    assert retry.status_code == 200
    assert retry.json() == first.json()
    assert conn.total_changes == before
    edited = client.patch(f"/api/documents/{first.json()['id']}", json={"content": "Edited"})
    before = conn.total_changes
    assert client.post(url, json=body).json() == edited.json()
    assert conn.total_changes == before
    assert len(client.get(f"/api/jobs/{job_id}").json()["documents"]) == 1


def test_creation_key_reuse_with_changed_payload_or_other_job_is_conflict(
    client: TestClient,
) -> None:
    first, second = _job(client, "first"), _job(client, "second")
    body = {"creation_key": "run:1:cv", "type": "cv", "content": "Original"}
    original = client.post(f"/api/jobs/{first}/documents", json=body).json()
    for job_id, payload in ((first, {**body, "content": "Different"}), (second, body)):
        response = client.post(f"/api/jobs/{job_id}/documents", json=payload)
        assert response.status_code == 409
        assert response.json() == {
            "detail": "document_creation_key_conflict",
            "current": {"document_id": original["id"], "job_id": first},
        }
    assert len(client.get(f"/api/jobs/{first}").json()["documents"]) == 1
    assert client.get(f"/api/jobs/{second}").json()["documents"] == []


def test_retry_follows_document_through_merge_and_old_alias(client: TestClient) -> None:
    source, target = _job(client, "source"), _job(client, "target")
    body = {"creation_key": "run:1:cv", "type": "cv"}
    created = client.post(f"/api/jobs/{source}/documents", json=body).json()
    client.post("/api/events", json={"job_id": target, "events": [{"event": "applied"}]})
    merged = client.post(f"/api/jobs/{source}/link-job", json={"other_job_id": target})
    assert merged.json()["job_id"] == target
    for job_id in (source, target):
        response = client.post(f"/api/jobs/{job_id}/documents", json=body)
        assert response.status_code == 200
        assert response.json()["id"] == created["id"]
        assert response.json()["job_id"] == target
        assert response.headers["content-location"] == f"/api/jobs/{target}"


def test_unkeyed_creates_remain_distinct_and_deletion_releases_key(client: TestClient) -> None:
    job_id = _job(client, "first")
    url = f"/api/jobs/{job_id}/documents"
    first = client.post(url, json={"type": "cv"}).json()
    second = client.post(url, json={"type": "cv"}).json()
    assert first["id"] != second["id"]
    body = {"type": "cv", "creation_key": "run:1:cv"}
    keyed = client.post(url, json=body).json()
    assert client.delete(f"/api/documents/{keyed['id']}").status_code == 204
    recreated = client.post(url, json=body)
    assert recreated.status_code == 201
    assert recreated.json()["id"] != keyed["id"]
    for key in ("", "   ", "x" * 201):
        assert client.post(url, json={"type": "cv", "creation_key": key}).status_code == 422


def test_document_creation_migration_preserves_old_documents_and_is_repeatable() -> None:
    conn = sqlite3.connect(":memory:")
    init_schema(conn)
    conn.execute(
        "INSERT INTO jobs (id, status, hidden, starred, created_at, updated_at) VALUES ('old', 'new', 0, 0, 'now', 'now')"
    )
    conn.execute(
        "INSERT INTO documents (job_id, type, provided, created_at, updated_at) VALUES ('old', 'cv', 1, 'now', 'now')"
    )
    conn.execute("DROP TABLE document_creations")
    conn.execute("DELETE FROM schema_migrations WHERE key = 'create_document_creations_v1'")
    conn.commit()
    init_schema(conn)
    assert conn.execute("SELECT COUNT(*) FROM documents").fetchone() == (1,)
    conn.execute("INSERT INTO document_creations VALUES ('key', 1, 'hash')")
    conn.commit()
    init_schema(conn)
    assert conn.execute("SELECT * FROM document_creations").fetchall() == [("key", 1, "hash")]
    assert conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE key = 'create_document_creations_v1'"
    ).fetchone() == (1,)
    conn.close()

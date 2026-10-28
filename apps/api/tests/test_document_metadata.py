"""Document metadata round trips, patch semantics, retries, and additive migration."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.core.db import _SCHEMA_PATH, init_schema


def _job(client: TestClient, key: str) -> str:
    return client.post("/api/listings", json={"platform": "test", "platform_id": key}).json()[
        "job_id"
    ]


def test_metadata_round_trips_and_patches_replace_preserve_or_clear(client: TestClient) -> None:
    job_id = _job(client, "first")
    url = f"/api/jobs/{job_id}/documents"
    meta = {
        "source": "agent",
        "artifact_ref": "artifact:123",
        "language": "en",
        "nested": {"version": 2},
        "labels": ["reviewed"],
        "verified": True,
    }
    document = client.post(url, json={"type": "cv", "meta": meta}).json()
    assert document["meta"] == meta
    document_url = f"/api/documents/{document['id']}"
    edited = client.patch(document_url, json={"content": "Updated"})
    assert edited.json()["meta"] == meta
    assert client.patch(document_url, json={"meta": {"version": 3}}).json()["meta"] == {
        "version": 3
    }
    assert client.get(f"/api/jobs/{job_id}").json()["documents"][0]["meta"] == {"version": 3}
    for empty in (None, {}):
        assert client.patch(document_url, json={"meta": empty}).json()["meta"] == {}
    assert client.post(url, json={"type": "cv"}).json()["meta"] == {}


def test_metadata_participates_in_retry_identity_and_moves_with_document(
    client: TestClient,
) -> None:
    source, target = _job(client, "source"), _job(client, "target")
    url = f"/api/jobs/{source}/documents"
    body = {"type": "cv", "creation_key": "run:1:cv", "meta": {"source": "agent", "version": 1}}
    created = client.post(url, json=body).json()
    reordered = {**body, "meta": {"version": 1, "source": "agent"}}
    assert client.post(url, json=reordered).json() == created
    changed = client.post(url, json={**body, "meta": {"version": 2}})
    assert changed.status_code == 409
    client.post("/api/events", json={"job_id": target, "events": [{"event": "applied"}]})
    client.post(f"/api/jobs/{source}/link-job", json={"other_job_id": target})
    retry = client.post(url, json=body)
    assert retry.status_code == 200
    assert retry.json()["id"] == created["id"]
    assert retry.json()["meta"] == body["meta"]
    assert retry.json()["job_id"] == target


@pytest.mark.parametrize("invalid", [[], "text", 12, False])
def test_metadata_requires_json_object(client: TestClient, invalid) -> None:
    job_id = _job(client, "first")
    url = f"/api/jobs/{job_id}/documents"
    assert client.post(url, json={"type": "cv", "meta": invalid}).status_code == 422
    document = client.post(url, json={"type": "cv"}).json()
    assert (
        client.patch(f"/api/documents/{document['id']}", json={"meta": invalid}).status_code == 422
    )


def test_metadata_migration_preserves_legacy_data_and_reruns_without_changes() -> None:
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_PATH.read_text())
    conn.execute("INSERT INTO jobs (id, created_at, updated_at) VALUES ('old', 'now', 'now')")
    conn.execute(
        "INSERT INTO documents (job_id, type, content, created_at, updated_at) VALUES ('old', 'cv', 'Keep content', 'now', 'now')"
    )
    conn.commit()
    assert "meta" not in {row[1] for row in conn.execute("PRAGMA table_info(documents)")}
    init_schema(conn)
    assert conn.execute("SELECT content, meta FROM documents").fetchone() == ("Keep content", None)
    conn.execute('UPDATE documents SET meta = \'{"source":"test"}\'')
    conn.commit()
    init_schema(conn)
    assert conn.execute("SELECT content, meta FROM documents").fetchone() == (
        "Keep content",
        '{"source":"test"}',
    )
    conn.close()

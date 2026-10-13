"""Canonical job identity after merges, including retained foreign-key context."""

import sqlite3
from typing import Any

from fastapi.testclient import TestClient


def _listing(client: TestClient, platform_id: str, **extra: Any) -> dict[str, Any]:
    response = client.post(
        "/api/listings", json={"platform": "linkedin", "platform_id": platform_id, **extra}
    )
    assert response.status_code == 200, response.text
    return response.json()


def _capture(conn: sqlite3.Connection, capture_id: str, job_id: str, listing_id: str) -> None:
    question_id = f"question-{capture_id}"
    conn.execute(
        "INSERT INTO form_questions ("
        "id, signature, identity_kind, site_scope, adapter_id, adapter_version, "
        "stable_field_key, normalizer_version, control_kind, normalized_question, "
        "raw_question, normalized_section, normalized_help, autocomplete_token, "
        "option_set_hash, review_state, last_seen_scan_id, first_seen_at, last_seen_at"
        ") VALUES (?, ?, 'stable', 'linkedin', 'linkedin', '1', ?, 1, 'text', "
        "'question', 'Question', '', '', '', 'options', 'open', 'scan', '2026-01-01', "
        "'2026-01-01')",
        (question_id, f"signature-{capture_id}", f"field-{capture_id}"),
    )
    conn.execute(
        "INSERT INTO form_captures ("
        "id, capture_key, question_id, application_context_id, job_id, listing_id, "
        "source, value_kind, value_json, status, created_at, updated_at"
        ") VALUES (?, ?, ?, 'application', ?, ?, 'user_input', 'text', '\"value\"', "
        "'current', '2026-01-01', '2026-01-01')",
        (capture_id, f"capture-key-{capture_id}", question_id, job_id, listing_id),
    )
    conn.commit()


def test_merge_keeps_old_id_resolvable_and_moves_form_capture_context(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    survivor = _listing(client, "original", title="Original")
    client.post("/api/events", json={"job_id": survivor["job_id"], "events": [{"event": "seen"}]})
    loser = _listing(client, "repost", title="Repost")
    _capture(conn, "capture-1", loser["job_id"], loser["listing_id"])
    client.post("/api/search-log", json={"query": "Repost", "job_id": loser["job_id"]})

    merged = client.post(
        "/api/listings/link-job",
        json={"platform": "linkedin", "platform_id": "repost", "other_job_id": survivor["job_id"]},
    )
    assert merged.status_code == 200, merged.text
    assert merged.json()["job_id"] == survivor["job_id"]
    assert merged.json()["merged_from"] == [loser["job_id"]]
    assert conn.execute(
        "SELECT canonical_job_id FROM job_id_aliases WHERE old_job_id = ?", (loser["job_id"],)
    ).fetchone() == (survivor["job_id"],)
    assert conn.execute(
        "SELECT job_id, listing_id FROM form_captures WHERE id = 'capture-1'"
    ).fetchone() == (survivor["job_id"], loser["listing_id"])
    # Search diagnostics retain what was clicked at the time; aliases give that raw
    # historical id a current meaning without rewriting the diagnostic row.
    assert client.get("/api/search-log").json()[0]["job_id"] == loser["job_id"]

    detail = client.get(f"/api/jobs/{loser['job_id']}")
    assert detail.status_code == 200
    assert detail.headers["content-location"] == f"/api/jobs/{survivor['job_id']}"
    assert detail.json()["id"] == survivor["job_id"]

    updated = client.patch(f"/api/jobs/{loser['job_id']}", json={"title": "Canonical"})
    assert updated.status_code == 200
    assert updated.json()["id"] == survivor["job_id"]
    assert updated.headers["content-location"] == f"/api/jobs/{survivor['job_id']}"

    state = client.post(
        "/api/events", json={"job_id": loser["job_id"], "events": [{"event": "applied"}]}
    )
    assert state.status_code == 200
    assert state.json()["job_id"] == survivor["job_id"]
    assert state.headers["content-location"] == f"/api/jobs/{survivor['job_id']}"

    document = client.post(f"/api/jobs/{loser['job_id']}/documents", json={"type": "cover_letter"})
    assert document.status_code == 201
    assert document.json()["job_id"] == survivor["job_id"]
    assert document.headers["content-location"] == f"/api/jobs/{survivor['job_id']}"

    refused = client.delete(f"/api/jobs/{loser['job_id']}")
    assert refused.status_code == 409
    assert refused.json() == {
        "detail": "job_merged",
        "current": {"requested_job_id": loser["job_id"], "canonical_job_id": survivor["job_id"]},
    }


def test_later_merge_flattens_existing_aliases(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    first = _listing(client, "first", title="Role")
    client.post("/api/events", json={"job_id": first["job_id"], "events": [{"event": "seen"}]})
    second = _listing(client, "second", title="Role")
    third = _listing(client, "third", title="Role")
    client.post("/api/events", json={"job_id": third["job_id"], "events": [{"event": "applied"}]})

    client.post(
        "/api/listings/link-job",
        json={"platform": "linkedin", "platform_id": "second", "other_job_id": first["job_id"]},
    )
    merged_again = client.post(
        "/api/listings/link-job",
        json={"platform": "linkedin", "platform_id": "first", "other_job_id": third["job_id"]},
    )
    assert merged_again.json()["job_id"] == third["job_id"]
    assert merged_again.json()["merged_from"] == [first["job_id"]]
    assert conn.execute(
        "SELECT old_job_id, canonical_job_id FROM job_id_aliases ORDER BY old_job_id"
    ).fetchall() == sorted(
        [(first["job_id"], third["job_id"]), (second["job_id"], third["job_id"])]
    )
    assert client.get(f"/api/jobs/{second['job_id']}").json()["id"] == third["job_id"]


def test_relink_and_delete_keep_form_capture_foreign_keys_valid(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    source = _listing(client, "source", title="Source")
    moved = _listing(client, "moved", title="Source", job_id=source["job_id"])
    target = _listing(client, "target", title="Target")
    _capture(conn, "capture-2", source["job_id"], moved["listing_id"])

    relinked = client.patch(
        f"/api/listings/{moved['listing_id']}", json={"job_id": target["job_id"]}
    )
    assert relinked.status_code == 200, relinked.text
    assert conn.execute(
        "SELECT job_id, listing_id FROM form_captures WHERE id = 'capture-2'"
    ).fetchone() == (target["job_id"], moved["listing_id"])

    assert client.delete(f"/api/listings/{moved['listing_id']}").status_code == 204
    assert conn.execute(
        "SELECT job_id, listing_id FROM form_captures WHERE id = 'capture-2'"
    ).fetchone() == (target["job_id"], None)

    assert client.delete(f"/api/jobs/{target['job_id']}").status_code == 204
    assert conn.execute(
        "SELECT job_id, listing_id FROM form_captures WHERE id = 'capture-2'"
    ).fetchone() == (None, None)

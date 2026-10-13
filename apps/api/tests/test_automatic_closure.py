from __future__ import annotations

import sqlite3
from typing import Any

from fastapi.testclient import TestClient

CLOSED_AT = "2026-07-20T12:00:00+00:00"


def _listing(client: TestClient, platform_id: str, **extra: Any) -> dict[str, Any]:
    response = client.post(
        "/api/listings",
        json={"platform": "linkedin", "platform_id": platform_id, "title": "Role", **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _close(client: TestClient, platform_id: str, closed_at: str = CLOSED_AT) -> None:
    response = client.post(
        "/api/listings",
        json={"platform": "linkedin", "platform_id": platform_id, "closed_at": closed_at},
    )
    assert response.status_code == 200, response.text


def _detail(client: TestClient, job_id: str) -> dict[str, Any]:
    response = client.get(f"/api/jobs/{job_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _event(client: TestClient, job_id: str, event: str, **extra: Any) -> None:
    response = client.post(
        "/api/events", json={"job_id": job_id, "events": [{"event": event, **extra}]}
    )
    assert response.status_code == 200, response.text


def _automatic_events(detail: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        event
        for event in detail["events"]
        if event["event"] == "closed"
        and event["meta"]
        and event["meta"].get("source") == "automatic"
    ]


def test_closes_only_after_every_listing_is_closed(client: TestClient) -> None:
    first = _listing(client, "1")
    job_id = first["job_id"]
    _listing(client, "2", job_id=job_id)
    _event(client, job_id, "seen")

    _close(client, "1")
    assert _detail(client, job_id)["status"] == "seen"

    _close(client, "2")
    detail = _detail(client, job_id)
    assert detail["status"] == "closed"
    assert _automatic_events(detail)[-1]["meta"] == {
        "source": "automatic",
        "reason": "all_listings_closed",
    }


def test_reopening_a_listing_supersedes_automatic_closure(client: TestClient) -> None:
    listing = _listing(client, "1")
    job_id = listing["job_id"]
    _event(client, job_id, "seen")
    _close(client, "1")

    response = client.patch(f"/api/listings/{listing['listing_id']}", json={"closed_at": None})

    assert response.status_code == 200, response.text
    detail = _detail(client, job_id)
    assert detail["status"] == "seen"
    automatic = _automatic_events(detail)[-1]
    assert automatic["meta"]["invalidated_reason"] == "open_listing"
    assert automatic["meta"]["invalidated_at"]


def test_repeated_closed_capture_does_not_override_manual_correction(client: TestClient) -> None:
    listing = _listing(client, "1")
    job_id = listing["job_id"]
    _event(client, job_id, "seen")
    _close(client, "1")

    corrected = client.post(f"/api/jobs/{job_id}/corrections", json={"status": "seen"})
    assert corrected.status_code == 200
    assert corrected.json()["status"] == "seen"
    _close(client, "1")

    detail = _detail(client, job_id)
    assert detail["status"] == "seen"
    assert len(_automatic_events(detail)) == 1
    assert _automatic_events(detail)[0]["meta"]["invalidated_reason"] == "manual_correction"


def test_relinking_open_listing_repairs_receiver_and_closes_source(client: TestClient) -> None:
    closed = _listing(client, "1")
    source_job_id = closed["job_id"]
    open_listing = _listing(client, "2", job_id=source_job_id)
    _event(client, source_job_id, "seen")
    _close(client, "1")
    receiver = _listing(client, "3")

    moved = client.patch(
        f"/api/listings/{open_listing['listing_id']}", json={"job_id": receiver["job_id"]}
    )

    assert moved.status_code == 200, moved.text
    assert _detail(client, source_job_id)["status"] == "closed"
    assert _detail(client, receiver["job_id"])["status"] == "new"


def test_relinking_open_listing_supersedes_receiver_automatic_closure(client: TestClient) -> None:
    receiver = _listing(client, "1")
    receiver_id = receiver["job_id"]
    _event(client, receiver_id, "seen")
    _close(client, "1")
    donor = _listing(client, "2")

    response = client.patch(f"/api/listings/{donor['listing_id']}", json={"job_id": receiver_id})

    assert response.status_code == 200, response.text
    detail = _detail(client, receiver_id)
    assert detail["status"] == "seen"
    assert _automatic_events(detail)[-1]["meta"]["invalidated_reason"] == "open_listing"


def test_merging_open_repost_supersedes_automatic_closure(client: TestClient) -> None:
    original = _listing(client, "1")
    original_id = original["job_id"]
    _event(client, original_id, "seen")
    _close(client, "1")
    _listing(client, "2")

    response = client.post(
        "/api/listings/link-job",
        json={"platform": "linkedin", "platform_id": "2", "other_job_id": original_id},
    )

    assert response.status_code == 200, response.text
    detail = _detail(client, response.json()["job_id"])
    assert detail["status"] == "seen"
    assert _automatic_events(detail)[-1]["meta"]["invalidated_reason"] == "open_listing"


def test_manual_closure_is_not_reversed_by_open_listing(client: TestClient) -> None:
    listing = _listing(client, "1")
    job_id = listing["job_id"]
    _event(client, job_id, "closed", meta={"source": "manual"})

    _listing(client, "2", job_id=job_id)

    detail = _detail(client, job_id)
    assert detail["status"] == "closed"
    manual = [event for event in detail["events"] if event["event"] == "closed"][-1]
    assert manual["meta"] == {"source": "manual"}


def test_applied_job_stays_applied_when_every_listing_closes(client: TestClient) -> None:
    listing = _listing(client, "1")
    job_id = listing["job_id"]
    _event(client, job_id, "applied")

    _close(client, "1")

    detail = _detail(client, job_id)
    assert detail["status"] == "applied"
    assert _automatic_events(detail) == []


def test_applied_history_wins_when_merged_with_automatic_closure(client: TestClient) -> None:
    applied = _listing(client, "1")
    _event(client, applied["job_id"], "applied")
    _close(client, "1")
    repost = _listing(client, "2")
    _event(client, repost["job_id"], "seen")
    _close(client, "2")

    response = client.post(
        "/api/listings/link-job",
        json={"platform": "linkedin", "platform_id": "2", "other_job_id": applied["job_id"]},
    )

    detail = _detail(client, response.json()["job_id"])
    assert detail["status"] == "applied"
    assert _automatic_events(detail)[-1]["meta"]["invalidated_reason"] == "authoritative_status"


def test_applied_receiver_wins_when_automatic_job_is_relinked(client: TestClient) -> None:
    receiver = _listing(client, "1")
    _event(client, receiver["job_id"], "applied")
    _close(client, "1")
    donor = _listing(client, "2")
    _event(client, donor["job_id"], "seen")
    _close(client, "2")

    response = client.patch(
        f"/api/listings/{donor['listing_id']}", json={"job_id": receiver["job_id"]}
    )

    assert response.status_code == 200, response.text
    detail = _detail(client, receiver["job_id"])
    assert detail["status"] == "applied"
    assert _automatic_events(detail)[-1]["meta"]["invalidated_reason"] == "authoritative_status"


def test_closing_a_listing_adopts_an_adjacent_provenance_less_closed_event(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    # Older extensions post a provenance-less closed event beside the listing close.
    # Adoption must keep that closure reversible when the listing reopens.
    first = _listing(client, "1")
    job_id = first["job_id"]
    _listing(client, "2", job_id=job_id)
    response = client.post(
        "/api/events", json={"job_id": job_id, "ts": CLOSED_AT, "events": [{"event": "closed"}]}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    conn.execute("UPDATE events SET meta = NULL, meta_hash = NULL WHERE event = 'closed'")
    conn.commit()

    _close(client, "1")

    detail = _detail(client, job_id)
    automatic = _automatic_events(detail)[-1]
    assert automatic["meta"]["legacy"] is True
    assert automatic["meta"]["reason"] == "listing_closed"
    # One listing is still open, so the adopted closure is not authoritative.
    assert detail["status"] == "new"
    assert automatic["meta"]["invalidated_reason"] == "open_listing"

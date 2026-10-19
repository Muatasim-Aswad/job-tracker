from __future__ import annotations

import sqlite3
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.db import _SCHEMA_PATH, init_schema

GRAY = "Not currently accepting applications"
RED = "No longer accepting applications"
EARLIER = "2026-10-19T10:00:00+00:00"
LATER = "2026-10-19T11:00:00+00:00"


def capture(client: TestClient, **fields: object) -> dict[str, object]:
    response = client.post(
        "/api/listings", json={"platform": "linkedin", "platform_id": "1", **fields}
    )
    assert response.status_code == 200, response.text
    return response.json()


def detail(client: TestClient, job_id: object) -> dict:
    return client.get(f"/api/jobs/{job_id}").json()


@pytest.mark.parametrize("status", ["seen", "to_apply", "applied", "in_process"])
def test_gray_notice_preserves_funnel_and_capture_evidence(client: TestClient, status: str) -> None:
    ids = capture(client, title="Example role", company="Example Labs")
    client.post("/api/events", json={"job_id": ids["job_id"], "events": [{"event": status}]})
    capture(
        client,
        availability="unavailable",
        availability_message=GRAY,
        availability_observed_at=EARLIER,
    )
    job = detail(client, ids["job_id"])
    listing = job["listings"][0]
    assert job["status"] == status
    assert listing["availability"] == "unavailable"
    assert listing["availability_message"] == GRAY
    assert listing["availability_observed_at"] == EARLIER
    assert listing["closed_at"] is None
    assert not any(event["event"] == "closed" for event in job["events"])


def test_positive_open_observation_replaces_notice_and_partial_capture_preserves_it(
    client: TestClient,
) -> None:
    ids = capture(
        client,
        availability="unavailable",
        availability_message=GRAY,
        availability_observed_at=EARLIER,
    )
    capture(client, availability="open", availability_observed_at=LATER)
    capture(client, meta_patch={"location": "Example City"})
    capture(client, availability="unknown")
    listing = detail(client, ids["job_id"])["listings"][0]
    assert listing["availability"] == "open"
    assert listing["availability_message"] is None
    assert listing["availability_observed_at"] == LATER


def test_late_observation_cannot_replace_newer_availability_or_reclose(client: TestClient) -> None:
    ids = capture(client, availability="open", availability_observed_at=LATER)
    capture(
        client, availability="closed", availability_message=RED, availability_observed_at=EARLIER
    )
    job = detail(client, ids["job_id"])
    assert job["status"] == "new"
    assert job["listings"][0]["availability"] == "open"
    assert job["listings"][0]["closed_at"] is None


def test_positive_apply_evidence_reopens_automatic_closure(client: TestClient) -> None:
    ids = capture(
        client, availability="closed", availability_message=RED, availability_observed_at=EARLIER
    )
    assert detail(client, ids["job_id"])["status"] == "closed"
    capture(client, availability="open", availability_observed_at=LATER)
    job = detail(client, ids["job_id"])
    assert job["status"] == "new"
    assert job["listings"][0]["closed_at"] is None
    assert job["listings"][0]["availability"] == "open"


def test_gray_notice_does_not_undo_prior_closure(client: TestClient) -> None:
    ids = capture(
        client, availability="closed", availability_message=RED, availability_observed_at=EARLIER
    )
    capture(
        client,
        availability="unavailable",
        availability_message=GRAY,
        availability_observed_at=LATER,
    )
    job = detail(client, ids["job_id"])
    assert job["status"] == "closed"
    assert job["listings"][0]["availability"] == "closed"
    assert job["listings"][0]["availability_message"] == GRAY


def test_positive_apply_evidence_preserves_manual_closure(client: TestClient) -> None:
    ids = capture(client)
    client.post("/api/events", json={"job_id": ids["job_id"], "events": [{"event": "closed"}]})
    capture(client, availability="open", availability_observed_at=LATER)
    assert detail(client, ids["job_id"])["status"] == "closed"


def test_legacy_closed_at_capture_and_explicit_reopening_remain_consistent(
    client: TestClient,
) -> None:
    ids = capture(client, closed_at=EARLIER)
    assert detail(client, ids["job_id"])["listings"][0]["availability"] == "closed"
    response = client.patch(f"/api/listings/{ids['listing_id']}", json={"closed_at": None})
    assert response.status_code == 200
    assert detail(client, ids["job_id"])["listings"][0]["availability"] == "unknown"


@pytest.mark.parametrize(
    "fields",
    [
        {"availability": "paused"},
        {"availability_message": GRAY},
        {"availability": "open", "closed_at": EARLIER},
        {"availability": "open", "availability_observed_at": "2026-10-19T10:00:00"},
    ],
)
def test_invalid_availability_evidence_is_rejected(client: TestClient, fields: dict) -> None:
    assert (
        client.post(
            "/api/listings", json={"platform": "linkedin", "platform_id": "1", **fields}
        ).status_code
        == 422
    )


def test_additive_availability_migration_upgrades_old_shape_once() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        # Construct the released baseline before additive columns were introduced.
        with patch("app.core.db._COLUMN_MIGRATIONS", ()):
            init_schema(conn, _SCHEMA_PATH)
        conn.execute(
            "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ('j1', 'seen', 't', 't')"
        )
        conn.execute(
            "INSERT INTO listings (id, job_id, platform, platform_id, closed_at) VALUES ('l1', 'j1', 'linkedin', '1', ?)",
            (EARLIER,),
        )
        conn.commit()
        init_schema(conn)
        assert conn.execute(
            "SELECT availability, availability_message, availability_observed_at, closed_at FROM listings"
        ).fetchone() == ("unknown", None, None, EARLIER)
        conn.execute(
            "UPDATE listings SET availability = 'unavailable', availability_message = ?", (GRAY,)
        )
        conn.commit()
        init_schema(conn)
        assert conn.execute(
            "SELECT availability, availability_message FROM listings"
        ).fetchone() == ("unavailable", GRAY)
    finally:
        conn.close()

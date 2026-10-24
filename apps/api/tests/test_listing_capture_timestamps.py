"""First capture, latest accepted capture, and unrelated listing updates."""

import sqlite3
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.db import _COLUMN_MIGRATIONS, init_schema

FIRST = "2026-10-20T10:00:00+00:00"
SECOND = "2026-10-21T10:00:00+00:00"


def _capture(client: TestClient, **fields: Any) -> dict[str, Any]:
    response = client.post(
        "/api/listings", json={"platform": "linkedin", "platform_id": "1", **fields}
    )
    assert response.status_code == 200, response.text
    return response.json()


def _listing(client: TestClient, address: dict[str, Any]) -> dict[str, Any]:
    response = client.get(f"/api/jobs/{address['job_id']}")
    assert response.status_code == 200, response.text
    return next(row for row in response.json()["listings"] if row["id"] == address["listing_id"])


@pytest.mark.parametrize(
    "recapture",
    [
        {},
        {"meta": {"description": "Updated description"}},
        {"meta_patch": {"card_location": "Utrecht"}},
    ],
)
def test_each_capture_advances_last_capture_without_replacing_first_or_availability_time(
    client: TestClient, recapture: dict[str, Any]
) -> None:
    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _capture(client, availability="open", meta={"description": "Original"})
    listing = _listing(client, address)
    assert listing["captured_at"] == listing["last_captured_at"] == FIRST
    with patch("app.listings.service.utc_now", return_value=SECOND):
        _capture(client, **recapture)

    listing = _listing(client, address)

    assert listing["captured_at"] == FIRST
    assert listing["last_captured_at"] == SECOND
    assert listing["availability_observed_at"] == FIRST


def test_stub_has_no_capture_times_until_first_capture(client: TestClient) -> None:
    response = client.post(
        "/api/events",
        json={"platform": "linkedin", "platform_id": "1", "events": [{"event": "seen"}]},
    )
    assert response.status_code == 200, response.text
    job = client.get(f"/api/jobs/{response.json()['job_id']}").json()
    assert job["listings"][0]["captured_at"] is None
    assert job["listings"][0]["last_captured_at"] is None

    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _capture(client, title="Engineer")

    listing = _listing(client, address)
    assert listing["captured_at"] == listing["last_captured_at"] == FIRST


def test_edits_relinks_and_merges_preserve_last_capture_time(client: TestClient) -> None:
    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _capture(client)
    edited = client.patch(
        f"/api/listings/{address['listing_id']}", json={"meta": {"location": "Amsterdam"}}
    )
    assert edited.status_code == 200, edited.text
    listing = _listing(client, address)
    assert listing["updated_at"] != FIRST
    assert listing["last_captured_at"] == FIRST

    target = _capture(client, platform_id="2")
    relinked = client.patch(
        f"/api/listings/{address['listing_id']}", json={"job_id": target["job_id"]}
    )
    assert relinked.status_code == 200, relinked.text
    assert _listing(client, address)["last_captured_at"] == FIRST

    third = _capture(client, platform_id="3")
    merged = client.post(
        f"/api/jobs/{target['job_id']}/link-job", json={"other_job_id": third["job_id"]}
    )
    assert merged.status_code == 200, merged.text
    assert _listing(client, address)["last_captured_at"] == FIRST


def test_failed_capture_rolls_back_last_capture_time(client: TestClient) -> None:
    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _capture(client, meta={"description": "Original"})
    with patch("app.listings.service.utc_now", return_value=SECOND):
        response = client.post(
            "/api/listings",
            json={
                "platform": "linkedin",
                "platform_id": "1",
                "job_id": "missing",
                "meta": {"description": "Rejected"},
            },
        )
    assert response.status_code == 404
    listing = _listing(client, address)
    assert listing["last_captured_at"] == FIRST
    assert listing["meta"]["description"] == "Original"


def test_capture_timestamp_migration_preserves_history_and_reruns_without_changes() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        old_columns = tuple(entry for entry in _COLUMN_MIGRATIONS if entry[1] != "last_captured_at")
        with patch("app.core.db._COLUMN_MIGRATIONS", old_columns):
            init_schema(conn)
        conn.execute(
            "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ('j', 'seen', ?, ?)",
            (FIRST, SECOND),
        )
        conn.execute(
            "INSERT INTO listings (id, job_id, platform, platform_id, captured_at, updated_at) "
            "VALUES ('l', 'j', 'linkedin', '1', ?, ?)",
            (FIRST, SECOND),
        )
        conn.commit()

        init_schema(conn)

        assert conn.execute(
            "SELECT captured_at, last_captured_at, updated_at FROM listings"
        ).fetchone() == (FIRST, None, SECOND)
        conn.execute("UPDATE listings SET last_captured_at = ?", (SECOND,))
        conn.commit()
        before = conn.total_changes
        init_schema(conn)
        assert conn.total_changes == before
        assert conn.execute(
            "SELECT captured_at, last_captured_at, updated_at FROM listings"
        ).fetchone() == (FIRST, SECOND, SECOND)
    finally:
        conn.close()

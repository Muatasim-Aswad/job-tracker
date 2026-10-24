"""First capture, latest full-detail capture, and unrelated listing updates."""

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


def _detail_capture(client: TestClient, **fields: Any) -> dict[str, Any]:
    return _capture(
        client,
        **{
            "capture_kind": "detail",
            "title": "Engineer",
            "meta": {"description": "Original"},
            **fields,
        },
    )


@pytest.mark.parametrize("description", ["Original", "Updated description"])
def test_detail_capture_advances_server_time_without_replacing_first_or_availability_time(
    client: TestClient, description: str
) -> None:
    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _detail_capture(client, availability="open")
    listing = _listing(client, address)
    assert listing["captured_at"] == listing["last_detail_captured_at"] == FIRST
    assert "last_captured_at" not in listing
    with patch("app.listings.service.utc_now", return_value=SECOND):
        _detail_capture(client, meta={"description": description})

    listing = _listing(client, address)

    assert listing["captured_at"] == FIRST
    assert listing["last_detail_captured_at"] == SECOND
    assert listing["availability_observed_at"] == FIRST


@pytest.mark.parametrize(
    "partial",
    [
        {},
        {"meta": {"description": "Unmarked description"}},
        {"capture_kind": "partial", "title": "Engineer", "meta": {"description": "Partial"}},
        {"meta_patch": {"card_location": "Utrecht"}},
        {"availability": "unavailable"},
    ],
)
def test_partial_captures_do_not_advance_detail_timestamp(
    client: TestClient, partial: dict[str, Any]
) -> None:
    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _detail_capture(client)
    with patch("app.listings.service.utc_now", return_value=SECOND):
        _capture(client, **partial)

    listing = _listing(client, address)
    assert listing["updated_at"] == SECOND
    assert listing["captured_at"] == FIRST
    assert listing["last_detail_captured_at"] == FIRST


def test_partial_first_capture_waits_for_a_detail_capture(client: TestClient) -> None:
    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _capture(client, title="Engineer")
    assert _listing(client, address)["last_detail_captured_at"] is None
    with patch("app.listings.service.utc_now", return_value=SECOND):
        _detail_capture(client)
    listing = _listing(client, address)
    assert listing["captured_at"] == FIRST
    assert listing["last_detail_captured_at"] == SECOND


def test_stub_has_no_capture_times_until_first_capture(client: TestClient) -> None:
    response = client.post(
        "/api/events",
        json={"platform": "linkedin", "platform_id": "1", "events": [{"event": "seen"}]},
    )
    assert response.status_code == 200, response.text
    job = client.get(f"/api/jobs/{response.json()['job_id']}").json()
    assert job["listings"][0]["captured_at"] is None
    assert job["listings"][0]["last_detail_captured_at"] is None

    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _detail_capture(client)

    listing = _listing(client, address)
    assert listing["captured_at"] == listing["last_detail_captured_at"] == FIRST


def test_edits_relinks_and_merges_preserve_last_detail_capture_time(client: TestClient) -> None:
    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _detail_capture(client)
    edited = client.patch(
        f"/api/listings/{address['listing_id']}", json={"meta": {"location": "Amsterdam"}}
    )
    assert edited.status_code == 200, edited.text
    listing = _listing(client, address)
    assert listing["updated_at"] != FIRST
    assert listing["last_detail_captured_at"] == FIRST

    target = _capture(client, platform_id="2")
    relinked = client.patch(
        f"/api/listings/{address['listing_id']}", json={"job_id": target["job_id"]}
    )
    assert relinked.status_code == 200, relinked.text
    assert _listing(client, address)["last_detail_captured_at"] == FIRST

    third = _capture(client, platform_id="3")
    merged = client.post(
        f"/api/jobs/{target['job_id']}/link-job", json={"other_job_id": third["job_id"]}
    )
    assert merged.status_code == 200, merged.text
    assert _listing(client, address)["last_detail_captured_at"] == FIRST


def test_failed_capture_rolls_back_last_detail_capture_time(client: TestClient) -> None:
    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _detail_capture(client)
    with patch("app.listings.service.utc_now", return_value=SECOND):
        response = client.post(
            "/api/listings",
            json={
                "platform": "linkedin",
                "platform_id": "1",
                "capture_kind": "detail",
                "title": "Engineer",
                "job_id": "missing",
                "meta": {"description": "Rejected"},
            },
        )
    assert response.status_code == 404
    listing = _listing(client, address)
    assert listing["last_detail_captured_at"] == FIRST
    assert listing["meta"]["description"] == "Original"


@pytest.mark.parametrize(
    "fields",
    [
        {},
        {"title": "Engineer"},
        {"title": "   ", "meta": {"description": "Fresh"}},
        {"meta": {"description": "Fresh"}},
        {"title": "Engineer", "meta": {"description": "   "}},
        {"title": "Engineer", "meta": {"description": 42}},
        {"title": "Engineer", "meta_patch": {"description": "Card description"}},
    ],
)
def test_detail_marker_requires_fresh_title_and_description_in_the_request(
    client: TestClient, conn: sqlite3.Connection, fields: dict[str, Any]
) -> None:
    with patch("app.listings.service.utc_now", return_value=FIRST):
        address = _detail_capture(client)
    before = conn.total_changes
    response = client.post(
        "/api/listings",
        json={"platform": "linkedin", "platform_id": "1", "capture_kind": "detail", **fields},
    )
    assert response.status_code == 422
    assert conn.total_changes == before
    assert _listing(client, address)["last_detail_captured_at"] == FIRST


def test_captures_no_longer_update_the_retired_generic_timestamp(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    address = _capture(client)
    conn.execute("UPDATE listings SET last_captured_at = ?", (FIRST,))
    conn.commit()
    with patch("app.listings.service.utc_now", return_value=SECOND):
        _detail_capture(client)
    assert conn.execute("SELECT last_captured_at FROM listings").fetchone() == (FIRST,)
    assert _listing(client, address)["last_detail_captured_at"] == SECOND


def test_capture_timestamp_migration_preserves_history_and_reruns_without_changes() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        old_columns = tuple(
            entry for entry in _COLUMN_MIGRATIONS if entry[1] != "last_detail_captured_at"
        )
        with patch("app.core.db._COLUMN_MIGRATIONS", old_columns):
            init_schema(conn)
        conn.execute(
            "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ('j', 'seen', ?, ?)",
            (FIRST, SECOND),
        )
        conn.execute(
            "INSERT INTO listings (id, job_id, platform, platform_id, captured_at, last_captured_at, updated_at) "
            "VALUES ('l', 'j', 'linkedin', '1', ?, ?, ?)",
            (FIRST, SECOND, SECOND),
        )
        conn.commit()

        init_schema(conn)

        assert conn.execute(
            "SELECT captured_at, last_captured_at, last_detail_captured_at, updated_at FROM listings"
        ).fetchone() == (FIRST, SECOND, None, SECOND)
        conn.execute("UPDATE listings SET last_detail_captured_at = ?", (SECOND,))
        conn.commit()
        before = conn.total_changes
        init_schema(conn)
        assert conn.total_changes == before
        assert conn.execute(
            "SELECT captured_at, last_captured_at, last_detail_captured_at, updated_at FROM listings"
        ).fetchone() == (FIRST, SECOND, SECOND, SECOND)
    finally:
        conn.close()

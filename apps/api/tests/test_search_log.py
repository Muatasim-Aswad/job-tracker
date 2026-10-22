"""Popup search diagnostics: session storage and click-through reports."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def enable_diagnostics(client: TestClient) -> None:
    response = client.patch(
        "/api/settings",
        json={
            "expected_revision": client.get("/api/settings").json()["revision"],
            "changes": {"search_diagnostics": {"scope": "always"}},
        },
    )
    assert response.status_code == 200


def _log(client: TestClient, **body: object) -> None:
    resp = client.post("/api/search-log", json=body)
    assert resp.status_code == 204


def test_record_is_fire_and_forget_204(client: TestClient) -> None:
    resp = client.post(
        "/api/search-log",
        json={
            "seed_rule": "gmail-subject",
            "seed": "Sample Company Corp",
            "seed_results": 0,
            "query": "Sample Company",
            "results": 3,
            "job_id": "j1",
        },
    )
    assert resp.status_code == 204
    assert resp.content == b""
    row = client.get("/api/search-log").json()[0]
    assert row["seed_rule"] == "gmail-subject"
    assert row["seed_results"] == 0
    assert "rule" not in row
    assert "seed_replaced" not in row


def test_report_aggregates_click_rate_per_rule(client: TestClient) -> None:
    # gmail-subject: 2 attempts, 1 click -> 0.5 ; typed: 1 attempt, 1 click -> 1.0
    _log(client, seed_rule="gmail-subject", job_id="j1")
    _log(client, seed_rule="gmail-subject")
    _log(client, job_id="j2")

    report = client.get("/api/search-log/report").json()
    assert report["total_attempts"] == 3
    assert report["total_clicks"] == 2
    assert report["click_rate"] == round(2 / 3, 3)

    by_rule = {r["rule"]: r for r in report["by_rule"]}
    assert by_rule["gmail-subject"] == {
        "rule": "gmail-subject",
        "attempts": 2,
        "clicks": 1,
        "click_rate": 0.5,
    }
    assert by_rule["typed"]["click_rate"] == 1.0


def test_empty_report_is_zeroed_not_divide_by_zero(client: TestClient) -> None:
    report = client.get("/api/search-log/report").json()
    assert report == {"total_attempts": 0, "total_clicks": 0, "click_rate": 0.0, "by_rule": []}


def test_recent_rows_newest_first_and_limited(client: TestClient) -> None:
    for i in range(3):
        _log(client, query=f"q{i}")

    rows = client.get("/api/search-log", params={"limit": 2}).json()
    assert [r["query"] for r in rows] == ["q2", "q1"]  # newest first, capped at 2

    bad = client.get("/api/search-log", params={"limit": 0})
    assert bad.status_code == 422  # ge=1 guard


def test_legacy_minimal_body_is_still_accepted(client: TestClient) -> None:
    _log(client, seed_rule="domain-label", results=2)
    rows = client.get("/api/search-log").json()
    assert rows[0]["seed_rule"] == "domain-label"


def test_clear_deletes_all_rows(client: TestClient) -> None:
    _log(client, job_id="j1")
    _log(client)
    assert client.get("/api/search-log").json()  # non-empty

    resp = client.delete("/api/search-log")
    assert resp.status_code == 204
    assert resp.content == b""

    assert client.get("/api/search-log").json() == []
    report = client.get("/api/search-log/report").json()
    assert report == {"total_attempts": 0, "total_clicks": 0, "click_rate": 0.0, "by_rule": []}


def test_record_prunes_to_the_retention_limit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Cap the table small so the pruning behaviour is visible without 1000 inserts.
    monkeypatch.setattr("app.search_log.service.RETENTION_LIMIT", 3)
    for i in range(5):
        _log(client, query=f"q{i}", host="example.com")

    rows = client.get("/api/search-log", params={"limit": 50}).json()
    assert [r["query"] for r in rows] == ["q4", "q3", "q2"]  # only the newest 3 survive

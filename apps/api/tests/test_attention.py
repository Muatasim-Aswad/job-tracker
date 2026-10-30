"""Server-owned stalled-job attention projection on ``GET /jobs``."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError as PydanticValidationError

from app.core.config import Settings, get_settings
from app.main import app

NOW = "2026-07-19T12:00:00+00:00"


def _listing(client: TestClient, platform_id: str, title: str = "Role") -> str:
    response = client.post(
        "/api/listings", json={"platform": "linkedin", "platform_id": platform_id, "title": title}
    )
    assert response.status_code == 200, response.text
    return str(response.json()["job_id"])


def _emit(client: TestClient, job_id: str, event: str, ts: str, **item: Any) -> None:
    response = client.post(
        "/api/events", json={"job_id": job_id, "ts": ts, "events": [{"event": event, **item}]}
    )
    assert response.status_code == 200, response.text


def _summary(client: TestClient, job_id: str) -> dict[str, Any]:
    response = client.get("/api/jobs")
    assert response.status_code == 200, response.text
    return next(job for job in response.json() if job["id"] == job_id)


@pytest.fixture(autouse=True)
def fixed_attention_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.jobs.service.utc_now", lambda: NOW)


@pytest.mark.parametrize(
    ("status", "since", "expected"),
    [
        ("applied", "2026-06-28T12:00:00+00:00", 21),
        ("applied", "2026-06-29T12:00:01+00:00", None),
        ("in_process", "2026-07-05T12:00:00+00:00", 14),
        ("in_process", "2026-07-06T12:00:01+00:00", None),
        ("offered", "2026-01-01T00:00:00+00:00", None),
    ],
)
def test_attention_stage_boundaries(
    client: TestClient, status: str, since: str, expected: int | None
) -> None:
    job_id = _listing(client, f"boundary-{status}-{since}")
    _emit(client, job_id, status, since)

    attention = _summary(client, job_id)["attention"]
    if expected is None:
        assert attention is None
    else:
        assert attention == {"stage": status, "since": since, "days": expected}


def test_latest_note_resets_clock_and_deleting_it_restores_attention(client: TestClient) -> None:
    job_id = _listing(client, "note-reset")
    applied_at = "2026-06-20T12:00:00+00:00"
    _emit(client, job_id, "applied", applied_at)
    assert _summary(client, job_id)["attention"]["since"] == applied_at

    _emit(client, job_id, "note", "2026-07-18T12:00:00+00:00", meta={"note": "Followed up"})
    assert _summary(client, job_id)["attention"] is None

    detail = client.get(f"/api/jobs/{job_id}").json()
    note_id = next(event["id"] for event in detail["events"] if event["event"] == "note")
    assert client.delete(f"/api/events/{note_id}").status_code == 204
    restored = _summary(client, job_id)["attention"]
    assert restored == {"stage": "applied", "since": applied_at, "days": 29}


def test_backdated_note_does_not_hide_newer_status_activity(client: TestClient) -> None:
    job_id = _listing(client, "backdated-note")
    applied_at = "2026-06-20T12:00:00+00:00"
    _emit(client, job_id, "applied", applied_at)
    _emit(client, job_id, "note", "2026-06-01T12:00:00+00:00", meta={"note": "Imported"})

    assert _summary(client, job_id)["attention"] == {
        "stage": "applied",
        "since": applied_at,
        "days": 29,
    }


def test_backdated_note_becomes_the_clock_when_it_is_the_newest_activity(
    client: TestClient,
) -> None:
    job_id = _listing(client, "backdated-newest-note")
    _emit(client, job_id, "applied", "2026-06-01T12:00:00+00:00")
    note_at = "2026-06-20T12:00:00+00:00"
    _emit(client, job_id, "note", note_at, meta={"note": "Old follow-up"})

    assert _summary(client, job_id)["attention"] == {
        "stage": "applied",
        "since": note_at,
        "days": 29,
    }


def test_correction_counts_as_status_activity(client: TestClient) -> None:
    job_id = _listing(client, "corrected")
    response = client.post(f"/api/jobs/{job_id}/corrections", json={"status": "applied"})
    assert response.status_code == 200
    detail = client.get(f"/api/jobs/{job_id}").json()
    correction = next(event for event in detail["events"] if event["event"] == "corrected:applied")
    corrected_at = "2026-06-20T12:00:00+00:00"
    assert (
        client.patch(f"/api/events/{correction['id']}", json={"ts": corrected_at}).status_code
        == 200
    )

    assert _summary(client, job_id)["attention"] == {
        "stage": "applied",
        "since": corrected_at,
        "days": 29,
    }


def test_flags_and_identity_edits_do_not_reset_event_clock(client: TestClient) -> None:
    job_id = _listing(client, "unrelated-edits")
    applied_at = "2026-06-20T12:00:00+00:00"
    _emit(client, job_id, "applied", applied_at)
    _emit(client, job_id, "starred", "2026-07-19T10:00:00+00:00")
    _emit(client, job_id, "hidden", "2026-07-19T10:01:00+00:00")
    assert client.patch(f"/api/jobs/{job_id}", json={"title": "Renamed"}).status_code == 200

    attention = _summary(client, job_id)["attention"]
    assert attention == {"stage": "applied", "since": applied_at, "days": 29}


@pytest.mark.parametrize(
    "status",
    ["new", "seen", "to_apply", "offered", "skipped", "closed", "withdrawn", "rejected", "ghosted"],
)
def test_statuses_outside_stalled_stages_never_receive_attention(
    client: TestClient, conn: Any, status: str
) -> None:
    job_id = _listing(client, f"not-attention-{status}")
    _emit(client, job_id, "applied", "2026-06-01T12:00:00+00:00")
    conn.execute("UPDATE jobs SET status = ? WHERE id = ?", (status, job_id))
    conn.commit()

    assert _summary(client, job_id)["attention"] is None


def test_status_changes_remove_or_restore_attention_from_the_event_log(client: TestClient) -> None:
    job_id = _listing(client, "attention-reprojection")
    applied_at = "2026-06-20T12:00:00+00:00"
    _emit(client, job_id, "applied", applied_at)
    expected = {"stage": "applied", "since": applied_at, "days": 29}
    assert _summary(client, job_id)["attention"] == expected

    _emit(client, job_id, "in_process", NOW)
    assert _summary(client, job_id)["attention"] is None

    assert client.post(f"/api/jobs/{job_id}/status/revert").status_code == 200
    assert _summary(client, job_id)["attention"] == expected

    assert (
        client.post(f"/api/jobs/{job_id}/corrections", json={"status": "offered"}).status_code
        == 200
    )
    assert _summary(client, job_id)["attention"] is None

    assert client.post(f"/api/jobs/{job_id}/status/revert").status_code == 200
    assert _summary(client, job_id)["attention"] == expected

    _emit(client, job_id, "closed", NOW)
    assert _summary(client, job_id)["attention"] is None


def test_reading_attention_never_writes_a_ghosted_event(client: TestClient) -> None:
    job_id = _listing(client, "read-only-attention")
    _emit(client, job_id, "applied", "2026-06-20T12:00:00+00:00")

    assert _summary(client, job_id)["attention"] is not None
    assert _summary(client, job_id)["status"] == "applied"
    detail = client.get(f"/api/jobs/{job_id}")
    assert detail.status_code == 200
    assert all(event["event"] != "ghosted" for event in detail.json()["events"])


def test_threshold_overrides_and_zero_disable_a_stage(client: TestClient) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        attention_applied_days=2, attention_in_process_days=0
    )
    applied = _listing(client, "override-applied")
    processing = _listing(client, "override-processing")
    _emit(client, applied, "applied", "2026-07-17T12:00:00+00:00")
    _emit(client, processing, "in_process", "2026-01-01T00:00:00+00:00")

    assert _summary(client, applied)["attention"]["days"] == 2
    assert _summary(client, processing)["attention"] is None


def test_legacy_job_without_activity_events_falls_back_to_updated_at(
    client: TestClient, conn: Any
) -> None:
    job_id = _listing(client, "legacy")
    conn.execute("DELETE FROM events WHERE job_id = ?", (job_id,))
    conn.execute(
        "UPDATE jobs SET status = 'applied', updated_at = ? WHERE id = ?",
        ("2026-06-20T12:00:00+00:00", job_id),
    )
    conn.commit()

    assert _summary(client, job_id)["attention"] == {
        "stage": "applied",
        "since": "2026-06-20T12:00:00+00:00",
        "days": 29,
    }


def test_jobs_read_uses_one_batched_activity_query(client: TestClient, conn: Any) -> None:
    for index in range(4):
        job_id = _listing(client, f"batch-{index}")
        _emit(client, job_id, "applied", "2026-06-20T12:00:00+00:00")

    statements: list[str] = []
    conn.set_trace_callback(statements.append)
    assert client.get("/api/jobs").status_code == 200
    conn.set_trace_callback(None)

    select_queries = [sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]
    activity_queries = [sql for sql in select_queries if "FROM events" in sql]
    assert len(select_queries) == 3
    assert len(activity_queries) == 1


def test_attention_settings_reject_negative_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ATTENTION_APPLIED_DAYS", raising=False)
    monkeypatch.delenv("ATTENTION_IN_PROCESS_DAYS", raising=False)
    defaults = Settings(app_env="local", _env_file=None)
    assert defaults.attention_applied_days == 21
    assert defaults.attention_in_process_days == 14
    with pytest.raises(PydanticValidationError):
        Settings(app_env="local", attention_applied_days=-1, _env_file=None)
    with pytest.raises(PydanticValidationError):
        Settings(app_env="local", attention_in_process_days=-1, _env_file=None)


def test_attention_settings_are_environment_backed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ATTENTION_APPLIED_DAYS", "9")
    monkeypatch.setenv("ATTENTION_IN_PROCESS_DAYS", "6")
    settings = Settings(app_env="local", _env_file=None)
    assert settings.attention_applied_days == 9
    assert settings.attention_in_process_days == 6

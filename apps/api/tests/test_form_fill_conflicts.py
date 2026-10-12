"""Atomic resolution of independently current remembered values."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.core.db import Conn
from app.core.errors import ConflictError
from app.form_fill.schemas import (
    AnswerCreate,
    CaptureConflictResolve,
    CaptureCreate,
    CreateAnswerAndMapApply,
    MappingPut,
    ResolutionRequest,
)
from app.form_fill.service import FormFillService


def _request(scan_id: str = "scan-1") -> ResolutionRequest:
    return ResolutionRequest.model_validate(
        {
            "scan_id": scan_id,
            "application_context_id": "application-1",
            "page": {
                "site_scope": "linkedin:easy-apply",
                "adapter_id": "linkedin",
                "adapter_version": "1",
                "platform": "linkedin",
                "platform_id": "job-42",
            },
            "fields": [
                {
                    "client_field_id": "field-1",
                    "prompt": "What is your expected salary?",
                    "section": "Compensation",
                    "help": None,
                    "control_kind": "decimal",
                    "stable_field_key": None,
                    "autocomplete_token": None,
                    "required": True,
                    "max_length": 20,
                    "has_value": False,
                    "options": [],
                }
            ],
        }
    )


def _seed_conflict(service: FormFillService, conn: Conn) -> tuple[str, str, str]:
    question_id = service.resolve(_request()).results[0].question_id
    first = service.create_capture(
        CaptureCreate(
            capture_key="capture-a",
            question_id=question_id,
            application_context_id="application-a",
            page={"platform": "linkedin", "platform_id": "job-42"},
            source="user_input",
            value={"kind": "decimal", "value": "100"},
        )
    ).capture
    conn.execute(
        "INSERT INTO form_captures (id, capture_key, question_id, application_context_id, "
        "source, value_kind, value_json, status, revision, created_at, updated_at) "
        "VALUES ('capture-b', 'capture-b-key', ?, 'application-b', 'user_input', "
        "'decimal', ?, 'current', 1, '2026-08-13T20:00:00+00:00', "
        "'2026-08-13T20:00:00+00:00')",
        (question_id, json.dumps({"kind": "decimal", "value": "200"})),
    )
    return question_id, first.id, "capture-b"


def test_competing_captures_fill_nothing_and_expose_only_ids_in_resolution(conn: Conn) -> None:
    service = FormFillService(conn)
    question_id, first_id, second_id = _seed_conflict(service, conn)

    result = service.resolve(_request("scan-2")).results[0]
    assert result.status == "conflict"
    assert set(result.capture_ids) == {first_id, second_id}
    assert "100" not in result.model_dump_json()
    assert "200" not in result.model_dump_json()
    assert service.get_question(question_id).capture_conflict is True


def test_conflict_resolution_requires_question_winner_and_complete_current_revision_set(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    question_id, first_id, second_id = _seed_conflict(service, conn)

    with pytest.raises(ConflictError) as incomplete:
        service.resolve_capture_conflict(
            question_id,
            CaptureConflictResolve(
                expected_question_revision=1,
                winner_capture_id=first_id,
                captures=[
                    {"capture_id": first_id, "expected_revision": 1},
                    {"capture_id": second_id, "expected_revision": 99},
                ],
            ),
        )
    assert incomplete.value.message == "stale_conflict_set"
    assert len(incomplete.value.current["captures"]) == 2
    assert all(item["status"] == "current" for item in incomplete.value.current["captures"])
    assert service.get_question(question_id).revision == 1

    resolved = service.resolve_capture_conflict(
        question_id,
        CaptureConflictResolve(
            expected_question_revision=1,
            winner_capture_id=second_id,
            captures=[
                {"capture_id": first_id, "expected_revision": 1},
                {"capture_id": second_id, "expected_revision": 1},
            ],
            reason="The later explicit value is correct",
        ),
    )
    assert resolved.question.capture_conflict is False
    assert resolved.question.revision == 2
    assert resolved.winner.id == second_id and resolved.winner.status == "current"
    assert [item.id for item in resolved.superseded] == [first_id]
    loser = service.get_capture(first_id)
    assert loser.status == "superseded" and loser.value is None and loser.revision == 2
    next_resolution = service.resolve(_request("scan-3")).results[0]
    assert next_resolution.status == "captured"
    assert next_resolution.action.model_dump()["value"] == "200"


@pytest.mark.parametrize("matched", [False, True])
def test_conflict_is_projected_before_and_after_resolution_without_mutating_question(
    conn: Conn, client: TestClient, matched: bool
) -> None:
    service = FormFillService(conn)
    question_id, first_id, second_id = _seed_conflict(service, conn)
    if matched:
        answer = service.create_answer(
            AnswerCreate(
                answer_key="verified_salary",
                label="Salary",
                value_kind="decimal",
                value={"kind": "decimal", "value": "300"},
            )
        )
        service.put_mapping(
            question_id,
            MappingPut(
                answer_id=answer.id,
                expected_answer_revision=1,
                expected_question_revision=1,
                expected_mapping_revision=None,
                bindings=[],
            ),
        )
    conn.commit()
    before = conn.execute("SELECT * FROM form_questions WHERE id = ?", (question_id,)).fetchone()

    def projections() -> None:
        for params in [
            {},
            {"needs_review": True},
            {"review_inbox": True},
            {"has_current_capture": True},
        ]:
            response = client.get("/api/form-fill/questions", params=params)
            assert response.status_code == 200
            item = next(row for row in response.json()["items"] if row["id"] == question_id)
            assert item["capture_conflict"] is True
            assert item["current_capture_count"] == 2
            assert "value" not in item
        detail = client.get(f"/api/form-fill/questions/{question_id}").json()
        assert detail["capture_conflict"] is True
        assert all("value" not in capture for capture in detail["current_captures"])
        assert (
            client.get(f"/api/form-fill/captures/{first_id}").json()["question"]["capture_conflict"]
            is True
        )

    projections()
    assert (
        conn.execute("SELECT * FROM form_questions WHERE id = ?", (question_id,)).fetchone()
        == before
    )
    result = service.resolve(_request("detected-conflict")).results[0]
    assert result.status == ("approved" if matched else "conflict")
    projections()
    assert service.get_question(question_id).revision == 1

    resolved = client.post(
        f"/api/form-fill/questions/{question_id}/capture-conflicts/resolve",
        json={
            "expected_question_revision": 1,
            "winner_capture_id": second_id,
            "captures": [
                {"capture_id": first_id, "expected_revision": 1},
                {"capture_id": second_id, "expected_revision": 1},
            ],
        },
    )
    assert resolved.status_code == 200
    assert resolved.json()["question"]["capture_conflict"] is False
    assert resolved.json()["question"]["revision"] == 2
    for params in [{}, {"review_inbox": True}, {"needs_review": not matched}]:
        response = client.get("/api/form-fill/questions", params=params)
        item = next(row for row in response.json()["items"] if row["id"] == question_id)
        assert item["capture_conflict"] is False
        assert item["current_capture_count"] == 1
    assert client.get(f"/api/form-fill/captures/{first_id}").json()["value"] is None
    assert (
        client.get(f"/api/form-fill/captures/{second_id}").json()["question"]["capture_conflict"]
        is False
    )
    conn.execute("UPDATE form_questions SET capture_conflict = 1 WHERE id = ?", (question_id,))
    assert service.get_question(question_id).capture_conflict is False
    assert service.resolve(_request("stale-stored-flag")).results[0].status == (
        "approved" if matched else "captured"
    )


def test_conflicted_capture_apply_requires_explicit_complete_set_resolution(conn: Conn) -> None:
    service = FormFillService(conn)
    question_id, first_id, _second_id = _seed_conflict(service, conn)
    before = conn.execute("SELECT * FROM form_captures ORDER BY id").fetchall()
    for cleared in (False, True):
        with pytest.raises(ConflictError, match="capture_conflict"):
            service.create_capture(
                CaptureCreate(
                    capture_key=f"replacement-{cleared}",
                    question_id=question_id,
                    application_context_id="new-application",
                    page={"platform": "linkedin", "platform_id": "job-42"},
                    source="user_input",
                    cleared=cleared,
                    value=None if cleared else {"kind": "decimal", "value": "400"},
                )
            )
    with pytest.raises(ConflictError, match="capture_conflict"):
        service.apply_capture(
            first_id,
            CreateAnswerAndMapApply(
                action="create_answer_and_map",
                expected_capture_revision=1,
                expected_question_revision=1,
                expected_mapping_revision=None,
                answer_key="salary",
                label="Salary",
                value_kind="decimal",
                value={"kind": "decimal", "value": "100"},
                choices=[],
                bindings=[],
                fill_policy="auto",
            ),
        )
    assert conn.execute("SELECT * FROM form_captures ORDER BY id").fetchall() == before
    assert conn.execute("SELECT COUNT(*) FROM form_answers").fetchone() == (0,)


def test_stale_question_revision_rolls_back_every_capture_transition(conn: Conn) -> None:
    service = FormFillService(conn)
    question_id, first_id, second_id = _seed_conflict(service, conn)
    conn.execute("UPDATE form_questions SET revision = 2 WHERE id = ?", (question_id,))

    with pytest.raises(ConflictError):
        service.resolve_capture_conflict(
            question_id,
            CaptureConflictResolve(
                expected_question_revision=1,
                winner_capture_id=first_id,
                captures=[
                    {"capture_id": first_id, "expected_revision": 1},
                    {"capture_id": second_id, "expected_revision": 1},
                ],
            ),
        )

    rows = conn.execute(
        "SELECT id, status, revision, value_json FROM form_captures ORDER BY id"
    ).fetchall()
    assert {(row[0], row[1], row[2]) for row in rows} == {
        (first_id, "current", 1),
        (second_id, "current", 1),
    }
    assert all(row[3] is not None for row in rows)


@pytest.mark.parametrize("stale_part", ["question", "capture", "set"])
def test_conflict_routes_return_value_free_summaries_and_keep_private_winner_detail(
    conn: Conn, client: TestClient, stale_part: str
) -> None:
    service = FormFillService(conn)
    question_id, first_id, second_id = _seed_conflict(service, conn)
    conn.commit()
    body = {
        "expected_question_revision": 99 if stale_part == "question" else 1,
        "winner_capture_id": first_id,
        "captures": [
            {"capture_id": first_id, "expected_revision": 99 if stale_part == "capture" else 1},
            {
                "capture_id": "absent-capture" if stale_part == "set" else second_id,
                "expected_revision": 1,
            },
        ],
    }
    endpoint = f"/api/form-fill/questions/{question_id}/capture-conflicts/resolve"
    stale = client.post(endpoint, json=body)
    assert stale.status_code == 409
    assert stale.headers["cache-control"] == "no-store"
    assert stale.json()["detail"] == "stale_conflict_set"
    summaries = stale.json()["current"]["captures"]
    assert {item["id"] for item in summaries} == {first_id, second_id}
    assert all("value" not in item and item["status"] == "current" for item in summaries)
    assert service.get_capture(first_id).value is not None
    assert service.get_capture(second_id).value is not None
    assert service.get_question(question_id).revision == 1

    resolved = client.post(
        endpoint,
        json={
            "expected_question_revision": 1,
            "winner_capture_id": first_id,
            "captures": [
                {"capture_id": first_id, "expected_revision": 1},
                {"capture_id": second_id, "expected_revision": 1},
            ],
        },
    )
    assert resolved.status_code == 200
    assert resolved.headers["cache-control"] == "no-store"
    assert resolved.json()["winner"]["id"] == first_id
    assert "value" not in resolved.json()["winner"]
    assert all("value" not in item for item in resolved.json()["superseded"])
    winner = client.get(f"/api/form-fill/captures/{first_id}")
    assert winner.status_code == 200
    assert winner.headers["cache-control"] == "no-store"
    assert winner.json()["value"] == {"kind": "decimal", "value": "100"}
    assert client.get(f"/api/form-fill/captures/{second_id}").json()["value"] is None

"""Atomic resolution of independently current remembered values."""

from __future__ import annotations

import json

import pytest

from app.core.db import Conn
from app.core.errors import ConflictError
from app.form_fill.schemas import CaptureConflictResolve, CaptureCreate, ResolutionRequest
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
    conn.execute(
        "UPDATE form_questions SET capture_conflict = 1, last_unresolved_reason = "
        "'capture_conflict' WHERE id = ?",
        (question_id,),
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

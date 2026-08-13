"""Remembered-value capture, idempotency, clearing, and review workflows."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.db import Conn
from app.core.errors import ConflictError, InvalidCursorError, ValidationError
from app.form_fill.schemas import (
    AnswerCreate,
    AnswerUpdate,
    CaptureCreate,
    CaptureUpdate,
    CreateAnswerAndMapApply,
    MappingPut,
    ReplaceOptionBindingsApply,
    ResolutionRequest,
    RetargetMappingApply,
    UpdateAnswerApply,
)
from app.form_fill.service import FormFillService


def _field(prompt: str = "What is your preferred name?", **updates: Any) -> dict[str, Any]:
    field: dict[str, Any] = {
        "client_field_id": "field-1",
        "prompt": prompt,
        "section": "Profile",
        "help": None,
        "control_kind": "text",
        "stable_field_key": None,
        "autocomplete_token": None,
        "required": True,
        "max_length": 100,
        "has_value": False,
        "user_confirmed": False,
        "options": [],
    }
    field.update(updates)
    return field


def _choice_field(prompt: str, prefix: str) -> dict[str, Any]:
    return _field(
        prompt,
        client_field_id=f"{prefix}-field",
        control_kind="select",
        max_length=None,
        options=[
            {"client_option_id": f"{prefix}-yes", "label": "Yes", "disabled": False},
            {"client_option_id": f"{prefix}-no", "label": "No", "disabled": False},
        ],
    )


def _request(*fields: dict[str, Any], scan: str = "scan-1") -> ResolutionRequest:
    return ResolutionRequest.model_validate(
        {
            "scan_id": scan,
            "application_context_id": "application-1",
            "page": {
                "site_scope": "linkedin:easy-apply",
                "adapter_id": "linkedin",
                "adapter_version": "1",
                "platform": "linkedin",
                "platform_id": "job-42",
            },
            "fields": list(fields),
        }
    )


def _capture(question_id: str, key: str, value: str, **updates: Any) -> CaptureCreate:
    body: dict[str, Any] = {
        "capture_key": key,
        "question_id": question_id,
        "application_context_id": "application-1",
        "page": {"platform": "linkedin", "platform_id": "job-42"},
        "source": "user_input",
        "value": {"kind": "text", "value": value},
    }
    body.update(updates)
    return CaptureCreate.model_validate(body)


def test_capture_retry_is_idempotent_new_values_supersede_and_clear_stores_no_reusable_empty(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    question_id = service.resolve(_request(_field())).results[0].question_id
    request = _capture(question_id, "retry-1", "FIRST PRIVATE VALUE")
    first = service.create_capture(request)
    retry = service.create_capture(request)
    assert retry.capture.id == first.capture.id
    assert conn.execute("SELECT COUNT(*) FROM form_captures").fetchone() == (1,)

    second = service.create_capture(_capture(question_id, "retry-2", "SECOND PRIVATE VALUE"))
    assert second.superseded_capture_ids == [first.capture.id]
    old = service.get_capture(first.capture.id)
    assert old.status == "superseded" and old.value is None and old.revision == 2
    resolution = service.resolve(_request(_field(), scan="scan-2")).results[0]
    assert resolution.status == "captured"
    assert resolution.action.model_dump()["value"] == "SECOND PRIVATE VALUE"

    cleared_request = CaptureCreate(
        capture_key="retry-clear",
        question_id=question_id,
        application_context_id="application-1",
        page={"platform": "linkedin", "platform_id": "job-42"},
        source="user_input",
        cleared=True,
    )
    cleared = service.create_capture(cleared_request)
    assert cleared.capture.status == "superseded" and cleared.capture.value is None
    assert service.create_capture(cleared_request).capture.id == cleared.capture.id
    assert service.resolve(_request(_field(), scan="scan-3")).results[0].status == "unresolved"
    assert conn.execute(
        "SELECT COUNT(*) FROM form_captures WHERE status = 'current' OR value_json IS NOT NULL"
    ).fetchone() == (0,)


def test_capture_key_reuse_with_different_body_conflicts_without_superseding(conn: Conn) -> None:
    service = FormFillService(conn)
    question_id = service.resolve(_request(_field())).results[0].question_id
    original = service.create_capture(_capture(question_id, "same-key", "ORIGINAL"))

    with pytest.raises(ConflictError) as reused:
        service.create_capture(_capture(question_id, "same-key", "DIFFERENT"))

    assert reused.value.message == "capture_key_reused"
    current = service.get_capture(original.capture.id)
    assert current.status == "current"
    assert current.value and current.value.model_dump()["value"] == "ORIGINAL"


def test_choice_capture_rejects_another_questions_option_and_preserves_current_value(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    results = service.resolve(
        _request(
            _choice_field("Are you authorized?", "auth"),
            _choice_field("Do you need sponsorship?", "sponsor"),
        )
    ).results
    first, second = results
    first_option = first.option_mappings[0].question_option_id
    second_option = second.option_mappings[0].question_option_id
    current = service.create_capture(
        CaptureCreate(
            capture_key="choice-1",
            question_id=first.question_id,
            application_context_id="application-1",
            page={"platform": "linkedin", "platform_id": "job-42"},
            source="user_input",
            value={"kind": "single_choice", "question_option_id": first_option},
        )
    )

    with pytest.raises(ValidationError, match="another question"):
        service.create_capture(
            CaptureCreate(
                capture_key="choice-invalid",
                question_id=first.question_id,
                application_context_id="application-1",
                page={"platform": "linkedin", "platform_id": "job-42"},
                source="user_input",
                value={"kind": "single_choice", "question_option_id": second_option},
            )
        )
    assert service.get_capture(current.capture.id).status == "current"
    assert conn.execute("SELECT COUNT(*) FROM form_captures").fetchone() == (1,)


def test_capture_rejects_stale_verified_resolution_context_atomically(conn: Conn) -> None:
    service = FormFillService(conn)
    question_id = service.resolve(_request(_field())).results[0].question_id
    answer = service.create_answer(
        AnswerCreate(
            answer_key="profile.name",
            label="Name",
            value_kind="text",
            value={"kind": "text", "value": "APPROVED"},
        )
    )
    mapped = service.put_mapping(
        question_id,
        MappingPut(answer_id=answer.id, expected_question_revision=1, expected_answer_revision=1),
    )
    assert mapped.mapping
    service.update_answer(answer.id, AnswerUpdate(expected_revision=1, label="New label"))

    with pytest.raises(ConflictError) as stale:
        service.create_capture(
            _capture(
                question_id,
                "stale-context",
                "OVERRIDE",
                mapping_id=mapped.mapping.id,
                answer_revision_used=1,
                mapping_revision_used=mapped.mapping.revision,
            )
        )
    assert stale.value.message == "stale_resolution_context"
    assert stale.value.current["answer"]["revision"] == 2
    assert conn.execute("SELECT COUNT(*) FROM form_captures").fetchone() == (0,)


def test_capture_review_list_cursor_ignore_and_value_free_history(conn: Conn) -> None:
    service = FormFillService(conn)
    questions = [
        service.resolve(_request(_field(f"Question {index}"), scan=f"scan-{index}")).results[0]
        for index in range(3)
    ]
    captures = [
        service.create_capture(_capture(question.question_id, f"capture-{index}", f"VALUE-{index}"))
        for index, question in enumerate(questions)
    ]
    first = service.list_captures(
        status="current", source=None, question_id=None, query=None, limit=2, cursor=None
    )
    assert first.next_cursor and len(first.items) == 2
    second = service.list_captures(
        status="current",
        source=None,
        question_id=None,
        query=None,
        limit=2,
        cursor=first.next_cursor,
    )
    assert len({item.id for item in first.items + second.items}) == 3
    with pytest.raises(InvalidCursorError):
        service.list_captures(
            status="ignored",
            source=None,
            question_id=None,
            query=None,
            limit=2,
            cursor=first.next_cursor,
        )

    ignored = service.update_capture(
        captures[0].capture.id,
        CaptureUpdate(
            expected_revision=captures[0].capture.revision, status="ignored", reason="Not reusable"
        ),
    )
    assert ignored.status == "ignored" and ignored.value is None
    assert ignored.events[0].event == "capture_ignored"
    assert "VALUE-0" not in str(conn.execute("SELECT * FROM form_knowledge_events").fetchall())
    with pytest.raises(ValidationError, match="value-cleared"):
        service.update_capture(
            ignored.id, CaptureUpdate(expected_revision=ignored.revision, status="current")
        )


def test_capture_routes_are_no_store(client: TestClient) -> None:
    observed = client.post(
        "/api/form-fill/resolutions", json=_request(_field()).model_dump(mode="json")
    ).json()["results"][0]
    response = client.post(
        "/api/form-fill/captures",
        json=_capture(observed["question_id"], "api-capture", "API PRIVATE").model_dump(
            mode="json"
        ),
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    capture_id = response.json()["capture"]["id"]
    assert (
        client.get(f"/api/form-fill/captures/{capture_id}").headers["cache-control"] == "no-store"
    )


def test_capture_apply_create_answer_and_map_is_atomic_and_clears_applied_value(conn: Conn) -> None:
    service = FormFillService(conn)
    question_id = service.resolve(_request(_field())).results[0].question_id
    capture = service.create_capture(_capture(question_id, "promote-new", "PROMOTED")).capture

    with pytest.raises(ConflictError):
        service.apply_capture(
            capture.id,
            CreateAnswerAndMapApply(
                action="create_answer_and_map",
                expected_capture_revision=capture.revision,
                expected_question_revision=99,
                answer_key="profile.promoted_name",
                label="Promoted name",
                value_kind="text",
                value={"kind": "text", "value": "PROMOTED"},
            ),
        )
    assert conn.execute("SELECT COUNT(*) FROM form_answers").fetchone() == (0,)
    assert service.get_capture(capture.id).status == "current"

    applied = service.apply_capture(
        capture.id,
        CreateAnswerAndMapApply(
            action="create_answer_and_map",
            expected_capture_revision=capture.revision,
            expected_question_revision=1,
            answer_key="profile.promoted_name",
            label="Promoted name",
            value_kind="text",
            value={"kind": "text", "value": "PROMOTED"},
            reason="Verified from remembered value",
        ),
    )
    assert applied.capture.status == "applied" and applied.capture.value is None
    assert applied.answer.answer_key == "profile.promoted_name"
    assert applied.mapping.answer_id == applied.answer.id and applied.mapping.status == "active"
    detail = service.get_answer(applied.answer.id)
    assert {event.event for event in detail.events} >= {
        "answer_created",
        "mapping_approved",
        "capture_applied",
    }
    assert "PROMOTED" not in str(conn.execute("SELECT * FROM form_knowledge_events").fetchall())


def test_capture_apply_update_answer_checks_all_revisions_and_returns_current_summaries(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    question_id = service.resolve(_request(_field())).results[0].question_id
    answer = service.create_answer(
        AnswerCreate(
            answer_key="profile.name",
            label="Name",
            value_kind="text",
            value={"kind": "text", "value": "OLD"},
        )
    )
    mapped = service.put_mapping(
        question_id,
        MappingPut(answer_id=answer.id, expected_question_revision=1, expected_answer_revision=1),
    )
    assert mapped.mapping
    capture = service.create_capture(
        _capture(
            question_id,
            "update-existing",
            "NEW",
            mapping_id=mapped.mapping.id,
            answer_revision_used=answer.revision,
            mapping_revision_used=mapped.mapping.revision,
        )
    ).capture

    with pytest.raises(ConflictError):
        service.apply_capture(
            capture.id,
            UpdateAnswerApply(
                action="update_answer",
                expected_capture_revision=capture.revision,
                expected_question_revision=1,
                answer_id=answer.id,
                expected_answer_revision=99,
                expected_mapping_revision=mapped.mapping.revision,
                value={"kind": "text", "value": "MUST ROLL BACK"},
            ),
        )
    assert service.get_answer(answer.id).value.model_dump()["value"] == "OLD"
    assert service.get_capture(capture.id).status == "current"

    applied = service.apply_capture(
        capture.id,
        UpdateAnswerApply(
            action="update_answer",
            expected_capture_revision=capture.revision,
            expected_question_revision=1,
            answer_id=answer.id,
            expected_answer_revision=answer.revision,
            expected_mapping_revision=mapped.mapping.revision,
            value={"kind": "text", "value": "NEW"},
            label="Updated name",
            reason="Promote correction",
        ),
    )
    assert applied.capture.revision == 2 and applied.capture.value is None
    assert applied.question.id == question_id
    assert applied.answer.revision == 2 and applied.answer.label == "Updated name"
    assert applied.mapping.revision == mapped.mapping.revision
    detail = service.get_answer(answer.id)
    assert detail.value.model_dump()["value"] == "NEW"
    assert {event.event for event in detail.events} >= {"answer_updated", "capture_applied"}


def test_capture_apply_retarget_mapping_reuses_singleton_and_rolls_back_stale_destination(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    question_id = service.resolve(_request(_field())).results[0].question_id
    old_answer = service.create_answer(
        AnswerCreate(
            answer_key="profile.old_name",
            label="Old name",
            value_kind="text",
            value={"kind": "text", "value": "OLD"},
        )
    )
    destination = service.create_answer(
        AnswerCreate(
            answer_key="profile.correct_name",
            label="Correct name",
            value_kind="text",
            value={"kind": "text", "value": "CORRECT"},
        )
    )
    mapped = service.put_mapping(
        question_id,
        MappingPut(
            answer_id=old_answer.id, expected_question_revision=1, expected_answer_revision=1
        ),
    )
    assert mapped.mapping
    capture = service.create_capture(
        _capture(
            question_id,
            "retarget",
            "CORRECT",
            mapping_id=mapped.mapping.id,
            answer_revision_used=old_answer.revision,
            mapping_revision_used=mapped.mapping.revision,
        )
    ).capture

    with pytest.raises(ConflictError):
        service.apply_capture(
            capture.id,
            RetargetMappingApply(
                action="retarget_mapping",
                expected_capture_revision=capture.revision,
                expected_question_revision=1,
                answer_id=destination.id,
                expected_answer_revision=99,
                expected_mapping_revision=mapped.mapping.revision,
            ),
        )
    current = service.get_question(question_id).mapping
    assert current and current.answer_id == old_answer.id and current.revision == 1

    applied = service.apply_capture(
        capture.id,
        RetargetMappingApply(
            action="retarget_mapping",
            expected_capture_revision=capture.revision,
            expected_question_revision=1,
            answer_id=destination.id,
            expected_answer_revision=destination.revision,
            expected_mapping_revision=mapped.mapping.revision,
            reason="Question asks for the corrected fact",
        ),
    )
    assert applied.mapping.id == mapped.mapping.id
    assert applied.mapping.answer_id == destination.id and applied.mapping.revision == 2
    assert applied.capture.status == "applied" and applied.capture.value is None
    assert {event.event for event in service.get_answer(destination.id).events} >= {
        "mapping_corrected",
        "capture_applied",
    }


def test_capture_apply_replace_option_bindings_is_complete_atomic_and_revision_checked(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    result = service.resolve(_request(_choice_field("Authorized?", "binding"))).results[0]
    question = service.get_question(result.question_id)
    option_by_label = {item.raw_label: item.id for item in question.options}
    answer = service.create_answer(
        AnswerCreate(
            answer_key="eligibility.authorization",
            label="Authorization",
            value_kind="single_choice",
            value={"kind": "single_choice", "choice_key": "yes"},
            choices=[
                {"choice_key": "yes", "display_label": "Yes"},
                {"choice_key": "no", "display_label": "No"},
            ],
        )
    )
    choice_by_key = {item.choice_key: item.id for item in answer.choices}
    mapped = service.put_mapping(
        question.id,
        MappingPut(
            answer_id=answer.id,
            expected_question_revision=question.revision,
            expected_answer_revision=answer.revision,
            bindings=[
                {
                    "question_option_id": option_by_label["Yes"],
                    "answer_choice_id": choice_by_key["yes"],
                },
                {
                    "question_option_id": option_by_label["No"],
                    "answer_choice_id": choice_by_key["no"],
                },
            ],
        ),
    )
    assert mapped.mapping
    capture = service.create_capture(
        CaptureCreate(
            capture_key="replace-bindings",
            question_id=question.id,
            application_context_id="application-1",
            page={"platform": "linkedin", "platform_id": "job-42"},
            source="user_input",
            value={"kind": "single_choice", "question_option_id": option_by_label["No"]},
            mapping_id=mapped.mapping.id,
            answer_revision_used=answer.revision,
            mapping_revision_used=mapped.mapping.revision,
        )
    ).capture

    with pytest.raises(ValidationError, match="complete active option set"):
        service.apply_capture(
            capture.id,
            ReplaceOptionBindingsApply(
                action="replace_option_bindings",
                expected_capture_revision=capture.revision,
                expected_question_revision=question.revision,
                answer_id=answer.id,
                expected_answer_revision=answer.revision,
                mapping_id=mapped.mapping.id,
                expected_mapping_revision=mapped.mapping.revision,
                bindings=[
                    {
                        "question_option_id": option_by_label["Yes"],
                        "answer_choice_id": choice_by_key["no"],
                    }
                ],
            ),
        )
    unchanged = service.get_question(question.id).mapping
    assert unchanged and unchanged.revision == 1
    assert service.get_capture(capture.id).status == "current"

    applied = service.apply_capture(
        capture.id,
        ReplaceOptionBindingsApply(
            action="replace_option_bindings",
            expected_capture_revision=capture.revision,
            expected_question_revision=question.revision,
            answer_id=answer.id,
            expected_answer_revision=answer.revision,
            mapping_id=mapped.mapping.id,
            expected_mapping_revision=mapped.mapping.revision,
            bindings=[
                {
                    "question_option_id": option_by_label["Yes"],
                    "answer_choice_id": choice_by_key["no"],
                },
                {
                    "question_option_id": option_by_label["No"],
                    "answer_choice_id": choice_by_key["yes"],
                },
            ],
            reason="Correct reversed option meanings",
        ),
    )
    assert applied.mapping.revision == 2
    assert {
        (item.question_option_id, item.answer_choice_id) for item in applied.mapping.bindings
    } == {
        (option_by_label["Yes"], choice_by_key["no"]),
        (option_by_label["No"], choice_by_key["yes"]),
    }
    assert {event.event for event in service.get_answer(answer.id).events} >= {
        "option_bindings_replaced",
        "capture_applied",
    }


def test_openapi_exposes_all_four_explicit_capture_apply_variants() -> None:
    from app.main import app

    schemas = app.openapi()["components"]["schemas"]
    assert {
        "CreateAnswerAndMapApply",
        "UpdateAnswerApply",
        "RetargetMappingApply",
        "ReplaceOptionBindingsApply",
        "CaptureApplyResponse",
    } <= schemas.keys()

"""Match lifecycle, option bindings, and resolution priority."""

from __future__ import annotations

from typing import Any

import pytest

from app.core.db import Conn
from app.core.errors import ConflictError, ValidationError
from app.form_fill.schemas import (
    AnswerCreate,
    AnswerUpdate,
    CaptureCreate,
    MappingPut,
    MappingUpdate,
    QuestionAnswerCreate,
    ResolutionRequest,
)
from app.form_fill.service import FormFillService


def _field(**updates: Any) -> dict[str, Any]:
    field: dict[str, Any] = {
        "client_field_id": "field-1",
        "prompt": "What is your preferred name?",
        "section": "Profile",
        "help": None,
        "control_kind": "text",
        "stable_field_key": None,
        "autocomplete_token": "name",
        "required": True,
        "max_length": 100,
        "has_value": False,
        "user_confirmed": False,
        "options": [],
    }
    field.update(updates)
    return field


def _choice_field(**updates: Any) -> dict[str, Any]:
    field = _field(
        prompt="Are you authorized to work here?",
        section="Eligibility",
        control_kind="radio",
        autocomplete_token=None,
        max_length=None,
        options=[
            {"client_option_id": "local-yes", "label": "Yes", "disabled": False},
            {"client_option_id": "local-no", "label": "No", "disabled": False},
        ],
    )
    field.update(updates)
    return field


def _request(
    field: dict[str, Any], scan_id: str, *, application: str = "application-1"
) -> ResolutionRequest:
    return ResolutionRequest.model_validate(
        {
            "scan_id": scan_id,
            "application_context_id": application,
            "page": {
                "site_scope": "linkedin:easy-apply",
                "adapter_id": "linkedin",
                "adapter_version": "1",
                "platform": "linkedin",
                "platform_id": "job-42",
            },
            "fields": [field],
        }
    )


def _text_answer(service: FormFillService, key: str = "profile.name") -> Any:
    return service.create_answer(
        AnswerCreate(
            answer_key=key,
            label="Preferred name",
            value_kind="text",
            value={"kind": "text", "value": "PRIVATE NAME"},
        )
    )


def test_question_answer_creation_is_compatible_bound_and_atomic(conn: Conn) -> None:
    service = FormFillService(conn)
    observed = service.resolve(_request(_choice_field(), "scan-create-for-question")).results[0]
    question = service.get_question(observed.question_id)
    option_by_label = {option.raw_label: option.id for option in question.options}
    create = QuestionAnswerCreate(
        expected_question_revision=question.revision,
        answer_key="eligibility.authorization",
        label="Work authorization",
        value={"kind": "single_choice", "choice_key": "yes"},
        choices=[
            {"choice_key": "yes", "display_label": "Yes"},
            {"choice_key": "no", "display_label": "No"},
        ],
        bindings=[
            {"question_option_id": option_by_label["Yes"], "answer_choice_key": "yes"},
            {"question_option_id": option_by_label["No"], "answer_choice_key": "no"},
        ],
    )

    stale = create.model_copy(update={"expected_question_revision": 99})
    with pytest.raises(ConflictError, match="stale_revision"):
        service.create_answer_for_question(question.id, stale)
    assert conn.execute("SELECT COUNT(*) FROM form_answers").fetchone() == (0,)

    created = service.create_answer_for_question(question.id, create)
    assert created.answer and created.mapping
    assert created.answer.value_kind == "single_choice"
    assert created.mapping.answer_id == created.answer.id
    assert len(created.mapping.bindings) == 2
    resolved = service.resolve(_request(_choice_field(), "scan-created-answer")).results[0]
    assert resolved.status == "approved"
    assert resolved.action.model_dump() == {
        "kind": "set_single_choice",
        "client_option_id": "local-yes",
    }


def test_question_answer_creation_rolls_back_an_incompatible_answer(conn: Conn) -> None:
    service = FormFillService(conn)
    observed = service.resolve(
        _request(_field(control_kind="integer"), "scan-incompatible-create")
    ).results[0]

    with pytest.raises(ValidationError, match="answer and question types are incompatible"):
        service.create_answer_for_question(
            observed.question_id,
            QuestionAnswerCreate(
                expected_question_revision=1,
                answer_key="profile.years",
                label="Years of experience",
                value={"kind": "text", "value": "PRIVATE"},
            ),
        )
    assert conn.execute("SELECT COUNT(*) FROM form_answers").fetchone() == (0,)
    assert service.get_question(observed.question_id).mapping is None


def test_question_answer_creation_route_is_private(client: Any, conn: Conn) -> None:
    service = FormFillService(conn)
    observed = service.resolve(_request(_field(), "scan-route-create")).results[0]

    response = client.post(
        f"/api/form-fill/questions/{observed.question_id}/answer",
        json={
            "expected_question_revision": 1,
            "answer_key": "profile.preferred_name",
            "label": "Preferred name",
            "value": {"kind": "text", "value": "PRIVATE NAME"},
        },
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["mapping"]["answer_id"] == response.json()["answer"]["id"]


def test_text_mapping_fill_policies_answer_status_and_match_states_have_distinct_fallbacks(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    observed = service.resolve(_request(_field(), "scan-1")).results[0]
    answer = _text_answer(service)
    mapped = service.put_mapping(
        observed.question_id,
        MappingPut(
            answer_id=answer.id,
            expected_question_revision=1,
            expected_answer_revision=1,
            bindings=[],
        ),
    )
    assert mapped.mapping and mapped.mapping.status == "active"
    mapping_id = mapped.mapping.id

    approved = service.resolve(_request(_field(), "scan-2")).results[0]
    assert approved.status == "approved"
    assert approved.action.model_dump() == {"kind": "set_text", "value": "PRIVATE NAME"}

    answer = service.update_answer(
        answer.id, AnswerUpdate(expected_revision=1, fill_policy="confirm_each_time")
    )
    assert (
        service.resolve(_request(_field(), "scan-3")).results[0].status == "confirmation_required"
    )
    confirmed = service.resolve(_request(_field(user_confirmed=True), "scan-4")).results[0]
    assert confirmed.status == "approved"

    captured = service.create_capture(
        CaptureCreate(
            capture_key="capture-override",
            question_id=observed.question_id,
            application_context_id="application-1",
            page={"platform": "linkedin", "platform_id": "job-42"},
            source="user_input",
            value={"kind": "text", "value": "PROVISIONAL"},
            mapping_id=mapping_id,
            answer_revision_used=answer.revision,
            mapping_revision_used=mapped.mapping.revision,
        )
    ).capture
    assert captured.status == "current"

    disabled = service.update_mapping(
        observed.question_id,
        MappingUpdate(expected_question_revision=1, expected_revision=1, status="disabled"),
    )
    assert disabled.mapping and disabled.mapping.revision == 2
    blocked = service.resolve(_request(_field(), "scan-5")).results[0]
    assert blocked.status == "blocked" and blocked.reason == "mapping_disabled"

    enabled = service.update_mapping(
        observed.question_id,
        MappingUpdate(expected_question_revision=1, expected_revision=2, status="active"),
    )
    assert enabled.mapping and enabled.mapping.revision == 3
    assert (
        service.resolve(_request(_field(), "scan-6")).results[0].status == "confirmation_required"
    )

    disabled_again = service.update_mapping(
        observed.question_id,
        MappingUpdate(expected_question_revision=1, expected_revision=3, status="disabled"),
    )
    retired = service.update_mapping(
        observed.question_id,
        MappingUpdate(expected_question_revision=1, expected_revision=4, status="retired"),
    )
    assert disabled_again.mapping and retired.mapping and retired.mapping.id == mapping_id
    provisional = service.resolve(_request(_field(), "scan-7")).results[0]
    assert provisional.status == "captured"
    assert provisional.action.model_dump()["value"] == "PROVISIONAL"

    reactivated = service.put_mapping(
        observed.question_id,
        MappingPut(
            answer_id=answer.id,
            expected_question_revision=1,
            expected_answer_revision=answer.revision,
            expected_mapping_revision=5,
            bindings=[],
        ),
    )
    assert reactivated.mapping and reactivated.mapping.id == mapping_id
    assert reactivated.mapping.status == "active"

    never = service.update_answer(
        answer.id, AnswerUpdate(expected_revision=answer.revision, fill_policy="never")
    )
    result = service.resolve(_request(_field(), "scan-8")).results[0]
    assert result.status == "blocked" and result.reason == "answer_policy_never"
    disabled_answer = service.update_answer(
        answer.id, AnswerUpdate(expected_revision=never.revision, status="disabled")
    )
    result = service.resolve(_request(_field(), "scan-9")).results[0]
    assert result.status == "blocked" and result.reason == "answer_disabled"
    assert disabled_answer.mappings[0].mapping.id == mapping_id

    enabled_answer = service.update_answer(
        answer.id,
        AnswerUpdate(
            expected_revision=disabled_answer.revision, status="active", fill_policy="auto"
        ),
    )
    assert enabled_answer.status == "active"
    assert enabled_answer.mappings[0].mapping.id == mapping_id
    restored = service.resolve(_request(_field(), "scan-10")).results[0]
    assert restored.status == "approved"
    assert restored.action.model_dump() == {"kind": "set_text", "value": "PRIVATE NAME"}


def test_choice_mapping_round_trips_server_option_ids_and_requires_complete_bindings(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    observed = service.resolve(_request(_choice_field(), "scan-1")).results[0]
    detail = service.get_question(observed.question_id)
    option_by_label = {option.raw_label: option.id for option in detail.options}
    answer = service.create_answer(
        AnswerCreate(
            answer_key="eligibility.authorization",
            label="Work authorization",
            value_kind="single_choice",
            value={"kind": "single_choice", "choice_key": "yes"},
            choices=[
                {"choice_key": "yes", "display_label": "Yes"},
                {"choice_key": "no", "display_label": "No"},
            ],
        )
    )
    choice_by_key = {choice.choice_key: choice.id for choice in answer.choices}

    with pytest.raises(ValidationError, match="complete active option set"):
        service.put_mapping(
            detail.id,
            MappingPut(
                answer_id=answer.id,
                expected_question_revision=detail.revision,
                expected_answer_revision=answer.revision,
                bindings=[
                    {
                        "question_option_id": option_by_label["Yes"],
                        "answer_choice_id": choice_by_key["yes"],
                    }
                ],
            ),
        )
    assert service.get_question(detail.id).mapping is None

    mapped = service.put_mapping(
        detail.id,
        MappingPut(
            answer_id=answer.id,
            expected_question_revision=detail.revision,
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
    result = service.resolve(_request(_choice_field(), "scan-2")).results[0]
    assert result.status == "approved"
    assert result.action.model_dump() == {
        "kind": "set_single_choice",
        "client_option_id": "local-yes",
    }
    assert mapped.mapping and len(mapped.mapping.bindings) == 2


def test_saving_match_consumes_an_identical_current_choice_capture(conn: Conn) -> None:
    service = FormFillService(conn)
    observed = service.resolve(_request(_choice_field(), "scan-match-capture")).results[0]
    detail = service.get_question(observed.question_id)
    option_by_label = {option.raw_label: option.id for option in detail.options}
    answer = service.create_answer(
        AnswerCreate(
            answer_key="eligibility.matching_capture",
            label="Matching capture",
            value_kind="single_choice",
            value={"kind": "single_choice", "choice_key": "yes"},
            choices=[
                {"choice_key": "yes", "display_label": "Yes"},
                {"choice_key": "no", "display_label": "No"},
            ],
        )
    )
    choice_by_key = {choice.choice_key: choice.id for choice in answer.choices}
    capture = service.create_capture(
        CaptureCreate(
            capture_key="matching-choice-capture",
            question_id=detail.id,
            application_context_id="application-1",
            page={"platform": "linkedin", "platform_id": "job-42"},
            source="confirmed_external",
            value={"kind": "single_choice", "question_option_id": option_by_label["Yes"]},
        )
    ).capture

    mapped = service.put_mapping(
        detail.id,
        MappingPut(
            answer_id=answer.id,
            expected_question_revision=detail.revision,
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

    applied = service.get_capture(capture.id)
    assert mapped.current_captures == []
    assert applied.status == "applied" and applied.value is None and applied.revision == 2
    assert [event.event for event in applied.events] == ["capture_applied"]


def test_saving_match_keeps_a_different_current_capture_for_review(conn: Conn) -> None:
    service = FormFillService(conn)
    observed = service.resolve(_request(_field(), "scan-different-capture")).results[0]
    answer = _text_answer(service, "profile.different_capture")
    capture = service.create_capture(
        CaptureCreate(
            capture_key="different-text-capture",
            question_id=observed.question_id,
            application_context_id="application-1",
            page={"platform": "linkedin", "platform_id": "job-42"},
            source="user_input",
            value={"kind": "text", "value": "DIFFERENT PRIVATE VALUE"},
        )
    ).capture

    mapped = service.put_mapping(
        observed.question_id,
        MappingPut(
            answer_id=answer.id,
            expected_question_revision=1,
            expected_answer_revision=answer.revision,
        ),
    )

    pending = service.get_capture(capture.id)
    assert [item.id for item in mapped.current_captures] == [capture.id]
    assert pending.status == "current" and pending.value is not None and pending.revision == 1
    assert pending.events == []


def test_choice_mapping_supports_complete_five_hundred_twelve_option_vocabulary(conn: Conn) -> None:
    service = FormFillService(conn)
    options = [
        {"client_option_id": f"local-{index}", "label": f"Choice {index}", "disabled": False}
        for index in range(512)
    ]
    field = _choice_field(prompt="Choose one item", control_kind="select", options=options)
    observed = service.resolve(_request(field, "scan-large-1")).results[0]
    detail = service.get_question(observed.question_id)
    question_option_by_label = {option.raw_label: option.id for option in detail.options}
    answer = service.create_answer(
        AnswerCreate(
            answer_key="profile.large_choice",
            label="Large choice",
            value_kind="single_choice",
            value={"kind": "single_choice", "choice_key": "choice-31"},
            choices=[
                {"choice_key": f"choice-{index}", "display_label": f"Choice {index}"}
                for index in range(512)
            ],
        )
    )
    answer_choice_by_key = {choice.choice_key: choice.id for choice in answer.choices}
    mapped = service.put_mapping(
        detail.id,
        MappingPut(
            answer_id=answer.id,
            expected_question_revision=detail.revision,
            expected_answer_revision=answer.revision,
            bindings=[
                {
                    "question_option_id": question_option_by_label[f"Choice {index}"],
                    "answer_choice_id": answer_choice_by_key[f"choice-{index}"],
                }
                for index in range(512)
            ],
        ),
    )

    result = service.resolve(_request(field, "scan-large-2")).results[0]
    assert mapped.mapping and len(mapped.mapping.bindings) == 512
    assert result.status == "approved"
    assert result.action.model_dump() == {
        "kind": "set_single_choice",
        "client_option_id": "local-31",
    }


def test_retarget_reuses_singleton_row_replaces_bindings_and_stale_request_rolls_back(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    observed = service.resolve(_request(_field(), "scan-1")).results[0]
    first = _text_answer(service, "profile.first_name")
    second = _text_answer(service, "profile.display_name")
    first_mapping = service.put_mapping(
        observed.question_id,
        MappingPut(answer_id=first.id, expected_question_revision=1, expected_answer_revision=1),
    ).mapping
    assert first_mapping

    retargeted = service.put_mapping(
        observed.question_id,
        MappingPut(
            answer_id=second.id,
            expected_question_revision=1,
            expected_answer_revision=1,
            expected_mapping_revision=first_mapping.revision,
        ),
    ).mapping
    assert retargeted and retargeted.id == first_mapping.id
    assert retargeted.answer_id == second.id and retargeted.revision == 2

    with pytest.raises(ConflictError) as stale:
        service.put_mapping(
            observed.question_id,
            MappingPut(
                answer_id=first.id,
                expected_question_revision=1,
                expected_answer_revision=1,
                expected_mapping_revision=1,
            ),
        )
    assert stale.value.current["mapping"]["answer_id"] == second.id
    current = service.get_question(observed.question_id).mapping
    assert current and current.answer_id == second.id and current.revision == 2
    assert conn.execute("SELECT COUNT(*) FROM form_question_mappings").fetchone() == (1,)

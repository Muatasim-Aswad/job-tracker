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

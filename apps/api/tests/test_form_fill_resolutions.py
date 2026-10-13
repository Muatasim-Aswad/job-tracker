"""Question observation and the stable resolution wire boundary."""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

import pytest
from fastapi import Response
from pydantic import ValidationError as PydanticValidationError

from app.core.db import Conn, query_one
from app.form_fill.router import resolve_questions
from app.form_fill.schemas import (
    CaptureCreate,
    MappingUpdate,
    QuestionAnswerCreate,
    QuestionReviewUpdate,
    ResolutionRequest,
)
from app.form_fill.service import FormFillService
from app.main import app


def _field(client_field_id: str = "field-1", **updates: Any) -> dict[str, Any]:
    field: dict[str, Any] = {
        "client_field_id": client_field_id,
        "prompt": "How many years of experience do you have with Python?",
        "section": "Additional Questions",
        "help": "Enter a whole number",
        "control_kind": "integer",
        "stable_field_key": None,
        "autocomplete_token": None,
        "required": True,
        "max_length": 2,
        "has_value": False,
        "user_confirmed": False,
        "options": [],
    }
    field.update(updates)
    return field


def _choice_field(client_field_id: str = "choice-1", **updates: Any) -> dict[str, Any]:
    field = _field(
        client_field_id,
        prompt="Are you legally authorized to work in the Netherlands?",
        section="Work authorization",
        help=None,
        control_kind="radio",
        max_length=None,
        options=[
            {
                "client_option_id": "local-yes",
                "label": "Yes",
                "stable_option_key": None,
                "disabled": False,
            },
            {
                "client_option_id": "local-no",
                "label": "No",
                "stable_option_key": None,
                "disabled": False,
            },
        ],
    )
    field.update(updates)
    return field


def _request(*fields: dict[str, Any], scan_id: str = "scan-1") -> dict[str, Any]:
    return {
        "scan_id": scan_id,
        "application_context_id": "application-1",
        "page": {
            "site_scope": "linkedin:easy-apply",
            "adapter_id": "linkedin",
            "adapter_version": "1",
            "platform": "linkedin",
            "platform_id": "job-42",
        },
        "fields": list(fields) or [_field()],
    }


def _resolve(service: FormFillService, body: dict[str, Any]) -> dict[str, Any]:
    return service.resolve(ResolutionRequest.model_validate(body)).model_dump(mode="json")


def _seed_listing(conn: Conn) -> tuple[str, str]:
    conn.execute(
        "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ('job-1', 'new', 't', 't')"
    )
    conn.execute(
        "INSERT INTO listings (id, job_id, platform, platform_id) "
        "VALUES ('listing-1', 'job-1', 'linkedin', 'job-42')"
    )
    return "job-1", "listing-1"


def test_resolution_preserves_order_resolves_listing_context_and_maps_every_option(
    conn: Conn,
) -> None:
    job_id, listing_id = _seed_listing(conn)
    result = _resolve(FormFillService(conn), _request(_field(), _choice_field()))

    assert result["listing_context"] == {"job_id": job_id, "listing_id": listing_id}
    assert [item["client_field_id"] for item in result["results"]] == ["field-1", "choice-1"]
    assert [item["status"] for item in result["results"]] == ["unresolved", "unresolved"]
    choice = result["results"][1]
    assert [pair["client_option_id"] for pair in choice["option_mappings"]] == [
        "local-yes",
        "local-no",
    ]
    assert all(pair["question_option_id"] for pair in choice["option_mappings"])
    assert conn.execute("SELECT COUNT(*) FROM form_questions").fetchone() == (2,)
    assert conn.execute("SELECT COUNT(*) FROM form_question_options").fetchone() == (2,)


def test_unknown_listing_context_stays_unlinked_and_does_not_materialize_a_job(conn: Conn) -> None:
    result = _resolve(FormFillService(conn), _request(_field()))
    assert result["listing_context"] == {"job_id": None, "listing_id": None}
    assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone() == (0,)
    assert conn.execute("SELECT COUNT(*) FROM listings").fetchone() == (0,)


def test_last_unresolved_reason_tracks_the_actual_resolution_outcome(conn: Conn) -> None:
    service = FormFillService(conn)
    first = _resolve(service, _request(_field()))["results"][0]
    assert service.get_question(first["question_id"]).last_unresolved_reason == "no_knowledge"

    conn.execute(
        "INSERT INTO form_answers (id, answer_key, label, value_kind, value_json, status, "
        "fill_policy, revision, verified_at, created_at, updated_at) "
        "VALUES ('answer-1', 'years.python', 'Years', 'decimal', ?, 'active', "
        "'auto', 1, 't', 't', 't')",
        ('{"kind":"decimal","value":"3"}',),
    )
    conn.execute(
        "INSERT INTO form_question_mappings "
        "(id, question_id, answer_id, status, revision, approved_at, created_at, updated_at) "
        "VALUES ('mapping-1', ?, 'answer-1', 'active', 1, 't', 't', 't')",
        (first["question_id"],),
    )
    approved = _resolve(service, _request(_field(), scan_id="scan-2"))["results"][0]
    assert approved["status"] == "approved"
    assert service.get_question(first["question_id"]).last_unresolved_reason is None

    conn.execute("UPDATE form_question_mappings SET status = 'disabled' WHERE id = 'mapping-1'")
    blocked = _resolve(service, _request(_field(), scan_id="scan-3"))["results"][0]
    assert blocked["reason"] == "mapping_disabled"
    assert service.get_question(first["question_id"]).last_unresolved_reason == "mapping_disabled"


def test_sighting_retry_is_deduplicated_and_option_reordering_preserves_identity(
    conn: Conn,
) -> None:
    service = FormFillService(conn)
    first = _resolve(service, _request(_choice_field(), scan_id="scan-retry"))["results"][0]
    retry_field = _choice_field(
        prompt="  Are you legally authorized to work in the Netherlands? (required)  ",
        options=list(reversed(_choice_field()["options"])),
    )
    retry = _resolve(service, _request(retry_field, scan_id="scan-retry"))["results"][0]
    later = _resolve(service, _request(retry_field, scan_id="scan-next"))["results"][0]

    assert first["question_id"] == retry["question_id"] == later["question_id"]
    first_pairs = {p["client_option_id"]: p["question_option_id"] for p in first["option_mappings"]}
    retry_pairs = {p["client_option_id"]: p["question_option_id"] for p in retry["option_mappings"]}
    assert retry_pairs == first_pairs
    row = query_one(
        conn,
        "SELECT seen_count, last_seen_scan_id FROM form_questions WHERE id = ?",
        (first["question_id"],),
    )
    assert row == {"seen_count": 2, "last_seen_scan_id": "scan-next"}


@pytest.mark.parametrize(
    "change",
    [
        {"section": "Screening"},
        {"help": "Enter a decimal number"},
        {"control_kind": "decimal"},
        {"autocomplete_token": "organization-title"},
    ],
)
def test_generic_identity_includes_all_semantic_field_evidence(
    conn: Conn, change: dict[str, Any]
) -> None:
    service = FormFillService(conn)
    first = _resolve(service, _request(_field(), scan_id="scan-a"))["results"][0]["question_id"]
    changed = _resolve(service, _request(_field(**change), scan_id="scan-b"))["results"][0][
        "question_id"
    ]
    assert changed != first


def test_enabled_option_set_changes_identity_but_request_local_ids_never_do(conn: Conn) -> None:
    service = FormFillService(conn)
    first = _resolve(service, _request(_choice_field(), scan_id="scan-a"))["results"][0]
    local_id_changed = deepcopy(_choice_field())
    local_id_changed["options"][0]["client_option_id"] = "another-local-id"
    same = _resolve(service, _request(local_id_changed, scan_id="scan-b"))["results"][0]
    option_added = deepcopy(_choice_field())
    option_added["options"].append(
        {
            "client_option_id": "local-maybe",
            "label": "Maybe",
            "stable_option_key": None,
            "disabled": False,
        }
    )
    changed = _resolve(service, _request(option_added, scan_id="scan-c"))["results"][0]

    assert same["question_id"] == first["question_id"]
    assert changed["question_id"] != first["question_id"]


def test_versioned_adapter_key_replaces_prompt_evidence_only_for_that_version(conn: Conn) -> None:
    service = FormFillService(conn)
    keyed = _field(stable_field_key="years.python", prompt="Python experience")
    first = _resolve(service, _request(keyed, scan_id="scan-a"))["results"][0]
    reworded = _field(stable_field_key="years.python", prompt="Years using Python professionally")
    same = _resolve(service, _request(reworded, scan_id="scan-b"))["results"][0]
    upgraded = _request(reworded, scan_id="scan-c")
    upgraded["page"]["adapter_version"] = "2"
    changed = _resolve(service, upgraded)["results"][0]

    assert same["question_id"] == first["question_id"]
    assert changed["question_id"] != first["question_id"]


def test_generic_identity_is_scoped_to_site_evidence_not_adapter_version(conn: Conn) -> None:
    service = FormFillService(conn)
    first = _resolve(service, _request(_field(), scan_id="scan-a"))["results"][0]
    upgraded = _request(_field(), scan_id="scan-b")
    upgraded["page"]["adapter_id"] = "linkedin-redesign"
    upgraded["page"]["adapter_version"] = "2"
    same = _resolve(service, upgraded)["results"][0]

    assert same["question_id"] == first["question_id"]


def test_request_evidence_is_bounded_and_duplicate_local_handles_are_rejected() -> None:
    with pytest.raises(PydanticValidationError):
        ResolutionRequest.model_validate(_request(_field(prompt="x" * 2001)))

    duplicate = _request(_choice_field())
    duplicate["fields"][0]["options"][1]["client_option_id"] = "local-yes"
    with pytest.raises(PydanticValidationError):
        ResolutionRequest.model_validate(duplicate)


def test_option_bound_is_exactly_five_hundred_twelve_per_field() -> None:
    # Adapters mirror this bound to keep an oversized control out of the request:
    # one over-bound field rejects the whole scan, not just itself.
    options = [
        {
            "client_option_id": f"local-{index}",
            "label": f"Option {index}",
            "stable_option_key": None,
            "disabled": False,
        }
        for index in range(513)
    ]
    at_bound = _request(_choice_field(control_kind="select", options=options[:512]))
    assert len(ResolutionRequest.model_validate(at_bound).fields[0].options) == 512

    over_bound = _request(_choice_field(control_kind="select", options=options))
    with pytest.raises(PydanticValidationError) as rejected:
        ResolutionRequest.model_validate(over_bound)
    assert rejected.value.errors()[0]["loc"][-1] == "options"


def test_openapi_defines_every_final_result_discriminant_and_typed_action() -> None:
    openapi = app.openapi()
    assert "/api/form-fill/resolutions" in openapi["paths"]
    schemas = openapi["components"]["schemas"]
    assert {
        "ApprovedResult",
        "CapturedResult",
        "ConfirmationRequiredResult",
        "BlockedResult",
        "ConflictResult",
        "UnresolvedResult",
        "IgnoredResult",
    } <= schemas.keys()
    assert {
        "SetTextAction",
        "SetDecimalAction",
        "SetBooleanAction",
        "SetDateAction",
        "SetSingleChoiceAction",
        "SetMultiChoiceAction",
    } <= schemas.keys()
    assert not any(
        forbidden in name.lower()
        for name in schemas
        for forbidden in ("navigate", "submit", "selector", "script_action")
    )


def test_value_bearing_route_is_no_store_and_request_bodies_are_not_logged(
    conn: Conn, caplog: pytest.LogCaptureFixture
) -> None:
    sentinel = "PRIVATE-QUESTION-BODY-DO-NOT-LOG"
    response = Response()
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        result = resolve_questions(
            ResolutionRequest.model_validate(_request(_field(prompt=sentinel))),
            response,
            FormFillService(conn),
        )
    assert result.results[0].status == "unresolved"
    assert response.headers["cache-control"] == "no-store"
    assert sentinel not in caplog.text
    assert "application-1" not in caplog.text


@pytest.mark.parametrize("source_kind,target_kind", [("radio", "select"), ("select", "radio")])
@pytest.mark.parametrize("stable_key", [None, "eligibility.authorization"])
@pytest.mark.parametrize("knowledge", ["capture", "verified"])
def test_single_choice_knowledge_is_shared_across_layouts(
    conn: Conn, source_kind: str, target_kind: str, stable_key: str | None, knowledge: str
) -> None:
    service = FormFillService(conn)
    first = _resolve(
        service, _request(_choice_field(control_kind=source_kind, stable_field_key=stable_key))
    )["results"][0]
    question = service.get_question(first["question_id"])
    yes = next(o.id for o in question.options if o.raw_label == "Yes")
    if knowledge == "capture":
        service.create_capture(
            CaptureCreate(
                capture_key="shared-choice",
                question_id=question.id,
                application_context_id="application-1",
                page={"platform": "linkedin", "platform_id": "job-42"},
                source="user_input",
                value={"kind": "single_choice", "question_option_id": yes},
            )
        )
    else:
        service.create_answer_for_question(
            question.id,
            QuestionAnswerCreate(
                expected_question_revision=question.revision,
                answer_key="eligibility.authorization",
                label="Work authorization",
                value={"kind": "single_choice", "choice_key": "yes"},
                choices=[
                    {"choice_key": "yes", "display_label": "Yes"},
                    {"choice_key": "no", "display_label": "No"},
                ],
                bindings=[
                    {"question_option_id": o.id, "answer_choice_key": o.raw_label.lower()}
                    for o in question.options
                ],
            ),
        )
    target = _choice_field(control_kind=target_kind, stable_field_key=stable_key)
    target["options"] = [
        dict(o, client_option_id=f"target-{o['label'].lower()}")
        for o in reversed(target["options"])
    ]
    result = _resolve(service, _request(target, scan_id="scan-other-layout"))["results"][0]
    assert result["question_id"] == question.id
    assert result["status"] == ("captured" if knowledge == "capture" else "approved")
    assert result["action"] == {"kind": "set_single_choice", "client_option_id": "target-yes"}
    shared = service.get_question(question.id)
    assert shared.normalizer_version == 2
    assert shared.control_kind == "radio"
    assert shared.revision == question.revision
    assert conn.execute("SELECT COUNT(*) FROM form_questions").fetchone() == (1,)
    if knowledge == "verified":
        assert shared.mapping is not None
        service.update_mapping(
            shared.id,
            MappingUpdate(
                expected_question_revision=shared.revision,
                expected_revision=shared.mapping.revision,
                status="disabled",
            ),
        )
        blocked = _resolve(service, _request(target, scan_id="scan-disabled"))["results"][0]
        assert blocked["status"] == "blocked"
        assert blocked["reason"] == "mapping_disabled"
    else:
        service.update_question(
            shared.id,
            QuestionReviewUpdate(expected_revision=shared.revision, review_state="ignored"),
        )
        assert (
            _resolve(service, _request(target, scan_id="scan-muted"))["results"][0]["status"]
            == "ignored"
        )


@pytest.mark.parametrize(
    "change",
    [
        {"prompt": "Are you authorized to work in another country?"},
        {"section": "Reference contact"},
        {"help": "Including future authorization"},
        {"autocomplete_token": "country"},
        {"stable_field_key": "another-question"},
        {"control_kind": "multi_select"},
        {
            "options": [
                {"client_option_id": "yes", "label": "Yes"},
                {"client_option_id": "no", "label": "Never"},
            ]
        },
        {
            "options": [
                {"client_option_id": "yes", "label": "Yes", "stable_option_key": "other"},
                {"client_option_id": "no", "label": "No"},
            ]
        },
        {
            "options": [
                {"client_option_id": "yes", "label": "Yes", "disabled": True},
                {"client_option_id": "no", "label": "No"},
            ]
        },
    ],
)
def test_shared_single_choice_identity_keeps_other_evidence_exact(
    conn: Conn, change: dict[str, Any]
) -> None:
    service = FormFillService(conn)
    first = _resolve(service, _request(_choice_field()))["results"][0]
    changed = _resolve(
        service,
        _request(_choice_field(**{"control_kind": "select", **change}), scan_id="scan-changed"),
    )["results"][0]
    assert changed["question_id"] != first["question_id"]
    scoped = _request(_choice_field(control_kind="select"), scan_id="scan-other-site")
    scoped["page"]["site_scope"] = "other:application"
    assert _resolve(service, scoped)["results"][0]["question_id"] != first["question_id"]


def test_old_radio_and_select_knowledge_is_untouched_and_not_adopted(conn: Conn) -> None:
    service = FormFillService(conn)
    legacy_signatures = {
        "radio": "0c1fb8a7663243d2427fd030080df6d7c2b62eeecc216f7222c496670d2efee6",
        "select": "682d7caa7a120c49056bf14ea232da5cce78cddfec0004195179663fc19efbbc",
    }
    old_ids = []
    for kind, signature in legacy_signatures.items():
        result = _resolve(
            service, _request(_choice_field(control_kind=kind), scan_id=f"old-{kind}")
        )["results"][0]
        old_ids.append(result["question_id"])
        conn.execute(
            "UPDATE form_questions SET signature = ?, normalizer_version = 1, control_kind = ? WHERE id = ?",
            (signature, kind, result["question_id"]),
        )
    old_radio = service.get_question(old_ids[0])
    service.create_capture(
        CaptureCreate(
            capture_key="old-radio-choice",
            question_id=old_radio.id,
            application_context_id="application-1",
            page={"platform": "linkedin", "platform_id": "job-42"},
            source="user_input",
            value={"kind": "single_choice", "question_option_id": old_radio.options[0].id},
        )
    )
    old_select = service.get_question(old_ids[1])
    service.create_answer_for_question(
        old_select.id,
        QuestionAnswerCreate(
            expected_question_revision=old_select.revision,
            answer_key="legacy.authorization",
            label="Work authorization",
            value={"kind": "single_choice", "choice_key": "no"},
            choices=[
                {"choice_key": "yes", "display_label": "Yes"},
                {"choice_key": "no", "display_label": "No"},
            ],
            bindings=[
                {"question_option_id": o.id, "answer_choice_key": o.raw_label.lower()}
                for o in old_select.options
            ],
        ),
    )
    before = [service.get_question(q).model_dump() for q in old_ids]
    captures = service.repo.list_current_capture_records(old_radio.id)
    radio = _resolve(service, _request(_choice_field(), scan_id="new-radio"))["results"][0]
    select = _resolve(
        service, _request(_choice_field(control_kind="select"), scan_id="new-select")
    )["results"][0]
    assert radio["question_id"] == select["question_id"]
    assert radio["question_id"] not in old_ids
    assert radio["status"] == select["status"] == "unresolved"
    assert before == [service.get_question(q).model_dump() for q in old_ids]
    assert captures == service.repo.list_current_capture_records(old_radio.id)
    assert conn.execute("SELECT COUNT(*) FROM form_questions").fetchone() == (3,)


@pytest.mark.parametrize(
    "field,signature",
    [
        (_field(), "5217c61c9250066631d5ad768f8877f7e1a72cee8c3bbe9554074d62f0339aba"),
        (
            _choice_field(control_kind="checkbox_group"),
            "7023c3e7be94d8e3b3ed07a1dec76f0ac85ee0d8b52d257ab3e28dbc4cb85e7c",
        ),
        (
            _choice_field(control_kind="multi_select"),
            "f87f74168d3fb91216bc693beead7210831abad18051c824fc3ef410cf2c4a2d",
        ),
    ],
)
def test_other_control_identities_retain_v1_signatures(
    conn: Conn, field: dict[str, Any], signature: str
) -> None:
    service = FormFillService(conn)
    result = _resolve(service, _request(field))["results"][0]
    question = service.get_question(result["question_id"])
    assert question.normalizer_version == 1
    assert service.repo.get_question_by_signature(signature).id == question.id

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
from app.form_fill.schemas import ResolutionRequest
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

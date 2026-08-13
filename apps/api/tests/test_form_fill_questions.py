"""Question review reads and revision-checked mute/reopen behavior."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import Response

from app.core.db import Conn
from app.core.errors import ConflictError, InvalidCursorError, ValidationError
from app.form_fill.router import get_question
from app.form_fill.router import list_questions as list_questions_route
from app.form_fill.schemas import QuestionReviewUpdate, ResolutionRequest
from app.form_fill.service import FormFillService


def _observe(
    service: FormFillService,
    prompt: str,
    *,
    scan_id: str,
    control_kind: str = "text",
    options: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    request = ResolutionRequest.model_validate(
        {
            "scan_id": scan_id,
            "application_context_id": "application-1",
            "page": {
                "site_scope": "linkedin:easy-apply",
                "adapter_id": "linkedin",
                "adapter_version": "1",
                "platform": "linkedin",
                "platform_id": "uncaptured-listing",
            },
            "fields": [
                {
                    "client_field_id": "field-1",
                    "prompt": prompt,
                    "section": "Additional Questions",
                    "help": "Exact help",
                    "control_kind": control_kind,
                    "stable_field_key": None,
                    "autocomplete_token": None,
                    "required": True,
                    "max_length": 100,
                    "has_value": False,
                    "user_confirmed": False,
                    "options": options or [],
                }
            ],
        }
    )
    return service.resolve(request).model_dump(mode="json")["results"][0]


def _list(service: FormFillService, **updates: Any) -> dict[str, Any]:
    arguments: dict[str, Any] = {
        "review_state": None,
        "mapping_status": None,
        "has_current_capture": None,
        "site_scope": None,
        "answer_id": None,
        "query": None,
        "sort": "last_seen",
        "limit": 50,
        "cursor": None,
    }
    arguments.update(updates)
    return service.list_questions(**arguments).model_dump(mode="json")


def test_question_list_detail_search_and_cursor_reads(conn: Conn) -> None:
    service = FormFillService(conn)
    prompts = ["Python experience", "Java experience", "TypeScript experience"]
    observed = [
        _observe(service, prompt, scan_id=f"scan-{index}") for index, prompt in enumerate(prompts)
    ]

    first_page = _list(service, limit=2)
    assert len(first_page["items"]) == 2
    cursor = first_page["next_cursor"]
    assert cursor
    second_page = _list(service, limit=2, cursor=cursor)
    ids = {item["id"] for item in first_page["items"] + second_page["items"]}
    assert ids == {item["question_id"] for item in observed}

    search = _list(service, query="PYTHON")
    assert [item["raw_question"] for item in search["items"]] == ["Python experience"]
    with pytest.raises(InvalidCursorError):
        _list(service, limit=2, review_state="ignored", cursor=cursor)

    detail = service.get_question(observed[0]["question_id"])
    assert detail.normalized_question == "python experience"
    assert detail.normalized_section == "additional questions"
    assert detail.normalized_help == "exact help"
    response = Response()
    get_question(detail.id, response, service)
    assert response.headers["cache-control"] == "no-store"
    list_response = Response()
    list_questions_route(
        response=list_response,
        review_state=None,
        mapping_status=None,
        has_current_capture=None,
        site_scope=None,
        answer_id=None,
        q=None,
        sort="last_seen",
        limit=50,
        cursor=None,
        service=service,
    )
    assert list_response.headers["cache-control"] == "no-store"


def test_mute_blocks_resolution_and_reopen_restores_unresolved_behavior(conn: Conn) -> None:
    service = FormFillService(conn)
    observed = _observe(service, "Question to mute", scan_id="scan-a")
    question_id = observed["question_id"]
    detail = service.get_question(question_id)

    muted = service.update_question(
        question_id,
        QuestionReviewUpdate(
            expected_revision=detail.revision,
            review_state="ignored",
            reason="Do not fill this exact variant",
        ),
    )
    assert muted.review_state == "ignored"
    assert muted.revision == detail.revision + 1
    assert muted.events[0].event == "question_ignored"

    ignored = _observe(service, "Question to mute", scan_id="scan-b")
    assert ignored["question_id"] == question_id
    assert ignored["status"] == "ignored"

    with pytest.raises(ConflictError) as stale:
        service.update_question(
            question_id,
            QuestionReviewUpdate(expected_revision=detail.revision, review_state="open"),
        )
    assert stale.value.message == "stale_revision"
    assert isinstance(stale.value.current, dict)
    assert stale.value.current["review_state"] == "ignored"

    reopened = service.update_question(
        question_id, QuestionReviewUpdate(expected_revision=muted.revision, review_state="open")
    )
    assert reopened.review_state == "open"
    assert reopened.revision == muted.revision + 1
    assert _observe(service, "Question to mute", scan_id="scan-c")["status"] == "unresolved"


def test_repeating_current_review_state_is_a_revision_checked_noop(conn: Conn) -> None:
    service = FormFillService(conn)
    observed = _observe(service, "No-op review", scan_id="scan-a")
    before = service.get_question(observed["question_id"])
    after = service.update_question(
        before.id, QuestionReviewUpdate(expected_revision=before.revision, review_state="open")
    )
    assert after.revision == before.revision
    assert after.events == before.events


def test_question_detail_and_filters_expose_current_relations_without_values(conn: Conn) -> None:
    service = FormFillService(conn)
    observed = _observe(service, "Mapped question", scan_id="scan-a")
    question_id = observed["question_id"]
    conn.execute(
        "INSERT INTO form_answers (id, answer_key, label, value_kind, value_json, status, "
        "fill_policy, revision, verified_at, created_at, updated_at) "
        "VALUES ('answer-1', 'profile.fact', 'Private fact', 'text', ?, 'active', "
        "'auto', 1, 't', 't', 't')",
        ('{"kind":"text","value":"PRIVATE-VALUE"}',),
    )
    conn.execute(
        "INSERT INTO form_question_mappings "
        "(id, question_id, answer_id, status, revision, approved_at, created_at, updated_at) "
        "VALUES ('mapping-1', ?, 'answer-1', 'active', 1, 't', 't', 't')",
        (question_id,),
    )
    conn.execute(
        "INSERT INTO form_captures (id, capture_key, question_id, application_context_id, "
        "source, value_kind, value_json, status, revision, created_at, updated_at) "
        "VALUES ('capture-1', 'retry-1', ?, 'application-1', 'user_input', 'text', ?, "
        "'current', 1, 't', 't')",
        (question_id, '{"kind":"text","value":"PRIVATE-CAPTURE"}'),
    )

    detail = service.get_question(question_id)
    assert detail.mapping and detail.mapping.id == "mapping-1"
    assert detail.answer and detail.answer.id == "answer-1"
    assert [capture.id for capture in detail.current_captures] == ["capture-1"]
    serialized = detail.model_dump_json()
    assert "PRIVATE-VALUE" not in serialized
    assert "PRIVATE-CAPTURE" not in serialized

    filters = _list(
        service,
        mapping_status="active",
        has_current_capture=True,
        answer_id="answer-1",
        site_scope="LINKEDIN:EASY-APPLY",
    )
    assert [item["id"] for item in filters["items"]] == [question_id]

    with pytest.raises(ValidationError):
        service.update_question(
            question_id,
            QuestionReviewUpdate(expected_revision=detail.revision, review_state="ignored"),
        )

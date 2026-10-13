from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.db import Conn
from app.core.errors import ConflictError, InvalidCursorError
from app.form_fill.schemas import (
    AnswerChoiceInput,
    AnswerCreate,
    AnswerUpdate,
    MappingPut,
    OptionBindingInput,
    ResolutionRequest,
    TextValue,
)
from app.form_fill.service import FormFillService


def question(service: FormFillService, **updates: Any) -> str:
    field = {
        "client_field_id": "field",
        "prompt": "How many years of Python experience do you have?",
        "section": "Skills",
        "control_kind": "text",
        "required": True,
        "has_value": False,
        "user_confirmed": False,
        "options": [],
        **updates,
    }
    result = service.resolve(
        ResolutionRequest.model_validate(
            {
                "scan_id": "candidate-scan",
                "application_context_id": "synthetic-candidates",
                "page": {
                    "site_scope": "synthetic",
                    "adapter_id": "synthetic",
                    "adapter_version": "1",
                    "platform": "synthetic",
                    "platform_id": "synthetic-job",
                },
                "fields": [field],
            }
        )
    ).results[0]
    return result.question_id


def answer(service: FormFillService, key: str, **updates: Any) -> Any:
    return service.create_answer(
        AnswerCreate.model_validate(
            {
                "answer_key": key,
                "label": "Python experience",
                "value_kind": "text",
                "value": {"kind": "text", "value": "5 years"},
                **updates,
            }
        )
    )


def candidates(service: FormFillService, question_id: str, **updates: Any) -> Any:
    return service.list_answer_candidates(
        question_id, **{"query": None, "limit": 30, "cursor": None, **updates}
    )


def choice_answer(service: FormFillService, key: str, labels: list[str], **updates: Any) -> Any:
    return answer(
        service,
        key,
        **{
            "label": "Work authorization",
            "value_kind": "single_choice",
            "value": {"kind": "single_choice", "choice_key": "c0"},
            "choices": [
                {"choice_key": f"c{i}", "display_label": label} for i, label in enumerate(labels)
            ],
            **updates,
        },
    )


def choice_question(service: FormFillService, **updates: Any) -> str:
    return question(
        service,
        **{
            "prompt": "Work authorization",
            "control_kind": "radio",
            "options": [
                {"client_option_id": "yes", "label": "Yes"},
                {"client_option_id": "no", "label": "No"},
            ],
            **updates,
        },
    )


def test_filters_and_ranks_globally_before_pagination(conn: Conn) -> None:
    service = FormFillService(conn)
    qid = question(service)
    weaker = answer(service, "weaker", label="Skill", description="Python")
    best = answer(service, "best")
    for i in range(65):
        answer(service, f"noise{i}", label="Unrelated answer")
    answer(service, "generic", label="Years of experience")
    answer(service, "wrongtype", value_kind="decimal", value={"kind": "decimal", "value": "5"})
    paused = answer(service, "paused")
    service.update_answer(paused.id, AnswerUpdate(expected_revision=1, status="disabled"))
    first = candidates(service, qid, limit=1)
    assert [item.id for item in first.items] == [best.id]
    assert first.next_cursor
    second = candidates(service, qid, limit=1, cursor=first.next_cursor)
    assert [item.id for item in second.items] == [weaker.id]
    assert second.next_cursor is None
    assert first.items[0].value_preview == "5 years"


def test_choice_count_labels_and_active_vocabulary(conn: Conn) -> None:
    service = FormFillService(conn)
    qid = choice_question(service)
    correct = choice_answer(service, "correct", [" YES ", "no"])
    choice_answer(service, "extra", ["Yes", "No", "Maybe"])
    choice_answer(service, "short", ["Yes"])
    different = choice_answer(service, "different", ["Junior", "Senior"])
    choice_answer(service, "unrelated", ["Yes", "No"], label="English proficiency")
    choice_answer(service, "duplicate", ["Yes", "Yes"])
    inactive_extra = choice_answer(service, "inactive_extra", ["Yes", "No", "Maybe"])
    service.update_answer(
        inactive_extra.id,
        AnswerUpdate(
            expected_revision=1,
            choices=[
                AnswerChoiceInput(
                    choice_key=c.choice_key,
                    display_label=c.display_label,
                    status="disabled" if c.choice_key == "c2" else "active",
                )
                for c in inactive_extra.choices
            ],
        ),
    )
    assert {item.id for item in candidates(service, qid).items} == {correct.id, inactive_extra.id}
    found = candidates(service, qid, query="authorization")
    assert different.id in {item.id for item in found.items}
    assert len(found.items) == 4  # Same type/count, including labels requiring manual bindings.


def test_numeric_candidates_obey_integer_write_safety(conn: Conn) -> None:
    service = FormFillService(conn)
    integer = question(service, control_kind="integer")
    decimal = question(service, control_kind="decimal")
    whole = answer(service, "whole", value_kind="decimal", value={"kind": "decimal", "value": "5"})
    fraction = answer(
        service, "fraction", value_kind="decimal", value={"kind": "decimal", "value": "5.5"}
    )
    assert [item.id for item in candidates(service, integer).items] == [whole.id]
    assert {item.id for item in candidates(service, decimal).items} == {whole.id, fraction.id}


def test_verified_bindings_and_question_wording_provide_suggestions(conn: Conn) -> None:
    service = FormFillService(conn)
    source = choice_question(service)
    target = choice_question(service, section="Another form")
    saved = choice_answer(service, "verified", ["Affirmative", "Negative"], label="Eligibility")
    detail = service.get_question(source)
    service.put_mapping(
        source,
        MappingPut(
            answer_id=saved.id,
            expected_question_revision=detail.revision,
            expected_answer_revision=saved.revision,
            expected_mapping_revision=None,
            bindings=[
                OptionBindingInput(
                    question_option_id=option.id,
                    answer_choice_id=next(
                        c.id
                        for c in saved.choices
                        if c.display_label
                        == ("Affirmative" if option.raw_label == "Yes" else "Negative")
                    ),
                )
                for option in detail.options
            ],
        ),
    )
    assert [item.id for item in candidates(service, target).items] == [saved.id]
    assert candidates(service, target).items[0].value_preview == "Affirmative"


def test_search_keeps_structural_constraints_and_cursors_bind_current_results(conn: Conn) -> None:
    service = FormFillService(conn)
    qid = question(service)
    first = answer(service, "first")
    answer(service, "second")
    page = candidates(service, qid, limit=1)
    assert page.next_cursor
    for overrides in [{"query": "Python"}, {"question_id": question(service, section="Other")}]:
        target = overrides.pop("question_id", qid)
        with pytest.raises(InvalidCursorError):
            candidates(service, target, cursor=page.next_cursor, **overrides)
    service.update_answer(
        first.id, AnswerUpdate(expected_revision=1, value=TextValue(kind="text", value="6 years"))
    )
    with pytest.raises(InvalidCursorError):
        candidates(service, qid, cursor=page.next_cursor)
    with pytest.raises(ConflictError, match="stale_revision"):
        service.put_mapping(
            qid,
            MappingPut(
                answer_id=first.id,
                expected_answer_revision=1,
                expected_question_revision=service.get_question(qid).revision,
            ),
        )
    assert service.get_question(qid).mapping is None


@pytest.mark.parametrize(
    ("control", "kind", "value", "preview"),
    [
        ("date", "date", "2026-10-01", "2026-10-01"),
        ("checkbox_boolean", "boolean", False, "No"),
        ("textarea", "long_text", "line one\nline two", "line one line two"),
    ],
)
def test_scalar_previews(conn: Conn, control: str, kind: str, value: Any, preview: str) -> None:
    service = FormFillService(conn)
    qid = question(service, control_kind=control)
    answer(service, "preview", value_kind=kind, value={"kind": kind, "value": value})
    assert candidates(service, qid).items[0].value_preview == preview


def test_private_endpoint_has_bounded_previews_and_no_store_errors(
    client: TestClient, conn: Conn
) -> None:
    service = FormFillService(conn)
    qid = question(service)
    answer(service, "private", value={"kind": "text", "value": "X" * 300 + "PRIVATE TAIL"})
    response = client.get(f"/api/form-fill/questions/{qid}/answer-candidates")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    item = response.json()["items"][0]
    assert set(item) == {"id", "label", "revision", "value_preview"}
    assert len(item["value_preview"]) == 160
    assert item["value_preview"].endswith("…")
    assert "PRIVATE TAIL" not in response.text
    assert "XXXX" not in client.get("/api/form-fill/answers").text
    for path in [
        f"{qid}/answer-candidates?cursor=bad",
        f"{qid}/answer-candidates?limit=0",
        "missing/answer-candidates",
    ]:
        error = client.get(f"/api/form-fill/questions/{path}")
        assert error.status_code in {400, 404, 422}
        assert error.headers["cache-control"] == "no-store"

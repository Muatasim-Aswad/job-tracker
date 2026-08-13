"""Verified Answer workflows and value-free history."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError as PydanticValidationError

from app.core.db import Conn
from app.core.errors import ConflictError, InvalidCursorError, ValidationError
from app.form_fill.schemas import AnswerCreate, AnswerUpdate
from app.form_fill.service import FormFillService


def _answer(key: str = "profile.name", value: str = "Private value") -> AnswerCreate:
    return AnswerCreate(
        answer_key=key,
        label=key.replace(".", " ").title(),
        value_kind="text",
        value={"kind": "text", "value": value},
        fill_policy="auto",
    )


def test_answer_create_list_detail_update_disable_enable_and_value_free_history(conn: Conn) -> None:
    service = FormFillService(conn)
    created = service.create_answer(_answer())
    assert created.revision == 1
    assert created.value.model_dump(mode="json") == {"kind": "text", "value": "Private value"}

    updated = service.update_answer(
        created.id,
        AnswerUpdate(
            expected_revision=created.revision,
            label="Preferred name",
            value={"kind": "text", "value": "New private value"},
            fill_policy="confirm_each_time",
            reason="Reviewed in dashboard",
        ),
    )
    assert updated.revision == 2
    assert updated.label == "Preferred name"
    assert updated.fill_policy == "confirm_each_time"
    assert updated.events[0].event == "answer_updated"
    assert "Private value" not in updated.model_dump_json(exclude={"value"})
    event_rows = conn.execute("SELECT event, reason FROM form_knowledge_events").fetchall()
    assert all("private" not in str(row).lower() for row in event_rows)

    disabled = service.update_answer(
        created.id, AnswerUpdate(expected_revision=2, status="disabled", reason="Pause fills")
    )
    enabled = service.update_answer(created.id, AnswerUpdate(expected_revision=3, status="active"))
    assert disabled.status == "disabled"
    assert enabled.status == "active"
    assert [event.event for event in enabled.events[:2]] == ["answer_enabled", "answer_disabled"]


def test_answer_stale_write_returns_current_summary_and_rolls_back_every_field(conn: Conn) -> None:
    service = FormFillService(conn)
    created = service.create_answer(_answer())
    current = service.update_answer(
        created.id, AnswerUpdate(expected_revision=1, label="Current label")
    )

    with pytest.raises(ConflictError) as stale:
        service.update_answer(
            created.id,
            AnswerUpdate(
                expected_revision=1,
                label="Stale label",
                value={"kind": "text", "value": "Must not persist"},
            ),
        )

    assert stale.value.message == "stale_revision"
    assert stale.value.current["revision"] == current.revision
    unchanged = service.get_answer(created.id)
    assert unchanged.label == "Current label"
    assert unchanged.value.model_dump(mode="json")["value"] == "Private value"


def test_answer_choice_vocabulary_is_complete_typed_and_revision_checked(conn: Conn) -> None:
    service = FormFillService(conn)
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
    assert [choice.choice_key for choice in answer.choices] == ["no", "yes"]

    with pytest.raises(PydanticValidationError):
        AnswerCreate.model_validate(
            {
                "answer_key": "bad.choice",
                "label": "Bad choice",
                "value_kind": "single_choice",
                "value": {"kind": "single_choice", "choice_key": "missing"},
                "choices": [],
            }
        )

    with pytest.raises(ValidationError, match="active answer choices"):
        service.update_answer(
            answer.id,
            AnswerUpdate(
                expected_revision=1,
                choices=[
                    {"choice_key": "yes", "display_label": "Yes", "status": "disabled"},
                    {"choice_key": "no", "display_label": "No"},
                ],
            ),
        )
    assert service.get_answer(answer.id).revision == 1


def test_answer_cursor_binds_to_filters_and_never_exposes_values_in_collection(conn: Conn) -> None:
    service = FormFillService(conn)
    for index in range(3):
        service.create_answer(_answer(f"profile.fact_{index}", f"PRIVATE-{index}"))

    first = service.list_answers(status=None, value_kind="text", query=None, limit=2, cursor=None)
    assert len(first.items) == 2
    assert first.next_cursor
    assert "PRIVATE" not in first.model_dump_json()
    second = service.list_answers(
        status=None, value_kind="text", query=None, limit=2, cursor=first.next_cursor
    )
    assert len({item.id for item in first.items + second.items}) == 3
    with pytest.raises(InvalidCursorError):
        service.list_answers(
            status="active", value_kind="text", query=None, limit=2, cursor=first.next_cursor
        )


def test_answer_value_routes_are_no_store(client: TestClient) -> None:
    response = client.post(
        "/api/form-fill/answers", json=_answer(value="API PRIVATE VALUE").model_dump(mode="json")
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    answer_id = response.json()["id"]
    assert client.get(f"/api/form-fill/answers/{answer_id}").headers["cache-control"] == "no-store"

    current = client.patch(
        f"/api/form-fill/answers/{answer_id}",
        json={"expected_revision": 1, "label": "Current API label"},
    )
    assert current.status_code == 200
    stale = client.patch(
        f"/api/form-fill/answers/{answer_id}",
        json={"expected_revision": 1, "label": "Stale API label"},
    )
    assert stale.status_code == 409
    assert stale.headers["cache-control"] == "no-store"
    assert stale.json()["detail"] == "stale_revision"
    assert stale.json()["current"]["revision"] == 2
    assert client.get(f"/api/form-fill/answers/{answer_id}").json()["label"] == "Current API label"

    sentinel = "PRIVATE-INVALID-BODY-VALUE"
    invalid = client.post(
        "/api/form-fill/answers",
        json={
            "answer_key": "privacy.invalid",
            "label": "Invalid answer",
            "value_kind": "text",
            "value": sentinel,
        },
    )
    assert invalid.status_code == 422
    assert invalid.headers["cache-control"] == "no-store"
    assert sentinel not in str(invalid.headers)

"""Form-fill actions."""

from __future__ import annotations

from typing import cast

from app.infra.database import Row
from app.modules.form_fill.models import Question
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    AnswerMultiChoiceValue,
    AnswerSingleChoiceValue,
    AnswerValue,
    CaptureMultiChoiceValue,
    CaptureSingleChoiceValue,
    CaptureValue,
    OptionIdentityPair,
    ResolutionAction,
    SetBooleanAction,
    SetDateAction,
    SetDecimalAction,
    SetMultiChoiceAction,
    SetSingleChoiceAction,
    SetTextAction,
)
from app.modules.form_fill.values import (
    _CHOICE_CONTROLS,
    _MULTI_CHOICE_CONTROLS,
    _SINGLE_CHOICE_CONTROLS,
)


def _answer_action(
    repo: FormFillRepository,
    question: Question,
    value: AnswerValue,
    mapping: Row,
    pairs: list[OptionIdentityPair],
) -> ResolutionAction | None:
    scalar = _scalar_action(question.control_kind, value)
    if scalar is not None:
        return scalar

    if question.control_kind not in _CHOICE_CONTROLS:
        return None

    choices = {row["choice_key"]: row for row in repo.list_answer_choices(mapping["answer_id"])}
    binding_by_choice = {
        row["answer_choice_id"]: row["question_option_id"]
        for row in repo.list_bindings(mapping["id"])
    }
    local_by_question = {pair.question_option_id: pair.client_option_id for pair in pairs}
    if (
        isinstance(value, AnswerSingleChoiceValue)
        and question.control_kind in _SINGLE_CHOICE_CONTROLS
    ):
        choice = choices.get(value.choice_key)
        question_option_id = binding_by_choice.get(choice["id"]) if choice else None
        local = local_by_question.get(question_option_id) if question_option_id else None

        return (
            SetSingleChoiceAction(kind="set_single_choice", client_option_id=local)
            if local
            else None
        )

    if (
        isinstance(value, AnswerMultiChoiceValue)
        and question.control_kind in _MULTI_CHOICE_CONTROLS
    ):
        locals_: list[str] = []
        for choice_key in value.choice_keys:
            choice = choices.get(choice_key)
            question_option_id = binding_by_choice.get(choice["id"]) if choice else None
            local = local_by_question.get(question_option_id) if question_option_id else None
            if local is None:
                return None

            locals_.append(local)

        return SetMultiChoiceAction(kind="set_multi_choice", client_option_ids=locals_)

    return None


def _scalar_action(control_kind: str, value: AnswerValue | CaptureValue) -> ResolutionAction | None:
    if control_kind in {"text", "textarea"} and value.kind in {"text", "long_text"}:
        return SetTextAction(kind="set_text", value=value.value)

    if control_kind in {"integer", "decimal"} and value.kind == "decimal":
        if control_kind == "integer" and "." in value.value:
            return None

        return SetDecimalAction(kind="set_decimal", value=value.value)

    if control_kind == "checkbox_boolean" and value.kind == "boolean":
        return SetBooleanAction(kind="set_boolean", value=value.value)

    if control_kind == "date" and value.kind == "date":
        return SetDateAction(kind="set_date", value=value.value)

    return None


def _capture_action(
    question: Question, value: CaptureValue, pairs: list[OptionIdentityPair]
) -> ResolutionAction | None:
    scalar = _scalar_action(question.control_kind, value)
    if scalar is not None:
        return scalar

    local_by_question = {pair.question_option_id: pair.client_option_id for pair in pairs}
    if (
        isinstance(value, CaptureSingleChoiceValue)
        and question.control_kind in _SINGLE_CHOICE_CONTROLS
    ):
        local = local_by_question.get(value.question_option_id)

        return (
            SetSingleChoiceAction(kind="set_single_choice", client_option_id=local)
            if local
            else None
        )

    if (
        isinstance(value, CaptureMultiChoiceValue)
        and question.control_kind in _MULTI_CHOICE_CONTROLS
    ):
        locals_ = [local_by_question.get(option_id) for option_id in value.question_option_ids]
        if any(local is None for local in locals_):
            return None

        return SetMultiChoiceAction(
            kind="set_multi_choice", client_option_ids=cast(list[str], locals_)
        )

    return None

"""Revision-checked Capture promotion; all actions share the caller's transaction."""

from __future__ import annotations

from dataclasses import dataclass

from app.infra.database import Row
from app.modules.form_fill.answers import _sync_choices
from app.modules.form_fill.errors import KnowledgeConflict
from app.modules.form_fill.models import Question
from app.modules.form_fill.projections import (
    _answer_summary,
    _capture_summary,
    _mapping_summary,
    _require_answer,
    _require_capture,
    _require_question,
    _summary,
)
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    AnswerCreate,
    CaptureApply,
    CaptureApplyResponse,
    CreateAnswerAndMapApply,
    OptionBindingInput,
    ReplaceOptionBindingsApply,
    RetargetMappingApply,
    UpdateAnswerApply,
)
from app.modules.form_fill.storage import _atomic, _json, _new_id
from app.modules.form_fill.validation import (
    _check_apply_revisions,
    _validate_answer_key,
    _validate_answer_value,
    _validate_bindings,
)
from app.shared.errors import ValidationError
from app.shared.timeutil import utc_now


@dataclass(frozen=True)
class AppliedKnowledge:
    answer: Row
    mapping: Row | None


def apply_capture(
    repo: FormFillRepository, capture_id: str, apply: CaptureApply
) -> CaptureApplyResponse:
    capture = _require_capture(repo, capture_id)
    question = _require_question(repo, capture["question_id"])
    mapping = repo.get_mapping(question.id)
    requested_answer_id = getattr(apply, "answer_id", None)
    answer = repo.get_answer(requested_answer_id) if requested_answer_id else None
    _check_apply_revisions(repo, capture, question, mapping, answer, apply)
    now = utc_now()

    with _atomic(repo.conn):
        if apply.action == "create_answer_and_map":
            applied = _create_answer_and_map(repo, question, mapping, apply, now)
        elif apply.action == "update_answer":
            applied = _update_answer(repo, answer, mapping, apply, now)
        elif apply.action == "retarget_mapping":
            applied = _retarget_mapping(repo, question, answer, mapping, apply, now)
        else:
            applied = _replace_option_bindings(repo, question, answer, mapping, apply, now)

        answer, mapping = (applied.answer, applied.mapping)
        assert answer is not None and mapping is not None
        repo.transition_capture(
            capture_id,
            expected_revision=capture["revision"],
            status="applied",
            now=now,
            clear_value=True,
        )
        repo.insert_event(
            event_id=_new_id(),
            event="capture_applied",
            answer_id=answer["id"],
            mapping_id=mapping["id"],
            question_id=question.id,
            capture_id=capture_id,
            before_revision=capture["revision"],
            after_revision=capture["revision"] + 1,
            reason=apply.reason,
            now=now,
        )

    capture = _require_capture(repo, capture_id)
    answer = _require_answer(repo, answer["id"])
    mapping = repo.get_mapping(question.id)
    assert mapping is not None

    return CaptureApplyResponse(
        capture=_capture_summary(repo, capture),
        question=_summary(repo, _require_question(repo, question.id)),
        answer=_answer_summary(answer),
        mapping=_mapping_summary(repo, mapping),
    )


def _create_answer_and_map(
    repo: FormFillRepository,
    question: Question,
    mapping: Row | None,
    apply: CreateAnswerAndMapApply,
    now: str,
) -> AppliedKnowledge:
    create = AnswerCreate(
        answer_key=apply.answer_key,
        label=apply.label,
        description=apply.description,
        value_kind=apply.value_kind,
        value=apply.value,
        choices=apply.choices,
        fill_policy=apply.fill_policy,
    )
    _validate_answer_key(create.answer_key)
    _validate_answer_value(create.value_kind, create.value, create.choices)
    if (existing := repo.get_answer_by_key(create.answer_key)) is not None:
        raise KnowledgeConflict("answer_key_exists", _answer_summary(existing).model_dump())

    answer_id = _new_id()
    repo.insert_answer(
        answer_id=answer_id,
        answer_key=create.answer_key,
        label=create.label,
        description=create.description,
        value_kind=create.value_kind,
        value_json=_json(create.value),
        fill_policy=create.fill_policy,
        now=now,
    )
    repo.replace_answer_choices(
        answer_id,
        [(_new_id(), item.choice_key, item.display_label, item.status) for item in create.choices],
        now,
    )
    answer = _require_answer(repo, answer_id)
    mapping_id = _new_id()
    if mapping is None:
        repo.insert_mapping(mapping_id, question.id, answer_id, now)
    else:
        mapping_id = mapping["id"]
        repo.update_mapping(
            mapping_id,
            answer_id=answer_id,
            status="active",
            expected_revision=mapping["revision"],
            now=now,
        )

    choices_by_key = {item["choice_key"]: item for item in repo.list_answer_choices(answer_id)}
    binding_inputs = [
        OptionBindingInput(
            question_option_id=item.question_option_id,
            answer_choice_id=choices_by_key[item.answer_choice_key]["id"],
        )
        for item in apply.bindings
        if item.answer_choice_key in choices_by_key
    ]
    if len(binding_inputs) != len(apply.bindings):
        raise ValidationError("option bindings must reference new answer choices")

    bindings = _validate_bindings(repo, question, answer, binding_inputs)
    repo.replace_bindings(mapping_id, bindings, now)
    mapping = repo.get_mapping(question.id)
    assert mapping is not None
    repo.insert_event(
        event_id=_new_id(), event="answer_created", answer_id=answer_id, after_revision=1, now=now
    )
    repo.insert_event(
        event_id=_new_id(),
        event="mapping_approved",
        answer_id=answer_id,
        mapping_id=mapping_id,
        question_id=question.id,
        after_answer_id=answer_id,
        after_revision=mapping["revision"],
        reason=apply.reason,
        now=now,
    )

    return AppliedKnowledge(answer=answer, mapping=mapping)


def _update_answer(
    repo: FormFillRepository,
    answer: Row | None,
    mapping: Row | None,
    apply: UpdateAnswerApply,
    now: str,
) -> AppliedKnowledge:
    assert answer is not None
    choices = apply.choices
    choice_models = choices if choices is not None else repo.list_answer_choices(answer["id"])
    _validate_answer_value(answer["value_kind"], apply.value, choice_models)
    if choices is not None:
        _sync_choices(repo, answer["id"], choices, now)

    repo.update_answer(
        answer["id"],
        expected_revision=answer["revision"],
        answer_key=answer["answer_key"],
        label=apply.label or answer["label"],
        description=apply.description
        if "description" in apply.model_fields_set
        else answer["description"],
        value_json=_json(apply.value),
        status=answer["status"],
        fill_policy=apply.fill_policy or answer["fill_policy"],
        now=now,
    )
    answer = _require_answer(repo, answer["id"])
    repo.insert_event(
        event_id=_new_id(),
        event="answer_updated",
        answer_id=answer["id"],
        before_revision=apply.expected_answer_revision,
        after_revision=answer["revision"],
        reason=apply.reason,
        now=now,
    )

    return AppliedKnowledge(answer=answer, mapping=mapping)


def _retarget_mapping(
    repo: FormFillRepository,
    question: Question,
    answer: Row | None,
    mapping: Row | None,
    apply: RetargetMappingApply,
    now: str,
) -> AppliedKnowledge:
    assert answer is not None and mapping is not None
    previous_answer_id = mapping["answer_id"]
    previous_revision = mapping["revision"]
    bindings = _validate_bindings(repo, question, answer, apply.bindings)
    repo.update_mapping(
        mapping["id"],
        answer_id=answer["id"],
        status="active",
        expected_revision=mapping["revision"],
        now=now,
    )
    repo.replace_bindings(mapping["id"], bindings, now)
    mapping = repo.get_mapping(question.id)
    assert mapping is not None
    repo.insert_event(
        event_id=_new_id(),
        event="mapping_corrected",
        answer_id=answer["id"],
        mapping_id=mapping["id"],
        question_id=question.id,
        before_answer_id=previous_answer_id,
        after_answer_id=answer["id"],
        before_revision=previous_revision,
        after_revision=mapping["revision"],
        reason=apply.reason,
        now=now,
    )

    return AppliedKnowledge(answer=answer, mapping=mapping)


def _replace_option_bindings(
    repo: FormFillRepository,
    question: Question,
    answer: Row | None,
    mapping: Row | None,
    apply: ReplaceOptionBindingsApply,
    now: str,
) -> AppliedKnowledge:
    assert answer is not None and mapping is not None
    if mapping["id"] != apply.mapping_id or mapping["answer_id"] != answer["id"]:
        raise ValidationError("mapping does not target the supplied answer")

    previous_revision = mapping["revision"]
    bindings = _validate_bindings(repo, question, answer, apply.bindings)
    repo.update_mapping(
        mapping["id"],
        answer_id=answer["id"],
        status="active",
        expected_revision=mapping["revision"],
        now=now,
    )
    repo.replace_bindings(mapping["id"], bindings, now)
    mapping = repo.get_mapping(question.id)
    assert mapping is not None
    repo.insert_event(
        event_id=_new_id(),
        event="option_bindings_replaced",
        answer_id=answer["id"],
        mapping_id=mapping["id"],
        question_id=question.id,
        before_revision=previous_revision,
        after_revision=mapping["revision"],
        reason=apply.reason,
        now=now,
    )

    return AppliedKnowledge(answer=answer, mapping=mapping)

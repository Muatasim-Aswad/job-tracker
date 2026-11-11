"""Form-fill mappings."""

from __future__ import annotations

from app.infra.database import Row
from app.modules.form_fill.actions import _answer_action, _capture_action
from app.modules.form_fill.errors import KnowledgeConflict
from app.modules.form_fill.models import Question
from app.modules.form_fill.projections import (
    _answer_summary,
    _conflict_current,
    _require_answer,
    _require_question,
    _summary,
)
from app.modules.form_fill.queries import get_question
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    MappingPut,
    MappingUpdate,
    OptionBindingInput,
    OptionIdentityPair,
    QuestionAnswerCreate,
    QuestionDetail,
    QuestionReviewUpdate,
)
from app.modules.form_fill.storage import _atomic, _json, _new_id
from app.modules.form_fill.validation import (
    _check_mapping_revisions,
    _validate_answer_key,
    _validate_answer_value,
    _validate_bindings,
)
from app.modules.form_fill.values import _ANSWER_VALUE, _CAPTURE_VALUE
from app.shared.errors import NotFoundError, ValidationError
from app.shared.timeutil import utc_now


def update_question(
    repo: FormFillRepository, question_id: str, update: QuestionReviewUpdate
) -> QuestionDetail:
    question = _require_question(repo, question_id)
    if question.revision != update.expected_revision:
        raise KnowledgeConflict("stale_revision", _summary(repo, question).model_dump())

    if question.review_state == update.review_state:
        return get_question(repo, question_id)

    mapping = repo.get_mapping(question_id)
    if update.review_state == "ignored" and mapping and (mapping["status"] == "active"):
        raise ValidationError("disable or retire the active mapping before ignoring its question")

    with _atomic(repo.conn):
        repo.set_review_state(
            question_id,
            update.review_state,
            update.expected_revision,
            update.reason,
            _new_id(),
            utc_now(),
        )
        if update.review_state == "ignored":
            now = utc_now()
            for capture in repo.list_current_capture_records(question_id):
                repo.transition_capture(
                    capture["id"],
                    expected_revision=capture["revision"],
                    status="ignored",
                    now=now,
                    clear_value=True,
                )

    return get_question(repo, question_id)


def put_mapping(repo: FormFillRepository, question_id: str, put: MappingPut) -> QuestionDetail:
    question = _require_question(repo, question_id)
    answer = _require_answer(repo, put.answer_id)
    mapping = repo.get_mapping(question_id)
    _check_mapping_revisions(repo, question, answer, mapping, put)
    bindings = _validate_bindings(repo, question, answer, put.bindings)
    if question.review_state == "ignored":
        raise ValidationError("ignored questions must be reopened before mapping")

    now = utc_now()

    with _atomic(repo.conn):
        if mapping is None:
            mapping_id = _new_id()
            repo.insert_mapping(mapping_id, question_id, answer["id"], now)
            event, before_revision, after_revision = ("mapping_approved", None, 1)
        else:
            mapping_id = mapping["id"]
            before_revision, after_revision = (mapping["revision"], mapping["revision"] + 1)
            event = (
                "mapping_reactivated"
                if mapping["status"] == "retired" and mapping["answer_id"] == answer["id"]
                else "mapping_corrected"
            )
            repo.update_mapping(
                mapping_id,
                answer_id=answer["id"],
                status="active",
                expected_revision=mapping["revision"],
                now=now,
            )

        repo.replace_bindings(mapping_id, bindings, now)
        repo.insert_event(
            event_id=_new_id(),
            event=event,
            answer_id=answer["id"],
            mapping_id=mapping_id,
            question_id=question_id,
            before_answer_id=mapping["answer_id"] if mapping else None,
            after_answer_id=answer["id"],
            before_revision=before_revision,
            after_revision=after_revision,
            reason=put.reason,
            now=now,
        )
        current_mapping = repo.get_mapping(question_id)
        assert current_mapping is not None
        _consume_matching_current_capture(
            repo, question, answer, current_mapping, now=now, reason=put.reason
        )

    return get_question(repo, question_id)


def create_answer_for_question(
    repo: FormFillRepository, question_id: str, create: QuestionAnswerCreate
) -> QuestionDetail:
    question = _require_question(repo, question_id)
    mapping = repo.get_mapping(question_id)
    stale = question.revision != create.expected_question_revision
    stale = stale or (mapping is None and create.expected_mapping_revision is not None)
    stale = stale or (
        mapping is not None and mapping["revision"] != create.expected_mapping_revision
    )
    if stale:
        raise KnowledgeConflict(
            "stale_revision", _conflict_current(repo, question=question, mapping=mapping)
        )

    if question.review_state == "ignored":
        raise ValidationError("ignored questions must be reopened before mapping")

    value_kind = create.value.kind
    _validate_answer_key(create.answer_key)
    _validate_answer_value(value_kind, create.value, create.choices)
    if (existing := repo.get_answer_by_key(create.answer_key)) is not None:
        raise KnowledgeConflict("answer_key_exists", _answer_summary(existing).model_dump())

    now, answer_id = (utc_now(), _new_id())

    with _atomic(repo.conn):
        repo.insert_answer(
            answer_id=answer_id,
            answer_key=create.answer_key,
            label=create.label,
            description=create.description,
            value_kind=value_kind,
            value_json=_json(create.value),
            fill_policy=create.fill_policy,
            now=now,
        )
        repo.replace_answer_choices(
            answer_id,
            [
                (_new_id(), item.choice_key, item.display_label, item.status)
                for item in create.choices
            ],
            now,
        )
        answer = _require_answer(repo, answer_id)
        choices_by_key = {item["choice_key"]: item for item in repo.list_answer_choices(answer_id)}
        binding_inputs = [
            OptionBindingInput(
                question_option_id=item.question_option_id,
                answer_choice_id=choices_by_key[item.answer_choice_key]["id"],
            )
            for item in create.bindings
            if item.answer_choice_key in choices_by_key
        ]
        if len(binding_inputs) != len(create.bindings):
            raise ValidationError("option bindings must reference new answer choices")

        bindings = _validate_bindings(repo, question, answer, binding_inputs)
        if mapping is None:
            mapping_id = _new_id()
            repo.insert_mapping(mapping_id, question_id, answer_id, now)
            event, before_revision, after_revision = ("mapping_approved", None, 1)
        else:
            mapping_id = mapping["id"]
            before_revision, after_revision = (mapping["revision"], mapping["revision"] + 1)
            event = "mapping_reactivated" if mapping["status"] == "retired" else "mapping_corrected"
            repo.update_mapping(
                mapping_id,
                answer_id=answer_id,
                status="active",
                expected_revision=mapping["revision"],
                now=now,
            )

        repo.replace_bindings(mapping_id, bindings, now)
        repo.insert_event(
            event_id=_new_id(),
            event="answer_created",
            answer_id=answer_id,
            after_revision=1,
            now=now,
        )
        repo.insert_event(
            event_id=_new_id(),
            event=event,
            answer_id=answer_id,
            mapping_id=mapping_id,
            question_id=question_id,
            before_answer_id=mapping["answer_id"] if mapping else None,
            after_answer_id=answer_id,
            before_revision=before_revision,
            after_revision=after_revision,
            reason=create.reason,
            now=now,
        )
        current_mapping = repo.get_mapping(question_id)
        assert current_mapping is not None
        _consume_matching_current_capture(
            repo, question, answer, current_mapping, now=now, reason=create.reason
        )

    return get_question(repo, question_id)


def update_mapping(
    repo: FormFillRepository, question_id: str, update: MappingUpdate
) -> QuestionDetail:
    question = _require_question(repo, question_id)
    mapping = repo.get_mapping(question_id)
    if mapping is None:
        raise NotFoundError(f"mapping for question {question_id} not found")

    if (
        question.revision != update.expected_question_revision
        or mapping["revision"] != update.expected_revision
    ):
        raise KnowledgeConflict(
            "stale_revision", _conflict_current(repo, question=question, mapping=mapping)
        )

    if mapping["status"] == update.status:
        return get_question(repo, question_id)

    now = utc_now()

    with _atomic(repo.conn):
        repo.update_mapping(
            mapping["id"],
            answer_id=mapping["answer_id"],
            status=update.status,
            expected_revision=mapping["revision"],
            now=now,
        )
        event = {
            "active": "mapping_enabled",
            "disabled": "mapping_disabled",
            "retired": "mapping_retired",
        }[update.status]
        repo.insert_event(
            event_id=_new_id(),
            event=event,
            answer_id=mapping["answer_id"],
            mapping_id=mapping["id"],
            question_id=question_id,
            before_revision=mapping["revision"],
            after_revision=mapping["revision"] + 1,
            reason=update.reason,
            now=now,
        )

    return get_question(repo, question_id)


def _consume_matching_current_capture(
    repo: FormFillRepository,
    question: Question,
    answer: Row,
    mapping: Row,
    *,
    now: str,
    reason: str | None,
) -> None:
    if question.capture_conflict:
        return

    current = repo.list_current_capture_records(question.id)
    if len(current) != 1 or current[0]["value_json"] is None:
        return

    capture = current[0]
    answer_value = _ANSWER_VALUE.validate_json(answer["value_json"])
    capture_value = _CAPTURE_VALUE.validate_json(capture["value_json"])
    option_pairs = [
        OptionIdentityPair(client_option_id=option.id, question_option_id=option.id)
        for option in repo.list_options(question.id)
        if option.status == "active"
    ]
    answer_action = _answer_action(repo, question, answer_value, mapping, option_pairs)
    capture_action = _capture_action(question, capture_value, option_pairs)
    if answer_action is None or capture_action is None or answer_action != capture_action:
        return

    repo.transition_capture(
        capture["id"],
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
        capture_id=capture["id"],
        before_revision=capture["revision"],
        after_revision=capture["revision"] + 1,
        reason=reason,
        now=now,
    )

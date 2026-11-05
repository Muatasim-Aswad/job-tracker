"""Form-fill answers."""

from __future__ import annotations

from collections.abc import Sequence

from app.infra.database import Row
from app.modules.form_fill.errors import KnowledgeConflict
from app.modules.form_fill.projections import _answer_summary, _require_answer
from app.modules.form_fill.queries import get_answer
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    AnswerChoiceInput,
    AnswerCreate,
    AnswerDetail,
    AnswerUpdate,
)
from app.modules.form_fill.storage import _atomic, _json, _new_id
from app.modules.form_fill.validation import (
    _choice_shape,
    _validate_answer_key,
    _validate_answer_value,
)
from app.modules.form_fill.values import _ANSWER_VALUE
from app.shared.errors import ValidationError
from app.shared.timeutil import utc_now


def create_answer(repo: FormFillRepository, create: AnswerCreate) -> AnswerDetail:
    _validate_answer_key(create.answer_key)
    _validate_answer_value(create.value_kind, create.value, create.choices)
    if (existing := repo.get_answer_by_key(create.answer_key)) is not None:
        raise KnowledgeConflict("answer_key_exists", _answer_summary(existing).model_dump())

    now, answer_id = (utc_now(), _new_id())

    with _atomic(repo.conn):
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
            [
                (_new_id(), item.choice_key, item.display_label, item.status)
                for item in create.choices
            ],
            now,
        )
        repo.insert_event(
            event_id=_new_id(),
            event="answer_created",
            answer_id=answer_id,
            after_revision=1,
            now=now,
        )

    return get_answer(repo, answer_id)


def update_answer(repo: FormFillRepository, answer_id: str, update: AnswerUpdate) -> AnswerDetail:
    row = _require_answer(repo, answer_id)
    if row["revision"] != update.expected_revision:
        raise KnowledgeConflict("stale_revision", _answer_summary(row).model_dump())

    answer_key = update.answer_key or row["answer_key"]
    if update.answer_key is not None:
        _validate_answer_key(update.answer_key)
        existing = repo.get_answer_by_key(update.answer_key)
        if existing is not None and existing["id"] != answer_id:
            raise KnowledgeConflict("answer_key_exists", _answer_summary(existing).model_dump())

    current_value = _ANSWER_VALUE.validate_json(row["value_json"])
    value = update.value or current_value
    choices = update.choices
    current_choices = repo.list_answer_choices(answer_id)
    choice_models = choices if choices is not None else current_choices
    _validate_answer_value(row["value_kind"], value, choice_models)
    changed = any(
        (
            update.answer_key is not None and update.answer_key != row["answer_key"],
            update.label is not None and update.label != row["label"],
            "description" in update.model_fields_set and update.description != row["description"],
            update.value is not None and _json(value) != row["value_json"],
            update.fill_policy is not None and update.fill_policy != row["fill_policy"],
            update.status is not None and update.status != row["status"],
            choices is not None and _choice_shape(choices) != _choice_shape(current_choices),
        )
    )
    if not changed:
        return get_answer(repo, answer_id)

    now = utc_now()

    with _atomic(repo.conn):
        if choices is not None:
            _sync_choices(repo, answer_id, choices, now)

        repo.update_answer(
            answer_id,
            expected_revision=update.expected_revision,
            answer_key=answer_key,
            label=update.label if update.label is not None else row["label"],
            description=update.description
            if "description" in update.model_fields_set
            else row["description"],
            value_json=_json(value),
            status=update.status or row["status"],
            fill_policy=update.fill_policy or row["fill_policy"],
            now=now,
        )
        event = "answer_updated"
        if update.status == "disabled":
            event = "answer_disabled"
        elif update.status == "active" and row["status"] == "disabled":
            event = "answer_enabled"

        repo.insert_event(
            event_id=_new_id(),
            event=event,
            answer_id=answer_id,
            before_revision=update.expected_revision,
            after_revision=update.expected_revision + 1,
            reason=update.reason,
            now=now,
        )

    return get_answer(repo, answer_id)


def delete_answer(repo: FormFillRepository, answer_id: str, expected_revision: int) -> None:
    row = _require_answer(repo, answer_id)
    if row["revision"] != expected_revision:
        raise KnowledgeConflict("stale_revision", _answer_summary(row).model_dump())

    if repo.answer_has_mappings(answer_id):
        raise ValidationError("only unmapped answers can be deleted")

    with _atomic(repo.conn):
        repo.delete_answer(answer_id)


def _sync_choices(
    repo: FormFillRepository, answer_id: str, choices: Sequence[AnswerChoiceInput | Row], now: str
) -> None:
    existing = {row["choice_key"]: row for row in repo.list_answer_choices(answer_id)}
    requested = {
        item["choice_key"] if isinstance(item, dict) else item.choice_key: item for item in choices
    }
    for key, row in existing.items():
        if key not in requested:
            if repo.choice_is_bound(row["id"]):
                raise ValidationError("choice vocabulary would invalidate an active mapping")

            repo.delete_answer_choice(row["id"])
            continue

        item = requested[key]
        label = item["display_label"] if isinstance(item, dict) else item.display_label
        status = item["status"] if isinstance(item, dict) else item.status
        if status == "disabled" and repo.choice_is_bound(row["id"]):
            raise ValidationError("bound answer choices cannot be disabled")

        repo.update_answer_choice(row["id"], label, status, now)

    for key, item in requested.items():
        if key in existing:
            continue

        label = item["display_label"] if isinstance(item, dict) else item.display_label
        status = item["status"] if isinstance(item, dict) else item.status
        repo.insert_answer_choice(_new_id(), answer_id, key, label, status, now)

"""Form-fill validation."""

from __future__ import annotations

from collections.abc import Sequence

from app.infra.database import Row
from app.modules.form_fill.actions import _scalar_action
from app.modules.form_fill.errors import KnowledgeConflict
from app.modules.form_fill.identity import QuestionIdentity
from app.modules.form_fill.models import Question
from app.modules.form_fill.projections import (
    _conflict_current,
    _mapping_summary,
    _require_answer,
    _summary,
)
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    AnswerChoiceInput,
    AnswerMultiChoiceValue,
    AnswerSingleChoiceValue,
    AnswerValue,
    CaptureApply,
    CaptureCreate,
    CaptureMultiChoiceValue,
    CaptureSingleChoiceValue,
    CaptureValue,
    MappingPut,
    OptionBindingInput,
)
from app.modules.form_fill.values import (
    _ANSWER_KEY,
    _ANSWER_VALUE,
    _CHOICE_CONTROLS,
    _MULTI_CHOICE_CONTROLS,
    _SINGLE_CHOICE_CONTROLS,
)
from app.modules.listings.models import Listing
from app.shared.errors import NotFoundError, ValidationError


def _assert_identity(question: Question, identity: QuestionIdentity) -> None:
    stored_base = (
        question.identity_kind,
        question.site_scope,
        question.normalizer_version,
        question.control_kind,
        question.option_set_hash,
    )
    observed_base = (
        identity.identity_kind,
        identity.site_scope,
        identity.normalizer_version,
        identity.control_kind,
        identity.option_set_hash,
    )
    if stored_base != observed_base:
        raise ValidationError("question identity signature collision")

    stored_evidence: tuple[str, ...]
    observed_evidence: tuple[str, ...]
    if identity.identity_kind == "adapter_key":
        stored_evidence = (question.adapter_id, question.adapter_version, question.stable_field_key)
        observed_evidence = (
            identity.adapter_id,
            identity.adapter_version,
            identity.stable_field_key,
        )
    else:
        stored_evidence = (
            question.normalized_question,
            question.normalized_section,
            question.normalized_help,
            question.autocomplete_token,
        )
        observed_evidence = (
            identity.normalized_question,
            identity.normalized_section,
            identity.normalized_help,
            identity.autocomplete_token,
        )

    if stored_evidence != observed_evidence:
        raise ValidationError("question identity signature collision")


def _validate_answer_key(answer_key: str) -> None:
    if not _ANSWER_KEY.fullmatch(answer_key):
        raise ValidationError("answer_key must be a stable lowercase token")


def _choice_fields(choice: AnswerChoiceInput | Row) -> tuple[str, str, str]:
    if isinstance(choice, dict):
        return choice["choice_key"], choice["display_label"], choice["status"]

    return choice.choice_key, choice.display_label, choice.status


def _choice_shape(choices: Sequence[AnswerChoiceInput | Row]) -> list[tuple[str, str, str]]:
    return sorted(_choice_fields(choice) for choice in choices)


def _validate_answer_value(
    value_kind: str, value: AnswerValue, choices: Sequence[AnswerChoiceInput | Row]
) -> None:
    if value.kind != value_kind:
        raise ValidationError("value kind must match answer value_kind")

    choice_by_key = {
        choice["choice_key"] if isinstance(choice, dict) else choice.choice_key: choice
        for choice in choices
    }
    active = {
        key
        for key, choice in choice_by_key.items()
        if (choice["status"] if isinstance(choice, dict) else choice.status) == "active"
    }
    selected: set[str] = set()
    if isinstance(value, AnswerSingleChoiceValue):
        selected = {value.choice_key}
    elif isinstance(value, AnswerMultiChoiceValue):
        selected = set(value.choice_keys)
    elif choices:
        raise ValidationError("non-choice answers cannot define choices")

    if value_kind in {"single_choice", "multi_choice"} and (not choices):
        raise ValidationError("choice answers require a complete choice vocabulary")

    if not selected <= active:
        raise ValidationError("answer value must reference active answer choices")


def _validate_bindings(
    repo: FormFillRepository, question: Question, answer: Row, bindings: list[OptionBindingInput]
) -> list[tuple[str, str]]:
    compatible = (
        question.control_kind in _SINGLE_CHOICE_CONTROLS
        and answer["value_kind"] == "single_choice"
        or (
            question.control_kind in _MULTI_CHOICE_CONTROLS
            and answer["value_kind"] == "multi_choice"
        )
    )
    if question.control_kind not in _CHOICE_CONTROLS:
        if (
            bindings
            or _scalar_action(
                question.control_kind, _ANSWER_VALUE.validate_json(answer["value_json"])
            )
            is None
        ):
            raise ValidationError("answer and question types are incompatible")

        return []

    if not compatible:
        raise ValidationError("answer and question types are incompatible")

    question_options = {
        option.id: option for option in repo.list_options(question.id) if option.status == "active"
    }
    choices = {
        row["id"]: row
        for row in repo.list_answer_choices(answer["id"])
        if row["status"] == "active"
    }
    question_ids = [item.question_option_id for item in bindings]
    answer_ids = [item.answer_choice_id for item in bindings]
    if len(question_ids) != len(set(question_ids)) or len(answer_ids) != len(set(answer_ids)):
        raise ValidationError("option bindings must be one-to-one")

    if set(question_ids) != set(question_options):
        raise ValidationError("choice mappings require the complete active option set")

    if not set(answer_ids) <= set(choices):
        raise ValidationError("option bindings must reference active choices on the answer")

    return [(item.question_option_id, item.answer_choice_id) for item in bindings]


def _check_mapping_revisions(
    repo: FormFillRepository, question: Question, answer: Row, mapping: Row | None, put: MappingPut
) -> None:
    stale = question.revision != put.expected_question_revision
    stale = stale or answer["revision"] != put.expected_answer_revision
    stale = stale or (mapping is None and put.expected_mapping_revision is not None)
    stale = stale or (mapping is not None and mapping["revision"] != put.expected_mapping_revision)
    if stale:
        raise KnowledgeConflict(
            "stale_revision",
            _conflict_current(repo, question=question, answer=answer, mapping=mapping),
        )


def _validate_capture_context(
    repo: FormFillRepository, create: CaptureCreate, mapping: Row | None
) -> None:
    if create.mapping_id is None:
        if mapping is not None and mapping["status"] in {"active", "disabled"}:
            raise KnowledgeConflict(
                "stale_resolution_context", _mapping_summary(repo, mapping).model_dump()
            )

        return

    if mapping is None or mapping["id"] != create.mapping_id:
        raise KnowledgeConflict(
            "stale_resolution_context",
            _mapping_summary(repo, mapping).model_dump() if mapping else None,
        )

    answer = _require_answer(repo, mapping["answer_id"])
    if (
        mapping["revision"] != create.mapping_revision_used
        or answer["revision"] != create.answer_revision_used
    ):
        raise KnowledgeConflict(
            "stale_resolution_context", _conflict_current(repo, answer=answer, mapping=mapping)
        )


def _same_capture_request(
    row: Row, create: CaptureCreate, listing: Listing | None, value_json: str | None
) -> bool:
    return all(
        (
            row["question_id"] == create.question_id,
            row["application_context_id"] == create.application_context_id,
            row["source"] == create.source,
            row["cleared"] == int(create.cleared),
            row["mapping_id"] == create.mapping_id,
            row["answer_revision_used"] == create.answer_revision_used,
            row["mapping_revision_used"] == create.mapping_revision_used,
            row["job_id"] == (listing.job_id if listing else None),
            row["listing_id"] == (listing.id if listing else None),
            row["value_json"] == value_json
            if not create.cleared
            else row["status"] == "superseded",
        )
    )


def _validate_capture_value(
    repo: FormFillRepository, question: Question, value: CaptureValue
) -> None:
    if _scalar_action(question.control_kind, value) is not None:
        return

    option_ids = {
        option.id for option in repo.list_options(question.id) if option.status == "active"
    }
    if (
        isinstance(value, CaptureSingleChoiceValue)
        and question.control_kind in _SINGLE_CHOICE_CONTROLS
    ):
        supplied = {value.question_option_id}
    elif (
        isinstance(value, CaptureMultiChoiceValue)
        and question.control_kind in _MULTI_CHOICE_CONTROLS
    ):
        supplied = set(value.question_option_ids)
    else:
        raise ValidationError("capture value is incompatible with the question")

    if not supplied <= option_ids:
        raise ValidationError("capture value references an option from another question")


def _check_apply_revisions(
    repo: FormFillRepository,
    capture: Row,
    question: Question,
    mapping: Row | None,
    answer: Row | None,
    apply: CaptureApply,
) -> None:
    stale = capture["revision"] != apply.expected_capture_revision
    stale = stale or question.revision != apply.expected_question_revision
    expected_mapping = getattr(apply, "expected_mapping_revision", None)
    expected_answer = getattr(apply, "expected_answer_revision", None)
    stale = stale or (
        expected_mapping is not None
        and (mapping is None or mapping["revision"] != expected_mapping)
    )
    stale = stale or (
        expected_answer is not None and (answer is None or answer["revision"] != expected_answer)
    )
    if stale:
        raise KnowledgeConflict(
            "stale_revision",
            _conflict_current(
                repo, capture=capture, question=question, answer=answer, mapping=mapping
            ),
        )

    if question.capture_conflict:
        raise KnowledgeConflict("capture_conflict", _summary(repo, question).model_dump())

    if capture["status"] != "current" or capture["value_json"] is None:
        raise KnowledgeConflict(
            "capture_not_current",
            _conflict_current(
                repo, capture=capture, question=question, answer=answer, mapping=mapping
            ),
        )

    if apply.action == "create_answer_and_map" and mapping is not None:
        if mapping["status"] != "retired":
            raise KnowledgeConflict(
                "mapping_slot_occupied", _mapping_summary(repo, mapping).model_dump()
            )

        if apply.expected_mapping_revision != mapping["revision"]:
            raise KnowledgeConflict(
                "stale_revision",
                _conflict_current(repo, capture=capture, question=question, mapping=mapping),
            )

    if apply.action in {"retarget_mapping", "replace_option_bindings"} and mapping is None:
        raise NotFoundError(f"mapping for question {question.id} not found")

    if apply.action == "update_answer" and mapping is not None:
        if apply.expected_mapping_revision is None:
            raise ValidationError("mapped capture updates require the mapping revision")

        if mapping["answer_id"] != apply.answer_id:
            raise ValidationError("mapped capture can update only its mapped answer")

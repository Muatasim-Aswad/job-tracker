"""Form-fill projections."""

from __future__ import annotations

from app.infra.database import Row
from app.modules.form_fill.models import Question
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    AnswerSummary,
    CaptureRecordDetail,
    CaptureRecordSummary,
    MappingSummary,
    OptionBindingSummary,
    QuestionSummary,
)
from app.modules.form_fill.values import _CAPTURE_VALUE
from app.shared.errors import NotFoundError


def _summary(
    repo: FormFillRepository, question: Question, *, mapping: MappingSummary | None = None
) -> QuestionSummary:
    option_count, capture_count, ignored_capture_count = repo.question_review_counts(question.id)

    return QuestionSummary(
        id=question.id,
        site_scope=question.site_scope,
        control_kind=question.control_kind,
        raw_question=question.raw_question,
        raw_section=question.raw_section,
        raw_help=question.raw_help,
        option_count=option_count,
        current_capture_count=capture_count,
        ignored_capture_count=ignored_capture_count,
        review_state=question.review_state,
        revision=question.revision,
        capture_conflict=capture_count > 1,
        last_unresolved_reason=question.last_unresolved_reason,
        seen_count=question.seen_count,
        first_seen_at=question.first_seen_at,
        last_seen_at=question.last_seen_at,
        mapping=mapping if mapping is not None else _mapping(repo, question.id),
    )


def _mapping(repo: FormFillRepository, question_id: str) -> MappingSummary | None:
    row = repo.get_mapping(question_id)

    return _mapping_summary(repo, row) if row else None


def _mapping_summary(repo: FormFillRepository, row: Row) -> MappingSummary:
    return MappingSummary(
        **row,
        bindings=[OptionBindingSummary(**binding) for binding in repo.list_bindings(row["id"])],
    )


def _answer_summary(row: Row) -> AnswerSummary:
    return AnswerSummary(
        id=row["id"],
        answer_key=row["answer_key"],
        label=row["label"],
        value_kind=row["value_kind"],
        status=row["status"],
        fill_policy=row["fill_policy"],
        revision=row["revision"],
    )


def _capture_summary(repo: FormFillRepository, row: Row) -> CaptureRecordSummary:
    return CaptureRecordSummary(
        id=row["id"],
        question_id=row["question_id"],
        question_label=_require_question(repo, row["question_id"]).raw_question,
        application_context_id=row["application_context_id"],
        job_id=row["job_id"],
        listing_id=row["listing_id"],
        mapping_id=row["mapping_id"],
        answer_revision_used=row["answer_revision_used"],
        mapping_revision_used=row["mapping_revision_used"],
        source=row["source"],
        value_kind=row["value_kind"],
        status=row["status"],
        revision=row["revision"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        resolved_at=row["resolved_at"],
    )


def _capture_record_detail(repo: FormFillRepository, row: Row) -> CaptureRecordDetail:
    return CaptureRecordDetail(
        **_capture_summary(repo, row).model_dump(),
        value=_CAPTURE_VALUE.validate_json(row["value_json"]) if row["value_json"] else None,
    )


def _require_question(repo: FormFillRepository, question_id: str) -> Question:
    question = repo.get_question(question_id)
    if question is None:
        raise NotFoundError(f"question {question_id} not found")

    return question


def _require_answer(repo: FormFillRepository, answer_id: str) -> Row:
    answer = repo.get_answer(answer_id)
    if answer is None:
        raise NotFoundError(f"answer {answer_id} not found")

    return answer


def _require_capture(repo: FormFillRepository, capture_id: str) -> Row:
    capture = repo.get_capture(capture_id)
    if capture is None:
        raise NotFoundError(f"capture {capture_id} not found")

    return capture


def _conflict_current(
    repo: FormFillRepository,
    *,
    capture: Row | None = None,
    question: Question | None = None,
    answer: Row | None = None,
    mapping: Row | None = None,
) -> dict[str, object | None]:
    return {
        "capture": _capture_summary(repo, capture).model_dump() if capture else None,
        "question": _summary(repo, question).model_dump() if question else None,
        "answer": _answer_summary(answer).model_dump() if answer else None,
        "mapping": _mapping_summary(repo, mapping).model_dump() if mapping else None,
    }

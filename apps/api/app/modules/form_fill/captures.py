"""Form-fill captures."""

from __future__ import annotations

from app.modules.form_fill.errors import KnowledgeConflict
from app.modules.form_fill.projections import (
    _capture_record_detail,
    _capture_summary,
    _require_capture,
    _require_question,
    _summary,
)
from app.modules.form_fill.queries import get_capture
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    CaptureConflictResolve,
    CaptureConflictResponse,
    CaptureCreate,
    CaptureCreateResponse,
    CaptureDetail,
    CaptureSummary,
    CaptureUpdate,
)
from app.modules.form_fill.storage import _atomic, _json, _new_id
from app.modules.form_fill.validation import (
    _same_capture_request,
    _validate_capture_context,
    _validate_capture_value,
)
from app.modules.listings.repository import ListingRepository
from app.shared.errors import ValidationError
from app.shared.timeutil import utc_now


def create_capture(repo: FormFillRepository, create: CaptureCreate) -> CaptureCreateResponse:
    question = _require_question(repo, create.question_id)
    listing = ListingRepository(repo.conn).get_by_platform(
        create.page.platform, create.page.platform_id
    )
    if question.review_state == "ignored":
        raise ValidationError("ignored questions cannot retain captures")

    mapping = repo.get_mapping(question.id)
    _validate_capture_context(repo, create, mapping)
    existing = repo.get_capture_by_key(create.capture_key)
    value_json = _json(create.value) if create.value is not None else None
    if existing is not None:
        if _same_capture_request(existing, create, listing, value_json):
            return CaptureCreateResponse(capture=_capture_record_detail(repo, existing))

        raise KnowledgeConflict("capture_key_reused", _capture_summary(repo, existing).model_dump())

    if question.capture_conflict:
        raise KnowledgeConflict("capture_conflict", _summary(repo, question).model_dump())

    if create.value is not None:
        _validate_capture_value(repo, question, create.value)

    current = repo.list_current_capture_records(question.id)
    now, capture_id = (utc_now(), _new_id())

    with _atomic(repo.conn):
        if create.cleared:
            kind = current[0]["value_kind"] if current else "text"
            repo.insert_capture(
                capture_id=capture_id,
                capture_key=create.capture_key,
                question_id=question.id,
                mapping_id=create.mapping_id,
                answer_revision_used=create.answer_revision_used,
                mapping_revision_used=create.mapping_revision_used,
                application_context_id=create.application_context_id,
                job_id=listing.job_id if listing else None,
                listing_id=listing.id if listing else None,
                source=create.source,
                value_kind=kind,
                value_json="null",
                now=now,
                cleared=True,
            )
            repo.transition_capture(
                capture_id, expected_revision=1, status="superseded", now=now, clear_value=True
            )
        else:
            assert create.value is not None and value_json is not None
            repo.insert_capture(
                capture_id=capture_id,
                capture_key=create.capture_key,
                question_id=question.id,
                mapping_id=create.mapping_id,
                answer_revision_used=create.answer_revision_used,
                mapping_revision_used=create.mapping_revision_used,
                application_context_id=create.application_context_id,
                job_id=listing.job_id if listing else None,
                listing_id=listing.id if listing else None,
                source=create.source,
                value_kind=create.value.kind,
                value_json=value_json,
                now=now,
            )

        for prior in current:
            repo.transition_capture(
                prior["id"],
                expected_revision=prior["revision"],
                status="superseded",
                superseded_by_id=None if create.cleared else capture_id,
                now=now,
                clear_value=True,
            )

    row = repo.get_capture(capture_id)
    assert row is not None

    return CaptureCreateResponse(
        capture=_capture_record_detail(repo, row),
        superseded_capture_id=current[0]["id"] if len(current) == 1 else None,
        superseded_capture_ids=[item["id"] for item in current],
    )


def update_capture(
    repo: FormFillRepository, capture_id: str, update: CaptureUpdate
) -> CaptureDetail:
    row = _require_capture(repo, capture_id)
    if row["revision"] != update.expected_revision:
        raise KnowledgeConflict("stale_revision", _capture_summary(repo, row).model_dump())

    if row["status"] not in {"current", "ignored"}:
        raise ValidationError("only current and ignored captures can change review state")

    if row["status"] == update.status:
        return get_capture(repo, capture_id)

    question = _require_question(repo, row["question_id"])
    if update.status == "current":
        if question.review_state == "ignored" or repo.list_current_capture_records(question.id):
            raise KnowledgeConflict("capture_slot_occupied", _summary(repo, question).model_dump())

        if row["value_json"] is None:
            raise ValidationError("a value-cleared capture cannot be reopened")

    now = utc_now()

    with _atomic(repo.conn):
        repo.transition_capture(
            capture_id,
            expected_revision=row["revision"],
            status=update.status,
            now=now,
            clear_value=update.status == "ignored",
        )
        repo.insert_event(
            event_id=_new_id(),
            event="capture_reopened" if update.status == "current" else "capture_ignored",
            capture_id=capture_id,
            question_id=question.id,
            before_revision=row["revision"],
            after_revision=row["revision"] + 1,
            reason=update.reason,
            now=now,
        )

    return get_capture(repo, capture_id)


def resolve_capture_conflict(
    repo: FormFillRepository, question_id: str, resolve: CaptureConflictResolve
) -> CaptureConflictResponse:
    question = _require_question(repo, question_id)
    current = repo.list_current_capture_records(question_id)
    current_by_id = {row["id"]: row for row in current}
    supplied = {item.capture_id: item.expected_revision for item in resolve.captures}
    stale = question.revision != resolve.expected_question_revision
    stale = stale or set(supplied) != set(current_by_id)
    stale = stale or any((current_by_id[item]["revision"] != rev for item, rev in supplied.items()))
    if stale:
        raise KnowledgeConflict(
            "stale_conflict_set",
            {
                "question": _summary(repo, question).model_dump(),
                "captures": [_capture_summary(repo, row).model_dump() for row in current],
            },
        )

    if len(current) < 2:
        raise ValidationError("capture conflict requires at least two current captures")

    now = utc_now()

    with _atomic(repo.conn):
        for row in current:
            if row["id"] != resolve.winner_capture_id:
                repo.transition_capture(
                    row["id"],
                    expected_revision=row["revision"],
                    status="superseded",
                    superseded_by_id=resolve.winner_capture_id,
                    now=now,
                    clear_value=True,
                )

        repo.set_question_conflict(question_id, False, resolve.expected_question_revision, now)
        repo.insert_event(
            event_id=_new_id(),
            event="capture_conflict_resolved",
            question_id=question_id,
            capture_id=resolve.winner_capture_id,
            before_revision=question.revision,
            after_revision=question.revision + 1,
            reason=resolve.reason,
            now=now,
        )

    winner = _require_capture(repo, resolve.winner_capture_id)
    superseded = [
        CaptureSummary(**_capture_summary(repo, _require_capture(repo, row["id"])).model_dump())
        for row in current
        if row["id"] != resolve.winner_capture_id
    ]

    return CaptureConflictResponse(
        question=_summary(repo, _require_question(repo, question_id)),
        winner=_capture_summary(repo, winner),
        superseded=superseded,
    )

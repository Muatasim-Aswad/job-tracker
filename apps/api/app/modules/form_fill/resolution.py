"""Form-fill resolution."""

from __future__ import annotations

from typing import Any

from app.modules.form_fill.actions import _answer_action, _capture_action
from app.modules.form_fill.identity import QuestionIdentity, build_identity
from app.modules.form_fill.models import Question
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    ApprovedResult,
    BlockedResult,
    CapturedResult,
    ConfirmationRequiredResult,
    ConflictResult,
    IgnoredResult,
    OptionIdentityPair,
    ResolutionField,
    ResolutionRequest,
    ResolutionResponse,
    ResolutionResult,
    ResolvedListingContext,
    UnresolvedResult,
)
from app.modules.form_fill.storage import _new_id
from app.modules.form_fill.validation import _assert_identity
from app.modules.form_fill.values import _ANSWER_VALUE, _CAPTURE_VALUE
from app.modules.listings.repository import ListingRepository
from app.shared.errors import ValidationError
from app.shared.timeutil import utc_now


def resolve(repo: FormFillRepository, request: ResolutionRequest) -> ResolutionResponse:
    listing = ListingRepository(repo.conn).get_by_platform(
        request.page.platform, request.page.platform_id
    )
    results: list[ResolutionResult] = []
    for field in request.fields:
        identity = build_identity(
            site_scope=request.page.site_scope,
            adapter_id=request.page.adapter_id,
            adapter_version=request.page.adapter_version,
            field=field,
        )
        if len({option.key for option in identity.options}) != len(identity.options):
            raise ValidationError("choice options must have distinct semantic identities")

        question, pairs = _observe_question(repo, request.scan_id, identity)
        result = _resolve_question(
            repo, question, field, pairs, application_context_id=request.application_context_id
        )
        repo.update_resolution_reason(question.id, getattr(result, "reason", None))
        results.append(result)

    return ResolutionResponse(
        scan_id=request.scan_id,
        listing_context=ResolvedListingContext(
            job_id=listing.job_id if listing else None, listing_id=listing.id if listing else None
        ),
        results=results,
    )


def _resolve_question(
    repo: FormFillRepository,
    question: Question,
    field: ResolutionField,
    pairs: list[OptionIdentityPair],
    *,
    application_context_id: str,
) -> ResolutionResult:
    base: dict[str, Any] = {
        "client_field_id": field.client_field_id,
        "question_id": question.id,
        "option_mappings": pairs,
    }
    if question.review_state == "ignored":
        return IgnoredResult(**base, status="ignored", reason="question_ignored")

    mapping = repo.get_mapping(question.id)
    if mapping is not None and mapping["status"] != "retired":
        if mapping["status"] == "disabled":
            return BlockedResult(**base, status="blocked", reason="mapping_disabled")

        answer = repo.get_answer(mapping["answer_id"])
        if answer is None:
            return BlockedResult(**base, status="blocked", reason="answer_missing")

        if answer["status"] == "disabled":
            return BlockedResult(**base, status="blocked", reason="answer_disabled")

        if answer["fill_policy"] == "never":
            return BlockedResult(**base, status="blocked", reason="answer_policy_never")

        value = _ANSWER_VALUE.validate_json(answer["value_json"])
        action = _answer_action(repo, question, value, mapping, pairs)
        if action is None:
            return BlockedResult(
                **base, status="blocked", reason="incompatible_or_incomplete_mapping"
            )

        if answer["fill_policy"] == "confirm_each_time" and (not field.user_confirmed):
            return ConfirmationRequiredResult(
                **base,
                status="confirmation_required",
                answer_id=answer["id"],
                answer_revision=answer["revision"],
                mapping_id=mapping["id"],
                mapping_revision=mapping["revision"],
            )

        return ApprovedResult(
            **base,
            status="approved",
            answer_id=answer["id"],
            answer_revision=answer["revision"],
            mapping_id=mapping["id"],
            mapping_revision=mapping["revision"],
            action=action,
        )

    captures = repo.list_current_capture_records(question.id)
    if question.capture_conflict or len(captures) > 1:
        return ConflictResult(
            **base,
            status="conflict",
            capture_ids=[row["id"] for row in captures],
            reason="capture_conflict",
        )

    if captures:
        capture = captures[0]
        if capture["value_json"]:
            capture_value = _CAPTURE_VALUE.validate_json(capture["value_json"])
            action = _capture_action(question, capture_value, pairs)
            if action is not None:
                return CapturedResult(
                    **base,
                    status="captured",
                    capture_id=capture["id"],
                    capture_revision=capture["revision"],
                    source=capture["source"],
                    action=action,
                )

    return UnresolvedResult(**base, status="unresolved", reason="no_knowledge")


def _observe_question(
    repo: FormFillRepository, scan_id: str, identity: QuestionIdentity
) -> tuple[Question, list[OptionIdentityPair]]:
    now = utc_now()
    question = repo.get_question_by_signature(identity.signature)
    created = question is None
    if question is None:
        question_id = _new_id()
        repo.insert_question(question_id, identity, scan_id, now)
        question = repo.get_question(question_id)
        assert question is not None
    else:
        _assert_identity(question, identity)

    pairs: list[OptionIdentityPair] = []
    options_changed = False
    for option in identity.options:
        stored, changed = repo.upsert_option(
            option_id=_new_id(),
            question_id=question.id,
            normalized_label=option.normalized_label,
            raw_label=option.raw_label,
            stable_option_key=option.stable_option_key,
            status=option.status,
            now=now,
        )
        options_changed = options_changed or changed
        pairs.append(
            OptionIdentityPair(
                client_option_id=option.client_option_id, question_option_id=stored.id
            )
        )

    if not created:
        repo.update_observation(question, identity, scan_id, now, options_changed=options_changed)

    refreshed = repo.get_question(question.id)
    assert refreshed is not None

    return (refreshed, pairs)

from __future__ import annotations

import base64
import hashlib
import json
import uuid
from typing import Literal

from app.core.db import Conn
from app.core.errors import ConflictError, InvalidCursorError, NotFoundError, ValidationError
from app.core.timeutil import utc_now
from app.form_fill.identity import (
    QuestionIdentity,
    build_identity,
    normalize_evidence,
    normalize_token,
)
from app.form_fill.models import Question
from app.form_fill.repository import FormFillRepository
from app.form_fill.schemas import (
    AnswerSummary,
    CaptureSummary,
    IgnoredResult,
    KnowledgeEventSummary,
    MappingSummary,
    OptionBindingSummary,
    OptionIdentityPair,
    QuestionDetail,
    QuestionListResponse,
    QuestionOptionSummary,
    QuestionReviewUpdate,
    QuestionSummary,
    ResolutionRequest,
    ResolutionResponse,
    ResolutionResult,
    ResolvedListingContext,
    UnresolvedResult,
)
from app.listings.repository import ListingRepository

QuestionSort = Literal["last_seen", "seen_count"]
QuestionMappingFilter = Literal["active", "disabled", "retired", "none"]


def _new_id() -> str:
    return uuid.uuid4().hex


def _filter_fingerprint(filters: object) -> str:
    raw = json.dumps(filters, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def _encode_cursor(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str, fingerprint: str, sort: QuestionSort) -> tuple[object, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        if not isinstance(payload, dict):
            raise ValueError
        if payload.get("filters") != fingerprint or payload.get("sort") != sort:
            raise ValueError
        value = payload["value"]
        resource_id = payload["id"]
        if sort == "last_seen" and not isinstance(value, str):
            raise ValueError
        if sort == "seen_count" and (not isinstance(value, int) or isinstance(value, bool)):
            raise ValueError
        if not isinstance(resource_id, str):
            raise ValueError
        return value, resource_id
    except KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError:
        raise InvalidCursorError from None


class FormFillService:
    def __init__(self, conn: Conn) -> None:
        self.repo = FormFillRepository(conn)
        self.listings = ListingRepository(conn)

    def resolve(self, request: ResolutionRequest) -> ResolutionResponse:
        listing = self.listings.get_by_platform(request.page.platform, request.page.platform_id)
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
            question, pairs = self._observe_question(request.scan_id, identity)
            if question.review_state == "ignored":
                results.append(
                    IgnoredResult(
                        client_field_id=field.client_field_id,
                        question_id=question.id,
                        option_mappings=pairs,
                        status="ignored",
                        reason="question_ignored",
                    )
                )
            else:
                results.append(
                    UnresolvedResult(
                        client_field_id=field.client_field_id,
                        question_id=question.id,
                        option_mappings=pairs,
                        status="unresolved",
                        reason="no_knowledge",
                    )
                )
        return ResolutionResponse(
            scan_id=request.scan_id,
            listing_context=ResolvedListingContext(
                job_id=listing.job_id if listing else None,
                listing_id=listing.id if listing else None,
            ),
            results=results,
        )

    def _observe_question(
        self, scan_id: str, identity: QuestionIdentity
    ) -> tuple[Question, list[OptionIdentityPair]]:
        now = utc_now()
        question = self.repo.get_question_by_signature(identity.signature)
        created = question is None
        if question is None:
            question_id = _new_id()
            self.repo.insert_question(question_id, identity, scan_id, now)
            question = self.repo.get_question(question_id)
            assert question is not None
        else:
            self._assert_identity(question, identity)

        pairs: list[OptionIdentityPair] = []
        options_changed = False
        for option in identity.options:
            stored, changed = self.repo.upsert_option(
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
            self.repo.update_observation(
                question, identity, scan_id, now, options_changed=options_changed
            )
        refreshed = self.repo.get_question(question.id)
        assert refreshed is not None
        return refreshed, pairs

    @staticmethod
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
            1,
            identity.control_kind,
            identity.option_set_hash,
        )
        if stored_base != observed_base:
            raise ValidationError("question identity signature collision")
        stored_evidence: tuple[str, ...]
        observed_evidence: tuple[str, ...]
        if identity.identity_kind == "adapter_key":
            stored_evidence = (
                question.adapter_id,
                question.adapter_version,
                question.stable_field_key,
            )
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

    def list_questions(
        self,
        *,
        review_state: str | None,
        mapping_status: QuestionMappingFilter | None,
        has_current_capture: bool | None,
        site_scope: str | None,
        answer_id: str | None,
        query: str | None,
        sort: QuestionSort,
        limit: int,
        cursor: str | None,
    ) -> QuestionListResponse:
        canonical_scope = normalize_token(site_scope) if site_scope is not None else None
        canonical_query = normalize_evidence(query) if query is not None else None
        filters = {
            "review_state": review_state,
            "mapping_status": mapping_status,
            "has_current_capture": has_current_capture,
            "site_scope": canonical_scope,
            "answer_id": answer_id,
            "query": canonical_query,
        }
        fingerprint = _filter_fingerprint(filters)
        cursor_values = _decode_cursor(cursor, fingerprint, sort) if cursor else None
        page = self.repo.list_questions(
            review_state=review_state,
            mapping_status=mapping_status,
            has_current_capture=has_current_capture,
            site_scope=canonical_scope,
            answer_id=answer_id,
            query=canonical_query,
            sort=sort,
            limit=limit,
            cursor_values=cursor_values,
        )
        items = [self._summary(question) for question in page.items]
        next_cursor = None
        if page.has_more and page.items:
            last = page.items[-1]
            value: object = last.last_seen_at if sort == "last_seen" else last.seen_count
            next_cursor = _encode_cursor(
                {"filters": fingerprint, "sort": sort, "value": value, "id": last.id}
            )
        return QuestionListResponse(items=items, next_cursor=next_cursor)

    def get_question(self, question_id: str) -> QuestionDetail:
        question = self.repo.get_question(question_id)
        if question is None:
            raise NotFoundError(f"question {question_id} not found")
        mapping = self._mapping(question.id)
        answer = (
            AnswerSummary(**row)
            if mapping and (row := self.repo.get_answer_summary(mapping.answer_id))
            else None
        )
        return QuestionDetail(
            **self._summary(question, mapping=mapping).model_dump(),
            signature=question.signature,
            identity_kind=question.identity_kind,
            adapter_id=question.adapter_id,
            adapter_version=question.adapter_version,
            stable_field_key=question.stable_field_key or None,
            normalizer_version=question.normalizer_version,
            normalized_question=question.normalized_question,
            normalized_section=question.normalized_section,
            raw_section=question.raw_section,
            normalized_help=question.normalized_help,
            raw_help=question.raw_help,
            autocomplete_token=question.autocomplete_token or None,
            option_set_hash=question.option_set_hash or None,
            options=[
                QuestionOptionSummary(
                    id=option.id,
                    normalized_label=option.normalized_label,
                    raw_label=option.raw_label,
                    stable_option_key=option.stable_option_key or None,
                    status=option.status,
                )
                for option in self.repo.list_options(question.id)
            ],
            answer=answer,
            current_captures=[
                CaptureSummary(**row) for row in self.repo.list_current_captures(question.id)
            ],
            events=[
                KnowledgeEventSummary(**row) for row in self.repo.list_question_events(question.id)
            ],
        )

    def update_question(self, question_id: str, update: QuestionReviewUpdate) -> QuestionDetail:
        question = self.repo.get_question(question_id)
        if question is None:
            raise NotFoundError(f"question {question_id} not found")
        if question.revision != update.expected_revision:
            raise ConflictError("stale_revision", self._summary(question).model_dump())
        if question.review_state == update.review_state:
            return self.get_question(question_id)
        mapping = self.repo.get_mapping(question_id)
        if update.review_state == "ignored" and mapping and mapping["status"] == "active":
            raise ValidationError(
                "disable or retire the active mapping before ignoring its question"
            )
        self.repo.set_review_state(
            question_id,
            update.review_state,
            update.expected_revision,
            update.reason,
            _new_id(),
            utc_now(),
        )
        return self.get_question(question_id)

    def _summary(
        self, question: Question, *, mapping: MappingSummary | None = None
    ) -> QuestionSummary:
        return QuestionSummary(
            id=question.id,
            site_scope=question.site_scope,
            control_kind=question.control_kind,
            raw_question=question.raw_question,
            review_state=question.review_state,
            revision=question.revision,
            capture_conflict=question.capture_conflict,
            last_unresolved_reason=question.last_unresolved_reason,
            seen_count=question.seen_count,
            first_seen_at=question.first_seen_at,
            last_seen_at=question.last_seen_at,
            mapping=mapping if mapping is not None else self._mapping(question.id),
        )

    def _mapping(self, question_id: str) -> MappingSummary | None:
        row = self.repo.get_mapping(question_id)
        if row is None:
            return None
        return MappingSummary(
            **row,
            bindings=[
                OptionBindingSummary(**binding) for binding in self.repo.list_bindings(row["id"])
            ],
        )

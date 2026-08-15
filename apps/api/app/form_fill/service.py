from __future__ import annotations

import base64
import hashlib
import json
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, Literal, cast

from pydantic import TypeAdapter

from app.core.db import Conn, Row
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
    AnswerChoiceSummary,
    AnswerCreate,
    AnswerDetail,
    AnswerListItem,
    AnswerListResponse,
    AnswerMultiChoiceValue,
    AnswerSingleChoiceValue,
    AnswerSummary,
    AnswerUpdate,
    AnswerValue,
    ApprovedResult,
    BlockedResult,
    CaptureApply,
    CaptureApplyResponse,
    CaptureConflictResolve,
    CaptureConflictResponse,
    CaptureCreate,
    CaptureCreateResponse,
    CaptureDetail,
    CapturedResult,
    CaptureListResponse,
    CaptureMultiChoiceValue,
    CaptureRecordSummary,
    CaptureSingleChoiceValue,
    CaptureSummary,
    CaptureUpdate,
    CaptureValue,
    ConfirmationRequiredResult,
    ConflictResult,
    IgnoredResult,
    KnowledgeEventSummary,
    MappedQuestionSummary,
    MappingPut,
    MappingSummary,
    MappingUpdate,
    OptionBindingInput,
    OptionBindingSummary,
    OptionIdentityPair,
    QuestionDetail,
    QuestionListResponse,
    QuestionOptionSummary,
    QuestionReviewUpdate,
    QuestionSummary,
    ResolutionAction,
    ResolutionField,
    ResolutionRequest,
    ResolutionResponse,
    ResolutionResult,
    ResolvedListingContext,
    SetBooleanAction,
    SetDateAction,
    SetDecimalAction,
    SetMultiChoiceAction,
    SetSingleChoiceAction,
    SetTextAction,
    UnresolvedResult,
)
from app.listings.repository import ListingRepository

QuestionSort = Literal["last_seen", "seen_count"]
QuestionMappingFilter = Literal["active", "disabled", "retired", "none"]

_ANSWER_VALUE: TypeAdapter[AnswerValue] = TypeAdapter(AnswerValue)
_CAPTURE_VALUE: TypeAdapter[CaptureValue] = TypeAdapter(CaptureValue)
_ANSWER_KEY = re.compile(r"^[a-z0-9][a-z0-9._-]{0,255}$")
_CHOICE_CONTROLS = {"radio", "select", "checkbox_group", "multi_select"}
_SINGLE_CHOICE_CONTROLS = {"radio", "select"}
_MULTI_CHOICE_CONTROLS = {"checkbox_group", "multi_select"}


def _new_id() -> str:
    return uuid.uuid4().hex


def _json(value: object) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _filter_fingerprint(filters: object) -> str:
    return hashlib.sha256(_json(filters).encode()).hexdigest()


def _encode_cursor(payload: dict[str, object]) -> str:
    return base64.urlsafe_b64encode(_json(payload).encode()).decode().rstrip("=")


def _cursor_payload(cursor: str) -> dict[str, object]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        if not isinstance(payload, dict):
            raise ValueError
        return cast(dict[str, object], payload)
    except TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError:
        raise InvalidCursorError from None


def _decode_cursor(cursor: str, fingerprint: str, sort: QuestionSort) -> tuple[object, str]:
    try:
        payload = _cursor_payload(cursor)
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
    except KeyError, TypeError, ValueError:
        raise InvalidCursorError from None


def _decode_time_cursor(cursor: str, fingerprint: str, sort: str) -> tuple[str, str]:
    try:
        payload = _cursor_payload(cursor)
        if payload.get("filters") != fingerprint or payload.get("sort") != sort:
            raise ValueError
        value, resource_id = payload["value"], payload["id"]
        if not isinstance(value, str) or not isinstance(resource_id, str):
            raise ValueError
        return value, resource_id
    except KeyError, TypeError, ValueError:
        raise InvalidCursorError from None


@contextmanager
def _atomic(conn: Conn) -> Iterator[None]:
    name = f"form_fill_{uuid.uuid4().hex}"
    conn.execute(f"SAVEPOINT {name}")
    try:
        yield
    except Exception:
        conn.execute(f"ROLLBACK TO {name}")
        conn.execute(f"RELEASE {name}")
        raise
    conn.execute(f"RELEASE {name}")


class FormFillService:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn
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
            result = self._resolve_question(
                question, field, pairs, application_context_id=request.application_context_id
            )
            self.repo.update_resolution_reason(question.id, getattr(result, "reason", None))
            results.append(result)
        return ResolutionResponse(
            scan_id=request.scan_id,
            listing_context=ResolvedListingContext(
                job_id=listing.job_id if listing else None,
                listing_id=listing.id if listing else None,
            ),
            results=results,
        )

    def _resolve_question(
        self,
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
        mapping = self.repo.get_mapping(question.id)
        if mapping is not None and mapping["status"] != "retired":
            if mapping["status"] == "disabled":
                return BlockedResult(**base, status="blocked", reason="mapping_disabled")
            answer = self.repo.get_answer(mapping["answer_id"])
            if answer is None:
                return BlockedResult(**base, status="blocked", reason="answer_missing")
            if answer["status"] == "disabled":
                return BlockedResult(**base, status="blocked", reason="answer_disabled")
            if answer["fill_policy"] == "never":
                return BlockedResult(**base, status="blocked", reason="answer_policy_never")
            value = _ANSWER_VALUE.validate_json(answer["value_json"])
            action = self._answer_action(question, value, mapping, pairs)
            if action is None:
                return BlockedResult(
                    **base, status="blocked", reason="incompatible_or_incomplete_mapping"
                )
            if answer["fill_policy"] == "confirm_each_time" and not field.user_confirmed:
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
        captures = self.repo.list_current_capture_records(question.id)
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
                action = self._capture_action(question, capture_value, pairs)
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

    def _answer_action(
        self, question: Question, value: AnswerValue, mapping: Row, pairs: list[OptionIdentityPair]
    ) -> ResolutionAction | None:
        scalar = self._scalar_action(question.control_kind, value)
        if scalar is not None:
            return scalar
        if question.control_kind not in _CHOICE_CONTROLS:
            return None
        choices = {
            row["choice_key"]: row for row in self.repo.list_answer_choices(mapping["answer_id"])
        }
        binding_by_choice = {
            row["answer_choice_id"]: row["question_option_id"]
            for row in self.repo.list_bindings(mapping["id"])
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

    @staticmethod
    def _scalar_action(
        control_kind: str, value: AnswerValue | CaptureValue
    ) -> ResolutionAction | None:
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
        self, question: Question, value: CaptureValue, pairs: list[OptionIdentityPair]
    ) -> ResolutionAction | None:
        scalar = self._scalar_action(question.control_kind, value)
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

    def list_questions(
        self,
        *,
        review_state: str | None,
        mapping_status: QuestionMappingFilter | None,
        needs_review: bool | None,
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
            "needs_review": needs_review,
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
            needs_review=needs_review,
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
        question = self._require_question(question_id)
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
        question = self._require_question(question_id)
        if question.revision != update.expected_revision:
            raise ConflictError("stale_revision", self._summary(question).model_dump())
        if question.review_state == update.review_state:
            return self.get_question(question_id)
        mapping = self.repo.get_mapping(question_id)
        if update.review_state == "ignored" and mapping and mapping["status"] == "active":
            raise ValidationError(
                "disable or retire the active mapping before ignoring its question"
            )
        with _atomic(self.conn):
            self.repo.set_review_state(
                question_id,
                update.review_state,
                update.expected_revision,
                update.reason,
                _new_id(),
                utc_now(),
            )
            if update.review_state == "ignored":
                now = utc_now()
                for capture in self.repo.list_current_capture_records(question_id):
                    self.repo.transition_capture(
                        capture["id"],
                        expected_revision=capture["revision"],
                        status="ignored",
                        now=now,
                        clear_value=True,
                    )
        return self.get_question(question_id)

    def list_answers(
        self,
        *,
        status: str | None,
        value_kind: str | None,
        query: str | None,
        limit: int,
        cursor: str | None,
    ) -> AnswerListResponse:
        canonical_query = normalize_evidence(query) if query is not None else None
        filters = {"status": status, "value_kind": value_kind, "query": canonical_query}
        fingerprint = _filter_fingerprint(filters)
        cursor_values = _decode_time_cursor(cursor, fingerprint, "updated_at") if cursor else None
        rows, has_more = self.repo.list_answers(
            status=status,
            value_kind=value_kind,
            query=canonical_query,
            limit=limit,
            cursor_values=cursor_values,
        )
        items = [AnswerListItem(**row) for row in rows]
        next_cursor = None
        if has_more and rows:
            next_cursor = _encode_cursor(
                {
                    "filters": fingerprint,
                    "sort": "updated_at",
                    "value": rows[-1]["updated_at"],
                    "id": rows[-1]["id"],
                }
            )
        return AnswerListResponse(items=items, next_cursor=next_cursor)

    def create_answer(self, create: AnswerCreate) -> AnswerDetail:
        self._validate_answer_key(create.answer_key)
        self._validate_answer_value(create.value_kind, create.value, create.choices)
        if (existing := self.repo.get_answer_by_key(create.answer_key)) is not None:
            raise ConflictError("answer_key_exists", self._answer_summary(existing).model_dump())
        now, answer_id = utc_now(), _new_id()
        with _atomic(self.conn):
            self.repo.insert_answer(
                answer_id=answer_id,
                answer_key=create.answer_key,
                label=create.label,
                description=create.description,
                value_kind=create.value_kind,
                value_json=_json(create.value),
                fill_policy=create.fill_policy,
                now=now,
            )
            self.repo.replace_answer_choices(
                answer_id,
                [
                    (_new_id(), item.choice_key, item.display_label, item.status)
                    for item in create.choices
                ],
                now,
            )
            self.repo.insert_event(
                event_id=_new_id(),
                event="answer_created",
                answer_id=answer_id,
                after_revision=1,
                now=now,
            )
        return self.get_answer(answer_id)

    def get_answer(self, answer_id: str) -> AnswerDetail:
        row = self._require_answer(answer_id)
        mappings: list[MappedQuestionSummary] = []
        for mapping_row in self.repo.list_answer_mappings(answer_id):
            question = self._require_question(mapping_row["id"])
            mapping = self._mapping(question.id)
            assert mapping is not None
            mappings.append(
                MappedQuestionSummary(
                    id=question.id,
                    site_scope=question.site_scope,
                    control_kind=question.control_kind,
                    raw_question=question.raw_question,
                    review_state=question.review_state,
                    revision=question.revision,
                    mapping=mapping,
                )
            )
        return AnswerDetail(
            id=row["id"],
            answer_key=row["answer_key"],
            label=row["label"],
            description=row["description"],
            value_kind=row["value_kind"],
            value=_ANSWER_VALUE.validate_json(row["value_json"]),
            status=row["status"],
            fill_policy=row["fill_policy"],
            revision=row["revision"],
            choices=[
                AnswerChoiceSummary(**choice) for choice in self.repo.list_answer_choices(answer_id)
            ],
            mappings=mappings,
            events=[
                KnowledgeEventSummary(**event) for event in self.repo.list_answer_events(answer_id)
            ],
            verified_at=row["verified_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def update_answer(self, answer_id: str, update: AnswerUpdate) -> AnswerDetail:
        row = self._require_answer(answer_id)
        if row["revision"] != update.expected_revision:
            raise ConflictError("stale_revision", self._answer_summary(row).model_dump())
        current_value = _ANSWER_VALUE.validate_json(row["value_json"])
        value = update.value or current_value
        choices = update.choices
        current_choices = self.repo.list_answer_choices(answer_id)
        choice_models = choices if choices is not None else current_choices
        self._validate_answer_value(row["value_kind"], value, choice_models)
        changed = any(
            (
                update.label is not None and update.label != row["label"],
                "description" in update.model_fields_set
                and update.description != row["description"],
                update.value is not None and _json(value) != row["value_json"],
                update.fill_policy is not None and update.fill_policy != row["fill_policy"],
                update.status is not None and update.status != row["status"],
                choices is not None
                and self._choice_shape(choices) != self._choice_shape(current_choices),
            )
        )
        if not changed:
            return self.get_answer(answer_id)
        now = utc_now()
        with _atomic(self.conn):
            if choices is not None:
                self._sync_choices(answer_id, choices, now)
            self.repo.update_answer(
                answer_id,
                expected_revision=update.expected_revision,
                label=update.label if update.label is not None else row["label"],
                description=(
                    update.description
                    if "description" in update.model_fields_set
                    else row["description"]
                ),
                value_json=_json(value),
                status=update.status or row["status"],
                fill_policy=update.fill_policy or row["fill_policy"],
                now=now,
            )
            event = (
                "answer_disabled"
                if update.status == "disabled"
                else "answer_enabled"
                if update.status == "active" and row["status"] == "disabled"
                else "answer_updated"
            )
            self.repo.insert_event(
                event_id=_new_id(),
                event=event,
                answer_id=answer_id,
                before_revision=update.expected_revision,
                after_revision=update.expected_revision + 1,
                reason=update.reason,
                now=now,
            )
        return self.get_answer(answer_id)

    def put_mapping(self, question_id: str, put: MappingPut) -> QuestionDetail:
        question = self._require_question(question_id)
        answer = self._require_answer(put.answer_id)
        mapping = self.repo.get_mapping(question_id)
        self._check_mapping_revisions(question, answer, mapping, put)
        bindings = self._validate_bindings(question, answer, put.bindings)
        if question.review_state == "ignored":
            raise ValidationError("ignored questions must be reopened before mapping")
        now = utc_now()
        with _atomic(self.conn):
            if mapping is None:
                mapping_id = _new_id()
                self.repo.insert_mapping(mapping_id, question_id, answer["id"], now)
                event, before_revision, after_revision = "mapping_approved", None, 1
            else:
                mapping_id = mapping["id"]
                before_revision, after_revision = mapping["revision"], mapping["revision"] + 1
                event = (
                    "mapping_reactivated"
                    if mapping["status"] == "retired" and mapping["answer_id"] == answer["id"]
                    else "mapping_corrected"
                )
                self.repo.update_mapping(
                    mapping_id,
                    answer_id=answer["id"],
                    status="active",
                    expected_revision=mapping["revision"],
                    now=now,
                )
            self.repo.replace_bindings(mapping_id, bindings, now)
            self.repo.insert_event(
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
            current_mapping = self.repo.get_mapping(question_id)
            assert current_mapping is not None
            self._consume_matching_current_capture(
                question, answer, current_mapping, now=now, reason=put.reason
            )
        return self.get_question(question_id)

    def update_mapping(self, question_id: str, update: MappingUpdate) -> QuestionDetail:
        question = self._require_question(question_id)
        mapping = self.repo.get_mapping(question_id)
        if mapping is None:
            raise NotFoundError(f"mapping for question {question_id} not found")
        if (
            question.revision != update.expected_question_revision
            or mapping["revision"] != update.expected_revision
        ):
            raise ConflictError(
                "stale_revision", self._conflict_current(question=question, mapping=mapping)
            )
        if mapping["status"] == update.status:
            return self.get_question(question_id)
        now = utc_now()
        with _atomic(self.conn):
            self.repo.update_mapping(
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
            self.repo.insert_event(
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
        return self.get_question(question_id)

    def create_capture(self, create: CaptureCreate) -> CaptureCreateResponse:
        question = self._require_question(create.question_id)
        listing = self.listings.get_by_platform(create.page.platform, create.page.platform_id)
        if question.review_state == "ignored":
            raise ValidationError("ignored questions cannot retain captures")
        mapping = self.repo.get_mapping(question.id)
        self._validate_capture_context(create, mapping)
        existing = self.repo.get_capture_by_key(create.capture_key)
        value_json = _json(create.value) if create.value is not None else None
        if existing is not None:
            if self._same_capture_request(existing, create, listing, value_json):
                return CaptureCreateResponse(capture=self._capture_summary(existing))
            raise ConflictError("capture_key_reused", self._capture_summary(existing).model_dump())
        if question.capture_conflict:
            raise ConflictError("capture_conflict", self._summary(question).model_dump())
        if create.value is not None:
            self._validate_capture_value(question, create.value)
        current = self.repo.list_current_capture_records(question.id)
        now, capture_id = utc_now(), _new_id()
        with _atomic(self.conn):
            if create.cleared:
                kind = current[0]["value_kind"] if current else "text"
                self.repo.insert_capture(
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
                )
                self.repo.transition_capture(
                    capture_id, expected_revision=1, status="superseded", now=now, clear_value=True
                )
            else:
                assert create.value is not None and value_json is not None
                self.repo.insert_capture(
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
                self.repo.transition_capture(
                    prior["id"],
                    expected_revision=prior["revision"],
                    status="superseded",
                    superseded_by_id=None if create.cleared else capture_id,
                    now=now,
                    clear_value=True,
                )
        row = self.repo.get_capture(capture_id)
        assert row is not None
        return CaptureCreateResponse(
            capture=self._capture_summary(row),
            superseded_capture_id=current[0]["id"] if len(current) == 1 else None,
            superseded_capture_ids=[item["id"] for item in current],
        )

    def list_captures(
        self,
        *,
        status: str | None,
        source: str | None,
        question_id: str | None,
        query: str | None,
        limit: int,
        cursor: str | None,
    ) -> CaptureListResponse:
        canonical_query = normalize_evidence(query) if query is not None else None
        filters = {
            "status": status,
            "source": source,
            "question_id": question_id,
            "query": canonical_query,
        }
        fingerprint = _filter_fingerprint(filters)
        cursor_values = _decode_time_cursor(cursor, fingerprint, "updated_at") if cursor else None
        rows, has_more = self.repo.list_capture_rows(
            status=status,
            source=source,
            question_id=question_id,
            query=canonical_query,
            limit=limit,
            cursor_values=cursor_values,
        )
        next_cursor = None
        if has_more and rows:
            next_cursor = _encode_cursor(
                {
                    "filters": fingerprint,
                    "sort": "updated_at",
                    "value": rows[-1]["updated_at"],
                    "id": rows[-1]["id"],
                }
            )
        return CaptureListResponse(
            items=[self._capture_summary(row) for row in rows], next_cursor=next_cursor
        )

    def get_capture(self, capture_id: str) -> CaptureDetail:
        row = self._require_capture(capture_id)
        question = self._require_question(row["question_id"])
        mapping = self._mapping(question.id)
        answer = None
        if mapping and (answer_row := self.repo.get_answer_summary(mapping.answer_id)):
            answer = AnswerSummary(**answer_row)
        return CaptureDetail(
            **self._capture_summary(row).model_dump(),
            question=self._summary(question),
            answer=answer,
            mapping=mapping,
            events=[
                KnowledgeEventSummary(**event)
                for event in self.repo.list_capture_events(capture_id)
            ],
        )

    def update_capture(self, capture_id: str, update: CaptureUpdate) -> CaptureDetail:
        row = self._require_capture(capture_id)
        if row["revision"] != update.expected_revision:
            raise ConflictError("stale_revision", self._capture_summary(row).model_dump())
        if row["status"] not in {"current", "ignored"}:
            raise ValidationError("only current and ignored captures can change review state")
        if row["status"] == update.status:
            return self.get_capture(capture_id)
        question = self._require_question(row["question_id"])
        if update.status == "current":
            if question.review_state == "ignored" or self.repo.list_current_capture_records(
                question.id
            ):
                raise ConflictError("capture_slot_occupied", self._summary(question).model_dump())
            if row["value_json"] is None:
                raise ValidationError("a value-cleared capture cannot be reopened")
        now = utc_now()
        with _atomic(self.conn):
            self.repo.transition_capture(
                capture_id,
                expected_revision=row["revision"],
                status=update.status,
                now=now,
                clear_value=update.status == "ignored",
            )
            self.repo.insert_event(
                event_id=_new_id(),
                event="capture_reopened" if update.status == "current" else "capture_ignored",
                capture_id=capture_id,
                question_id=question.id,
                before_revision=row["revision"],
                after_revision=row["revision"] + 1,
                reason=update.reason,
                now=now,
            )
        return self.get_capture(capture_id)

    def apply_capture(self, capture_id: str, apply: CaptureApply) -> CaptureApplyResponse:
        capture = self._require_capture(capture_id)
        question = self._require_question(capture["question_id"])
        mapping = self.repo.get_mapping(question.id)
        requested_answer_id = getattr(apply, "answer_id", None)
        answer = self.repo.get_answer(requested_answer_id) if requested_answer_id else None
        self._check_apply_revisions(capture, question, mapping, answer, apply)
        now = utc_now()
        with _atomic(self.conn):
            if apply.action == "create_answer_and_map":
                create = AnswerCreate(
                    answer_key=apply.answer_key,
                    label=apply.label,
                    description=apply.description,
                    value_kind=apply.value_kind,
                    value=apply.value,
                    choices=apply.choices,
                    fill_policy=apply.fill_policy,
                )
                self._validate_answer_key(create.answer_key)
                self._validate_answer_value(create.value_kind, create.value, create.choices)
                if (existing := self.repo.get_answer_by_key(create.answer_key)) is not None:
                    raise ConflictError(
                        "answer_key_exists", self._answer_summary(existing).model_dump()
                    )
                answer_id = _new_id()
                self.repo.insert_answer(
                    answer_id=answer_id,
                    answer_key=create.answer_key,
                    label=create.label,
                    description=create.description,
                    value_kind=create.value_kind,
                    value_json=_json(create.value),
                    fill_policy=create.fill_policy,
                    now=now,
                )
                self.repo.replace_answer_choices(
                    answer_id,
                    [
                        (_new_id(), item.choice_key, item.display_label, item.status)
                        for item in create.choices
                    ],
                    now,
                )
                answer = self._require_answer(answer_id)
                mapping_id = _new_id()
                if mapping is None:
                    self.repo.insert_mapping(mapping_id, question.id, answer_id, now)
                else:
                    mapping_id = mapping["id"]
                    self.repo.update_mapping(
                        mapping_id,
                        answer_id=answer_id,
                        status="active",
                        expected_revision=mapping["revision"],
                        now=now,
                    )
                choices_by_key = {
                    item["choice_key"]: item for item in self.repo.list_answer_choices(answer_id)
                }
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
                bindings = self._validate_bindings(question, answer, binding_inputs)
                self.repo.replace_bindings(mapping_id, bindings, now)
                mapping = self.repo.get_mapping(question.id)
                assert mapping is not None
                self.repo.insert_event(
                    event_id=_new_id(),
                    event="answer_created",
                    answer_id=answer_id,
                    after_revision=1,
                    now=now,
                )
                self.repo.insert_event(
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
            elif apply.action == "update_answer":
                assert answer is not None
                choices = apply.choices
                choice_models = (
                    choices if choices is not None else self.repo.list_answer_choices(answer["id"])
                )
                self._validate_answer_value(answer["value_kind"], apply.value, choice_models)
                if choices is not None:
                    self._sync_choices(answer["id"], choices, now)
                self.repo.update_answer(
                    answer["id"],
                    expected_revision=answer["revision"],
                    label=apply.label or answer["label"],
                    description=(
                        apply.description
                        if "description" in apply.model_fields_set
                        else answer["description"]
                    ),
                    value_json=_json(apply.value),
                    status=answer["status"],
                    fill_policy=apply.fill_policy or answer["fill_policy"],
                    now=now,
                )
                answer = self._require_answer(answer["id"])
                self.repo.insert_event(
                    event_id=_new_id(),
                    event="answer_updated",
                    answer_id=answer["id"],
                    before_revision=apply.expected_answer_revision,
                    after_revision=answer["revision"],
                    reason=apply.reason,
                    now=now,
                )
            elif apply.action == "retarget_mapping":
                assert answer is not None and mapping is not None
                previous_answer_id = mapping["answer_id"]
                previous_revision = mapping["revision"]
                bindings = self._validate_bindings(question, answer, apply.bindings)
                self.repo.update_mapping(
                    mapping["id"],
                    answer_id=answer["id"],
                    status="active",
                    expected_revision=mapping["revision"],
                    now=now,
                )
                self.repo.replace_bindings(mapping["id"], bindings, now)
                mapping = self.repo.get_mapping(question.id)
                assert mapping is not None
                self.repo.insert_event(
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
            else:
                assert answer is not None and mapping is not None
                if mapping["id"] != apply.mapping_id or mapping["answer_id"] != answer["id"]:
                    raise ValidationError("mapping does not target the supplied answer")
                previous_revision = mapping["revision"]
                bindings = self._validate_bindings(question, answer, apply.bindings)
                self.repo.update_mapping(
                    mapping["id"],
                    answer_id=answer["id"],
                    status="active",
                    expected_revision=mapping["revision"],
                    now=now,
                )
                self.repo.replace_bindings(mapping["id"], bindings, now)
                mapping = self.repo.get_mapping(question.id)
                assert mapping is not None
                self.repo.insert_event(
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
            assert answer is not None and mapping is not None
            self.repo.transition_capture(
                capture_id,
                expected_revision=capture["revision"],
                status="applied",
                now=now,
                clear_value=True,
            )
            self.repo.insert_event(
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
        capture = self._require_capture(capture_id)
        answer = self._require_answer(answer["id"])
        mapping = self.repo.get_mapping(question.id)
        assert mapping is not None
        return CaptureApplyResponse(
            capture=self._capture_summary(capture),
            question=self._summary(self._require_question(question.id)),
            answer=self._answer_summary(answer),
            mapping=self._mapping_summary(mapping),
        )

    def resolve_capture_conflict(
        self, question_id: str, resolve: CaptureConflictResolve
    ) -> CaptureConflictResponse:
        question = self._require_question(question_id)
        current = self.repo.list_current_capture_records(question_id)
        current_by_id = {row["id"]: row for row in current}
        supplied = {item.capture_id: item.expected_revision for item in resolve.captures}
        stale = question.revision != resolve.expected_question_revision
        stale = stale or set(supplied) != set(current_by_id)
        stale = stale or any(
            current_by_id[item]["revision"] != rev for item, rev in supplied.items()
        )
        if stale:
            raise ConflictError(
                "stale_conflict_set",
                {
                    "question": self._summary(question).model_dump(),
                    "captures": [self._capture_summary(row).model_dump() for row in current],
                },
            )
        if len(current) < 2:
            raise ValidationError("capture conflict requires at least two current captures")
        now = utc_now()
        with _atomic(self.conn):
            for row in current:
                if row["id"] != resolve.winner_capture_id:
                    self.repo.transition_capture(
                        row["id"],
                        expected_revision=row["revision"],
                        status="superseded",
                        superseded_by_id=resolve.winner_capture_id,
                        now=now,
                        clear_value=True,
                    )
            self.repo.set_question_conflict(
                question_id, False, resolve.expected_question_revision, now
            )
            self.repo.insert_event(
                event_id=_new_id(),
                event="capture_conflict_resolved",
                question_id=question_id,
                capture_id=resolve.winner_capture_id,
                before_revision=question.revision,
                after_revision=question.revision + 1,
                reason=resolve.reason,
                now=now,
            )
        winner = self._require_capture(resolve.winner_capture_id)
        superseded = [
            CaptureSummary(**self._capture_summary(self._require_capture(row["id"])).model_dump())
            for row in current
            if row["id"] != resolve.winner_capture_id
        ]
        return CaptureConflictResponse(
            question=self._summary(self._require_question(question_id)),
            winner=self._capture_summary(winner),
            superseded=superseded,
        )

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
        return self._mapping_summary(row) if row else None

    def _mapping_summary(self, row: Row) -> MappingSummary:
        return MappingSummary(
            **row,
            bindings=[
                OptionBindingSummary(**binding) for binding in self.repo.list_bindings(row["id"])
            ],
        )

    @staticmethod
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

    def _capture_summary(self, row: Row) -> CaptureRecordSummary:
        return CaptureRecordSummary(
            id=row["id"],
            question_id=row["question_id"],
            application_context_id=row["application_context_id"],
            job_id=row["job_id"],
            listing_id=row["listing_id"],
            mapping_id=row["mapping_id"],
            answer_revision_used=row["answer_revision_used"],
            mapping_revision_used=row["mapping_revision_used"],
            source=row["source"],
            value_kind=row["value_kind"],
            value=_CAPTURE_VALUE.validate_json(row["value_json"]) if row["value_json"] else None,
            status=row["status"],
            revision=row["revision"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            resolved_at=row["resolved_at"],
        )

    def _require_question(self, question_id: str) -> Question:
        question = self.repo.get_question(question_id)
        if question is None:
            raise NotFoundError(f"question {question_id} not found")
        return question

    def _require_answer(self, answer_id: str) -> Row:
        answer = self.repo.get_answer(answer_id)
        if answer is None:
            raise NotFoundError(f"answer {answer_id} not found")
        return answer

    def _require_capture(self, capture_id: str) -> Row:
        capture = self.repo.get_capture(capture_id)
        if capture is None:
            raise NotFoundError(f"capture {capture_id} not found")
        return capture

    @staticmethod
    def _validate_answer_key(answer_key: str) -> None:
        if not _ANSWER_KEY.fullmatch(answer_key):
            raise ValidationError("answer_key must be a stable lowercase token")

    @staticmethod
    def _choice_shape(choices: list[Any]) -> list[tuple[str, str, str]]:
        def item(choice: Any) -> tuple[str, str, str]:
            if isinstance(choice, dict):
                return choice["choice_key"], choice["display_label"], choice["status"]
            return choice.choice_key, choice.display_label, choice.status

        return sorted(item(choice) for choice in choices)

    def _validate_answer_value(
        self, value_kind: str, value: AnswerValue, choices: list[Any]
    ) -> None:
        if value.kind != value_kind:
            raise ValidationError("value kind must match answer value_kind")
        choice_by_key = {
            (choice["choice_key"] if isinstance(choice, dict) else choice.choice_key): choice
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
        if value_kind in {"single_choice", "multi_choice"} and not choices:
            raise ValidationError("choice answers require a complete choice vocabulary")
        if not selected <= active:
            raise ValidationError("answer value must reference active answer choices")

    def _sync_choices(self, answer_id: str, choices: list[Any], now: str) -> None:
        existing = {row["choice_key"]: row for row in self.repo.list_answer_choices(answer_id)}
        requested = {
            (item["choice_key"] if isinstance(item, dict) else item.choice_key): item
            for item in choices
        }
        for key, row in existing.items():
            if key not in requested:
                if self.repo.choice_is_bound(row["id"]):
                    raise ValidationError("choice vocabulary would invalidate an active mapping")
                self.repo.delete_answer_choice(row["id"])
                continue
            item = requested[key]
            label = item["display_label"] if isinstance(item, dict) else item.display_label
            status = item["status"] if isinstance(item, dict) else item.status
            if status == "disabled" and self.repo.choice_is_bound(row["id"]):
                raise ValidationError("bound answer choices cannot be disabled")
            self.repo.update_answer_choice(row["id"], label, status, now)
        for key, item in requested.items():
            if key in existing:
                continue
            label = item["display_label"] if isinstance(item, dict) else item.display_label
            status = item["status"] if isinstance(item, dict) else item.status
            self.repo.insert_answer_choice(_new_id(), answer_id, key, label, status, now)

    def _validate_bindings(
        self, question: Question, answer: Row, bindings: list[OptionBindingInput]
    ) -> list[tuple[str, str]]:
        compatible = (
            question.control_kind in _SINGLE_CHOICE_CONTROLS
            and answer["value_kind"] == "single_choice"
        ) or (
            question.control_kind in _MULTI_CHOICE_CONTROLS
            and answer["value_kind"] == "multi_choice"
        )
        if question.control_kind not in _CHOICE_CONTROLS:
            if (
                bindings
                or self._scalar_action(
                    question.control_kind, _ANSWER_VALUE.validate_json(answer["value_json"])
                )
                is None
            ):
                raise ValidationError("answer and question types are incompatible")
            return []
        if not compatible:
            raise ValidationError("answer and question types are incompatible")
        question_options = {
            option.id: option
            for option in self.repo.list_options(question.id)
            if option.status == "active"
        }
        choices = {
            row["id"]: row
            for row in self.repo.list_answer_choices(answer["id"])
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

    def _consume_matching_current_capture(
        self, question: Question, answer: Row, mapping: Row, *, now: str, reason: str | None
    ) -> None:
        if question.capture_conflict:
            return
        current = self.repo.list_current_capture_records(question.id)
        if len(current) != 1 or current[0]["value_json"] is None:
            return
        capture = current[0]
        answer_value = _ANSWER_VALUE.validate_json(answer["value_json"])
        capture_value = _CAPTURE_VALUE.validate_json(capture["value_json"])
        option_pairs = [
            OptionIdentityPair(client_option_id=option.id, question_option_id=option.id)
            for option in self.repo.list_options(question.id)
            if option.status == "active"
        ]
        answer_action = self._answer_action(question, answer_value, mapping, option_pairs)
        capture_action = self._capture_action(question, capture_value, option_pairs)
        if answer_action is None or capture_action is None or answer_action != capture_action:
            return
        self.repo.transition_capture(
            capture["id"],
            expected_revision=capture["revision"],
            status="applied",
            now=now,
            clear_value=True,
        )
        self.repo.insert_event(
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

    def _check_mapping_revisions(
        self, question: Question, answer: Row, mapping: Row | None, put: MappingPut
    ) -> None:
        stale = question.revision != put.expected_question_revision
        stale = stale or answer["revision"] != put.expected_answer_revision
        stale = stale or (mapping is None and put.expected_mapping_revision is not None)
        stale = stale or (
            mapping is not None and mapping["revision"] != put.expected_mapping_revision
        )
        if stale:
            raise ConflictError(
                "stale_revision",
                self._conflict_current(question=question, answer=answer, mapping=mapping),
            )

    def _validate_capture_context(self, create: CaptureCreate, mapping: Row | None) -> None:
        if create.mapping_id is None:
            if mapping is not None and mapping["status"] in {"active", "disabled"}:
                raise ConflictError(
                    "stale_resolution_context", self._mapping_summary(mapping).model_dump()
                )
            return
        if mapping is None or mapping["id"] != create.mapping_id:
            raise ConflictError(
                "stale_resolution_context",
                self._mapping_summary(mapping).model_dump() if mapping else None,
            )
        answer = self._require_answer(mapping["answer_id"])
        if (
            mapping["revision"] != create.mapping_revision_used
            or answer["revision"] != create.answer_revision_used
        ):
            raise ConflictError(
                "stale_resolution_context", self._conflict_current(answer=answer, mapping=mapping)
            )

    def _same_capture_request(
        self, row: Row, create: CaptureCreate, listing: Any, value_json: str | None
    ) -> bool:
        expected_status = "superseded" if create.cleared else row["status"]
        return all(
            (
                row["question_id"] == create.question_id,
                row["application_context_id"] == create.application_context_id,
                row["source"] == create.source,
                row["mapping_id"] == create.mapping_id,
                row["answer_revision_used"] == create.answer_revision_used,
                row["mapping_revision_used"] == create.mapping_revision_used,
                row["job_id"] == (listing.job_id if listing else None),
                row["listing_id"] == (listing.id if listing else None),
                (
                    row["value_json"] == value_json
                    if not create.cleared
                    else expected_status == "superseded"
                ),
            )
        )

    def _validate_capture_value(self, question: Question, value: CaptureValue) -> None:
        if self._scalar_action(question.control_kind, value) is not None:
            return
        option_ids = {
            option.id for option in self.repo.list_options(question.id) if option.status == "active"
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
        self,
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
            expected_answer is not None
            and (answer is None or answer["revision"] != expected_answer)
        )
        if stale:
            raise ConflictError(
                "stale_revision",
                self._conflict_current(
                    capture=capture, question=question, answer=answer, mapping=mapping
                ),
            )
        if capture["status"] != "current" or capture["value_json"] is None:
            raise ConflictError(
                "capture_not_current",
                self._conflict_current(
                    capture=capture, question=question, answer=answer, mapping=mapping
                ),
            )
        if apply.action == "create_answer_and_map" and mapping is not None:
            if mapping["status"] != "retired":
                raise ConflictError(
                    "mapping_slot_occupied", self._mapping_summary(mapping).model_dump()
                )
            if apply.expected_mapping_revision != mapping["revision"]:
                raise ConflictError(
                    "stale_revision",
                    self._conflict_current(capture=capture, question=question, mapping=mapping),
                )
        if apply.action in {"retarget_mapping", "replace_option_bindings"} and mapping is None:
            raise NotFoundError(f"mapping for question {question.id} not found")
        if apply.action == "update_answer" and mapping is not None:
            if apply.expected_mapping_revision is None:
                raise ValidationError("mapped capture updates require the mapping revision")
            if mapping["answer_id"] != apply.answer_id:
                raise ValidationError("mapped capture can update only its mapped answer")

    def _conflict_current(
        self,
        *,
        capture: Row | None = None,
        question: Question | None = None,
        answer: Row | None = None,
        mapping: Row | None = None,
    ) -> dict[str, object | None]:
        return {
            "capture": self._capture_summary(capture).model_dump() if capture else None,
            "question": self._summary(question).model_dump() if question else None,
            "answer": self._answer_summary(answer).model_dump() if answer else None,
            "mapping": self._mapping_summary(mapping).model_dump() if mapping else None,
        }

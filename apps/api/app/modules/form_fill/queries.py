"""Form-fill queries."""

from __future__ import annotations

from dataclasses import dataclass

from app.infra.database import Row
from app.modules.form_fill.actions import _scalar_action
from app.modules.form_fill.candidates import compatible_options, relevance, value_preview
from app.modules.form_fill.identity import normalize_evidence, normalize_token
from app.modules.form_fill.pagination import (
    _cursor_payload,
    _decode_cursor,
    _decode_time_cursor,
    _encode_cursor,
    _filter_fingerprint,
)
from app.modules.form_fill.projections import (
    _capture_record_detail,
    _capture_summary,
    _mapping,
    _require_answer,
    _require_capture,
    _require_question,
    _summary,
)
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    AnswerCandidate,
    AnswerCandidateResponse,
    AnswerChoiceSummary,
    AnswerDetail,
    AnswerListItem,
    AnswerListResponse,
    AnswerMultiChoiceValue,
    AnswerSingleChoiceValue,
    AnswerSort,
    AnswerSummary,
    CaptureDetail,
    CaptureListResponse,
    CaptureSummary,
    KnowledgeEventSummary,
    MappedQuestionSummary,
    QuestionDetail,
    QuestionListResponse,
    QuestionOptionSummary,
)
from app.modules.form_fill.values import (
    _ANSWER_VALUE,
    _CHOICE_CONTROLS,
    QuestionMappingFilter,
    QuestionSort,
)
from app.shared.errors import InvalidCursorError, ValidationError


@dataclass(frozen=True)
class RankedCandidate:
    priority: int
    normalized_label: str
    candidate: AnswerCandidate

    @property
    def sort_key(self) -> tuple[int, str, str]:
        return self.priority, self.normalized_label, self.candidate.id


def list_questions(
    repo: FormFillRepository,
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
    review_inbox: bool | None = None,
    include_matched: bool = False,
    include_dismissed: bool = False,
) -> QuestionListResponse:
    if (include_matched or include_dismissed) and review_inbox is not True:
        raise ValidationError("include filters require review_inbox=true")

    canonical_scope = normalize_token(site_scope) if site_scope is not None else None
    canonical_query = normalize_evidence(query) if query is not None else None
    filters = {
        "review_state": review_state,
        "mapping_status": mapping_status,
        "needs_review": needs_review,
        "review_inbox": review_inbox,
        "include_matched": include_matched,
        "include_dismissed": include_dismissed,
        "has_current_capture": has_current_capture,
        "site_scope": canonical_scope,
        "answer_id": answer_id,
        "query": canonical_query,
    }
    fingerprint = _filter_fingerprint(filters)
    cursor_values = _decode_cursor(cursor, fingerprint, sort) if cursor else None
    page = repo.list_questions(
        review_state=review_state,
        mapping_status=mapping_status,
        needs_review=needs_review,
        review_inbox=review_inbox,
        include_matched=include_matched,
        include_dismissed=include_dismissed,
        has_current_capture=has_current_capture,
        site_scope=canonical_scope,
        answer_id=answer_id,
        query=canonical_query,
        sort=sort,
        limit=limit,
        cursor_values=cursor_values,
    )
    items = [_summary(repo, question) for question in page.items]
    next_cursor = None
    if page.has_more and page.items:
        last = page.items[-1]
        value: object
        if sort == "prompt":
            value = last.normalized_question
        elif sort == "last_seen":
            value = last.last_seen_at
        else:
            value = last.seen_count

        next_cursor = _encode_cursor(
            {"filters": fingerprint, "sort": sort, "value": value, "id": last.id}
        )

    return QuestionListResponse(items=items, next_cursor=next_cursor)


def get_question(repo: FormFillRepository, question_id: str) -> QuestionDetail:
    question = _require_question(repo, question_id)
    mapping = _mapping(repo, question.id)
    answer = (
        AnswerSummary(**row)
        if mapping and (row := repo.get_answer_summary(mapping.answer_id))
        else None
    )

    return QuestionDetail(
        **_summary(repo, question, mapping=mapping).model_dump(),
        signature=question.signature,
        identity_kind=question.identity_kind,
        adapter_id=question.adapter_id,
        adapter_version=question.adapter_version,
        stable_field_key=question.stable_field_key or None,
        normalizer_version=question.normalizer_version,
        normalized_question=question.normalized_question,
        normalized_section=question.normalized_section,
        normalized_help=question.normalized_help,
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
            for option in repo.list_options(question.id)
        ],
        answer=answer,
        current_captures=[CaptureSummary(**row) for row in repo.list_current_captures(question.id)],
        events=[KnowledgeEventSummary(**row) for row in repo.list_question_events(question.id)],
    )


def list_answers(
    repo: FormFillRepository,
    *,
    status: str | None,
    value_kind: str | None,
    query: str | None,
    limit: int,
    cursor: str | None,
    sort: AnswerSort = "updated_at",
) -> AnswerListResponse:
    canonical_query = normalize_evidence(query) if query is not None else None
    filters = {"status": status, "value_kind": value_kind, "query": canonical_query}
    fingerprint = _filter_fingerprint(filters)
    cursor_values = _decode_cursor(cursor, fingerprint, sort) if cursor else None
    rows, has_more = repo.list_answers(
        status=status,
        value_kind=value_kind,
        query=canonical_query,
        limit=limit,
        cursor_values=cursor_values,
        sort=sort,
    )
    items = [AnswerListItem(**row) for row in rows]
    next_cursor = None
    if has_more and rows:
        next_cursor = _encode_cursor(
            {
                "filters": fingerprint,
                "sort": sort,
                "value": rows[-1]["sort_value"],
                "id": rows[-1]["id"],
            }
        )

    return AnswerListResponse(items=items, next_cursor=next_cursor)


def list_answer_candidates(
    repo: FormFillRepository, question_id: str, *, query: str | None, limit: int, cursor: str | None
) -> AnswerCandidateResponse:
    question = _require_question(repo, question_id)
    kinds = {
        "text": ("text", "long_text"),
        "textarea": ("text", "long_text"),
        "integer": ("decimal",),
        "decimal": ("decimal",),
        "date": ("date",),
        "checkbox_boolean": ("boolean",),
        "select": ("single_choice",),
        "radio": ("single_choice",),
        "checkbox_group": ("multi_choice",),
        "multi_select": ("multi_choice",),
    }[question.control_kind]
    options = [o for o in repo.list_options(question_id) if o.status == "active"]
    choice_question = question.control_kind in _CHOICE_CONTROLS
    canonical_query = normalize_evidence(query) or None
    answers = repo.candidate_answers(
        kinds, len(options) if choice_question else None, canonical_query
    )
    choices_by_answer: dict[str, list[Row]] = {}
    if choice_question:
        for choice in repo.candidate_choices(kinds):
            choices_by_answer.setdefault(choice["answer_id"], []).append(choice)

    mappings_by_answer: dict[str, list[Row]] = {}
    for mapping in repo.candidate_mappings(kinds):
        mappings_by_answer.setdefault(mapping["answer_id"], []).append(mapping)

    ranked: list[RankedCandidate] = []
    for answer in answers:
        value = _ANSWER_VALUE.validate_json(answer["value_json"])
        choices = choices_by_answer.get(answer["id"], [])
        mappings = mappings_by_answer.get(answer["id"], [])
        if not choice_question and _scalar_action(question.control_kind, value) is None:
            continue

        if choice_question:
            available_keys = {choice["choice_key"] for choice in choices}
            selected_keys: set[str] = set()
            if isinstance(value, AnswerSingleChoiceValue):
                selected_keys = {value.choice_key}
            elif isinstance(value, AnswerMultiChoiceValue):
                selected_keys = set(value.choice_keys)

            if not selected_keys <= available_keys:
                continue

            if not canonical_query and (
                not compatible_options(question, options, choices, mappings)
            ):
                continue

        score = relevance(question, answer, mappings)
        if not canonical_query and score == 0:
            continue

        candidate = AnswerCandidate(
            id=answer["id"],
            label=answer["label"],
            revision=answer["revision"],
            value_preview=value_preview(value, choices),
        )
        ranked.append(RankedCandidate(-score, normalize_evidence(candidate.label), candidate))

    ranked.sort(key=lambda item: item.sort_key)
    fingerprint = _filter_fingerprint(
        {
            "question": question_id,
            "revision": question.revision,
            "query": canonical_query,
            "candidates": [
                (item.candidate.id, item.candidate.revision, item.priority) for item in ranked
            ],
        }
    )
    offset = 0
    if cursor:
        payload = _cursor_payload(cursor)
        offset_value = payload.get("offset")
        if (
            payload.get("filters") != fingerprint
            or type(offset_value) is not int
            or offset_value < 0
            or (offset_value > len(ranked))
        ):
            raise InvalidCursorError

        offset = offset_value

    next_offset = offset + limit

    return AnswerCandidateResponse(
        items=[item.candidate for item in ranked[offset:next_offset]],
        next_cursor=_encode_cursor({"filters": fingerprint, "offset": next_offset})
        if next_offset < len(ranked)
        else None,
    )


def get_answer(repo: FormFillRepository, answer_id: str) -> AnswerDetail:
    row = _require_answer(repo, answer_id)
    mappings: list[MappedQuestionSummary] = []
    for mapping_row in repo.list_answer_mappings(answer_id):
        question = _require_question(repo, mapping_row["id"])
        mapping = _mapping(repo, question.id)
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
        choices=[AnswerChoiceSummary(**choice) for choice in repo.list_answer_choices(answer_id)],
        mappings=mappings,
        events=[KnowledgeEventSummary(**event) for event in repo.list_answer_events(answer_id)],
        verified_at=row["verified_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_captures(
    repo: FormFillRepository,
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
    rows, has_more = repo.list_capture_rows(
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
        items=[_capture_summary(repo, row) for row in rows], next_cursor=next_cursor
    )


def get_capture(repo: FormFillRepository, capture_id: str) -> CaptureDetail:
    row = _require_capture(repo, capture_id)
    question = _require_question(repo, row["question_id"])
    mapping = _mapping(repo, question.id)
    answer = None
    if mapping and (answer_row := repo.get_answer_summary(mapping.answer_id)):
        answer = AnswerSummary(**answer_row)

    return CaptureDetail(
        **_capture_record_detail(repo, row).model_dump(),
        question=_summary(repo, question),
        answer=answer,
        mapping=mapping,
        events=[KnowledgeEventSummary(**event) for event in repo.list_capture_events(capture_id)],
    )

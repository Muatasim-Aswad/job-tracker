"""Connection-bound public API; focused modules own the use cases."""

from __future__ import annotations

from app.infra.database import Conn
from app.modules.form_fill import answers, capture_apply, captures, mappings, queries, resolution
from app.modules.form_fill.repository import FormFillRepository
from app.modules.form_fill.schemas import (
    AnswerCandidateResponse,
    AnswerCreate,
    AnswerDetail,
    AnswerListResponse,
    AnswerSort,
    AnswerUpdate,
    CaptureApply,
    CaptureApplyResponse,
    CaptureConflictResolve,
    CaptureConflictResponse,
    CaptureCreate,
    CaptureCreateResponse,
    CaptureDetail,
    CaptureListResponse,
    CaptureUpdate,
    MappingPut,
    MappingUpdate,
    QuestionAnswerCreate,
    QuestionDetail,
    QuestionListResponse,
    QuestionReviewUpdate,
    ResolutionRequest,
    ResolutionResponse,
)
from app.modules.form_fill.values import QuestionMappingFilter, QuestionSort


class FormFillService:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn
        self.repo = FormFillRepository(conn)

    def resolve(self, request: ResolutionRequest) -> ResolutionResponse:
        return resolution.resolve(self.repo, request)

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
        review_inbox: bool | None = None,
        include_matched: bool = False,
        include_dismissed: bool = False,
    ) -> QuestionListResponse:
        return queries.list_questions(
            self.repo,
            review_state=review_state,
            mapping_status=mapping_status,
            needs_review=needs_review,
            has_current_capture=has_current_capture,
            site_scope=site_scope,
            answer_id=answer_id,
            query=query,
            sort=sort,
            limit=limit,
            cursor=cursor,
            review_inbox=review_inbox,
            include_matched=include_matched,
            include_dismissed=include_dismissed,
        )

    def get_question(self, question_id: str) -> QuestionDetail:
        return queries.get_question(self.repo, question_id)

    def update_question(self, question_id: str, update: QuestionReviewUpdate) -> QuestionDetail:
        return mappings.update_question(self.repo, question_id, update)

    def list_answers(
        self,
        *,
        status: str | None,
        value_kind: str | None,
        query: str | None,
        limit: int,
        cursor: str | None,
        sort: AnswerSort = "updated_at",
    ) -> AnswerListResponse:
        return queries.list_answers(
            self.repo,
            status=status,
            value_kind=value_kind,
            query=query,
            limit=limit,
            cursor=cursor,
            sort=sort,
        )

    def list_answer_candidates(
        self, question_id: str, *, query: str | None, limit: int, cursor: str | None
    ) -> AnswerCandidateResponse:
        return queries.list_answer_candidates(
            self.repo, question_id, query=query, limit=limit, cursor=cursor
        )

    def create_answer(self, create: AnswerCreate) -> AnswerDetail:
        return answers.create_answer(self.repo, create)

    def get_answer(self, answer_id: str) -> AnswerDetail:
        return queries.get_answer(self.repo, answer_id)

    def update_answer(self, answer_id: str, update: AnswerUpdate) -> AnswerDetail:
        return answers.update_answer(self.repo, answer_id, update)

    def delete_answer(self, answer_id: str, expected_revision: int) -> None:
        return answers.delete_answer(self.repo, answer_id, expected_revision)

    def put_mapping(self, question_id: str, put: MappingPut) -> QuestionDetail:
        return mappings.put_mapping(self.repo, question_id, put)

    def create_answer_for_question(
        self, question_id: str, create: QuestionAnswerCreate
    ) -> QuestionDetail:
        return mappings.create_answer_for_question(self.repo, question_id, create)

    def update_mapping(self, question_id: str, update: MappingUpdate) -> QuestionDetail:
        return mappings.update_mapping(self.repo, question_id, update)

    def create_capture(self, create: CaptureCreate) -> CaptureCreateResponse:
        return captures.create_capture(self.repo, create)

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
        return queries.list_captures(
            self.repo,
            status=status,
            source=source,
            question_id=question_id,
            query=query,
            limit=limit,
            cursor=cursor,
        )

    def get_capture(self, capture_id: str) -> CaptureDetail:
        return queries.get_capture(self.repo, capture_id)

    def update_capture(self, capture_id: str, update: CaptureUpdate) -> CaptureDetail:
        return captures.update_capture(self.repo, capture_id, update)

    def apply_capture(self, capture_id: str, apply: CaptureApply) -> CaptureApplyResponse:
        return capture_apply.apply_capture(self.repo, capture_id, apply)

    def resolve_capture_conflict(
        self, question_id: str, resolve: CaptureConflictResolve
    ) -> CaptureConflictResponse:
        return captures.resolve_capture_conflict(self.repo, question_id, resolve)

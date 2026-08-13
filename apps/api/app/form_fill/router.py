from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.core.deps import service_factory
from app.form_fill.schemas import (
    QuestionDetail,
    QuestionListResponse,
    QuestionReviewUpdate,
    ResolutionRequest,
    ResolutionResponse,
)
from app.form_fill.service import FormFillService

router = APIRouter(prefix="/form-fill", tags=["form-fill"])
get_service = service_factory(FormFillService)


@router.post("/resolutions", response_model=ResolutionResponse)
def resolve_questions(
    body: ResolutionRequest, response: Response, service: FormFillService = Depends(get_service)
) -> ResolutionResponse:
    response.headers["Cache-Control"] = "no-store"
    return service.resolve(body)


@router.get("/questions", response_model=QuestionListResponse)
def list_questions(
    response: Response,
    review_state: Annotated[Literal["open", "ignored"] | None, Query()] = None,
    mapping_status: Annotated[
        Literal["active", "disabled", "retired", "none"] | None, Query()
    ] = None,
    has_current_capture: Annotated[bool | None, Query()] = None,
    site_scope: Annotated[str | None, Query(min_length=1, max_length=253)] = None,
    answer_id: Annotated[str | None, Query(min_length=1, max_length=128)] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=256)] = None,
    sort: Annotated[Literal["last_seen", "seen_count"], Query()] = "last_seen",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(min_length=1, max_length=2048)] = None,
    service: FormFillService = Depends(get_service),
) -> QuestionListResponse:
    response.headers["Cache-Control"] = "no-store"
    return service.list_questions(
        review_state=review_state,
        mapping_status=mapping_status,
        has_current_capture=has_current_capture,
        site_scope=site_scope,
        answer_id=answer_id,
        query=q,
        sort=sort,
        limit=limit,
        cursor=cursor,
    )


@router.get("/questions/{question_id}", response_model=QuestionDetail)
def get_question(
    question_id: str, response: Response, service: FormFillService = Depends(get_service)
) -> QuestionDetail:
    response.headers["Cache-Control"] = "no-store"
    return service.get_question(question_id)


@router.patch("/questions/{question_id}", response_model=QuestionDetail)
def update_question(
    question_id: str,
    body: QuestionReviewUpdate,
    response: Response,
    service: FormFillService = Depends(get_service),
) -> QuestionDetail:
    response.headers["Cache-Control"] = "no-store"
    return service.update_question(question_id, body)

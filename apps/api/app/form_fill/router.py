from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.core.deps import service_factory
from app.form_fill.schemas import (
    AnswerCreate,
    AnswerDetail,
    AnswerListResponse,
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
    QuestionDetail,
    QuestionListResponse,
    QuestionReviewUpdate,
    ResolutionRequest,
    ResolutionResponse,
)
from app.form_fill.service import FormFillService

router = APIRouter(prefix="/form-fill", tags=["form-fill"])
get_service = service_factory(FormFillService)


def _private(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


@router.post("/resolutions", response_model=ResolutionResponse)
def resolve_questions(
    body: ResolutionRequest, response: Response, service: FormFillService = Depends(get_service)
) -> ResolutionResponse:
    _private(response)
    return service.resolve(body)


@router.get("/answers", response_model=AnswerListResponse)
def list_answers(
    response: Response,
    status: Annotated[Literal["active", "disabled"] | None, Query()] = None,
    value_kind: Annotated[
        Literal["text", "long_text", "decimal", "boolean", "date", "single_choice", "multi_choice"]
        | None,
        Query(),
    ] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=256)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(min_length=1, max_length=2048)] = None,
    service: FormFillService = Depends(get_service),
) -> AnswerListResponse:
    _private(response)
    return service.list_answers(
        status=status, value_kind=value_kind, query=q, limit=limit, cursor=cursor
    )


@router.post("/answers", response_model=AnswerDetail)
def create_answer(
    body: AnswerCreate, response: Response, service: FormFillService = Depends(get_service)
) -> AnswerDetail:
    _private(response)
    return service.create_answer(body)


@router.get("/answers/{answer_id}", response_model=AnswerDetail)
def get_answer(
    answer_id: str, response: Response, service: FormFillService = Depends(get_service)
) -> AnswerDetail:
    _private(response)
    return service.get_answer(answer_id)


@router.patch("/answers/{answer_id}", response_model=AnswerDetail)
def update_answer(
    answer_id: str,
    body: AnswerUpdate,
    response: Response,
    service: FormFillService = Depends(get_service),
) -> AnswerDetail:
    _private(response)
    return service.update_answer(answer_id, body)


@router.post("/captures", response_model=CaptureCreateResponse)
def create_capture(
    body: CaptureCreate, response: Response, service: FormFillService = Depends(get_service)
) -> CaptureCreateResponse:
    _private(response)
    return service.create_capture(body)


@router.get("/captures", response_model=CaptureListResponse)
def list_captures(
    response: Response,
    status: Annotated[
        Literal["current", "superseded", "applied", "ignored"] | None, Query()
    ] = "current",
    source: Annotated[
        Literal["user_input", "confirmed_external", "unattributed_change"] | None, Query()
    ] = None,
    question_id: Annotated[str | None, Query(min_length=1, max_length=128)] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=256)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(min_length=1, max_length=2048)] = None,
    service: FormFillService = Depends(get_service),
) -> CaptureListResponse:
    _private(response)
    return service.list_captures(
        status=status, source=source, question_id=question_id, query=q, limit=limit, cursor=cursor
    )


@router.get("/captures/{capture_id}", response_model=CaptureDetail)
def get_capture(
    capture_id: str, response: Response, service: FormFillService = Depends(get_service)
) -> CaptureDetail:
    _private(response)
    return service.get_capture(capture_id)


@router.patch("/captures/{capture_id}", response_model=CaptureDetail)
def update_capture(
    capture_id: str,
    body: CaptureUpdate,
    response: Response,
    service: FormFillService = Depends(get_service),
) -> CaptureDetail:
    _private(response)
    return service.update_capture(capture_id, body)


@router.post("/captures/{capture_id}/apply", response_model=CaptureApplyResponse)
def apply_capture(
    capture_id: str,
    body: CaptureApply,
    response: Response,
    service: FormFillService = Depends(get_service),
) -> CaptureApplyResponse:
    _private(response)
    return service.apply_capture(capture_id, body)


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
    _private(response)
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
    _private(response)
    return service.get_question(question_id)


@router.patch("/questions/{question_id}", response_model=QuestionDetail)
def update_question(
    question_id: str,
    body: QuestionReviewUpdate,
    response: Response,
    service: FormFillService = Depends(get_service),
) -> QuestionDetail:
    _private(response)
    return service.update_question(question_id, body)


@router.put("/questions/{question_id}/mapping", response_model=QuestionDetail)
def put_mapping(
    question_id: str,
    body: MappingPut,
    response: Response,
    service: FormFillService = Depends(get_service),
) -> QuestionDetail:
    _private(response)
    return service.put_mapping(question_id, body)


@router.patch("/questions/{question_id}/mapping", response_model=QuestionDetail)
def update_mapping(
    question_id: str,
    body: MappingUpdate,
    response: Response,
    service: FormFillService = Depends(get_service),
) -> QuestionDetail:
    _private(response)
    return service.update_mapping(question_id, body)


@router.post(
    "/questions/{question_id}/capture-conflicts/resolve", response_model=CaptureConflictResponse
)
def resolve_capture_conflict(
    question_id: str,
    body: CaptureConflictResolve,
    response: Response,
    service: FormFillService = Depends(get_service),
) -> CaptureConflictResponse:
    _private(response)
    return service.resolve_capture_conflict(question_id, body)

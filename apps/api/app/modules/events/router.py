from fastapi import APIRouter, Query, Response

from app.modules.events.models import Event
from app.modules.events.schemas import (
    CorrectionCreate,
    EventCreate,
    EventOperation,
    EventUpdate,
    StatusPrecondition,
)
from app.modules.job_activity.dependencies import ServiceDep
from app.modules.jobs.schemas import JobMutationState

router = APIRouter(tags=["events"])


@router.get("/event-operations", response_model=EventOperation)
def get_event_operation(
    *, operation_key: str = Query(min_length=1, max_length=200, pattern=r"\S"), service: ServiceDep
) -> EventOperation:
    """Return the original committed result, including completed no-op batches."""
    return service.operation(operation_key)


@router.post("/events", response_model=JobMutationState)
def create_event(*, body: EventCreate, response: Response, service: ServiceDep) -> JobMutationState:
    """Submit a state change (status transition or hide/star flag) addressed by
    `(platform, platform_id)` or `job_id`; returns the resulting job state."""
    state = service.record(body)
    response.headers["Content-Location"] = f"/api/jobs/{state.job_id}"
    return state


@router.patch("/events/{event_id}", response_model=Event)
def edit_event(*, event_id: int, body: EventUpdate, service: ServiceDep) -> Event:
    """Update an event's metadata and/or timestamp without changing its verb."""
    return service.edit(event_id, body.meta, set_meta="meta" in body.model_fields_set, ts=body.ts)


@router.delete("/events/{event_id}", status_code=204)
def delete_note_event(*, event_id: int, service: ServiceDep) -> Response:
    """Delete a note; state-changing events require correction or revert."""
    service.delete_note(event_id)
    return Response(status_code=204)


@router.post("/jobs/{job_id}/corrections", response_model=JobMutationState)
def correct_status(
    *, job_id: str, body: CorrectionCreate, response: Response, service: ServiceDep
) -> JobMutationState:
    """Set any status and record the deliberate correction."""
    state = service.correct(job_id, body.status, body.reason, body.expected_status)
    response.headers["Content-Location"] = f"/api/jobs/{state.job_id}"
    return state


@router.post("/jobs/{job_id}/status/revert", response_model=JobMutationState)
def revert_status(
    *, job_id: str, response: Response, body: StatusPrecondition | None = None, service: ServiceDep
) -> JobMutationState:
    """Remove the latest status-setting event and reproject the prior state."""
    state = service.revert_last_status(job_id, body.expected_status if body else None)
    response.headers["Content-Location"] = f"/api/jobs/{state.job_id}"
    return state

from fastapi import APIRouter, Depends, Response

from app.core.deps import service_factory
from app.events.models import Event
from app.events.schemas import CorrectionCreate, EventCreate, EventUpdate
from app.events.service import EventService
from app.jobs.schemas import JobMutationState

router = APIRouter(tags=["events"])

get_service = service_factory(EventService)


@router.post("/events", response_model=JobMutationState)
def create_event(
    body: EventCreate, response: Response, service: EventService = Depends(get_service)
) -> JobMutationState:
    """Submit a state change (status transition or hide/star flag) addressed by
    `(platform, platform_id)` or `job_id`; returns the resulting job state."""
    state = service.record(body)
    response.headers["Content-Location"] = f"/api/jobs/{state.job_id}"
    return state


@router.patch("/events/{event_id}", response_model=Event)
def edit_event(
    event_id: int, body: EventUpdate, service: EventService = Depends(get_service)
) -> Event:
    """Update an event's metadata and/or timestamp without changing its verb."""
    return service.edit(event_id, body.meta, set_meta="meta" in body.model_fields_set, ts=body.ts)


@router.delete("/events/{event_id}", status_code=204)
def delete_note_event(event_id: int, service: EventService = Depends(get_service)) -> Response:
    """Delete a note; state-changing events require correction or revert."""
    service.delete_note(event_id)
    return Response(status_code=204)


@router.post("/jobs/{job_id}/corrections", response_model=JobMutationState)
def correct_status(
    job_id: str,
    body: CorrectionCreate,
    response: Response,
    service: EventService = Depends(get_service),
) -> JobMutationState:
    """Set any status and record the deliberate correction."""
    state = service.correct(job_id, body.status, body.reason)
    response.headers["Content-Location"] = f"/api/jobs/{state.job_id}"
    return state


@router.post("/jobs/{job_id}/status/revert", response_model=JobMutationState)
def revert_status(
    job_id: str, response: Response, service: EventService = Depends(get_service)
) -> JobMutationState:
    """Remove the latest status-setting event and reproject the prior state."""
    state = service.revert_last_status(job_id)
    response.headers["Content-Location"] = f"/api/jobs/{state.job_id}"
    return state

from typing import Annotated, Any

from pydantic import BaseModel, StringConstraints, model_validator

from app.core.enums import Event as EventType
from app.core.enums import Status
from app.jobs.schemas import JobMutationState


class EventItem(BaseModel):
    """One event verb and its optional metadata."""

    event: EventType
    meta: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _reject_created(self) -> EventItem:
        if self.event == EventType.CREATED:
            raise ValueError("`created` is server-generated, not client-submittable")
        return self


class EventCreate(BaseModel):
    """Ordered events addressed by one listing natural key or one job id."""

    events: list[EventItem]
    operation_key: (
        Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r"\S")] | None
    ) = None
    platform: str | None = None
    platform_id: str | None = None
    job_id: str | None = None
    ts: str | None = None  # defaults to now (UTC) server-side; shared by all events
    expected_status: Status | None = None

    @model_validator(mode="after")
    def _check_addressing(self) -> EventCreate:
        by_listing = self.platform is not None and self.platform_id is not None
        by_job = self.job_id is not None
        if by_listing == by_job:
            raise ValueError("address by (platform, platform_id) or job_id — exactly one")
        if not self.events:
            raise ValueError("events must be non-empty")
        return self


class EventOperation(BaseModel):
    operation_key: str
    result: JobMutationState
    created_at: str


class EventUpdate(BaseModel):
    """Optional metadata and timestamp changes for an existing event.

    Metadata replaces the complete bag. The event verb is immutable.
    """

    meta: dict[str, Any] | None = None
    ts: str | None = None


class StatusPrecondition(BaseModel):
    expected_status: Status | None = None


class CorrectionCreate(StatusPrecondition):
    """A deliberate status override, logged as `corrected:<status>`."""

    status: Status
    reason: str | None = None

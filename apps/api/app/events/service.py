"""The single state-write path. Every submission updates the projected
state (`jobs.status`/`hidden`/`starred`) and *conditionally* logs an event row:

- funnel status change → always logged on a real transition (meta enriches);
- flag (hide/star) → logged only when it carries novel meta;
- anything that neither changes state nor adds novel info → a no-op.

Funnel events move forward for dashboard and automatic submissions alike:
`seen` is monotonic, terminal outcomes cannot be revived, and active stages
cannot move backward. Correction and revert are the explicit override paths.
Listing-addressed submissions also create a stub on first contact.
"""

from app.core.db import Conn
from app.core.enums import Event as EventType
from app.core.enums import (
    Status,
    correction_event,
    flag_for_event,
    status_for_event,
    status_set_by,
    target_status,
)
from app.core.errors import NotFoundError, ValidationError
from app.core.hashing import stable_hash
from app.core.timeutil import utc_now
from app.events.automation import is_automatic_close, is_effective_status_event
from app.events.models import Event
from app.events.projection import reproject_status
from app.events.repository import EventRepository
from app.events.schemas import EventCreate
from app.jobs.models import Job
from app.jobs.repository import JobRepository
from app.jobs.schemas import JobMutationState
from app.listings.service import ListingService


class EventService:
    def __init__(self, conn: Conn) -> None:
        self.events = EventRepository(conn)
        self.jobs = JobRepository(conn)
        self.listings = ListingService(conn)

    def record(self, data: EventCreate) -> JobMutationState:
        # Resolve the address, and any stub it materializes, once; every event in the
        # submission then applies against that same job/listing, in order.
        job_id, listing_id = self._resolve_target(data)
        ts = data.ts or utc_now()

        for item in data.events:
            job = self.jobs.get(job_id)  # re-read: a prior event may have moved state
            assert job is not None
            if status_for_event(str(item.event)) is not None:
                self._apply_funnel(job, str(item.event), ts, listing_id, item.meta)
            elif flag_for_event(str(item.event)) is not None:
                self._apply_flag(job, str(item.event), ts, listing_id, item.meta)
            elif str(item.event) == EventType.NOTE.value:
                self._apply_note(job, ts, listing_id, item.meta)

        refreshed = self.jobs.get(job_id)
        assert refreshed is not None
        return JobMutationState(
            job_id=refreshed.id,
            status=refreshed.status,
            hidden=refreshed.hidden,
            starred=refreshed.starred,
        )

    # --- dashboard corrections --------------------------------------------

    def correct(self, job_id: str, status: Status, reason: str | None) -> JobMutationState:
        """Force a job to `status`, bypassing every funnel guard, and log a
        `corrected:<status>` row marking the override deliberate and carrying the
        optional `reason`. Correcting to the status the job already holds is a
        no-op and logs nothing."""
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        job = self.jobs.get(job_id) if job_id else None
        if job is None:
            raise NotFoundError(f"job {requested_job_id} not found")
        self.listings.automatic_closure.invalidate(job_id, "manual_correction")
        job = self.jobs.get(job_id)
        assert job is not None
        if status.value == job.status:
            return self._state(job_id)
        ts = utc_now()
        meta: dict[str, object] | None = {"reason": reason} if reason else None
        self.events.insert(
            job_id,
            correction_event(status),
            ts,
            listing_id=None,
            meta=meta,
            meta_hash=stable_hash(meta),
        )
        # A current timestamp makes this correction the latest projection input.
        self._reproject_status(job_id)
        return self._state(job_id)

    def revert_last_status(self, job_id: str) -> JobMutationState:
        """Remove the latest status-setting event and reproject the prior state.

        Flags and the server-generated `created` event are never affected.
        """
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        job = self.jobs.get(job_id) if job_id else None
        if job is None:
            raise NotFoundError(f"job {requested_job_id} not found")
        status_events = [
            e
            for e in self.events.list_for_job(job_id)
            if status_set_by(e.event) and is_effective_status_event(e)
        ]
        if not status_events:
            return self._state(job_id)
        latest = status_events[-1]
        if is_automatic_close(latest):
            self.listings.automatic_closure.invalidate(job_id, "manual_revert")
            return self._state(job_id)
        self.events.delete_by_id(latest.id)
        self._reproject_status(job_id)
        return self._state(job_id)

    def delete_note(self, event_id: int) -> None:
        """Delete a note; state-changing events must use correction or revert."""
        event = self.events.get(event_id)
        if event is None:
            raise NotFoundError(f"event {event_id} not found")
        if event.event != EventType.NOTE.value:
            raise ValidationError("only note events can be deleted")
        self.events.delete_by_id(event_id)

    def edit(
        self,
        event_id: int,
        meta: dict[str, object] | None,
        *,
        set_meta: bool = True,
        ts: str | None = None,
    ) -> Event:
        """Update event metadata and/or timestamp without changing its verb.

        Moving a status-setting event can change projection order, so timestamp
        edits reproject that job's status.
        """
        event = self.events.get(event_id)
        if event is None:
            raise NotFoundError(f"event {event_id} not found")
        if set_meta:
            self.events.update_meta(event_id, meta, stable_hash(meta))
            if status_set_by(event.event) is not None:
                self._reproject_status(event.job_id)
        if ts is not None:
            self.events.set_ts(event_id, ts)
            if status_set_by(event.event) is not None:
                self._reproject_status(event.job_id)
        refreshed = self.events.get(event_id)
        assert refreshed is not None
        return refreshed

    def _reproject_status(self, job_id: str) -> None:
        """Project status from the latest `(ts, id)` status-setting event."""
        reproject_status(job_id, self.events, self.jobs)

    def _state(self, job_id: str) -> JobMutationState:
        job = self.jobs.get(job_id)
        assert job is not None
        return JobMutationState(
            job_id=job.id, status=job.status, hidden=job.hidden, starred=job.starred
        )

    # --- target resolution ------------------------------------------------

    def _resolve_target(self, data: EventCreate) -> tuple[str, str | None]:
        """Return (job_id, listing_id). A listing-addressed submission stubs a job on
        first contact, firing `created`; a job-addressed one must already exist."""
        if data.job_id is not None:
            canonical_job_id = self.jobs.resolve_id(data.job_id)
            if canonical_job_id is None:
                raise NotFoundError(f"job {data.job_id} not found")
            return canonical_job_id, None
        assert data.platform is not None and data.platform_id is not None
        # `via` records the verb that first materialized the stub — the first event.
        via = str(data.events[0].event)
        return self.listings.ensure_listing(data.platform, data.platform_id, via=via)

    # --- the two branches -------------------------------------------------

    def _apply_funnel(
        self, job: Job, event: str, ts: str, listing_id: str | None, meta: dict[str, object] | None
    ) -> None:
        target = target_status(event, job.status)
        if target is None or target == job.status:
            return  # guard blocked it, or already there → no-op, no log
        # Log the accepted transition, then reproject: a backdated terminal still gets
        # recorded for the audit trail, but a newer-ts event keeps the projected status.
        self.events.insert(
            job.id, event, ts, listing_id=listing_id, meta=meta, meta_hash=stable_hash(meta)
        )
        self._reproject_status(job.id)

    def _apply_note(
        self, job: Job, ts: str, listing_id: str | None, meta: dict[str, object] | None
    ) -> None:
        """Log a manual note. Sets no status and no flag — it's pure history — so
        it's always logged (no novelty gate) and never affects projected state."""
        self.events.insert(
            job.id,
            EventType.NOTE.value,
            ts,
            listing_id=listing_id,
            meta=meta,
            meta_hash=stable_hash(meta),
        )

    def _apply_flag(
        self, job: Job, event: str, ts: str, listing_id: str | None, meta: dict[str, object] | None
    ) -> None:
        field, value = flag_for_event(event)  # type: ignore[misc]
        if getattr(job, field) != value:
            self.jobs.set_flags(
                job.id,
                value if field == "hidden" else None,
                value if field == "starred" else None,
                utc_now(),
            )
        # Log only when the toggle carries meta not already on the last one.
        new_hash = stable_hash(meta)
        if new_hash is not None and new_hash != self.events.latest_meta_hash(job.id, event):
            self.events.insert(
                job.id, event, ts, listing_id=listing_id, meta=meta, meta_hash=new_hash
            )

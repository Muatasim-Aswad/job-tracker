"""Automatic job closure derived from listing availability."""

from datetime import datetime

from app.modules.events.automation import (
    AUTOMATIC_SOURCE,
    is_automatic_close,
    is_effective_status_event,
)
from app.modules.events.models import Event
from app.modules.events.projection import reproject_status
from app.modules.events.repository import EventRepository
from app.modules.jobs.repository import JobRepository
from app.modules.listings.repository import ListingRepository
from app.shared.enums import APPLIED_EVIDENCE, Status, active_rank, parse_correction, status_set_by
from app.shared.hashing import stable_hash
from app.shared.timeutil import utc_now

AUTOMATIC_REASON = "all_listings_closed"
LEGACY_REASON = "listing_closed"
LEGACY_MATCH_SECONDS = 30


class AutomaticClosure:
    def __init__(
        self, listings: ListingRepository, jobs: JobRepository, events: EventRepository
    ) -> None:
        self.listings = listings
        self.jobs = jobs
        self.events = events

    def projected_automatically(self, job_id: str) -> bool:
        setters = [
            event
            for event in self.events.list_for_job(job_id)
            if is_effective_status_event(event) and status_set_by(event.event) is not None
        ]
        return bool(setters and is_automatic_close(setters[-1]))

    def reconcile(self, job_id: str, *, allow_close: bool) -> None:
        if self.jobs.get(job_id) is None:
            return
        listings = self.listings.list_for_job(job_id)
        all_closed = bool(listings) and all(listing.closed_at is not None for listing in listings)
        events = self.events.list_for_job(job_id)
        active = [
            event
            for event in events
            if is_automatic_close(event) and is_effective_status_event(event)
        ]
        base_status = Status.NEW.value
        has_applied_history = False
        for event in events:
            setter = status_set_by(event.event)
            if (
                setter is not None
                and is_effective_status_event(event)
                and not is_automatic_close(event)
            ):
                base_status = setter
                if parse_correction(event.event) is not None:
                    has_applied_history = setter in APPLIED_EVIDENCE
                elif setter in APPLIED_EVIDENCE:
                    has_applied_history = True
        applied_rank = active_rank(Status.APPLIED.value)
        base_rank = active_rank(base_status)
        pre_application = (
            base_rank is not None
            and applied_rank is not None
            and base_rank < applied_rank
            and not has_applied_history
        )

        if active and (not all_closed or not pre_application):
            reason = "open_listing" if not all_closed else "authoritative_status"
            if self._invalidate(active, reason):
                reproject_status(job_id, self.events, self.jobs)
            return
        if active or not allow_close:
            return
        if not all_closed or not pre_application:
            return
        meta: dict[str, object] = {"source": AUTOMATIC_SOURCE, "reason": AUTOMATIC_REASON}
        self.events.insert(
            job_id,
            Status.CLOSED.value,
            utc_now(),
            listing_id=None,
            meta=meta,
            meta_hash=stable_hash(meta),
        )
        reproject_status(job_id, self.events, self.jobs)

    def invalidate(self, job_id: str, reason: str) -> bool:
        active = [
            event
            for event in self.events.list_for_job(job_id)
            if is_automatic_close(event) and is_effective_status_event(event)
        ]
        changed = self._invalidate(active, reason)
        if changed:
            reproject_status(job_id, self.events, self.jobs)
        return changed

    def adopt_legacy(self, job_id: str, closed_at: str) -> None:
        """Claim a provenance-less `closed` event written beside this listing close.

        Older extensions posted the event and the listing update as adjacent
        requests without marking the event automatic, so it reads as a manual
        closure and survives reopening. Only the narrow timestamp window is
        adopted, leaving genuinely manual closures untouched.
        """
        for event in self.events.list_for_job(job_id):
            if event.event != Status.CLOSED.value or event.meta is not None:
                continue
            if _timestamps_near(event.ts, closed_at):
                self._mark_legacy(event)

    def _mark_legacy(self, event: Event) -> None:
        meta: dict[str, object] = {
            "source": AUTOMATIC_SOURCE,
            "reason": LEGACY_REASON,
            "legacy": True,
        }
        self.events.update_meta(event.id, meta, stable_hash(meta))

    def _invalidate(self, events: list[Event], reason: str) -> bool:
        if not events:
            return False
        now = utc_now()
        for event in events:
            meta: dict[str, object] = {
                **(event.meta or {}),
                "invalidated_at": now,
                "invalidated_reason": reason,
            }
            self.events.update_meta(event.id, meta, stable_hash(meta))
        return True


def _timestamps_near(left: str, right: str) -> bool:
    try:
        return abs(
            (datetime.fromisoformat(left) - datetime.fromisoformat(right)).total_seconds()
        ) <= (LEGACY_MATCH_SECONDS)
    except TypeError, ValueError:
        return False

"""Feature-owned ownership changes; caller retains transaction ownership."""

from app.infra.database import Conn, execute
from app.modules.events.automation import is_effective_status_event
from app.modules.events.projection import reproject_status
from app.modules.events.repository import EventRepository
from app.modules.jobs.repository import JobRepository
from app.shared.enums import (
    Status,
    correction_event,
    parse_correction,
    status_set_by,
    target_status,
)
from app.shared.hashing import stable_hash
from app.shared.timeutil import utc_now


def move_by_listing(conn: Conn, listing_id: str, old_job_id: str, new_job_id: str) -> None:
    """Reattach events that came from this listing to the new job. With no
    per-day uniqueness anymore this is a plain reassignment — ids/ts/order
    are preserved, and duplicates across the two jobs are simply kept."""
    execute(
        conn,
        "UPDATE events SET job_id = ? WHERE listing_id = ? AND job_id = ?",
        (new_job_id, listing_id, old_job_id),
    )


def move_all(conn: Conn, old_job_id: str, new_job_id: str) -> None:
    """Reattach every remaining event off a job being dissolved."""
    execute(conn, "UPDATE events SET job_id = ? WHERE job_id = ?", (new_job_id, old_job_id))


def clear_listing(conn: Conn, listing_id: str) -> None:
    """Drop the listing provenance from its events, keeping them as job-level
    history — used when a single listing is deleted but its job survives."""
    execute(conn, "UPDATE events SET listing_id = NULL WHERE listing_id = ?", (listing_id,))


def delete_for_job(conn: Conn, job_id: str) -> None:
    execute(conn, "DELETE FROM events WHERE job_id = ?", (job_id,))


def preserve_combined_status(conn: Conn, survivor_id: str, before: str, *, source: str) -> None:
    """Preserve the receiver when combined event order implies an illegal regression.

    Deliberate corrections remain authoritative. Other restorations are logged
    as corrections so future projections remain stable and the conflict stays
    visible and revertible.
    """
    jobs = JobRepository(conn)
    events = EventRepository(conn)
    survivor = jobs.get(survivor_id)
    assert survivor is not None
    after = survivor.status
    winner = _winning_status_event(conn, survivor_id)
    if after == before or winner is None or parse_correction(winner) is not None:
        return

    if target_status(winner, before) is None:
        meta: dict[str, object] = {
            "source": source,
            "reason": f"{source} would have walked status back to {after}",
        }
        events.insert(
            survivor_id,
            correction_event(Status(before)),
            utc_now(),
            listing_id=None,
            meta=meta,
            meta_hash=stable_hash(meta),
        )
        reproject_status(survivor_id, events, jobs)


def _winning_status_event(conn: Conn, job_id: str) -> str | None:
    """Return the latest `(ts, id)` status-setting event."""
    events = EventRepository(conn)
    setters = [
        e.event
        for e in events.list_for_job(job_id)
        if status_set_by(e.event) and is_effective_status_event(e)
    ]

    return setters[-1] if setters else None


def reproject(conn: Conn, job_id: str) -> None:
    reproject_status(job_id, EventRepository(conn), JobRepository(conn))

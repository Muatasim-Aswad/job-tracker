"""Shared projection of the event log onto ``jobs.status``."""

from app.modules.events.automation import is_effective_status_event
from app.modules.events.repository import EventRepository
from app.modules.jobs.repository import JobRepository
from app.shared.enums import Status, status_set_by
from app.shared.timeutil import utc_now


def reproject_status(job_id: str, events: EventRepository, jobs: JobRepository) -> None:
    """Set a job's status from its newest status-setting event.

    ``EventRepository.list_for_job`` orders by timestamp and then event ID, both
    ascending, so replaying that sequence makes the last status setter the
    winner. A job with no status-setting events projects to ``new``.
    """
    projected = Status.NEW.value
    for event in events.list_for_job(job_id):
        setter = status_set_by(event.event)
        if setter is not None and is_effective_status_event(event):
            projected = setter

    job = jobs.get(job_id)
    assert job is not None
    if job.status != projected:
        jobs.set_status(job_id, projected, utc_now())

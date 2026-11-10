"""Derived application deadlines and their reusable notification schedules."""

from datetime import UTC, datetime, timedelta

from app.infra.database import Conn
from app.modules.events.repository import EventRepository
from app.modules.jobs.models import JobFilters
from app.modules.jobs.repository import JobRepository
from app.modules.notifications import service as notifications
from app.modules.preferences import service as preferences
from app.modules.preferences.schemas import ApplicationStaleness
from app.shared.timeutil import utc_now


def deadline(status: str, since: str, rules: ApplicationStaleness) -> str | None:
    days = {"applied": rules.applied_days, "in_process": rules.in_process_days}.get(status, 0)
    if days == 0:
        return None
    activity = datetime.fromisoformat(since)
    if activity.tzinfo is None:
        activity = activity.replace(tzinfo=UTC)
    return (activity.astimezone(UTC) + timedelta(days=days)).isoformat()


def reconcile(conn: Conn, job_ids: list[str] | None = None, *, reschedule: bool = False) -> None:
    jobs = JobRepository(conn)
    candidates = (
        jobs.search(JobFilters())
        if job_ids is None
        else [job for job_id in dict.fromkeys(job_ids) if (job := jobs.get(job_id)) is not None]
    )
    activity = EventRepository(conn).last_activity_for_jobs([job.id for job in candidates])
    rules = preferences.read(conn).settings.application_staleness
    now = utc_now()
    for job in candidates:
        due_at = deadline(job.status, activity.get(job.id) or job.updated_at, rules)
        if job.application_stale_at != due_at:
            jobs.set_stale_at(job.id, due_at)
        title = f"Application stale: {job.title or 'Untitled job'}"
        if job.company:
            title += f" at {job.company}"
        notifications.reconcile_stale(
            conn,
            job_id=job.id,
            title=title,
            due_at=None
            if getattr(rules, f"{job.status}_notifications", "off") == "off"
            else due_at,
            now=now,
            settings=rules,
            new_cycle=job.application_stale_at != due_at,
            reschedule=reschedule,
        )

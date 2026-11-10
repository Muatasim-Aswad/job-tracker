"""Notification lifecycle; caller owns transactions and post-commit broadcasts."""

from uuid import uuid4

from app.infra.database import Conn
from app.modules.jobs.repository import JobRepository
from app.modules.notifications.models import Notification, PublicationBatch
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.scheduling import stale_alert_time
from app.modules.notifications.schemas import (
    NotificationPage,
    PublicationAcknowledgment,
    ReminderCreate,
    ReminderUpdate,
    timestamp,
)
from app.modules.preferences import service as preferences
from app.modules.preferences.schemas import ApplicationStaleness, Preferences
from app.shared.errors import ConflictError, NotFoundError, ValidationError
from app.shared.timeutil import utc_now


def get(conn: Conn, notification_id: str) -> Notification:
    result = NotificationRepository(conn).get(notification_id)
    if result is None:
        raise NotFoundError("Notification not found")
    return result


def _job_id(conn: Conn, job_id: str | None) -> str | None:
    if job_id is None:
        return None
    resolved = JobRepository(conn).resolve_id(job_id)
    if resolved is None:
        raise NotFoundError("Job not found")
    return resolved


def create(conn: Conn, body: ReminderCreate) -> Notification:
    now = utc_now()
    result = Notification(
        id=str(uuid4()),
        kind="manual_reminder",
        job_id=_job_id(conn, body.job_id),
        title=body.title,
        body=body.body,
        scheduled_at=timestamp(body.scheduled_at),
        published_at=None,
        state="scheduled",
        delivered_at=None,
        read_at=None,
        resolved_at=None,
        revision=str(uuid4()),
        created_at=now,
        updated_at=now,
    )
    NotificationRepository(conn).save(result)
    return result


def _editable(conn: Conn, notification_id: str, revision: str) -> Notification:
    result = get(conn, notification_id)
    if result.kind != "manual_reminder":
        raise ValidationError("Application staleness is managed by job activity and settings")
    if result.revision != revision:
        raise ConflictError("notification_revision_conflict", result.model_dump())
    return result


def update(conn: Conn, notification_id: str, body: ReminderUpdate) -> Notification:
    result = _editable(conn, notification_id, body.expected_revision)
    changes = body.model_dump(exclude_unset=True, exclude={"expected_revision"})
    if "job_id" in changes:
        changes["job_id"] = _job_id(conn, body.job_id)
    if body.scheduled_at is not None:
        changes["scheduled_at"] = timestamp(body.scheduled_at)
        changes.update(
            state="scheduled",
            published_at=None,
            delivered_at=None,
            alert_suppressed_at=None,
            read_at=None,
            resolved_at=None,
        )
    result = result.model_copy(
        update={**changes, "revision": str(uuid4()), "updated_at": utc_now()}
    )
    NotificationRepository(conn).save(result)
    return result


def cancel(conn: Conn, notification_id: str, revision: str) -> Notification:
    result = _editable(conn, notification_id, revision)
    if result.state != "scheduled":
        raise ValidationError("Only scheduled reminders can be cancelled")
    result = result.model_copy(
        update={"state": "cancelled", "revision": str(uuid4()), "updated_at": utc_now()}
    )
    NotificationRepository(conn).save(result)
    return result


def acknowledge(
    conn: Conn, notification_id: str, body: PublicationAcknowledgment, *, read: bool = False
) -> Notification:
    result = get(conn, notification_id)
    publication = timestamp(body.published_at)
    if result.state != "published" or result.published_at != publication:
        raise ConflictError("notification_publication_changed", result.model_dump())
    now = utc_now()
    # Delivery/read timestamps are monotonic for this publication. They do not
    # change the edit revision or permit an old client to acknowledge a new cycle.
    NotificationRepository(conn).acknowledge(notification_id, publication, now, read=read)
    return get(conn, notification_id)


def list_notifications(
    conn: Conn,
    *,
    job_id: str | None = None,
    state: str | None = None,
    kind: str | None = None,
    before: str | None = None,
    limit: int = 50,
) -> NotificationPage:
    repository = NotificationRepository(conn)
    rows = repository.page(
        job_id=_job_id(conn, job_id),
        state=state,
        kind=kind,
        anchor=get(conn, before) if before else None,
        limit=limit + 1,
    )
    items = rows[:limit]
    return NotificationPage(
        items=items,
        next_cursor=items[-1].id if len(rows) > limit else None,
        unread_count=repository.unread_count(),
    )


def reconcile_stale(
    conn: Conn,
    *,
    job_id: str,
    title: str,
    due_at: str | None,
    now: str,
    settings: ApplicationStaleness,
    new_cycle: bool = True,
    reschedule: bool = False,
) -> None:
    repository = NotificationRepository(conn)
    prior = repository.stale_for_job(job_id)
    if due_at is None:
        if prior is not None and prior.resolved_at is None:
            repository.save(
                prior.model_copy(
                    update={
                        "state": "cancelled" if prior.state == "scheduled" else prior.state,
                        "resolved_at": now,
                        "revision": str(uuid4()),
                        "updated_at": now,
                    }
                )
            )
        return
    if prior is not None and not new_cycle and prior.resolved_at is None:
        changes: dict[str, object] = {}
        if prior.title != title:
            changes["title"] = title
        if reschedule and prior.state == "scheduled":
            changes["scheduled_at"] = stale_alert_time(due_at, now, settings)
            changes["revision"] = str(uuid4())
        if changes:
            repository.save(prior.model_copy(update={**changes, "updated_at": now}))
        return
    result = Notification(
        id=prior.id if prior else str(uuid4()),
        kind="application_stale",
        job_id=job_id,
        title=title,
        body=None,
        scheduled_at=stale_alert_time(due_at, now, settings),
        published_at=None,
        state="scheduled",
        delivered_at=None,
        read_at=None,
        resolved_at=None,
        revision=str(uuid4()),
        created_at=prior.created_at if prior else now,
        updated_at=now,
    )
    repository.save(result)


def publish_due(conn: Conn, now: str | None = None) -> PublicationBatch:
    now = now or utc_now()
    repository = NotificationRepository(conn)
    published = []
    changed = False
    choices = preferences.read(conn).settings
    settings = choices.application_staleness
    for item in repository.due(now):
        if item.kind == "application_stale":
            job = JobRepository(conn).get(item.job_id) if item.job_id else None
            due_at = (
                job.application_stale_at
                if job and job.status in {"applied", "in_process"}
                else None
            )
            mode = getattr(settings, f"{job.status}_notifications", "off") if job else "off"
            if mode == "off":
                due_at = None
            if due_at is None or due_at > now:
                if job is not None:
                    reconcile_stale(
                        conn,
                        job_id=job.id,
                        title=item.title,
                        due_at=due_at,
                        now=now,
                        settings=settings,
                    )
                    changed = True
                continue
            scheduled = stale_alert_time(due_at, now, settings)
            if scheduled > now:
                repository.save(
                    item.model_copy(update={"scheduled_at": scheduled, "updated_at": now})
                )
                changed = True
                continue
        result = item.model_copy(
            update={
                "state": "published",
                "published_at": now,
                "alert_suppressed_at": now if alert_muted(conn, item, choices) else None,
                "revision": str(uuid4()),
                "updated_at": now,
            }
        )
        repository.save(result)
        changed = True
        published.append(result)
    return PublicationBatch(published, changed)


def move_job(conn: Conn, source: str, target: str) -> None:
    """Carry user reminders through identity consolidation; recompute automatic alerts."""
    NotificationRepository(conn).move_job(source, target)


def detach_job(conn: Conn, job_id: str) -> None:
    NotificationRepository(conn).detach_job(job_id, utc_now())


def alert_muted(conn: Conn, item: Notification, settings: Preferences) -> bool:
    if settings.notifications.muted:
        return True
    if item.kind != "application_stale":
        return False
    job = JobRepository(conn).get(item.job_id) if item.job_id else None
    mode = (
        getattr(settings.application_staleness, f"{job.status}_notifications", "off")
        if job
        else "off"
    )
    return mode != "on"


def suppress_muted_pending(conn: Conn) -> bool:
    """Muting handles outstanding alerts silently; unmuting never replays them."""
    settings = preferences.read(conn).settings
    repository = NotificationRepository(conn)
    changed = False
    for item in repository.pending():
        if alert_muted(conn, item, settings):
            repository.suppress_alert(item.id, utc_now())
            changed = True
    return changed

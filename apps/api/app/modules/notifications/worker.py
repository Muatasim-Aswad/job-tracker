"""Publish due schedules and redeliver unacknowledged publications."""

from collections.abc import Callable

from app.infra.broadcast import BroadcastHub
from app.infra.database import Database
from app.infra.transactions import transaction
from app.infra.web_push import WebPushSender
from app.modules.notifications.models import PublicationBatch
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.service import publish_due, suppress_muted_pending


def cycle(
    db: Database,
    hub: BroadcastHub,
    committed: Callable[[], None],
    *,
    scheduler_enabled: bool,
    known: dict[str, str] | None = None,
    push_sender: WebPushSender | None = None,
) -> None:
    with transaction(db) as conn:
        batch = publish_due(conn) if scheduler_enabled else PublicationBatch([])
        batch.changed = suppress_muted_pending(conn) or batch.changed
        subscriptions = (
            NotificationRepository(conn).push_subscriptions(push_sender.public_key)
            if push_sender
            else []
        )
        pending = NotificationRepository(conn).pending() if hub.connected or subscriptions else []
        snapshot = NotificationRepository(conn).snapshot() if known is not None else None
    if batch.changed:
        committed()
    if batch.changed or (known is not None and snapshot != known):
        hub.publish("sync", {})
    if known is not None and snapshot is not None:
        known.clear()
        known.update(snapshot)
    for item in pending:
        if hub.connected:
            hub.publish("notification", item.model_dump())
        if push_sender is None:
            continue
        payload: dict[str, object] = {
            "id": item.id,
            "kind": item.kind,
            "job_id": item.job_id,
            "published_at": item.published_at,
            "title": item.title,
            "body": item.body[:500] if item.body else None,
            "state": "published",
        }
        for subscription in subscriptions:
            if push_sender.send(subscription, payload) == "expired":
                with transaction(db) as conn:
                    NotificationRepository(conn).unsubscribe_push(str(subscription["endpoint"]))
                committed()

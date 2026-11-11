import asyncio
import json
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Query
from starlette.responses import StreamingResponse

from app.infra.transactions import transaction
from app.modules.notifications import service
from app.modules.notifications.dependencies import RuntimeDep
from app.modules.notifications.models import Notification
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.schemas import (
    NotificationPage,
    PublicationAcknowledgment,
    PushConfiguration,
    PushSubscriptionCreate,
    PushSubscriptionDelete,
    ReminderCancel,
    ReminderCreate,
    ReminderUpdate,
)
from app.platform.dependencies import ConnDep
from app.shared.errors import ValidationError
from app.shared.timeutil import utc_now

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=NotificationPage)
def list_notifications(
    *,
    conn: ConnDep,
    job_id: str | None = None,
    state: Literal["scheduled", "published", "cancelled"] | None = None,
    kind: Literal["manual_reminder", "application_stale"] | None = None,
    before: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> NotificationPage:
    return service.list_notifications(
        conn, job_id=job_id, state=state, kind=kind, before=before, limit=limit
    )


@router.post("/notifications", response_model=Notification, status_code=201)
def create(*, conn: ConnDep, body: ReminderCreate) -> Notification:
    return service.create(conn, body)


@router.get("/notifications/push-key", response_model=PushConfiguration)
def push_configuration(*, runtime: RuntimeDep) -> PushConfiguration:
    return PushConfiguration(
        application_server_key=runtime.web_push.public_key if runtime.web_push else None
    )


@router.post("/notifications/push-subscriptions", status_code=204)
def subscribe_push(*, conn: ConnDep, runtime: RuntimeDep, body: PushSubscriptionCreate) -> None:
    if runtime.web_push is None:
        raise ValidationError("Web Push is disabled on this server")
    NotificationRepository(conn).subscribe_push(
        body.endpoint, body.keys.p256dh, body.keys.auth, runtime.web_push.public_key, utc_now()
    )


@router.delete("/notifications/push-subscriptions", status_code=204)
def unsubscribe_push(*, conn: ConnDep, body: PushSubscriptionDelete) -> None:
    NotificationRepository(conn).unsubscribe_push(body.endpoint)


@router.get("/notifications/stream")
async def stream(*, runtime: RuntimeDep) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        hub = runtime.notification_hub
        queue = hub.subscribe()

        def pending() -> list[Notification]:
            with transaction(runtime.database()) as conn:
                service.suppress_muted_pending(conn)
                return NotificationRepository(conn).pending()

        try:
            # Subscribe before reading pending rows. Overlap is harmless because
            # clients deduplicate the publication identity, not the stream event.
            for item in await asyncio.to_thread(pending):
                yield f"event: notification\ndata: {item.model_dump_json()}\n\n"
            yield "event: sync\ndata: {}\n\n"
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"event: {message.event}\ndata: {json.dumps(message.data)}\n\n"
                except TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            hub.unsubscribe(queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/notifications/{notification_id}", response_model=Notification)
def get(*, conn: ConnDep, notification_id: str) -> Notification:
    return service.get(conn, notification_id)


@router.patch("/notifications/{notification_id}", response_model=Notification)
def update(*, conn: ConnDep, notification_id: str, body: ReminderUpdate) -> Notification:
    return service.update(conn, notification_id, body)


@router.post("/notifications/{notification_id}/cancel", response_model=Notification)
def cancel(*, conn: ConnDep, notification_id: str, body: ReminderCancel) -> Notification:
    return service.cancel(conn, notification_id, body.expected_revision)


@router.post("/notifications/{notification_id}/ack", response_model=Notification)
def acknowledge(
    *, conn: ConnDep, notification_id: str, body: PublicationAcknowledgment
) -> Notification:
    return service.acknowledge(conn, notification_id, body)


@router.post("/notifications/{notification_id}/read", response_model=Notification)
def read(*, conn: ConnDep, notification_id: str, body: PublicationAcknowledgment) -> Notification:
    return service.acknowledge(conn, notification_id, body, read=True)

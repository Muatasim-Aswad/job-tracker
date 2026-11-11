"""Notification scheduling, publication identity, shared receipts and job lifecycle."""

import asyncio
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.paths import settings_paths
from app.infra import database
from app.infra.broadcast import BroadcastHub
from app.infra.database import Database
from app.modules.notifications import service
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.router import stream
from app.modules.notifications.worker import cycle
from app.modules.preferences.schemas import ApplicationStaleness
from app.modules.preferences.service import initialize_staleness as initialize
from app.modules.staleness.service import reconcile
from app.platform.runtime import RuntimeResources

NOW = "2026-11-10T09:00:00+00:00"
PAST = "2026-10-01T12:00:00+00:00"


@pytest.fixture(autouse=True)
def notification_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.modules.staleness.service.utc_now", lambda: "2026-11-10T08:00:00+00:00"
    )
    monkeypatch.setattr("app.modules.notifications.service.utc_now", lambda: NOW)


def job(client: TestClient, key: str = "notifications") -> str:
    return str(
        client.post(
            "/api/listings",
            json={
                "platform": "test",
                "platform_id": key,
                "title": "Engineer",
                "company": "Example",
            },
        ).json()["job_id"]
    )


def emit(client: TestClient, job_id: str, event: str, ts: str) -> None:
    response = client.post(
        "/api/events", json={"job_id": job_id, "ts": ts, "events": [{"event": event}]}
    )
    assert response.status_code == 200, response.text


def test_stale_notification_rearms_same_row_and_rejects_old_receipts(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    job_id = job(client)
    emit(client, job_id, "applied", PAST)
    scheduled = client.get("/api/notifications", params={"job_id": job_id}).json()["items"][0]
    assert scheduled["kind"] == "application_stale"
    assert scheduled["scheduled_at"] == NOW
    assert (
        client.get(f"/api/jobs/{job_id}").json()["application_stale_at"]
        == "2026-10-22T12:00:00+00:00"
    )

    published = service.publish_due(conn, NOW).publications
    conn.commit()
    assert len(published) == 1
    publication = {"published_at": published[0].published_at}
    notification_id = published[0].id
    acknowledged = client.post(f"/api/notifications/{notification_id}/ack", json=publication)
    assert acknowledged.status_code == 200
    assert acknowledged.json()["read_at"] is None
    read = client.post(f"/api/notifications/{notification_id}/read", json=publication)
    assert read.status_code == 200
    assert client.get("/api/notifications").json()["unread_count"] == 0
    assert service.publish_due(conn, NOW).publications == []

    emit(client, job_id, "note", NOW)
    rearmed = client.get(f"/api/notifications/{notification_id}").json()
    assert rearmed["state"] == "scheduled"
    assert rearmed["scheduled_at"] == "2026-12-01T09:00:00+00:00"
    for field in ("published_at", "delivered_at", "read_at", "resolved_at"):
        assert rearmed[field] is None
    assert rearmed["revision"] != scheduled["revision"]
    assert (
        client.post(f"/api/notifications/{notification_id}/ack", json=publication).status_code
        == 409
    )
    assert (
        client.post(f"/api/notifications/{notification_id}/read", json=publication).status_code
        == 409
    )
    assert len(client.get("/api/notifications", params={"job_id": job_id}).json()["items"]) == 1


def test_manual_reminders_can_share_time_and_job_and_edit_with_revision(client: TestClient) -> None:
    job_id = job(client)
    body = {
        "title": "Follow up",
        "body": "Ask about next steps",
        "scheduled_at": NOW,
        "job_id": job_id,
    }
    first = client.post("/api/notifications", json=body)
    second = client.post("/api/notifications", json=body)
    tracker = client.post("/api/notifications", json={**body, "job_id": None})
    assert first.status_code == second.status_code == tracker.status_code == 201
    item = first.json()
    assert item["id"] != second.json()["id"]
    assert tracker.json()["job_id"] is None
    updated = client.patch(
        f"/api/notifications/{item['id']}",
        json={"expected_revision": item["revision"], "title": "Call recruiter"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Call recruiter"
    assert (
        client.patch(
            f"/api/notifications/{item['id']}",
            json={"expected_revision": item["revision"], "title": "Old edit"},
        ).status_code
        == 409
    )
    cancelled = client.post(
        f"/api/notifications/{item['id']}/cancel",
        json={"expected_revision": updated.json()["revision"]},
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["state"] == "cancelled"


def test_validation_and_automatic_notification_protection(client: TestClient) -> None:
    assert (
        client.post("/api/notifications", json={"title": " ", "scheduled_at": NOW}).status_code
        == 422
    )
    assert (
        client.post(
            "/api/notifications", json={"title": "Time zone", "scheduled_at": "2026-11-10T12:00:00"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/notifications",
            json={"title": "Missing job", "scheduled_at": NOW, "job_id": "missing"},
        ).status_code
        == 404
    )
    job_id = job(client)
    emit(client, job_id, "applied", PAST)
    item = client.get("/api/notifications").json()["items"][0]
    assert (
        client.patch(
            f"/api/notifications/{item['id']}",
            json={"expected_revision": item["revision"], "title": "Manual override"},
        ).status_code
        == 400
    )


def test_threshold_edit_reschedules_existing_jobs_and_zero_cancels(client: TestClient) -> None:
    job_id = job(client)
    emit(client, job_id, "in_process", PAST)
    settings = client.get("/api/settings").json()
    response = client.patch(
        "/api/settings",
        json={
            "expected_revision": settings["revision"],
            "changes": {"application_staleness": {"applied_days": 3, "in_process_days": 0}},
        },
    )
    assert response.status_code == 200
    assert client.get(f"/api/jobs/{job_id}").json()["application_stale_at"] is None
    item = client.get("/api/notifications").json()["items"][0]
    assert item["state"] == "cancelled"
    assert (
        client.patch(
            "/api/settings",
            json={
                "expected_revision": response.json()["revision"],
                "changes": {"application_staleness": {"applied_days": -1}},
            },
        ).status_code
        == 422
    )


def test_terminal_status_resolves_published_alert_and_stops_pending_delivery(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    job_id = job(client)
    emit(client, job_id, "applied", PAST)
    service.publish_due(conn, NOW)
    conn.commit()
    emit(client, job_id, "rejected", NOW)
    item = client.get("/api/notifications").json()["items"][0]
    assert item["state"] == "published"
    assert item["resolved_at"] is not None
    assert NotificationRepository(conn).pending() == []


def test_merge_keeps_manual_reminders_and_reconciles_one_stale_alert(client: TestClient) -> None:
    first, second = job(client, "first"), job(client, "second")
    for job_id in (first, second):
        emit(client, job_id, "applied", PAST)
        assert (
            client.post(
                "/api/notifications",
                json={"title": "Keep me", "job_id": job_id, "scheduled_at": NOW},
            ).status_code
            == 201
        )
    merged = client.post(f"/api/jobs/{first}/link-job", json={"other_job_id": second})
    assert merged.status_code == 200
    survivor = merged.json()["job_id"]
    items = client.get("/api/notifications", params={"job_id": survivor}).json()["items"]
    assert sum(item["kind"] == "application_stale" for item in items) == 1
    assert sum(item["kind"] == "manual_reminder" for item in items) == 2
    assert client.delete(f"/api/jobs/{survivor}").status_code == 204
    items = client.get("/api/notifications").json()["items"]
    assert all(item["job_id"] is None and item["state"] == "cancelled" for item in items)


def test_worker_retries_until_acknowledged_and_sse_never_holds_db_lock(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    item = client.post(
        "/api/notifications", json={"title": "Due reminder", "scheduled_at": PAST}
    ).json()
    db = Database(conn)
    hub = BroadcastHub()
    committed = []

    async def exercise() -> None:
        queue = hub.subscribe()
        cycle(db, hub, lambda: committed.append(True), scheduler_enabled=True)
        assert (await asyncio.wait_for(queue.get(), 1)).event == "sync"
        first = await asyncio.wait_for(queue.get(), 1)
        assert first.event == "notification" and first.data["id"] == item["id"]
        cycle(db, hub, lambda: committed.append(True), scheduler_enabled=True)
        assert (await asyncio.wait_for(queue.get(), 1)).data["id"] == item["id"]
        ack = {"published_at": first.data["published_at"]}
        assert client.post(f"/api/notifications/{item['id']}/ack", json=ack).status_code == 200
        cycle(db, hub, lambda: committed.append(True), scheduler_enabled=True)
        assert queue.empty()
        assert len(committed) == 1
        hub.unsubscribe(queue)

        resources = RuntimeResources(settings_paths(Settings(_env_file=None)), db=db)
        response = await stream(runtime=resources)
        iterator = response.body_iterator
        assert "event: sync" in str(await anext(iterator))
        assert db.lock.acquire(blocking=False)
        db.lock.release()
        assert resources.notification_hub.connected
        await iterator.aclose()  # type: ignore[attr-defined]
        assert not resources.notification_hub.connected

    asyncio.run(exercise())


def test_startup_defaults_seed_once_and_saved_preferences_survive(conn: sqlite3.Connection) -> None:
    initialize(conn, ApplicationStaleness(applied_days=9, in_process_days=6))
    reconcile(conn)
    initialize(conn, ApplicationStaleness(applied_days=2, in_process_days=1))
    import json

    stored = json.loads(conn.execute("SELECT settings_json FROM user_preferences").fetchone()[0])
    assert stored["application_staleness"] == {
        "applied_notifications": "on",
        "in_process_notifications": "on",
        "applied_days": 9,
        "in_process_days": 6,
        "notification_time": "09:00",
        "timezone": "UTC",
    }


def test_disconnected_publication_is_recovered_and_acknowledged_without_event_history(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    item = client.post(
        "/api/notifications", json={"title": "Recover me", "scheduled_at": PAST}
    ).json()
    db = Database(conn)
    hub = BroadcastHub()
    cycle(db, hub, lambda: None, scheduler_enabled=True)
    stored = service.get(conn, item["id"])
    assert stored.state == "published" and stored.delivered_at is None

    async def reconnect() -> None:
        resources = RuntimeResources(settings_paths(Settings(_env_file=None)), db=db)
        response = await stream(runtime=resources)
        iterator = response.body_iterator
        message = str(await anext(iterator))
        assert "event: notification" in message and item["id"] in message
        assert db.lock.acquire(blocking=False)
        db.lock.release()
        await iterator.aclose()  # type: ignore[attr-defined]
        assert (
            client.post(
                f"/api/notifications/{item['id']}/ack", json={"published_at": stored.published_at}
            ).status_code
            == 200
        )
        second = (await stream(runtime=resources)).body_iterator
        assert "event: sync" in str(await anext(second))
        await second.aclose()  # type: ignore[attr-defined]

    asyncio.run(reconnect())


def test_secondary_instance_does_not_publish_but_observes_synced_read_state(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    item = client.post("/api/notifications", json={"title": "Shared", "scheduled_at": PAST}).json()
    db, hub, known = Database(conn), BroadcastHub(), {}
    cycle(db, hub, lambda: None, scheduler_enabled=False, known=known)
    assert service.get(conn, item["id"]).state == "scheduled"
    published = service.publish_due(conn, NOW).publications[0]
    conn.commit()

    async def observe() -> None:
        queue = hub.subscribe()
        cycle(db, hub, lambda: None, scheduler_enabled=False, known=known)
        assert (await asyncio.wait_for(queue.get(), 1)).event == "sync"
        assert (await asyncio.wait_for(queue.get(), 1)).event == "notification"
        assert (
            client.post(
                f"/api/notifications/{item['id']}/read",
                json={"published_at": published.published_at},
            ).status_code
            == 200
        )
        cycle(db, hub, lambda: None, scheduler_enabled=False, known=known)
        assert (await asyncio.wait_for(queue.get(), 1)).event == "sync"
        assert queue.empty()
        cycle(db, hub, lambda: None, scheduler_enabled=False, known=known)
        assert queue.empty()
        hub.unsubscribe(queue)

    asyncio.run(observe())


def test_notification_upgrade_from_previous_schema_is_additive_and_repeatable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = sqlite3.connect(":memory:")
    columns, migrations = database._COLUMN_MIGRATIONS, database._DATA_MIGRATIONS
    with monkeypatch.context() as previous:
        previous.setattr(
            database,
            "_COLUMN_MIGRATIONS",
            tuple(entry for entry in columns if entry[1] != "application_stale_at"),
        )
        previous.setattr(
            database,
            "_DATA_MIGRATIONS",
            tuple(
                entry
                for entry in migrations
                if entry[0]
                not in {
                    "create_notifications_v1",
                    "create_notification_push_subscriptions_v1",
                    "add_notification_alert_suppression_v1",
                }
            ),
        )
        database.init_schema(conn)
    assert "application_stale_at" not in {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
    database.init_schema(conn)
    database.init_schema(conn)
    assert "application_stale_at" in {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
    assert (
        conn.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE key = 'create_notifications_v1'"
        ).fetchone()[0]
        == 1
    )
    assert conn.execute("SELECT COUNT(*) FROM notifications").fetchone()[0] == 0
    conn.close()


def settings_patch(client: TestClient, changes: dict) -> dict:
    current = client.get("/api/settings").json()
    response = client.patch(
        "/api/settings", json={"expected_revision": current["revision"], "changes": changes}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_global_mute_keeps_unread_inbox_and_unmute_does_not_replay(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    settings_patch(client, {"notifications": {"muted": True}})
    item = client.post("/api/notifications", json={"title": "Silent", "scheduled_at": PAST}).json()
    published = service.publish_due(conn, NOW).publications[0]
    conn.commit()
    assert published.alert_suppressed_at == NOW
    assert published.delivered_at is None and published.read_at is None
    assert (
        client.get("/api/notifications", params={"state": "published"}).json()["unread_count"] == 1
    )
    assert NotificationRepository(conn).pending() == []
    settings_patch(client, {"notifications": {"muted": False}})
    assert NotificationRepository(conn).pending() == []
    assert service.get(conn, item["id"]).state == "published"
    # A new publication after unmuting can alert normally.
    client.post("/api/notifications", json={"title": "Audible", "scheduled_at": PAST})
    assert service.publish_due(conn, NOW).publications[0].alert_suppressed_at is None


def test_stage_modes_are_independent_and_preserve_stale_badges(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    applied, processing = job(client, "applied"), job(client, "processing")
    emit(client, applied, "applied", PAST)
    emit(client, processing, "in_process", PAST)
    rules = client.get("/api/settings").json()["settings"]["application_staleness"]
    settings_patch(
        client,
        {
            "application_staleness": {
                **rules,
                "applied_notifications": "off",
                "in_process_notifications": "muted",
            }
        },
    )
    for job_id in (applied, processing):
        detail = client.get(f"/api/jobs/{job_id}").json()
        assert detail["application_stale_at"] is not None
        summary = next(row for row in client.get("/api/jobs").json() if row["id"] == job_id)
        assert summary["attention"] is not None
    applied_alert = client.get("/api/notifications", params={"job_id": applied}).json()["items"][0]
    assert applied_alert["state"] == "cancelled"
    publications = service.publish_due(conn, NOW).publications
    conn.commit()
    assert len(publications) == 1 and publications[0].job_id == processing
    assert publications[0].alert_suppressed_at == NOW
    settings_patch(
        client,
        {
            "application_staleness": {
                **rules,
                "applied_notifications": "on",
                "in_process_notifications": "muted",
            }
        },
    )
    reenabled = service.get(conn, applied_alert["id"])
    assert reenabled.state == "scheduled"
    silent = service.get(conn, publications[0].id)
    assert silent.state == "published" and silent.published_at == NOW


def test_muting_suppresses_pending_retries_without_marking_read(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    client.post("/api/notifications", json={"title": "Outstanding", "scheduled_at": PAST})
    item = service.publish_due(conn, NOW).publications[0]
    conn.commit()
    assert len(NotificationRepository(conn).pending()) == 1
    settings_patch(client, {"notifications": {"muted": True}})
    assert NotificationRepository(conn).pending() == []
    assert service.get(conn, item.id).read_at is None


def test_fixed_local_alert_time_and_missed_slot_deferral(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    job_id = job(client)
    emit(client, job_id, "applied", PAST)
    assert service.publish_due(conn, "2026-11-10T08:59:00+00:00").publications == []
    deferred = service.publish_due(conn, "2026-11-10T23:00:00+00:00")
    assert deferred.changed and deferred.publications == []
    row = NotificationRepository(conn).stale_for_job(job_id)
    assert row is not None and row.scheduled_at == "2026-11-11T09:00:00+00:00"
    assert len(service.publish_due(conn, "2026-11-11T09:00:35+00:00").publications) == 1


@pytest.mark.parametrize(
    ("deadline", "now", "expected"),
    [
        ("2026-11-10T05:00:00+00:00", "2026-11-10T06:00:00+00:00", "2026-11-10T08:00:00+00:00"),
        ("2026-11-10T14:00:00+00:00", "2026-11-10T06:00:00+00:00", "2026-11-11T08:00:00+00:00"),
        ("2026-10-25T01:00:00+00:00", "2026-10-24T05:00:00+00:00", "2026-10-25T08:00:00+00:00"),
    ],
)
def test_daily_clock_observes_saved_timezone(deadline: str, now: str, expected: str) -> None:
    from app.modules.notifications.scheduling import stale_alert_time

    assert (
        stale_alert_time(deadline, now, ApplicationStaleness(timezone="Europe/Amsterdam"))
        == expected
    )


def test_push_key_is_private_persistent_and_expired_subscriptions_are_removed(
    client: TestClient, conn: sqlite3.Connection, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.infra.web_push import WebPushSender

    key = tmp_path / "state" / "web-push-private.pem"
    sender = WebPushSender(key, "https://example.com")
    assert key.stat().st_mode & 0o777 == 0o600
    assert WebPushSender(key, "https://example.com").public_key == sender.public_key
    repository = NotificationRepository(conn)
    repository.subscribe_push(
        "https://fcm.googleapis.com/example", "public", "auth", sender.public_key, NOW
    )
    client.post("/api/notifications", json={"title": "Push", "scheduled_at": PAST})
    calls = []
    monkeypatch.setattr(
        sender, "send", lambda subscription, payload: calls.append(payload) or "expired"
    )
    cycle(Database(conn), BroadcastHub(), lambda: None, scheduler_enabled=True, push_sender=sender)
    assert len(calls) == 1
    assert repository.push_subscriptions(sender.public_key) == []
    # Vendor acceptance/removal cannot assert a client handled the publication.
    assert len(repository.pending()) == 1


def test_push_subscription_endpoint_rejects_arbitrary_network_targets() -> None:
    import base64

    from pydantic import ValidationError

    from app.modules.notifications.schemas import PushSubscriptionCreate

    keys = {
        "p256dh": base64.urlsafe_b64encode(b"\x04" + b"x" * 64).decode().rstrip("="),
        "auth": base64.urlsafe_b64encode(b"x" * 16).decode().rstrip("="),
    }
    for endpoint in (
        "http://fcm.googleapis.com/abc",
        "https://localhost/abc",
        "https://evil.example/abc",
        "https://fcm.googleapis.com:8443/abc",
        "https://user@fcm.googleapis.com/abc",
    ):
        with pytest.raises(ValidationError):
            PushSubscriptionCreate(endpoint=endpoint, keys=keys)
    assert PushSubscriptionCreate(
        endpoint="https://fcm.googleapis.com/example", keys=keys
    ).endpoint.endswith("example")


def test_push_routes_register_and_remove_subscription_without_exposing_private_key(
    client: TestClient, conn: sqlite3.Connection, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import base64

    from app.infra.web_push import WebPushSender
    from app.main import app

    sender = WebPushSender(tmp_path / "vapid.pem", "https://example.com")
    monkeypatch.setattr(app.state.resources, "web_push", sender)
    config = client.get("/api/notifications/push-key")
    assert config.json() == {"application_server_key": sender.public_key}
    assert config.headers["Cache-Control"] == "no-store"
    body = {
        "endpoint": "https://fcm.googleapis.com/test",
        "keys": {
            "p256dh": base64.urlsafe_b64encode(b"\x04" + b"x" * 64).decode().rstrip("="),
            "auth": base64.urlsafe_b64encode(b"x" * 16).decode().rstrip("="),
        },
    }
    assert client.post("/api/notifications/push-subscriptions", json=body).status_code == 204
    assert len(NotificationRepository(conn).push_subscriptions(sender.public_key)) == 1
    assert (
        client.request(
            "DELETE", "/api/notifications/push-subscriptions", json={"endpoint": body["endpoint"]}
        ).status_code
        == 204
    )
    assert NotificationRepository(conn).push_subscriptions(sender.public_key) == []
    assert (
        client.post(
            "/api/notifications/push-subscriptions",
            json={**body, "endpoint": "https://example.com/ssrf"},
        ).status_code
        == 422
    )


def test_daily_time_edit_does_not_republish_an_existing_cycle(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    job_id = job(client)
    emit(client, job_id, "applied", PAST)
    item = service.publish_due(conn, NOW).publications[0]
    conn.commit()
    rules = client.get("/api/settings").json()["settings"]["application_staleness"]
    settings_patch(client, {"application_staleness": {**rules, "notification_time": "10:00"}})
    unchanged = service.get(conn, item.id)
    assert unchanged.state == "published" and unchanged.published_at == item.published_at
    assert service.publish_due(conn, "2026-11-10T10:00:00+00:00").publications == []


def test_job_reminder_filter_excludes_stale_alerts_before_pagination(client: TestClient) -> None:
    job_id = job(client)
    emit(client, job_id, "applied", PAST)
    for hour in (10, 11):
        response = client.post(
            "/api/notifications",
            json={
                "title": f"Reminder {hour}",
                "job_id": job_id,
                "scheduled_at": f"2026-11-10T{hour}:00:00+00:00",
            },
        )
        assert response.status_code == 201
    filters = {"job_id": job_id, "state": "scheduled", "kind": "manual_reminder", "limit": 1}
    first = client.get("/api/notifications", params=filters).json()
    assert [row["title"] for row in first["items"]] == ["Reminder 10"]
    assert first["next_cursor"] is not None
    second = client.get(
        "/api/notifications", params={**filters, "before": first["next_cursor"]}
    ).json()
    assert [row["title"] for row in second["items"]] == ["Reminder 11"]
    assert second["next_cursor"] is None
    unfiltered = client.get(
        "/api/notifications", params={"job_id": job_id, "state": "scheduled"}
    ).json()
    assert len(unfiltered["items"]) == 3
    assert any(row["kind"] == "application_stale" for row in unfiltered["items"])
    assert client.get("/api/notifications", params={"kind": "unknown"}).status_code == 422


def test_inbox_orders_unread_before_read_with_paginated_newest_first_groups(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    ids = []
    for hour in (9, 10, 11):
        created = client.post(
            "/api/notifications", json={"title": f"Item {hour}", "scheduled_at": PAST}
        ).json()
        ids.append(created["id"])
        service.publish_due(conn, f"2026-11-09T{hour:02}:00:00+00:00")
        conn.commit()
    middle = service.get(conn, ids[1])
    assert (
        client.post(
            f"/api/notifications/{middle.id}/read", json={"published_at": middle.published_at}
        ).status_code
        == 200
    )
    cursor = None
    seen = []
    for _ in range(3):
        params = {"state": "published", "limit": 1}
        if cursor:
            params["before"] = cursor
        page = client.get("/api/notifications", params=params).json()
        seen.extend(row["id"] for row in page["items"])
        cursor = page["next_cursor"]
    assert seen == [ids[2], ids[0], ids[1]]
    assert cursor is None
    oldest = service.get(conn, ids[0])
    client.post(f"/api/notifications/{oldest.id}/read", json={"published_at": oldest.published_at})
    page = client.get("/api/notifications", params={"state": "published"}).json()
    assert [row["id"] for row in page["items"]] == [ids[2], ids[1], ids[0]]
    assert page["unread_count"] == 1

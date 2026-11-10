"""Additive notification storage; existing jobs and event history remain authoritative."""

from app.infra.database import Conn


def create_notifications(conn: Conn) -> None:
    conn.execute("BEGIN")
    conn.execute("""
        CREATE TABLE notifications (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('manual_reminder', 'application_stale')),
            job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
            title TEXT NOT NULL,
            body TEXT,
            scheduled_at TEXT NOT NULL,
            published_at TEXT,
            state TEXT NOT NULL CHECK (state IN ('scheduled', 'published', 'cancelled')),
            delivered_at TEXT,
            read_at TEXT,
            resolved_at TEXT,
            revision TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute(
        "CREATE UNIQUE INDEX idx_notification_stale_job ON notifications(job_id, kind) WHERE kind = 'application_stale' AND job_id IS NOT NULL"
    )
    conn.execute("CREATE INDEX idx_notifications_schedule ON notifications(state, scheduled_at)")
    conn.execute("CREATE INDEX idx_notifications_job ON notifications(job_id, scheduled_at)")
    conn.execute(
        "CREATE INDEX idx_notifications_inbox ON notifications(state, created_at DESC, id)"
    )


def create_push_subscriptions(conn: Conn) -> None:
    conn.execute(
        "CREATE TABLE notification_push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, application_server_key TEXT NOT NULL, created_at TEXT NOT NULL)"
    )

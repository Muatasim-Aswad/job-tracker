from app.infra.database import Conn, execute, query_all, query_one
from app.modules.notifications.models import Notification
from app.shared.hashing import stable_hash


class NotificationRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def snapshot(self) -> dict[str, str]:
        rows = query_all(
            self.conn,
            "SELECT id, revision, state, job_id, scheduled_at, published_at, delivered_at, read_at, resolved_at, updated_at FROM notifications",
        )
        return {str(row["id"]): stable_hash(row) or "" for row in rows}

    def acknowledge(self, notification_id: str, publication: str, now: str, *, read: bool) -> None:
        execute(
            self.conn,
            "UPDATE notifications SET delivered_at = COALESCE(delivered_at, ?), read_at = CASE WHEN ? THEN COALESCE(read_at, ?) ELSE read_at END WHERE id = ? AND published_at = ?",
            (now, read, now, notification_id, publication),
        )

    def move_job(self, source: str, target: str) -> None:
        execute(
            self.conn,
            "UPDATE notifications SET job_id = ? WHERE job_id = ? AND kind = 'manual_reminder'",
            (target, source),
        )
        execute(
            self.conn,
            "DELETE FROM notifications WHERE job_id = ? AND kind = 'application_stale'",
            (source,),
        )

    def detach_job(self, job_id: str, now: str) -> None:
        execute(
            self.conn,
            "UPDATE notifications SET job_id = NULL, state = CASE WHEN state = 'scheduled' THEN 'cancelled' ELSE state END, resolved_at = COALESCE(resolved_at, ?), updated_at = ? WHERE job_id = ?",
            (now, now, job_id),
        )

    def page(
        self,
        *,
        job_id: str | None,
        state: str | None,
        kind: str | None,
        anchor: Notification | None,
        limit: int,
    ) -> list[Notification]:
        clauses: list[str] = []
        params: list[object] = []
        if job_id is not None:
            clauses.append("job_id = ?")
            params.append(job_id)
        if state is not None:
            clauses.append("state = ?")
            params.append(state)
        if kind is not None:
            clauses.append("kind = ?")
            params.append(kind)
        sort_column = "published_at" if state == "published" else "scheduled_at"
        ascending = state == "scheduled"
        comparison = ">" if ascending else "<"
        direction = "ASC" if ascending else "DESC"
        read_order = "(read_at IS NOT NULL OR resolved_at IS NOT NULL)"
        if anchor is not None:
            value = getattr(anchor, sort_column)
            seek = f"({sort_column} {comparison} ? OR ({sort_column} = ? AND id {comparison} ?))"
            if state == "published":
                rank = int(anchor.read_at is not None or anchor.resolved_at is not None)
                clauses.append(f"({read_order} > ? OR ({read_order} = ? AND {seek}))")
                params.extend([rank, rank, value, value, anchor.id])
            else:
                clauses.append(seek)
                params.extend([value, value, anchor.id])
        ordering = f"{sort_column} {direction}, id {direction}"
        if state == "published":
            ordering = f"{read_order} ASC, {ordering}"
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        rows = query_all(
            self.conn,
            f"SELECT * FROM notifications{where} ORDER BY {ordering} LIMIT ?",
            (*params, limit),
        )
        return [Notification(**row) for row in rows]

    def unread_count(self) -> int:
        row = query_one(
            self.conn,
            "SELECT COUNT(*) AS n FROM notifications WHERE state = 'published' AND read_at IS NULL AND resolved_at IS NULL",
        )
        return int(row["n"]) if row else 0

    def get(self, notification_id: str) -> Notification | None:
        row = query_one(self.conn, "SELECT * FROM notifications WHERE id = ?", (notification_id,))
        return Notification(**row) if row else None

    def subscribe_push(
        self, endpoint: str, public: str, auth: str, server_key: str, now: str
    ) -> None:
        execute(
            self.conn,
            "INSERT INTO notification_push_subscriptions(endpoint,p256dh,auth,application_server_key,created_at) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,application_server_key=excluded.application_server_key",
            (endpoint, public, auth, server_key, now),
        )

    def unsubscribe_push(self, endpoint: str) -> None:
        execute(
            self.conn, "DELETE FROM notification_push_subscriptions WHERE endpoint = ?", (endpoint,)
        )

    def push_subscriptions(self, server_key: str) -> list[dict[str, object]]:
        rows = query_all(
            self.conn,
            "SELECT endpoint,p256dh,auth FROM notification_push_subscriptions WHERE application_server_key = ?",
            (server_key,),
        )
        return [
            {"endpoint": row["endpoint"], "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
            for row in rows
        ]

    def stale_for_job(self, job_id: str) -> Notification | None:
        row = query_one(
            self.conn,
            "SELECT * FROM notifications WHERE job_id = ? AND kind = 'application_stale'",
            (job_id,),
        )
        return Notification(**row) if row else None

    def save(self, notification: Notification) -> None:
        fields = notification.model_dump()
        columns = list(fields)
        assignments = ", ".join(f"{field} = excluded.{field}" for field in columns if field != "id")
        execute(
            self.conn,
            f"INSERT INTO notifications ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)}) ON CONFLICT(id) DO UPDATE SET {assignments}",
            tuple(fields.values()),
        )

    def pending(self) -> list[Notification]:
        rows = query_all(
            self.conn,
            "SELECT * FROM notifications WHERE state = 'published' AND delivered_at IS NULL AND resolved_at IS NULL AND alert_suppressed_at IS NULL ORDER BY published_at, id",
        )
        return [Notification(**row) for row in rows]

    def suppress_alert(self, notification_id: str, now: str) -> None:
        execute(
            self.conn,
            "UPDATE notifications SET alert_suppressed_at = ?, updated_at = ? WHERE id = ?",
            (now, now, notification_id),
        )

    def due(self, now: str) -> list[Notification]:
        rows = query_all(
            self.conn,
            "SELECT * FROM notifications WHERE state = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at, id LIMIT 100",
            (now,),
        )
        return [Notification(**row) for row in rows]

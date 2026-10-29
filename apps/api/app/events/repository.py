import json

from app.core.db import Conn, Row, execute, hydrate_json, query_all, query_one
from app.core.enums import Event as EventType
from app.core.enums import Status, correction_event
from app.events.models import Event

# meta_hash is write-only/internal (novelty check), so it's not in the read set.
_COLUMNS = "id, job_id, event, ts, listing_id, meta"


def _to_event(row: Row) -> Event:
    return Event(**hydrate_json(row))


class EventRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def operation(self, key: str) -> Row | None:
        return query_one(
            self.conn, "SELECT * FROM event_operations WHERE operation_key = ?", (key,)
        )

    def remember_operation(self, key: str, request_hash: str, result: str, created_at: str) -> None:
        execute(
            self.conn,
            "INSERT INTO event_operations (operation_key, request_hash, result, created_at) "
            "VALUES (?, ?, ?, ?)",
            (key, request_hash, result, created_at),
        )

    def insert(
        self,
        job_id: str,
        event: str,
        ts: str,
        *,
        listing_id: str | None,
        meta: dict[str, object] | None,
        meta_hash: str | None,
    ) -> int:
        row = query_one(
            self.conn,
            "INSERT INTO events (job_id, event, ts, listing_id, meta, meta_hash) "
            "VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            (job_id, event, ts, listing_id, json.dumps(meta) if meta else None, meta_hash),
        )
        assert row is not None
        return int(row["id"])

    def latest_meta_hash(self, job_id: str, event: str) -> str | None:
        """Hash of the newest event of this kind for the job — the novelty baseline
        a flag submission compares against."""
        row = query_one(
            self.conn,
            "SELECT meta_hash FROM events WHERE job_id = ? AND event = ? "
            "ORDER BY ts DESC, id DESC LIMIT 1",
            (job_id, event),
        )
        return row["meta_hash"] if row else None

    def get(self, event_id: int) -> Event | None:
        row = query_one(self.conn, f"SELECT {_COLUMNS} FROM events WHERE id = ?", (event_id,))
        return _to_event(row) if row else None

    def update_meta(
        self, event_id: int, meta: dict[str, object] | None, meta_hash: str | None
    ) -> None:
        """Replace an event's metadata and its deduplication hash."""
        execute(
            self.conn,
            "UPDATE events SET meta = ?, meta_hash = ? WHERE id = ?",
            (json.dumps(meta) if meta else None, meta_hash, event_id),
        )

    def set_ts(self, event_id: int, ts: str) -> None:
        """Correct when an event happened without changing its verb or metadata."""
        execute(self.conn, "UPDATE events SET ts = ? WHERE id = ?", (ts, event_id))

    def list_for_job(self, job_id: str) -> list[Event]:
        rows = query_all(
            self.conn, f"SELECT {_COLUMNS} FROM events WHERE job_id = ? ORDER BY ts, id", (job_id,)
        )
        return [_to_event(r) for r in rows]

    def last_activity_for_jobs(self, job_ids: list[str]) -> dict[str, str]:
        """Latest status-setting/note timestamp for each requested job.

        One windowed query preserves the projection's ``(ts, id)`` ordering and
        avoids a request per dashboard card. The explicit event whitelist is the
        SQL equivalent of ``status_set_by`` semantics: organic transitions and
        every correction count, while created/flag rows do not.
        """
        if not job_ids:
            return {}
        activity_events = [
            EventType.NOTE.value,
            *(status.value for status in Status if status is not Status.NEW),
            *(correction_event(status) for status in Status),
        ]
        job_placeholders = ", ".join("?" for _ in job_ids)
        event_placeholders = ", ".join("?" for _ in activity_events)
        rows = query_all(
            self.conn,
            "SELECT job_id, ts FROM ("
            "SELECT job_id, ts, ROW_NUMBER() OVER ("
            "PARTITION BY job_id ORDER BY ts DESC, id DESC"
            ") AS activity_rank FROM events "
            f"WHERE job_id IN ({job_placeholders}) "
            f"AND event IN ({event_placeholders}) "
            "AND NOT (event = 'closed' "
            'AND meta LIKE \'%"source": "automatic"%\' '
            "AND meta LIKE '%\"invalidated_at\":%')"
            ") WHERE activity_rank = 1",
            (*job_ids, *activity_events),
        )
        return {str(row["job_id"]): str(row["ts"]) for row in rows}

    def move_by_listing(self, listing_id: str, old_job_id: str, new_job_id: str) -> None:
        """Reattach events that came from this listing to the new job. With no
        per-day uniqueness anymore this is a plain reassignment — ids/ts/order
        are preserved, and duplicates across the two jobs are simply kept."""
        execute(
            self.conn,
            "UPDATE events SET job_id = ? WHERE listing_id = ? AND job_id = ?",
            (new_job_id, listing_id, old_job_id),
        )

    def move_all(self, old_job_id: str, new_job_id: str) -> None:
        """Reattach every remaining event off a job being dissolved."""
        execute(
            self.conn, "UPDATE events SET job_id = ? WHERE job_id = ?", (new_job_id, old_job_id)
        )

    def clear_listing(self, listing_id: str) -> None:
        """Drop the listing provenance from its events, keeping them as job-level
        history — used when a single listing is deleted but its job survives."""
        execute(
            self.conn, "UPDATE events SET listing_id = NULL WHERE listing_id = ?", (listing_id,)
        )

    def delete_for_job(self, job_id: str) -> None:
        execute(self.conn, "DELETE FROM events WHERE job_id = ?", (job_id,))

    def delete_by_id(self, event_id: int) -> None:
        """Remove one event for note deletion or status undo."""
        execute(self.conn, "DELETE FROM events WHERE id = ?", (event_id,))

"""Feature-owned ownership changes; caller retains transaction ownership."""

from __future__ import annotations

from app.infra.database import Conn, execute


def move_listing_job_context(conn: Conn, listing_id: str, new_job_id: str) -> None:
    """Keep capture context aligned when its listing moves to another job."""
    execute(
        conn, "UPDATE form_captures SET job_id = ? WHERE listing_id = ?", (new_job_id, listing_id)
    )


def move_job_context(conn: Conn, old_job_id: str, new_job_id: str) -> None:
    """Reattach every remaining capture before a merged job is dissolved."""
    execute(conn, "UPDATE form_captures SET job_id = ? WHERE job_id = ?", (new_job_id, old_job_id))


def clear_listing_context(conn: Conn, listing_id: str) -> None:
    """Retain captures without dangling provenance after listing deletion."""
    execute(conn, "UPDATE form_captures SET listing_id = NULL WHERE listing_id = ?", (listing_id,))


def clear_job_context(conn: Conn, job_id: str) -> None:
    """Retain captures without a dangling job after deliberate deletion."""
    execute(conn, "UPDATE form_captures SET job_id = NULL WHERE job_id = ?", (job_id,))

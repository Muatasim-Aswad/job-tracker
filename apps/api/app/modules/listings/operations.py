"""Feature-owned ownership changes; caller retains transaction ownership."""

from app.infra.database import Conn, execute


def set_job(conn: Conn, listing_id: str, job_id: str, updated_at: str) -> None:
    execute(
        conn,
        "UPDATE listings SET job_id = ?, updated_at = ? WHERE id = ?",
        (job_id, updated_at, listing_id),
    )


def delete(conn: Conn, listing_id: str) -> None:
    execute(conn, "DELETE FROM listings WHERE id = ?", (listing_id,))


def delete_for_job(conn: Conn, job_id: str) -> None:
    execute(conn, "DELETE FROM listings WHERE job_id = ?", (job_id,))

"""Feature-owned ownership changes; caller retains transaction ownership."""

from app.infra.database import Conn, execute


def move_all(conn: Conn, old_job_id: str, new_job_id: str) -> None:
    execute(conn, "UPDATE documents SET job_id = ? WHERE job_id = ?", (new_job_id, old_job_id))
    execute(
        conn, "UPDATE document_operations SET job_id = ? WHERE job_id = ?", (new_job_id, old_job_id)
    )


def delete_for_job(conn: Conn, job_id: str) -> None:
    execute(conn, "DELETE FROM documents WHERE job_id = ?", (job_id,))

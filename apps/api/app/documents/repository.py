import json
from typing import Any

from app.core.db import Conn, Row, execute, hydrate_json, query_all, query_one
from app.documents.models import Document

_COLUMNS = "id, job_id, type, requested, provided, content, created_at, updated_at, meta"


def _to_document(row: Row) -> Document:
    return Document(**hydrate_json(row, empty={}))


class DocumentRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def creation(self, key: str) -> Row | None:
        return query_one(
            self.conn,
            "SELECT document_id, request_hash FROM document_creations WHERE creation_key = ?",
            (key,),
        )

    def operation(self, key: str) -> Row | None:
        return query_one(
            self.conn, "SELECT * FROM document_operations WHERE operation_key = ?", (key,)
        )

    def remember_operation(
        self, key: str, document_id: int, job_id: str, request_hash: str, created_at: str
    ) -> None:
        # Deliberately no cascading foreign keys: deletion must leave a receipt.
        execute(
            self.conn,
            "INSERT INTO document_operations "
            "(operation_key, document_id, job_id, request_hash, created_at) VALUES (?, ?, ?, ?, ?)",
            (key, document_id, job_id, request_hash, created_at),
        )

    def remember_creation(self, key: str, document_id: int, request_hash: str) -> None:
        execute(
            self.conn,
            "INSERT INTO document_creations (creation_key, document_id, request_hash) VALUES (?, ?, ?)",
            (key, document_id, request_hash),
        )

    def insert(
        self,
        job_id: str,
        type_: str,
        requested: str | None,
        provided: bool,
        content: str | None,
        created_at: str,
        updated_at: str,
        meta: dict[str, Any] | None = None,
    ) -> int:
        # RETURNING the id rather than reading `cur.lastrowid`: the libSQL replica
        # connection doesn't populate lastrowid reliably (it can hand back a stale,
        # non-None value), which left the follow-up fetch empty. RETURNING is exact
        # on both the app driver and the sqlite3 test driver.
        row = query_one(
            self.conn,
            "INSERT INTO documents "
            "(job_id, type, requested, provided, content, created_at, updated_at, meta) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            (
                job_id,
                type_,
                requested,
                int(provided),
                content,
                created_at,
                updated_at,
                json.dumps(meta) if meta else None,
            ),
        )
        assert row is not None
        return int(row["id"])

    def get(self, document_id: int) -> Document | None:
        rows = query_all(
            self.conn, f"SELECT {_COLUMNS} FROM documents WHERE id = ?", (document_id,)
        )
        return _to_document(rows[0]) if rows else None

    def list_for_job(self, job_id: str) -> list[Document]:
        rows = query_all(
            self.conn,
            f"SELECT {_COLUMNS} FROM documents WHERE job_id = ? ORDER BY created_at",
            (job_id,),
        )
        return [_to_document(r) for r in rows]

    def update(self, document_id: int, fields: dict[str, object], updated_at: str) -> None:
        """Patch a subset of a document's columns (only the keys present in
        `fields`), always bumping `updated_at`. `provided` is coerced to an int by
        the caller. No-op when there's nothing to set."""
        if not fields:
            return
        fields = dict(fields)
        if "meta" in fields:
            fields["meta"] = json.dumps(fields["meta"]) if fields["meta"] else None
        sets = [f"{col} = ?" for col in fields]
        params = [*fields.values(), updated_at, document_id]
        sets.append("updated_at = ?")
        execute(self.conn, f"UPDATE documents SET {', '.join(sets)} WHERE id = ?", params)

    def delete_by_id(self, document_id: int) -> None:
        execute(self.conn, "DELETE FROM documents WHERE id = ?", (document_id,))

    def move_all(self, old_job_id: str, new_job_id: str) -> None:
        execute(
            self.conn, "UPDATE documents SET job_id = ? WHERE job_id = ?", (new_job_id, old_job_id)
        )
        execute(
            self.conn,
            "UPDATE document_operations SET job_id = ? WHERE job_id = ?",
            (new_job_id, old_job_id),
        )

    def delete_for_job(self, job_id: str) -> None:
        execute(self.conn, "DELETE FROM documents WHERE job_id = ?", (job_id,))

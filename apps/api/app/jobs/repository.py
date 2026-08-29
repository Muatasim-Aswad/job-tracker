import json

from app.core.db import Conn, Row, execute, hydrate_json, query_all, query_one
from app.core.enums import APPLIED_EVIDENCE
from app.jobs.models import Job, JobFilters

_COLUMNS = (
    "id, title, company, company_key, title_key, status, hidden, starred, meta, "
    "created_at, updated_at"
)


def _to_job(row: Row) -> Job:
    return Job(**hydrate_json(row, empty={}))


class JobRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def get(self, job_id: str) -> Job | None:
        row = query_one(self.conn, f"SELECT {_COLUMNS} FROM jobs WHERE id = ?", (job_id,))
        return _to_job(row) if row else None

    def resolve_id(self, job_id: str) -> str | None:
        """Resolve a live or merged identity to its live canonical job id."""
        if self.get(job_id) is not None:
            return job_id
        row = query_one(
            self.conn, "SELECT canonical_job_id FROM job_id_aliases WHERE old_job_id = ?", (job_id,)
        )
        return str(row["canonical_job_id"]) if row else None

    def alias_merged_id(self, old_job_id: str, canonical_job_id: str, merged_at: str) -> None:
        """Flatten prior aliases and retain the newly dissolved identity."""
        execute(
            self.conn,
            "UPDATE job_id_aliases SET canonical_job_id = ? WHERE canonical_job_id = ?",
            (canonical_job_id, old_job_id),
        )
        execute(
            self.conn,
            "INSERT INTO job_id_aliases (old_job_id, canonical_job_id, merged_at) VALUES (?, ?, ?)",
            (old_job_id, canonical_job_id, merged_at),
        )

    def insert(self, job: Job) -> None:
        execute(
            self.conn,
            f"INSERT INTO jobs ({_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                job.id,
                job.title,
                job.company,
                job.company_key,
                job.title_key,
                job.status,
                int(job.hidden),
                int(job.starred),
                json.dumps(job.meta) if job.meta else None,
                job.created_at,
                job.updated_at,
            ),
        )

    def set_meta(self, job_id: str, meta: dict[str, object], updated_at: str) -> None:
        """Replace the complete metadata bag, storing an empty bag as NULL."""
        execute(
            self.conn,
            "UPDATE jobs SET meta = ?, updated_at = ? WHERE id = ?",
            (json.dumps(meta) if meta else None, updated_at, job_id),
        )

    def set_identity(
        self,
        job_id: str,
        title: str | None,
        company: str | None,
        company_key: str | None,
        title_key: str | None,
        updated_at: str,
    ) -> None:
        execute(
            self.conn,
            "UPDATE jobs SET title = ?, company = ?, company_key = ?, title_key = ?, "
            "updated_at = ? WHERE id = ?",
            (title, company, company_key, title_key, updated_at, job_id),
        )

    def set_status(self, job_id: str, status: str, updated_at: str) -> None:
        execute(
            self.conn,
            "UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?",
            (status, updated_at, job_id),
        )

    def set_flags(
        self, job_id: str, hidden: bool | None, starred: bool | None, updated_at: str
    ) -> None:
        sets: list[str] = []
        params: list[object] = []
        if hidden is not None:
            sets.append("hidden = ?")
            params.append(int(hidden))
        if starred is not None:
            sets.append("starred = ?")
            params.append(int(starred))
        if not sets:
            return
        sets.append("updated_at = ?")
        params.extend([updated_at, job_id])
        execute(self.conn, f"UPDATE jobs SET {', '.join(sets)} WHERE id = ?", params)

    def delete(self, job_id: str) -> None:
        execute(self.conn, "DELETE FROM jobs WHERE id = ?", (job_id,))

    def states_by_listings(self, platform: str, platform_ids: list[str]) -> dict[str, Job]:
        """Resolve many listings on one platform to their jobs in a single query,
        keyed by platform_id. Untracked ids are simply absent from the map (the
        caller fills them as `untracked`). Empty input short-circuits — SQLite
        rejects an empty `IN ()`."""
        if not platform_ids:
            return {}
        placeholders = ", ".join("?" for _ in platform_ids)
        cols = ", ".join("j." + c for c in _COLUMNS.split(", "))
        rows = query_all(
            self.conn,
            f"SELECT l.platform_id AS platform_id, {cols} "
            "FROM jobs j JOIN listings l ON l.job_id = j.id "
            f"WHERE l.platform = ? AND l.platform_id IN ({placeholders})",
            (platform, *platform_ids),
        )
        out: dict[str, Job] = {}
        for row in rows:
            pid = row.pop("platform_id")
            out[pid] = _to_job(row)
        return out

    def match_candidates(self, company_key: str, title_key: str) -> list[Row]:
        """Jobs sharing BOTH normalized keys — the duplicate-suggestion set,
        newest-first. Rolls in a listing count and the latest `closed_at` across
        each job's postings (MAX ignores the NULLs of still-open listings), so the
        popover can show whether a candidate's posting has since closed. Caller
        filters out the current job + its `false_matches`; kept out of SQL because
        that exclude set is a handful of ids, not worth threading through a
        variable-length IN clause."""
        return query_all(
            self.conn,
            "SELECT j.id AS job_id, j.title, j.company, j.status, j.created_at, "
            "COUNT(l.id) AS listing_count, MAX(l.closed_at) AS closed_at "
            "FROM jobs j LEFT JOIN listings l ON l.job_id = j.id "
            "WHERE j.company_key = ? AND j.title_key = ? "
            "GROUP BY j.id ORDER BY j.created_at DESC",
            (company_key, title_key),
        )

    def applied_count_for_company(self, company_key: str) -> int:
        """How many of this company's jobs carry applied evidence (APPLIED_EVIDENCE:
        applied-or-beyond plus the post-application terminals) — the "previous
        applications to this company" count behind the extension's badge. Keyed by
        the advisory `company_key`, same as the duplicate suggestions."""
        statuses = sorted(APPLIED_EVIDENCE)  # sorted: deterministic SQL for tests/logs
        placeholders = ", ".join("?" for _ in statuses)
        row = query_one(
            self.conn,
            f"SELECT COUNT(*) AS n FROM jobs WHERE company_key = ? AND status IN ({placeholders})",
            (company_key, *statuses),
        )
        return int(row["n"]) if row else 0

    def search(self, filters: JobFilters) -> list[Job]:
        """List/filter jobs, newest-updated first — see `JobFilters` for the
        semantics of each field."""
        from app.core.text import normalize_company, normalize_title

        clauses: list[str] = []
        params: list[object] = []
        if filters.status:
            clauses.append("j.status = ?")
            params.append(filters.status)
        if filters.company:
            clauses.append("j.company_key = ?")
            params.append(normalize_company(filters.company))
        if filters.title:
            clauses.append("j.title_key = ?")
            params.append(normalize_title(filters.title))
        if filters.q:
            clauses.append("(j.title LIKE ? OR j.company LIKE ?)")
            like = f"%{filters.q}%"
            params.extend([like, like])
        if filters.hidden is not None:
            clauses.append("j.hidden = ?")
            params.append(int(filters.hidden))
        if filters.starred is not None:
            clauses.append("j.starred = ?")
            params.append(int(filters.starred))
        # A stub is a job we never captured a title for (born from a bare event:
        # seen/closed/auto-hide). The board passes stubs=False to keep them out of
        # the human list; scripts pass nothing (None) so backfill/merge still see
        # every row; stubs=True is the cleanup view. NULL check, so no bound param.
        if filters.stubs is not None:
            clauses.append("j.title IS NULL" if filters.stubs else "j.title IS NOT NULL")
        sql = f"SELECT DISTINCT {', '.join('j.' + c for c in _COLUMNS.split(', '))} FROM jobs j"
        if filters.apply_type:
            sql += " JOIN listings l ON l.job_id = j.id"
            clauses.append("l.apply_type = ?")
            params.append(filters.apply_type)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY j.updated_at DESC"
        if filters.limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params.extend([filters.limit, filters.offset])
        return [_to_job(r) for r in query_all(self.conn, sql, params)]

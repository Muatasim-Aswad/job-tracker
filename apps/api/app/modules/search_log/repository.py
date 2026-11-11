from app.infra.database import Conn, Row, execute, query_all
from app.modules.search_log.models import SearchLogRow

# Keep the projection in physical schema order. pyturso currently mislabels
# reordered SELECT projections after a pulled schema change.
_COLUMNS = "id, ts, host, seed, query, results, job_id, seed_rule, seed_results"


def _to_row(row: Row) -> SearchLogRow:
    return SearchLogRow(**row)


class SearchLogRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def insert(
        self,
        *,
        ts: str,
        host: str | None,
        seed_rule: str | None,
        seed: str | None,
        seed_results: int | None,
        query: str | None,
        results: int | None,
        job_id: str | None,
    ) -> None:
        execute(
            self.conn,
            "INSERT INTO search_log "
            "(ts, host, seed_rule, seed, seed_results, query, results, job_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (ts, host, seed_rule, seed, seed_results, query, results, job_id),
        )

    def counts_by_rule(self) -> list[Row]:
        """Attempts and clicks per automatic seed rule, or `typed` without one."""
        return query_all(
            self.conn,
            "SELECT COALESCE(seed_rule, 'typed') AS rule, "
            "COUNT(*) AS attempts, "
            "SUM(CASE WHEN job_id IS NOT NULL THEN 1 ELSE 0 END) AS clicks "
            "FROM search_log GROUP BY COALESCE(seed_rule, 'typed') "
            "ORDER BY attempts DESC, rule",
        )

    def recent(self, limit: int) -> list[SearchLogRow]:
        rows = query_all(
            self.conn, f"SELECT {_COLUMNS} FROM search_log ORDER BY id DESC LIMIT ?", (limit,)
        )
        return [_to_row(r) for r in rows]

    def prune(self, keep: int) -> None:
        """Keep only the `keep` most recent rows and drop the rest, bounding how
        much diagnostic history accumulates locally."""
        execute(
            self.conn,
            "DELETE FROM search_log WHERE id NOT IN "
            "(SELECT id FROM search_log ORDER BY id DESC LIMIT ?)",
            (keep,),
        )

    def clear(self) -> None:
        """Delete every stored row (the popup's 'Clear stored data')."""
        execute(self.conn, "DELETE FROM search_log")

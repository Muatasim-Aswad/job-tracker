from app.infra.database import Conn, Row, query_all, query_one


class StatsRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def funnel_counts(self) -> list[Row]:
        return query_all(self.conn, "SELECT status, COUNT(*) AS n FROM jobs GROUP BY status")

    def apply_type_counts(self) -> list[Row]:
        return query_all(
            self.conn, "SELECT apply_type, COUNT(*) AS n FROM listings GROUP BY apply_type"
        )

    def total_jobs(self) -> int:
        row = query_one(self.conn, "SELECT COUNT(*) AS n FROM jobs")
        return int(row["n"]) if row else 0

from app.infra.database import Conn
from app.modules.stats.repository import StatsRepository
from app.modules.stats.schemas import Stats


def compute(conn: Conn) -> Stats:
    funnel = {row["status"]: row["n"] for row in StatsRepository(conn).funnel_counts()}
    apply_type = {
        row["apply_type"] or "unknown": row["n"]
        for row in StatsRepository(conn).apply_type_counts()
    }

    return Stats(
        total_jobs=StatsRepository(conn).total_jobs(), funnel=funnel, apply_type=apply_type
    )

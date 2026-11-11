import time

from app.infra.database import Conn
from app.modules.preferences import service as preferences
from app.modules.search_log.models import SearchLogRow
from app.modules.search_log.repository import SearchLogRepository
from app.modules.search_log.schemas import RuleReport, SearchLogCreate, SearchReport
from app.shared.timeutil import utc_now

RETENTION_LIMIT = 1000


def _rate(clicks: int, attempts: int) -> float:
    return round(clicks / attempts, 3) if attempts else 0.0


def record(conn: Conn, body: SearchLogCreate) -> None:
    settings = preferences.read(conn).settings.search_diagnostics
    if settings.scope == "never" or (
        settings.scope == "temporary" and (settings.expires_at or 0) <= time.time() * 1000
    ):
        return

    SearchLogRepository(conn).insert(
        ts=utc_now(),
        host=body.host,
        seed_rule=body.seed_rule,
        seed=body.seed,
        seed_results=body.seed_results,
        query=body.query,
        results=body.results,
        job_id=body.job_id,
    )
    SearchLogRepository(conn).prune(RETENTION_LIMIT)


def clear(conn: Conn) -> None:
    SearchLogRepository(conn).clear()


def report(conn: Conn) -> SearchReport:
    by_rule: list[RuleReport] = []
    total_attempts = total_clicks = 0
    for row in SearchLogRepository(conn).counts_by_rule():
        attempts = int(row["attempts"] or 0)
        clicks = int(row["clicks"] or 0)
        total_attempts += attempts
        total_clicks += clicks
        by_rule.append(
            RuleReport(
                rule=row["rule"],
                attempts=attempts,
                clicks=clicks,
                click_rate=_rate(clicks, attempts),
            )
        )

    return SearchReport(
        total_attempts=total_attempts,
        total_clicks=total_clicks,
        click_rate=_rate(total_clicks, total_attempts),
        by_rule=by_rule,
    )


def recent(conn: Conn, limit: int) -> list[SearchLogRow]:
    return SearchLogRepository(conn).recent(limit)

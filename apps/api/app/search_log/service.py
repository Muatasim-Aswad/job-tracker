import time

from app.core.db import Conn
from app.core.timeutil import utc_now
from app.preferences.service import PreferencesService
from app.search_log.models import SearchLogRow
from app.search_log.repository import SearchLogRepository
from app.search_log.schemas import RuleReport, SearchLogCreate, SearchReport

# Diagnostics are local-only debugging data, not an audit trail: cap the table so
# it can't grow without bound. The newest RETENTION_LIMIT rows are always kept.
RETENTION_LIMIT = 1000


def _rate(clicks: int, attempts: int) -> float:
    return round(clicks / attempts, 3) if attempts else 0.0


class SearchLogService:
    def __init__(self, conn: Conn) -> None:
        self.repo = SearchLogRepository(conn)
        self.preferences = PreferencesService(conn)

    def record(self, body: SearchLogCreate) -> None:
        settings = self.preferences.read().settings.search_diagnostics
        if settings.scope == "never" or (
            settings.scope == "temporary" and (settings.expires_at or 0) <= time.time() * 1000
        ):
            return
        self.repo.insert(
            ts=utc_now(),
            host=body.host,
            seed_rule=body.seed_rule,
            seed=body.seed,
            seed_results=body.seed_results,
            query=body.query,
            results=body.results,
            job_id=body.job_id,
        )
        self.repo.prune(RETENTION_LIMIT)

    def clear(self) -> None:
        self.repo.clear()

    def report(self) -> SearchReport:
        by_rule: list[RuleReport] = []
        total_attempts = total_clicks = 0
        for row in self.repo.counts_by_rule():
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

    def recent(self, limit: int) -> list[SearchLogRow]:
        return self.repo.recent(limit)

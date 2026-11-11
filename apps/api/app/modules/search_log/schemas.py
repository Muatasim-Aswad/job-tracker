from pydantic import BaseModel


class SearchLogCreate(BaseModel):
    """One full-context search-diagnostics row from an explicitly enabled popup."""

    results: int | None = None  # matches returned by the final query
    host: str | None = None
    seed_rule: str | None = None  # extractor that produced the automatic seed
    seed: str | None = None
    seed_results: int | None = None  # matches returned by the automatic seed
    query: str | None = None  # final searched text, including a replacement
    job_id: str | None = None


class RuleReport(BaseModel):
    rule: str
    attempts: int
    clicks: int
    click_rate: float  # clicks / attempts, 0..1


class SearchReport(BaseModel):
    total_attempts: int
    total_clicks: int
    click_rate: float
    by_rule: list[RuleReport]

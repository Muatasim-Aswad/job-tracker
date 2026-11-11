from pydantic import BaseModel


class SearchLogRow(BaseModel):
    id: int
    ts: str
    host: str | None
    seed_rule: str | None
    seed: str | None
    seed_results: int | None
    query: str | None
    results: int | None
    job_id: str | None

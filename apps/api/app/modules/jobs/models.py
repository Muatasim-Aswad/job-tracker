from typing import Any

from pydantic import BaseModel, Field


class Job(BaseModel):
    id: str
    title: str | None = None
    company: str | None = None
    company_key: str | None = None
    title_key: str | None = None
    status: str
    hidden: bool
    starred: bool
    # User-defined fields only; funnel state remains in typed columns.
    meta: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str


class JobFilters(BaseModel):
    """Filters shared by the jobs router, service, and repository.

    `company` and `title` use normalized duplicate-suggestion keys; `q` searches
    raw title and company text. Boolean filters are tri-state, and `stubs`
    distinguishes titleless placeholders from captured jobs.
    """

    status: str | None = None
    company: str | None = None
    title: str | None = None
    apply_type: str | None = None
    q: str | None = None
    hidden: bool | None = None
    starred: bool | None = None
    stubs: bool | None = None
    limit: int | None = Field(default=None, ge=1)
    offset: int = Field(default=0, ge=0)

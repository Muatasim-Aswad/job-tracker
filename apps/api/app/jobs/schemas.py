from typing import Any, Literal

from pydantic import BaseModel

from app.documents.models import Document
from app.events.models import Event
from app.jobs.models import Job
from app.listings.models import Listing


class JobState(BaseModel):
    """Compact listing state; `untracked` is a read-only synthetic status."""

    status: str
    hidden: bool
    starred: bool


class JobMutationState(JobState):
    """Result of a job-state write, carrying the resolved canonical identity."""

    job_id: str


class ListingState(JobState):
    """Listing state tagged with its platform-native id."""

    platform_id: str


class PrimaryListing(BaseModel):
    """Preferred listing address for a dashboard card."""

    platform: str
    platform_id: str
    url: str | None = None


class Attention(BaseModel):
    """Read-only reminder for a stalled post-application stage."""

    stage: Literal["applied", "in_process"]
    since: str
    days: int


class JobSummary(Job):
    """Job plus the listing rollup needed by dashboard cards."""

    platforms: list[str] = []
    apply_types: list[str] = []
    listing_count: int = 0
    primary_listing: PrimaryListing | None = None
    attention: Attention | None = None


class JobUpdate(BaseModel):
    """Identity and metadata changes; metadata replaces the complete bag."""

    title: str | None = None
    company: str | None = None
    meta: dict[str, Any] | None = None


class JobDetail(Job):
    listings: list[Listing] = []
    events: list[Event] = []
    documents: list[Document] = []


class CompanyAppliedCount(BaseModel):
    """Applied-job count and the normalized company key used for lookup."""

    company_key: str | None = None
    count: int = 0


class JobMatch(BaseModel):
    """Duplicate-suggestion candidate after false-match filtering."""

    job_id: str
    title: str | None = None
    company: str | None = None
    status: str
    created_at: str
    closed_at: str | None = None  # latest listing closed_at, if any posting closed
    listing_count: int = 0
    # Jaccard JD-overlap (0..1) with the viewed listing — the popover's "N% match".
    # None when either side has no captured JD yet, so the popover degrades to a
    # plain candidate list rather than a misleading 0%.
    similarity: float | None = None

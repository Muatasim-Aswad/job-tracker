from typing import Any

from pydantic import BaseModel, Field

from app.core.enums import ApplyType


class ListingCreate(BaseModel):
    platform: str
    platform_id: str
    url: str | None = None
    title: str | None = None
    company: str | None = None
    apply_type: ApplyType | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
    # Discovery-card facts enrich an existing full capture instead of replacing it.
    meta_patch: dict[str, Any] = Field(default_factory=dict)
    closed_at: str | None = None  # "no longer accepting" — a natural-keyed listing fact
    job_id: str | None = None  # explicit link; otherwise a new listing auto-creates a job
    # Recorded on `created` only when this listing creates its job.
    via: str = "capture"


class ListingUpdate(BaseModel):
    url: str | None = None
    title: str | None = None
    company: str | None = None
    apply_type: ApplyType | None = None
    meta: dict[str, Any] | None = None
    closed_at: str | None = None  # explicit null reopens; omission leaves it unchanged
    job_id: str | None = None  # relink via the shared link_listing_to_job cascade


class ListingUpsertResult(BaseModel):
    job_id: str
    listing_id: str


class FalseMatchCreate(BaseModel):
    """Mutually exclude the current listing's job and a candidate job."""

    platform: str
    platform_id: str
    other_job_id: str


class LinkJobCreate(BaseModel):
    """Merge the current listing's complete job with another job."""

    platform: str
    platform_id: str
    other_job_id: str

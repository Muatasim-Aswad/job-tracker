from typing import Any, Self

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from app.core.enums import ApplyType, ListingAvailability


class ListingCreate(BaseModel):
    """Capture observations; missing, null, or empty facts preserve stored values."""

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
    availability: ListingAvailability | None = None
    availability_message: str | None = Field(default=None, max_length=1000)
    availability_observed_at: AwareDatetime | None = None
    job_id: str | None = None  # explicit link; otherwise a new listing auto-creates a job
    # Recorded on `created` only when this listing creates its job.
    via: str = "capture"

    @model_validator(mode="after")
    def availability_evidence(self) -> Self:
        if self.availability is None and (
            self.availability_message is not None or self.availability_observed_at is not None
        ):
            raise ValueError("availability evidence requires an availability value")
        if self.closed_at is not None and self.availability not in (
            None,
            ListingAvailability.UNKNOWN,
            ListingAvailability.CLOSED,
        ):
            raise ValueError("closed_at conflicts with the availability observation")
        return self


class ListingUpdate(BaseModel):
    """Explicit edits; metadata replaces the complete bag and can clear values."""

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
    merged_from: list[str] = Field(default_factory=list)


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

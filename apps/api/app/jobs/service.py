"""Job reads plus the dashboard identity edit.

All state changes (status/hidden/starred) go through `POST /events`, so this
module is read-only except for `update`, which edits descriptive job identity
(title/company) and never funnel state.
"""

from datetime import UTC, datetime
from typing import Literal

from app.application_workflows.repository import ApplicationWorkflowRepository
from app.core.config import Settings
from app.core.db import Conn
from app.core.errors import ConflictError, NotFoundError
from app.core.similarity import jaccard, tokenize
from app.core.text import normalize_company, normalize_title
from app.core.timeutil import utc_now
from app.documents.repository import DocumentRepository
from app.events.repository import EventRepository
from app.form_fill.repository import FormFillRepository
from app.jobs.models import Job, JobFilters
from app.jobs.repository import JobRepository
from app.jobs.schemas import (
    Attention,
    CompanyAppliedCount,
    JobDetail,
    JobMatch,
    JobState,
    JobSummary,
    JobUpdate,
    ListingState,
    PrimaryListing,
)
from app.listings.repository import ListingRepository


class JobService:
    def __init__(self, conn: Conn, settings: Settings | None = None) -> None:
        self.jobs = JobRepository(conn)
        self.events = EventRepository(conn)
        self.listings = ListingRepository(conn)
        self.documents = DocumentRepository(conn)
        self.application_workflows = ApplicationWorkflowRepository(conn)
        self.form_fill = FormFillRepository(conn)
        self.settings = settings or Settings()

    # --- reads ------------------------------------------------------------

    def search(self, filters: JobFilters) -> list[JobSummary]:
        """Filtered job list, each enriched with a compact listing rollup so the board
        renders cards without a per-job fetch. The rollup is one batched query over
        just the jobs on this page, and attention is a second batched read over the
        same page — never one event query per card."""
        jobs = self.jobs.search(filters)
        job_ids = [j.id for j in jobs]
        summaries = self.listings.summaries_for_jobs(job_ids)
        last_activity = self.events.last_activity_for_jobs(job_ids)
        now = datetime.fromisoformat(utc_now())
        out: list[JobSummary] = []
        for job in jobs:
            rollup = summaries.get(job.id)
            primary = (
                PrimaryListing(
                    platform=rollup.primary_platform,
                    platform_id=rollup.primary_platform_id,
                    url=rollup.primary_url,
                )
                if rollup and rollup.primary_platform and rollup.primary_platform_id
                else None
            )
            out.append(
                JobSummary(
                    **job.model_dump(),
                    platforms=rollup.platforms if rollup else [],
                    apply_types=rollup.apply_types if rollup else [],
                    listing_count=rollup.listing_count if rollup else 0,
                    primary_listing=primary,
                    attention=self._attention(job, last_activity.get(job.id), now),
                )
            )
        return out

    def _attention(self, job: Job, activity_ts: str | None, now: datetime) -> Attention | None:
        stage: Literal["applied", "in_process"]
        if job.status == "applied":
            stage = "applied"
            threshold = self.settings.attention_applied_days
        elif job.status == "in_process":
            stage = "in_process"
            threshold = self.settings.attention_in_process_days
        else:
            return None
        if threshold == 0:
            return None

        # Legacy rows may predate the status/note event log, leaving updated_at as
        # their best clock — so only those rows inherit its flag/identity-edit noise.
        since = activity_ts or job.updated_at
        parsed = datetime.fromisoformat(since)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        days = int((now.astimezone(UTC) - parsed.astimezone(UTC)).total_seconds() // 86_400)
        if days < threshold:
            return None
        return Attention(stage=stage, since=since, days=days)

    def get_detail(self, job_id: str) -> JobDetail:
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        job = self.jobs.get(job_id) if job_id else None
        if job is None:
            raise NotFoundError(f"job {requested_job_id} not found")
        return JobDetail(
            **job.model_dump(),
            listings=self.listings.list_for_job(job_id),
            events=self.events.list_for_job(job_id),
            documents=self.documents.list_for_job(job_id),
        )

    def batch_state(self, platform: str, platform_ids: list[str]) -> list[ListingState]:
        """One self-describing entry per requested id, in request order. A listing
        with no job yet still gets an entry, carrying the `untracked` status. This
        read never creates rows: a listing materializes only on a real signal."""
        found = self.jobs.states_by_listings(platform, platform_ids)
        out: list[ListingState] = []
        for platform_id in platform_ids:
            job = found.get(platform_id)
            state = _state(job) if job is not None else _untracked()
            out.append(_tagged(platform_id, state))
        return out

    def matches(
        self, platform: str, platform_id: str, title: str | None, company: str | None
    ) -> list[JobMatch]:
        """Sibling jobs a repost of `(platform, platform_id)` might really be: those
        sharing its normalized company+title. Driven by the title and company the
        CALLER scraped live, not the current job's stored keys, since a listing just
        materialized by a `seen` event is still a NULL-keyed stub. A pure read, never
        creating a row. Excludes the current listing's own job and anything already
        marked NOT a match (`meta.false_matches`), so a dismissed candidate never
        comes back. Empty when either key is missing — one field alone is too broad
        to suggest on."""
        company_key = normalize_company(company)
        title_key = normalize_title(title)
        if not company_key or not title_key:
            return []
        exclude: set[str] = set()
        current_jd: str | None = None
        listing = self.listings.get_by_platform(platform, platform_id)
        if listing is not None:
            exclude.add(listing.job_id)
            current_jd = (listing.meta or {}).get("description")
            current = self.jobs.get(listing.job_id)
            if current is not None:
                exclude.update(
                    canonical
                    for excluded_id in current.meta.get("false_matches", [])
                    if (canonical := self.jobs.resolve_id(excluded_id)) is not None
                )
        rows = [
            row
            for row in self.jobs.match_candidates(company_key, title_key)
            if row["job_id"] not in exclude
        ]
        # Score each candidate's JD against the viewed listing's. None whenever either
        # side is uncaptured: a real 0.0, where the JDs share nothing, is distinct from
        # having no JD to compare, and the popover shows a % only for real comparisons.
        current_tokens = tokenize(current_jd) if current_jd else None
        descriptions = self.listings.descriptions_for_jobs([r["job_id"] for r in rows])
        out: list[JobMatch] = []
        for row in rows:
            cand_jd = descriptions.get(row["job_id"])
            similarity = (
                jaccard(current_tokens, tokenize(cand_jd))
                if current_tokens is not None and cand_jd
                else None
            )
            out.append(JobMatch(**row, similarity=similarity))
        # Strongest duplicate first, unscored candidates last. The stable sort keeps
        # the SQL's created_at-desc order as the tie-breaker.
        out.sort(key=lambda m: (m.similarity is None, -(m.similarity or 0.0)))
        return out

    def applied_count(self, company: str | None) -> CompanyAppliedCount:
        """How many jobs at `company` carry applied evidence — the "previous
        applications to this company" count. Driven, like `matches`, by the raw name
        the caller scraped live, normalized here to the same advisory `company_key`
        jobs store. A pure read; a name that normalizes to nothing counts 0."""
        company_key = normalize_company(company)
        if not company_key:
            return CompanyAppliedCount(company_key=None, count=0)
        return CompanyAppliedCount(
            company_key=company_key, count=self.jobs.applied_count_for_company(company_key)
        )

    # --- identity + annotation edit (state still lives in POST /events) ----

    def delete(self, job_id: str) -> None:
        """Hard-delete a job and its listings, events, and documents. Dashboard-only
        and deliberate: intentional history loss for a noise or dead job, where a real
        opportunity that ended should be `closed` instead. Children go first so no FK
        dangles, and the whole cascade commits atomically in one request."""
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        if not job_id:
            raise NotFoundError(f"job {requested_job_id} not found")
        if job_id != requested_job_id:
            raise ConflictError(
                "job_merged", {"requested_job_id": requested_job_id, "canonical_job_id": job_id}
            )
        for listing in self.listings.list_for_job(job_id):
            self.form_fill.clear_listing_context(listing.id)
        self.form_fill.clear_job_context(job_id)
        self.application_workflows.delete_for_job(job_id)
        self.events.delete_for_job(job_id)
        self.documents.delete_for_job(job_id)
        self.listings.delete_for_job(job_id)
        self.jobs.delete(job_id)

    def update(self, job_id: str, data: JobUpdate) -> Job:
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        job = self.jobs.get(job_id) if job_id else None
        if job is None:
            raise NotFoundError(f"job {requested_job_id} not found")
        if data.title is not None or data.company is not None:
            title = data.title if data.title is not None else job.title
            company = data.company if data.company is not None else job.company
            self.jobs.set_identity(
                job_id,
                title,
                company,
                normalize_company(company),
                normalize_title(title),
                utc_now(),
            )
        if data.meta is not None:
            self.jobs.set_meta(job_id, data.meta, utc_now())
        refreshed = self.jobs.get(job_id)
        assert refreshed is not None
        return refreshed


def _state(job: Job) -> JobState:
    return JobState(status=job.status, hidden=job.hidden, starred=job.starred)


def _tagged(platform_id: str, state: JobState) -> ListingState:
    """Tag a bare state with the listing it belongs to, so every state response —
    single or batch — is one self-describing `ListingState` shape."""
    return ListingState(platform_id=platform_id, **state.model_dump())


def _untracked() -> JobState:
    """The state an as-yet-uncaptured listing reads as. `untracked` is a synthetic,
    read-only status (never persisted, not a `Status` enum member) meaning no job
    exists yet — distinct from `new`, which is a real captured job at stage one."""
    return JobState(status="untracked", hidden=False, starred=False)

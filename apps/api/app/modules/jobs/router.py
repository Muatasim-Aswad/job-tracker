from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.modules.job_lifecycle.dependencies import ServiceDep as LifecycleDep
from app.modules.job_queries.dependencies import ServiceDep
from app.modules.jobs.models import Job, JobFilters
from app.modules.jobs.schemas import (
    CompanyAppliedCount,
    JobDetail,
    JobLinkCreate,
    JobMatch,
    JobMergeResult,
    JobSummary,
    JobUpdate,
    ListingState,
)
from app.modules.jobs.service import update
from app.platform.dependencies import ConnDep

router = APIRouter(tags=["jobs"])


@router.get("/jobs", response_model=list[JobSummary])
def list_jobs(*, filters: Annotated[JobFilters, Query()], service: ServiceDep) -> list[JobSummary]:
    return service.search(filters)


# Static paths must precede /jobs/{job_id}.
@router.get("/jobs/states", response_model=list[ListingState])
def state_for_listings(
    *, platform: str, platform_ids: list[str] = Query(default=[]), service: ServiceDep
) -> list[ListingState]:
    return service.batch_state(platform, platform_ids)


# Live identity supports matching before a stub receives its first full capture.
@router.get("/jobs/matches", response_model=list[JobMatch])
def match_listings(
    *,
    platform: str,
    platform_id: str,
    title: str | None = None,
    company: str | None = None,
    service: ServiceDep,
) -> list[JobMatch]:
    """Return duplicate candidates without materializing the current listing."""
    return service.matches(platform, platform_id, title, company)


# Normalize the live company name using the same advisory key as stored jobs.
@router.get("/jobs/applied-count", response_model=CompanyAppliedCount)
def applied_count(*, company: str | None = None, service: ServiceDep) -> CompanyAppliedCount:
    """Count jobs carrying application evidence for a company."""
    return service.applied_count(company)


@router.get("/jobs/{job_id}", response_model=JobDetail)
def get_job(*, job_id: str, response: Response, service: ServiceDep) -> JobDetail:
    detail = service.get_detail(job_id)
    response.headers["Content-Location"] = f"/api/jobs/{detail.id}"
    return detail


@router.get("/jobs/{job_id}/matches", response_model=list[JobMatch])
def match_job(*, job_id: str, response: Response, service: ServiceDep) -> list[JobMatch]:
    """Return duplicate candidates using the stored job and all its listings."""
    canonical_job_id, matches = service.matches_for_job(job_id)
    response.headers["Content-Location"] = f"/api/jobs/{canonical_job_id}/matches"
    return matches


@router.patch("/jobs/{job_id}", response_model=Job)
def update_job(*, job_id: str, body: JobUpdate, response: Response, conn: ConnDep) -> Job:
    job = update(conn, job_id, body)
    response.headers["Content-Location"] = f"/api/jobs/{job.id}"
    return job


@router.post("/jobs/{job_id}/link-job", response_model=JobMergeResult)
def link_job(
    *, job_id: str, body: JobLinkCreate, response: Response, service: LifecycleDep
) -> JobMergeResult:
    """Merge two complete stored jobs under the standard survivor rules."""
    merged = service.merge_jobs(job_id, body.other_job_id)
    response.headers["Content-Location"] = f"/api/jobs/{merged.job_id}"
    return merged


@router.post("/jobs/{job_id}/false-match", status_code=204)
def false_match_job(*, job_id: str, body: JobLinkCreate, service: LifecycleDep) -> Response:
    """Mutually exclude two stored jobs from duplicate suggestions."""
    canonical_id = service.mark_jobs_false_match(job_id, body.other_job_id)
    return Response(status_code=204, headers={"Content-Location": f"/api/jobs/{canonical_id}"})


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(*, job_id: str, service: LifecycleDep) -> Response:
    """Delete a job and all of its listings, events, and documents."""
    service.delete_job(job_id)
    return Response(status_code=204)

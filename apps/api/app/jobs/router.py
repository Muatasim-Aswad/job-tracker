from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.core.config import Settings, get_settings
from app.core.db import Conn
from app.core.deps import get_conn
from app.jobs.models import Job, JobFilters
from app.jobs.schemas import (
    CompanyAppliedCount,
    JobDetail,
    JobMatch,
    JobSummary,
    JobUpdate,
    ListingState,
)
from app.jobs.service import JobService

router = APIRouter(tags=["jobs"])


def get_service(
    conn: Conn = Depends(get_conn), settings: Settings = Depends(get_settings)
) -> JobService:
    return JobService(conn, settings)


@router.get("/jobs", response_model=list[JobSummary])
def list_jobs(
    filters: Annotated[JobFilters, Query()], service: JobService = Depends(get_service)
) -> list[JobSummary]:
    return service.search(filters)


# Static paths must precede /jobs/{job_id}.
@router.get("/jobs/states", response_model=list[ListingState])
def state_for_listings(
    platform: str,
    platform_ids: list[str] = Query(default=[]),
    service: JobService = Depends(get_service),
) -> list[ListingState]:
    return service.batch_state(platform, platform_ids)


# Live identity supports matching before a stub receives its first full capture.
@router.get("/jobs/matches", response_model=list[JobMatch])
def match_listings(
    platform: str,
    platform_id: str,
    title: str | None = None,
    company: str | None = None,
    service: JobService = Depends(get_service),
) -> list[JobMatch]:
    """Return duplicate candidates without materializing the current listing."""
    return service.matches(platform, platform_id, title, company)


# Normalize the live company name using the same advisory key as stored jobs.
@router.get("/jobs/applied-count", response_model=CompanyAppliedCount)
def applied_count(
    company: str | None = None, service: JobService = Depends(get_service)
) -> CompanyAppliedCount:
    """Count jobs carrying application evidence for a company."""
    return service.applied_count(company)


@router.get("/jobs/{job_id}", response_model=JobDetail)
def get_job(
    job_id: str, response: Response, service: JobService = Depends(get_service)
) -> JobDetail:
    detail = service.get_detail(job_id)
    response.headers["Content-Location"] = f"/api/jobs/{detail.id}"
    return detail


@router.patch("/jobs/{job_id}", response_model=Job)
def update_job(
    job_id: str, body: JobUpdate, response: Response, service: JobService = Depends(get_service)
) -> Job:
    job = service.update(job_id, body)
    response.headers["Content-Location"] = f"/api/jobs/{job.id}"
    return job


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: str, service: JobService = Depends(get_service)) -> Response:
    """Delete a job and all of its listings, events, and documents."""
    service.delete(job_id)
    return Response(status_code=204)

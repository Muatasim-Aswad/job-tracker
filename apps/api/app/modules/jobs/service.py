"""Canonical identity and annotation edits; state changes belong to activity use cases."""

from app.infra.database import Conn
from app.modules.jobs.models import Job
from app.modules.jobs.repository import JobRepository
from app.modules.jobs.schemas import JobUpdate
from app.shared.errors import NotFoundError
from app.shared.text import normalize_company, normalize_title
from app.shared.timeutil import utc_now


def update(conn: Conn, job_id: str, data: JobUpdate) -> Job:
    jobs = JobRepository(conn)
    requested_job_id = job_id
    job_id = jobs.resolve_id(job_id) or ""
    job = jobs.get(job_id) if job_id else None
    if job is None:
        raise NotFoundError(f"job {requested_job_id} not found")
    if data.title is not None or data.company is not None:
        title = data.title if data.title is not None else job.title
        company = data.company if data.company is not None else job.company
        jobs.set_identity(
            job_id, title, company, normalize_company(company), normalize_title(title), utc_now()
        )
    if data.meta is not None:
        jobs.set_meta(job_id, data.meta, utc_now())
    refreshed = jobs.get(job_id)
    assert refreshed is not None
    return refreshed

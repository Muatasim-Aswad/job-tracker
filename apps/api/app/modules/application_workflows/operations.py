"""Feature-owned ownership changes; caller retains transaction ownership."""

from app.infra.database import Conn, execute
from app.modules.application_workflows.errors import WorkflowConflict
from app.modules.application_workflows.repository import ApplicationWorkflowRepository
from app.modules.events.repository import EventRepository
from app.modules.jobs.repository import JobRepository
from app.shared.enums import APPLIED_EVIDENCE


def delete_for_job(conn: Conn, job_id: str) -> None:
    execute(conn, "DELETE FROM application_workflows WHERE job_id = ?", (job_id,))


def guard_relink(
    conn: Conn,
    source_job_id: str,
    target_job_id: str,
    listing_id: str,
    *,
    source_will_dissolve: bool,
) -> None:
    """Refuse a relink that would collapse two singular workflow records."""
    events = EventRepository(conn)
    application_workflows = ApplicationWorkflowRepository(conn)
    source = application_workflows.get_for_job(source_job_id)
    target = application_workflows.get_for_job(target_job_id)
    if source is None or target is None:
        return

    submitted = events.get(source.submitted_event_id)
    moves = source_will_dissolve or (submitted is not None and submitted.listing_id == listing_id)
    if moves:
        raise WorkflowConflict(
            "application_workflow_conflict",
            {"source": source.model_dump(), "target": target.model_dump()},
        )


def guard_merge(conn: Conn, loser_id: str, survivor_id: str) -> None:
    """A merge cannot silently choose between two recorded workflows."""
    application_workflows = ApplicationWorkflowRepository(conn)
    loser = application_workflows.get_for_job(loser_id)
    survivor = application_workflows.get_for_job(survivor_id)
    if loser is not None and survivor is not None:
        raise WorkflowConflict(
            "application_workflow_conflict",
            {"source": loser.model_dump(), "target": survivor.model_dump()},
        )


def discard_ineligible(conn: Conn, job_id: str) -> None:
    """Apply workflow lifecycle rules after merge/relink status settles."""
    jobs = JobRepository(conn)
    job = jobs.get(job_id)
    if job is not None and job.status not in APPLIED_EVIDENCE:
        delete_for_job(conn, job_id)

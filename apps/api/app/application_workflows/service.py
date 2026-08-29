from app.application_workflows.models import ApplicationWorkflow
from app.application_workflows.repository import ApplicationWorkflowRepository
from app.application_workflows.schemas import ApplicationWorkflowPut
from app.core.db import Conn
from app.core.enums import APPLIED_EVIDENCE, Status, status_set_by
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.timeutil import utc_now
from app.events.automation import is_effective_status_event
from app.events.repository import EventRepository
from app.jobs.repository import JobRepository


class ApplicationWorkflowService:
    def __init__(self, conn: Conn) -> None:
        self.workflows = ApplicationWorkflowRepository(conn)
        self.events = EventRepository(conn)
        self.jobs = JobRepository(conn)

    def get(self, job_id: str) -> ApplicationWorkflow:
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        if not job_id:
            raise NotFoundError(f"job {requested_job_id} not found")
        workflow = self.workflows.get_for_job(job_id)
        if workflow is None:
            raise NotFoundError(f"application workflow for job {requested_job_id} not found")
        return workflow

    def put(self, job_id: str, data: ApplicationWorkflowPut) -> tuple[ApplicationWorkflow, bool]:
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        job = self.jobs.get(job_id) if job_id else None
        if job is None:
            raise NotFoundError(f"job {requested_job_id} not found")
        if job.status not in APPLIED_EVIDENCE:
            raise ValidationError("application_not_submitted")
        event = self.events.get(data.submitted_event_id)
        if (
            event is None
            or event.job_id != job_id
            or status_set_by(event.event) != Status.APPLIED.value
            or not is_effective_status_event(event)
        ):
            raise ValidationError("submitted_event_must_confirm_application")

        current = self.workflows.get_for_job(job_id)
        if current is not None and self._same_payload(current, data):
            return current, False
        if current is None:
            if data.expected_revision is not None:
                raise ConflictError("stale_revision", None)
            self.workflows.insert(job_id, data, utc_now())
            created = self.workflows.get_for_job(job_id)
            assert created is not None
            return created, True
        if data.expected_revision is None:
            raise ConflictError("application_workflow_exists", current.model_dump())
        if current.revision != data.expected_revision:
            raise ConflictError("stale_revision", current.model_dump())

        updated = self.workflows.update(job_id, data, data.expected_revision, utc_now())
        if not updated:
            latest = self.workflows.get_for_job(job_id)
            raise ConflictError(
                "stale_revision", latest.model_dump() if latest is not None else None
            )
        result = self.workflows.get_for_job(job_id)
        assert result is not None
        return result, False

    @staticmethod
    def _same_payload(current: ApplicationWorkflow, data: ApplicationWorkflowPut) -> bool:
        return (
            current.submitted_event_id == data.submitted_event_id
            and current.preparation_lane == data.preparation_lane
            and current.submission_actor == data.submission_actor
            and current.submission_channel == data.submission_channel
            and current.narratives == data.narratives
            and current.measured_human_time_seconds == data.measured_human_time_seconds
            and current.references == data.references
        )

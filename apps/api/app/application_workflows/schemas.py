from pydantic import Field

from app.application_workflows.models import ApplicationWorkflowData


class ApplicationWorkflowPut(ApplicationWorkflowData):
    """Complete replacement with an absence-or-revision precondition."""

    submitted_event_id: int = Field(ge=1)
    # Null means the caller observed no record. Identical retries are accepted even
    # after creation; a differing write must name the current positive revision.
    expected_revision: int | None = Field(default=None, ge=1)

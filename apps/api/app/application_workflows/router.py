from fastapi import APIRouter, Depends, Response

from app.application_workflows.models import ApplicationWorkflow
from app.application_workflows.schemas import ApplicationWorkflowPut
from app.application_workflows.service import ApplicationWorkflowService
from app.core.deps import service_factory

router = APIRouter(tags=["application-workflows"])
get_service = service_factory(ApplicationWorkflowService)


def _location(response: Response, job_id: str) -> None:
    response.headers["Content-Location"] = f"/api/jobs/{job_id}/application-workflow"
    response.headers["Cache-Control"] = "no-store"


@router.get("/jobs/{job_id}/application-workflow", response_model=ApplicationWorkflow)
def get_application_workflow(
    job_id: str, response: Response, service: ApplicationWorkflowService = Depends(get_service)
) -> ApplicationWorkflow:
    workflow = service.get(job_id)
    _location(response, workflow.job_id)
    return workflow


@router.put(
    "/jobs/{job_id}/application-workflow",
    response_model=ApplicationWorkflow,
    responses={201: {"model": ApplicationWorkflow, "description": "Created"}},
)
def put_application_workflow(
    job_id: str,
    body: ApplicationWorkflowPut,
    response: Response,
    service: ApplicationWorkflowService = Depends(get_service),
) -> ApplicationWorkflow:
    workflow, created = service.put(job_id, body)
    response.status_code = 201 if created else 200
    _location(response, workflow.job_id)
    return workflow

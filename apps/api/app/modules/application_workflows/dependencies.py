from typing import Annotated

from fastapi import Depends

from app.modules.application_workflows.service import ApplicationWorkflowService
from app.platform.dependencies import ConnDep


def get_service(conn: ConnDep) -> ApplicationWorkflowService:
    return ApplicationWorkflowService(conn)


ServiceDep = Annotated[ApplicationWorkflowService, Depends(get_service)]

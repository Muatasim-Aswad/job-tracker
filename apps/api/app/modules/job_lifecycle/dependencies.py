from typing import Annotated

from fastapi import Depends

from app.modules.job_lifecycle.service import JobLifecycle
from app.platform.dependencies import ConnDep


def get_service(conn: ConnDep) -> JobLifecycle:
    return JobLifecycle(conn)


ServiceDep = Annotated[JobLifecycle, Depends(get_service)]

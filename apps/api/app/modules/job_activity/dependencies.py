from typing import Annotated

from fastapi import Depends

from app.modules.job_activity.service import EventService
from app.platform.dependencies import ConnDep


def get_service(conn: ConnDep) -> EventService:
    return EventService(conn)


ServiceDep = Annotated[EventService, Depends(get_service)]

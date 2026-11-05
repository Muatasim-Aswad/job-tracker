from typing import Annotated

from fastapi import Depends

from app.modules.job_queries.service import JobQueries
from app.platform.dependencies import ConnDep, SettingsDep


def get_service(conn: ConnDep, settings: SettingsDep) -> JobQueries:
    return JobQueries(conn, settings)


ServiceDep = Annotated[JobQueries, Depends(get_service)]

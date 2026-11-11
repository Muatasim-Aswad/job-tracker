from typing import Annotated

from fastapi import Depends

from app.modules.form_fill.service import FormFillService
from app.platform.dependencies import ConnDep


def get_service(conn: ConnDep) -> FormFillService:
    return FormFillService(conn)


ServiceDep = Annotated[FormFillService, Depends(get_service)]

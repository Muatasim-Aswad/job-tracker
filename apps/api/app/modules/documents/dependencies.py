from typing import Annotated

from fastapi import Depends

from app.modules.documents.service import DocumentService
from app.platform.dependencies import ConnDep


def get_service(conn: ConnDep) -> DocumentService:
    return DocumentService(conn)


ServiceDep = Annotated[DocumentService, Depends(get_service)]

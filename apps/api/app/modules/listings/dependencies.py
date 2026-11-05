from typing import Annotated

from fastapi import Depends

from app.modules.listings.service import ListingService
from app.platform.dependencies import ConnDep


def get_capture(conn: ConnDep) -> ListingService:
    return ListingService(conn)


CaptureDep = Annotated[ListingService, Depends(get_capture)]

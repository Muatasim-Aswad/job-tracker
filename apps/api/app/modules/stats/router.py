from fastapi import APIRouter

from app.modules.stats import service
from app.modules.stats.schemas import Stats
from app.platform.dependencies import ConnDep

router = APIRouter(tags=["stats"])


@router.get("/stats", response_model=Stats)
def get_stats(*, conn: ConnDep) -> Stats:
    return service.compute(conn)

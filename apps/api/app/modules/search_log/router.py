from fastapi import APIRouter, Query, Response

from app.modules.search_log import service
from app.modules.search_log.models import SearchLogRow
from app.modules.search_log.schemas import SearchLogCreate, SearchReport
from app.platform.dependencies import ConnDep

router = APIRouter(tags=["search-log"])


@router.post("/search-log", status_code=204)
def create_search_log(*, body: SearchLogCreate, conn: ConnDep) -> Response:
    """Record one opted-in popup search session."""
    service.record(conn, body)
    return Response(status_code=204)


@router.delete("/search-log", status_code=204)
def clear_search_log(*, conn: ConnDep) -> Response:
    """Delete every stored search-diagnostic row."""
    service.clear(conn)
    return Response(status_code=204)


@router.get("/search-log/report", response_model=SearchReport)
def search_log_report(*, conn: ConnDep) -> SearchReport:
    """Click-through by automatic seed rule, or `typed` when no seed was used."""
    return service.report(conn)


@router.get("/search-log", response_model=list[SearchLogRow])
def list_search_log(*, limit: int = Query(50, ge=1, le=500), conn: ConnDep) -> list[SearchLogRow]:
    """Return recent search-diagnostic rows, newest first."""
    return service.recent(conn, limit)

from fastapi import APIRouter, Query, Response

from app.modules.blocked import service
from app.modules.blocked.models import BlockedCompany
from app.modules.blocked.schemas import ALL_PLATFORMS, BlockedCompanyCreate
from app.platform.dependencies import ConnDep

router = APIRouter(tags=["blocked-companies"])


@router.get("/blocked-companies", response_model=list[BlockedCompany])
def list_blocked(*, conn: ConnDep) -> list[BlockedCompany]:
    """List blocked companies."""
    return service.list_all(conn)


@router.post("/blocked-companies", response_model=BlockedCompany, status_code=201)
def block_company(*, body: BlockedCompanyCreate, conn: ConnDep) -> BlockedCompany:
    """Create or refresh a normalized company block."""
    return service.block(conn, body)


@router.delete("/blocked-companies/{company_key}", status_code=204)
def unblock_company(
    *, company_key: str, platform: str = Query(ALL_PLATFORMS), conn: ConnDep
) -> Response:
    """Remove one company block in the requested platform scope."""
    service.unblock(conn, company_key, platform)
    return Response(status_code=204)

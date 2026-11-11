from app.infra.database import Conn
from app.modules.blocked.models import BlockedCompany
from app.modules.blocked.repository import BlockedCompanyRepository
from app.modules.blocked.schemas import ALL_PLATFORMS, BlockedCompanyCreate
from app.shared.errors import NotFoundError, ValidationError
from app.shared.text import normalize_company
from app.shared.timeutil import utc_now


def list_all(conn: Conn) -> list[BlockedCompany]:
    return BlockedCompanyRepository(conn).list_all()


def block(conn: Conn, body: BlockedCompanyCreate) -> BlockedCompany:
    company_key = normalize_company(body.company)
    if not company_key:
        raise ValidationError("Company name is empty after normalization.")

    label = body.company.strip() or None
    created_at = utc_now()
    BlockedCompanyRepository(conn).upsert(
        company_key=company_key, platform=body.platform, label=label, created_at=created_at
    )

    return BlockedCompany(
        company_key=company_key, platform=body.platform, label=label, created_at=created_at
    )


def unblock(conn: Conn, company_key: str, platform: str = ALL_PLATFORMS) -> None:
    if not BlockedCompanyRepository(conn).delete(company_key, platform):
        raise NotFoundError(f"'{company_key}' is not blocked on '{platform}'.")

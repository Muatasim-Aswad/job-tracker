from app.infra.database import Conn, Row, execute, query_all, query_one
from app.modules.blocked.models import BlockedCompany

_COLUMNS = "company_key, platform, label, created_at"


def _to_blocked_company(row: Row) -> BlockedCompany:
    return BlockedCompany(**row)


class BlockedCompanyRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def list_all(self) -> list[BlockedCompany]:
        rows = query_all(
            self.conn,
            f"SELECT {_COLUMNS} FROM blocked_companies ORDER BY label, company_key, platform",
        )
        return [_to_blocked_company(r) for r in rows]

    def upsert(
        self, *, company_key: str, platform: str, label: str | None, created_at: str
    ) -> None:
        # Re-blocking refreshes the label while preserving the original timestamp.
        execute(
            self.conn,
            "INSERT INTO blocked_companies (company_key, platform, label, created_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT (company_key, platform) DO UPDATE SET label = excluded.label",
            (company_key, platform, label, created_at),
        )

    def delete(self, company_key: str, platform: str) -> bool:
        # RETURNING tells us whether a row actually went (for the 404) without
        # relying on cursor.rowcount, which isn't on the Conn/Cursor protocol.
        row = query_one(
            self.conn,
            "DELETE FROM blocked_companies WHERE company_key = ? AND platform = ? "
            "RETURNING company_key",
            (company_key, platform),
        )
        return row is not None

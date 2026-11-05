from pydantic import BaseModel


class BlockedCompany(BaseModel):
    company_key: str
    platform: str
    label: str | None = None
    created_at: str

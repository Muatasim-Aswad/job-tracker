from typing import Any

from pydantic import BaseModel


class Event(BaseModel):
    id: int
    job_id: str
    event: str
    ts: str
    listing_id: str | None = None
    meta: dict[str, Any] | None = None

from typing import Any

from pydantic import BaseModel, Field


class Document(BaseModel):
    id: int
    job_id: str
    type: str
    requested: str | None = None
    provided: bool
    content: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str

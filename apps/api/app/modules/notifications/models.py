from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel


class Notification(BaseModel):
    id: str
    kind: Literal["manual_reminder", "application_stale"]
    job_id: str | None
    title: str
    body: str | None
    scheduled_at: str
    published_at: str | None
    state: Literal["scheduled", "published", "cancelled"]
    alert_suppressed_at: str | None = None
    delivered_at: str | None
    read_at: str | None
    resolved_at: str | None
    revision: str
    created_at: str
    updated_at: str


@dataclass
class PublicationBatch:
    publications: list[Notification]
    changed: bool = False

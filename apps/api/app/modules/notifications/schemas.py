import base64
from datetime import UTC, datetime
from typing import Annotated, Self
from urllib.parse import urlsplit

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.modules.notifications.models import Notification

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class ReminderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Title
    body: str | None = Field(default=None, max_length=10000)
    job_id: str | None = None
    scheduled_at: AwareDatetime


class ReminderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: str
    title: Title | None = None
    body: str | None = Field(default=None, max_length=10000)
    job_id: str | None = None
    scheduled_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def reject_required_nulls(self) -> Self:
        for field in ("title", "scheduled_at"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class ReminderCancel(BaseModel):
    expected_revision: str


class PublicationAcknowledgment(BaseModel):
    published_at: AwareDatetime


class NotificationPage(BaseModel):
    items: list[Notification]
    next_cursor: str | None = None
    unread_count: int


class PushKeys(BaseModel):
    p256dh: str = Field(max_length=100)
    auth: str = Field(max_length=30)

    @model_validator(mode="after")
    def validate_keys(self) -> Self:
        try:
            public = base64.urlsafe_b64decode(self.p256dh + "=" * (-len(self.p256dh) % 4))
            auth = base64.urlsafe_b64decode(self.auth + "=" * (-len(self.auth) % 4))
        except ValueError as exc:
            raise ValueError("Invalid push keys") from exc
        if len(public) != 65 or public[0] != 4 or len(auth) != 16:
            raise ValueError("Invalid push keys")
        return self


class PushSubscriptionCreate(BaseModel):
    endpoint: str = Field(max_length=2048)
    keys: PushKeys

    @model_validator(mode="after")
    def validate_provider(self) -> Self:
        url = urlsplit(self.endpoint)
        host = url.hostname or ""
        allowed = (
            host in {"fcm.googleapis.com", "updates.push.services.mozilla.com"}
            or host.endswith(".push.apple.com")
            or host.endswith(".notify.windows.com")
        )
        if (
            url.scheme != "https"
            or not allowed
            or url.username
            or url.password
            or url.port not in {None, 443}
            or url.fragment
        ):
            raise ValueError("Unsupported browser push provider")
        return self


class PushConfiguration(BaseModel):
    application_server_key: str | None


class PushSubscriptionDelete(BaseModel):
    endpoint: str = Field(max_length=2048)


def timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()

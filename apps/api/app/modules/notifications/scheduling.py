"""Round automatic alerts to the user's next daily notification time."""

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.modules.preferences.schemas import ApplicationStaleness


def stale_alert_time(deadline: str, now: str, settings: ApplicationStaleness) -> str:
    zone = ZoneInfo(settings.timezone)
    earliest = max(
        datetime.fromisoformat(deadline),
        datetime.fromisoformat(now).replace(second=0, microsecond=0),
    )
    local = earliest.astimezone(zone)
    candidate = datetime.combine(local.date(), time.fromisoformat(settings.notification_time), zone)
    if candidate.astimezone(UTC) < earliest.astimezone(UTC):
        candidate = datetime.combine(
            local.date() + timedelta(days=1), time.fromisoformat(settings.notification_time), zone
        )
    return candidate.astimezone(UTC).isoformat()

"""Metadata rules for reversible automatic status events."""

from app.modules.events.models import Event
from app.shared.enums import Status

AUTOMATIC_SOURCE = "automatic"


def is_automatic_close(event: Event) -> bool:
    return (
        event.event == Status.CLOSED.value
        and event.meta is not None
        and event.meta.get("source") == AUTOMATIC_SOURCE
    )


def is_effective_status_event(event: Event) -> bool:
    return not (is_automatic_close(event) and event.meta and event.meta.get("invalidated_at"))

from fastapi import APIRouter
from pydantic import ValidationError as PydanticValidationError

from app.modules.notifications import service as notifications
from app.modules.preferences import service
from app.modules.preferences.schemas import PreferencesState, PreferencesUpdate
from app.modules.staleness import service as staleness
from app.platform.dependencies import ConnDep
from app.shared.errors import ValidationError

router = APIRouter(tags=["settings"])


@router.get("/settings", response_model=PreferencesState)
def read_settings(*, conn: ConnDep) -> PreferencesState:
    return service.read(conn)


@router.patch("/settings", response_model=PreferencesState)
def update_settings(*, body: PreferencesUpdate, conn: ConnDep) -> PreferencesState:
    try:
        previous = service.read(conn).settings.application_staleness
        result = service.update(conn, body)
        if "application_staleness" in body.changes.model_fields_set:
            current = result.settings.application_staleness
            clock_changed = (previous.notification_time, previous.timezone) != (
                current.notification_time,
                current.timezone,
            )
            staleness.reconcile(conn, reschedule=clock_changed)
        notifications.suppress_muted_pending(conn)
        return result
    except PydanticValidationError as exc:
        raise ValidationError("Invalid settings: check rule counts and unique IDs.") from exc

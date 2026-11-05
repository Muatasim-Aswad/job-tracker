from fastapi import APIRouter
from pydantic import ValidationError as PydanticValidationError

from app.modules.preferences import service
from app.modules.preferences.schemas import PreferencesState, PreferencesUpdate
from app.platform.dependencies import ConnDep
from app.shared.errors import ValidationError

router = APIRouter(tags=["settings"])


@router.get("/settings", response_model=PreferencesState)
def read_settings(*, conn: ConnDep) -> PreferencesState:
    return service.read(conn)


@router.patch("/settings", response_model=PreferencesState)
def update_settings(*, body: PreferencesUpdate, conn: ConnDep) -> PreferencesState:
    try:
        return service.update(conn, body)
    except PydanticValidationError as exc:
        raise ValidationError("Invalid settings: check rule counts and unique IDs.") from exc

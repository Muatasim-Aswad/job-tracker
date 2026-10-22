from fastapi import APIRouter, Depends
from pydantic import ValidationError as PydanticValidationError

from app.core.deps import service_factory
from app.core.errors import ValidationError
from app.preferences.schemas import PreferencesState, PreferencesUpdate
from app.preferences.service import PreferencesService

router = APIRouter(tags=["settings"])
get_service = service_factory(PreferencesService)


@router.get("/settings", response_model=PreferencesState)
def read_settings(service: PreferencesService = Depends(get_service)) -> PreferencesState:
    return service.read()


@router.patch("/settings", response_model=PreferencesState)
def update_settings(
    body: PreferencesUpdate, service: PreferencesService = Depends(get_service)
) -> PreferencesState:
    try:
        return service.update(body)
    except PydanticValidationError as exc:
        raise ValidationError("Invalid settings: check rule counts and unique IDs.") from exc

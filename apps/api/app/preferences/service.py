from uuid import uuid4

from app.core.db import Conn
from app.core.errors import ConflictError
from app.preferences.repository import PreferencesRepository
from app.preferences.schemas import (
    Preferences,
    PreferencesPatch,
    PreferencesState,
    PreferencesUpdate,
)


class PreferencesService:
    def __init__(self, conn: Conn) -> None:
        self.repo = PreferencesRepository(conn)

    def read(self) -> PreferencesState:
        row = self.repo.get()
        if row is None:
            raise RuntimeError("Shared settings were not initialized at startup.")
        return PreferencesState(
            revision=row["revision"], settings=Preferences.model_validate_json(row["settings_json"])
        )

    def update(self, body: PreferencesUpdate) -> PreferencesState:
        current = self.read()
        if current.revision != body.expected_revision:
            raise ConflictError(
                "Settings changed. Reload them before saving again.", current.model_dump()
            )
        return self._save(current, body.changes)

    def _save(self, current: PreferencesState, changes: PreferencesPatch) -> PreferencesState:
        settings = Preferences.model_validate(
            current.settings.model_dump() | changes.model_dump(exclude_unset=True)
        )
        revision = str(uuid4())
        self.repo.save(revision, settings.model_dump_json())
        return PreferencesState(revision=revision, settings=settings)

from uuid import uuid4

from app.infra.database import Conn
from app.modules.preferences.repository import PreferencesRepository
from app.modules.preferences.schemas import (
    Preferences,
    PreferencesPatch,
    PreferencesState,
    PreferencesUpdate,
)
from app.shared.errors import ConflictError


def read(conn: Conn) -> PreferencesState:
    row = PreferencesRepository(conn).get()
    if row is None:
        raise RuntimeError("Shared settings were not initialized at startup.")

    return PreferencesState(
        revision=row["revision"], settings=Preferences.model_validate_json(row["settings_json"])
    )


def update(conn: Conn, body: PreferencesUpdate) -> PreferencesState:
    current = read(conn)
    if current.revision != body.expected_revision:
        raise ConflictError(
            "Settings changed. Reload them before saving again.", current.model_dump()
        )

    return _save(conn, current, body.changes)


def _save(conn: Conn, current: PreferencesState, changes: PreferencesPatch) -> PreferencesState:
    settings = Preferences.model_validate(
        current.settings.model_dump() | changes.model_dump(exclude_unset=True)
    )
    revision = str(uuid4())
    PreferencesRepository(conn).save(revision, settings.model_dump_json())

    return PreferencesState(revision=revision, settings=settings)

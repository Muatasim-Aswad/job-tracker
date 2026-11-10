import json
from uuid import uuid4

from app.infra.database import Conn
from app.modules.preferences.repository import PreferencesRepository
from app.modules.preferences.schemas import (
    ApplicationStaleness,
    Preferences,
    PreferencesPatch,
    PreferencesState,
    PreferencesUpdate,
)
from app.shared.errors import ConflictError
from app.shared.timeutil import utc_now


def initialize_staleness(conn: Conn, defaults: ApplicationStaleness) -> None:
    """Seed deployment defaults once, preserving subsequent saved choices."""
    key = "seed_application_staleness_settings_v1"
    repository = PreferencesRepository(conn)
    initialized = repository.initialization_recorded(key)
    row = repository.get()
    assert row is not None
    settings = json.loads(row["settings_json"])
    before = json.dumps(settings, sort_keys=True)
    if not initialized and (
        "application_staleness" not in settings or row["revision"] == "defaults-v1"
    ):
        settings["application_staleness"] = defaults.model_dump()
    clock = settings.setdefault("application_staleness", defaults.model_dump())
    clock.setdefault("notification_time", defaults.notification_time)
    clock.setdefault("timezone", defaults.timezone)
    if json.dumps(settings, sort_keys=True) != before:
        repository.save(str(uuid4()), json.dumps(settings))
    if not initialized:
        repository.record_initialization(key, utc_now())


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

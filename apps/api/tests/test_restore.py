from __future__ import annotations

import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core.config import Settings
from app.core.lifecycle import ServerLock
from app.core.paths import ResolvedPaths, resolve_paths
from app.maintenance.base import MaintenanceError
from app.maintenance.restore import restore_profile


def _profile(tmp_path: Path) -> tuple[ResolvedPaths, Settings]:
    app_dir = tmp_path / "app"
    schema = app_dir / "apps/api/app/core/schema.sql"
    schema.parent.mkdir(parents=True)
    schema.write_text(
        "CREATE TABLE IF NOT EXISTS schema_migrations "
        "(key TEXT PRIMARY KEY, applied_at TEXT NOT NULL);\n"
        "CREATE TABLE IF NOT EXISTS current_schema (value TEXT);\n"
    )
    paths = resolve_paths(
        profile="packaged",
        environ={"JOB_TRACKER_APP_DIR": str(app_dir), "HOME": str(tmp_path / "home")},
        cwd=tmp_path,
    )
    settings = Settings(
        db_path=str(paths.database),
        turso_database_url=None,
        turso_auth_token=None,
        turso_local_first=False,
    )
    return paths, settings


def _database(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE payload (value TEXT NOT NULL)")
        conn.execute("INSERT INTO payload VALUES (?)", (value,))


def _value(path: Path) -> str:
    with sqlite3.connect(path) as conn:
        return str(conn.execute("SELECT value FROM payload").fetchone()[0])


def test_restore_uses_migrated_candidate_and_refuses_repeated_invocation(tmp_path: Path) -> None:
    paths, settings = _profile(tmp_path)
    backup = tmp_path / "backup.sqlite"
    _database(backup, "restored")

    assert restore_profile(settings, paths, backup, target=None, replace=False) == paths.database
    assert _value(paths.database) == "restored"
    with sqlite3.connect(paths.database) as conn:
        assert conn.execute(
            "SELECT name FROM sqlite_master WHERE name = 'current_schema'"
        ).fetchone()

    with pytest.raises(MaintenanceError, match="destination already exists"):
        restore_profile(settings, paths, backup, target=None, replace=False)
    assert _value(paths.database) == "restored"


def test_replace_creates_verified_automatic_backup_before_atomic_install(tmp_path: Path) -> None:
    paths, settings = _profile(tmp_path)
    _database(paths.database, "before")
    backup = tmp_path / "backup.sqlite"
    _database(backup, "after")

    restore_profile(settings, paths, backup, target=None, replace=True)

    assert _value(paths.database) == "after"
    automatic = list((paths.backup_dir / "automatic").glob("*-pre-restore.sqlite"))
    assert len(automatic) == 1
    assert _value(automatic[0]) == "before"


def test_restore_refuses_a_running_profile(tmp_path: Path) -> None:
    paths, settings = _profile(tmp_path)
    backup = tmp_path / "backup.sqlite"
    _database(backup, "after")

    with (
        ServerLock(paths, port=3456, version="test"),
        pytest.raises(MaintenanceError, match="profile lock is held by PID"),
    ):
        restore_profile(settings, paths, backup, target=None, replace=False)
    assert not paths.database.exists()


def test_invalid_or_foreign_key_broken_backup_never_installs(tmp_path: Path) -> None:
    paths, settings = _profile(tmp_path)
    corrupt = tmp_path / "corrupt.sqlite"
    corrupt.write_bytes(b"not sqlite")
    with pytest.raises(MaintenanceError):
        restore_profile(settings, paths, corrupt, target=None, replace=False)
    assert not paths.database.exists()

    broken = tmp_path / "broken.sqlite"
    with sqlite3.connect(broken) as conn:
        conn.executescript(
            "PRAGMA foreign_keys = OFF;"
            "CREATE TABLE parent (id INTEGER PRIMARY KEY);"
            "CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));"
            "INSERT INTO child VALUES (1);"
        )
    with pytest.raises(MaintenanceError, match="foreign-key"):
        restore_profile(settings, paths, broken, target=None, replace=False)
    assert not paths.database.exists()


def test_candidate_or_install_failure_preserves_existing_destination(tmp_path: Path) -> None:
    paths, settings = _profile(tmp_path)
    _database(paths.database, "before")
    backup = tmp_path / "backup.sqlite"
    _database(backup, "after")

    with (
        patch(
            "app.maintenance.restore._migrate_candidate",
            side_effect=MaintenanceError("migration failed"),
        ),
        pytest.raises(MaintenanceError, match="migration failed"),
    ):
        restore_profile(settings, paths, backup, target=None, replace=True)
    assert _value(paths.database) == "before"
    assert not (paths.backup_dir / "automatic").exists()

    with (
        patch("app.maintenance.backup.os.replace", side_effect=PermissionError("denied")),
        pytest.raises(MaintenanceError, match="denied"),
    ):
        restore_profile(settings, paths, backup, target=None, replace=True)
    assert _value(paths.database) == "before"


@pytest.mark.parametrize("local_first", [False, True])
def test_turso_restore_requires_separate_explicit_local_target(
    tmp_path: Path, local_first: bool
) -> None:
    paths, settings = _profile(tmp_path)
    settings.turso_database_url = "libsql://synthetic.invalid"
    settings.turso_local_first = local_first
    backup = tmp_path / "backup.sqlite"
    _database(backup, "recovery")

    with pytest.raises(MaintenanceError, match="requires --target"):
        restore_profile(settings, paths, backup, target=None, replace=False)
    configured = Path(f"{paths.database}.sync") if local_first else paths.database
    with pytest.raises(MaintenanceError, match="configured replica path"):
        restore_profile(settings, paths, backup, target=configured, replace=False)

    target = tmp_path / f"recovery-{local_first}.sqlite"
    assert restore_profile(settings, paths, backup, target=target, replace=False) == target
    assert _value(target) == "recovery"

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import turso.sync

from app.core.config import Settings
from app.core.db import connect
from app.core.lifecycle import ServerLock
from app.core.paths import ResolvedPaths, resolve_paths
from app.maintenance.backup import backup_profile, preserve_before_startup_pull
from app.maintenance.base import MaintenanceError


def _paths(tmp_path: Path) -> ResolvedPaths:
    app_dir = tmp_path / "app"
    app_dir.mkdir()
    return resolve_paths(
        profile="packaged",
        environ={"JOB_TRACKER_APP_DIR": str(app_dir), "HOME": str(tmp_path / "home")},
        cwd=tmp_path,
    )


def _settings(paths: ResolvedPaths, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "db_path": str(paths.database),
        "turso_database_url": None,
        "turso_auth_token": None,
        "turso_local_first": False,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def _database(path: Path, value: str = "kept") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE payload (value TEXT NOT NULL)")
        conn.execute("INSERT INTO payload VALUES (?)", (value,))


@pytest.mark.parametrize(
    ("remote", "local_first", "suffix"),
    [(False, False, ""), (True, False, ""), (True, True, ".sync")],
)
def test_backup_selects_and_validates_each_mode(
    tmp_path: Path, remote: bool, local_first: bool, suffix: str
) -> None:
    paths = _paths(tmp_path)
    settings = _settings(
        paths,
        turso_database_url="libsql://synthetic.invalid" if remote else None,
        turso_local_first=local_first,
    )
    source = Path(f"{paths.database}{suffix}")
    _database(source)
    output = tmp_path / "snapshot.sqlite"

    assert backup_profile(settings, paths, output) == output
    with sqlite3.connect(output) as conn:
        assert conn.execute("SELECT value FROM payload").fetchone() == ("kept",)
    if os.name == "posix":
        assert output.stat().st_mode & 0o777 == 0o600


def test_backup_refuses_running_profile_with_owner_and_stop_instructions(tmp_path: Path) -> None:
    paths = _paths(tmp_path)
    settings = _settings(paths)
    _database(paths.database)

    with ServerLock(paths, port=3456, version="test"), pytest.raises(MaintenanceError) as exc:
        backup_profile(settings, paths, tmp_path / "snapshot.sqlite")

    message = str(exc.value)
    assert "packaged profile" in message
    assert "PID" in message
    assert "Ctrl-C" in message


def test_backup_rejects_corruption_and_preserves_existing_destination(tmp_path: Path) -> None:
    paths = _paths(tmp_path)
    settings = _settings(paths)
    paths.database.parent.mkdir(parents=True)
    paths.database.write_bytes(b"not sqlite")
    output = tmp_path / "snapshot.sqlite"
    output.write_bytes(b"existing")

    with pytest.raises(MaintenanceError, match="destination already exists"):
        backup_profile(settings, paths, output)
    assert output.read_bytes() == b"existing"

    output.unlink()
    with pytest.raises(MaintenanceError, match="database|validated snapshot"):
        backup_profile(settings, paths, output)
    assert not output.exists()
    assert not list(tmp_path.glob(".snapshot.sqlite.*.tmp"))


def test_backup_write_failure_leaves_no_partial_output(tmp_path: Path) -> None:
    paths = _paths(tmp_path)
    settings = _settings(paths)
    _database(paths.database)
    output = tmp_path / "snapshot.sqlite"

    with (
        patch("app.maintenance.backup._copy_database", side_effect=OSError("disk full")),
        pytest.raises(MaintenanceError, match="disk full"),
    ):
        backup_profile(settings, paths, output)

    assert not output.exists()
    assert not list(tmp_path.glob(".snapshot.sqlite.*.tmp"))


@pytest.mark.parametrize("local_first", [False, True])
def test_startup_snapshot_precedes_turso_driver_construction(
    tmp_path: Path, local_first: bool
) -> None:
    paths = _paths(tmp_path)
    settings = _settings(
        paths,
        turso_database_url="libsql://synthetic.invalid",
        turso_auth_token="synthetic-token",
        turso_local_first=local_first,
    )
    source = Path(f"{paths.database}.sync") if local_first else paths.database
    _database(source, "unsynced")
    recovery = paths.backup_dir / "recovery/pre-pull.sqlite"
    fake_conn = MagicMock()

    def driver_probe(*_args: object, **_kwargs: object) -> MagicMock:
        with sqlite3.connect(recovery) as conn:
            assert conn.execute("SELECT value FROM payload").fetchone() == ("unsynced",)
        return fake_conn

    with patch("app.core.db.settings_paths", return_value=paths):
        if local_first:
            with patch.object(turso.sync, "connect", side_effect=driver_probe):
                connect(settings)
            fake_conn.pull.assert_called_once()
        else:
            with patch("app.core.db.libsql.connect", side_effect=driver_probe):
                connect(settings)
            fake_conn.sync.assert_called_once()


def test_failed_startup_snapshot_blocks_pull_and_preserves_recovery(tmp_path: Path) -> None:
    paths = _paths(tmp_path)
    settings = _settings(
        paths, turso_database_url="libsql://synthetic.invalid", turso_local_first=True
    )
    source = Path(f"{paths.database}.sync")
    _database(source, "older-safe-copy")
    recovery = preserve_before_startup_pull(settings, paths)
    assert recovery is not None
    source.write_bytes(b"corrupt")

    with (
        patch("app.core.db.settings_paths", return_value=paths),
        patch.object(turso.sync, "connect") as driver,
        pytest.raises(MaintenanceError),
    ):
        connect(settings)

    driver.assert_not_called()
    with sqlite3.connect(recovery) as conn:
        assert conn.execute("SELECT value FROM payload").fetchone() == ("older-safe-copy",)

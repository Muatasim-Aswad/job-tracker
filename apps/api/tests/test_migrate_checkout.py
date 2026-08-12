from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.lifecycle import ServerLock
from app.core.paths import ResolvedPaths, resolve_paths
from app.maintenance.base import MaintenanceError
from app.maintenance.migrate_checkout import migrate_checkout


def _destination(tmp_path: Path) -> tuple[ResolvedPaths, Settings]:
    app_dir = tmp_path / "packaged-app"
    schema = app_dir / "apps/api/app/core/schema.sql"
    schema.parent.mkdir(parents=True)
    schema.write_text(
        "CREATE TABLE IF NOT EXISTS schema_migrations "
        "(key TEXT PRIMARY KEY, applied_at TEXT NOT NULL);\n"
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


def _checkout(tmp_path: Path, mode: str) -> tuple[Path, Path]:
    checkout = tmp_path / f"checkout-{mode}"
    api_dir = checkout / "apps/api"
    api_dir.mkdir(parents=True)
    lines = ["DB_PATH=legacy.sqlite"]
    source = api_dir / "legacy.sqlite"
    if mode == "embedded":
        lines.extend(
            ["TURSO_DATABASE_URL=libsql://synthetic.invalid", "TURSO_AUTH_TOKEN=never-print-me"]
        )
    elif mode == "local-first":
        lines.extend(
            [
                "TURSO_DATABASE_URL=libsql://synthetic.invalid",
                "TURSO_AUTH_TOKEN=never-print-me",
                "TURSO_LOCAL_FIRST=true",
            ]
        )
        source = Path(f"{source}.sync")
    (api_dir / ".env").write_text("\n".join(lines) + "\n")
    with sqlite3.connect(source) as conn:
        conn.execute("CREATE TABLE payload (value TEXT NOT NULL)")
        conn.execute("INSERT INTO payload VALUES (?)", (mode,))
    return checkout, source


def _tree(checkout: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(checkout)): path.read_bytes()
        for path in checkout.rglob("*")
        if path.is_file()
    }


@pytest.mark.parametrize("mode", ["local", "embedded", "local-first"])
def test_migrate_checkout_adopts_effective_store_and_preserves_source(
    tmp_path: Path, mode: str
) -> None:
    paths, settings = _destination(tmp_path)
    checkout, _source = _checkout(tmp_path, mode)
    before = _tree(checkout)

    assert migrate_checkout(settings, paths, checkout) == paths.database

    with sqlite3.connect(paths.database) as conn:
        assert conn.execute("SELECT value FROM payload").fetchone() == (mode,)
    assert _tree(checkout) == before
    assert not paths.config_file.exists()

    with pytest.raises(MaintenanceError, match="not empty"):
        migrate_checkout(settings, paths, checkout)
    assert _tree(checkout) == before


def test_migrate_checkout_refuses_nonempty_family_and_turso_destination(tmp_path: Path) -> None:
    paths, settings = _destination(tmp_path)
    checkout, _source = _checkout(tmp_path, "local")
    paths.database.parent.mkdir(parents=True)
    sidecar = Path(f"{paths.database}.sync-meta")
    sidecar.write_text("occupied")

    with pytest.raises(MaintenanceError, match="not empty"):
        migrate_checkout(settings, paths, checkout)
    assert not paths.database.exists()

    sidecar.unlink()
    settings.turso_database_url = "libsql://synthetic.invalid"
    with pytest.raises(MaintenanceError, match="local packaged destination"):
        migrate_checkout(settings, paths, checkout)
    assert not paths.database.exists()


def test_migrate_checkout_requires_packaged_profile_and_valid_checkout(tmp_path: Path) -> None:
    paths, settings = _destination(tmp_path)
    source_paths = resolve_paths(
        profile="source", environ={"JOB_TRACKER_APP_DIR": str(tmp_path / "source")}, cwd=tmp_path
    )
    with pytest.raises(MaintenanceError, match="packaged profile"):
        migrate_checkout(settings, source_paths, tmp_path / "missing")
    with pytest.raises(MaintenanceError, match="not a Job Tracker checkout"):
        migrate_checkout(settings, paths, tmp_path / "missing")


def test_migrate_checkout_refuses_running_source_or_destination(tmp_path: Path) -> None:
    paths, settings = _destination(tmp_path)
    checkout, _source = _checkout(tmp_path, "local")
    source_paths = resolve_paths(
        profile="source", environ={"JOB_TRACKER_APP_DIR": str(checkout)}, cwd=checkout / "apps/api"
    )

    with (
        ServerLock(source_paths, port=3456, version="test"),
        pytest.raises(MaintenanceError, match="source profile lock is held by PID"),
    ):
        migrate_checkout(settings, paths, checkout)
    assert not paths.database.exists()

    with (
        ServerLock(paths, port=3456, version="test"),
        pytest.raises(MaintenanceError, match="packaged profile lock is held by PID"),
    ):
        migrate_checkout(settings, paths, checkout)
    assert not paths.database.exists()

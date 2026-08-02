"""Validated candidate restore for local and Turso recovery workflows."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

from app.core.config import Settings
from app.core.db import Conn, init_schema
from app.core.paths import ResolvedPaths
from app.maintenance.backup import snapshot_database
from app.maintenance.base import MaintenanceError, ensure_private_directory, profile_lock


def _migrate_candidate(candidate: Path, schema_file: Path) -> None:
    try:
        with sqlite3.connect(candidate) as conn:
            init_schema(cast(Conn, conn), schema_file)
    except (OSError, sqlite3.Error) as exc:
        raise MaintenanceError(f"candidate schema migration failed: {exc}") from exc


def _automatic_backup(paths: ResolvedPaths, destination: Path) -> Path:
    automatic_dir = paths.backup_dir / "automatic"
    ensure_private_directory(automatic_dir)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
    output = automatic_dir / f"{timestamp}-pre-restore.sqlite"
    return snapshot_database(destination, output)


def _is_primary_local_path(paths: ResolvedPaths, target: Path) -> bool:
    target = target.resolve()
    database = paths.database.resolve()
    return target in {database, Path(f"{database}.sync").resolve()}


def restore_profile(
    settings: Settings, paths: ResolvedPaths, backup: Path, *, target: Path | None, replace: bool
) -> Path:
    """Restore through a migrated candidate without ever touching a Turso primary."""
    if settings.turso_database_url:
        if target is None:
            raise MaintenanceError(
                "Turso restore requires --target with a separate local recovery database"
            )
        destination = target.resolve()
        if _is_primary_local_path(paths, destination):
            raise MaintenanceError(
                "Turso restore refuses the configured replica path; choose a separate "
                "local --target and validate it before any provider-directed recovery"
            )
    else:
        destination = (target or paths.database).resolve()

    if destination == paths.database.resolve():
        ensure_private_directory(paths.data_dir)

    def before_install(existing: Path) -> None:
        if replace and existing.exists():
            _automatic_backup(paths, existing)

    with profile_lock(paths, operation="restore"):
        return snapshot_database(
            backup,
            destination,
            replace=replace,
            prepare_candidate=lambda candidate: _migrate_candidate(candidate, paths.schema_file),
            before_install=before_install,
        )

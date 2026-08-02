"""Validated SQLite snapshots and the offline backup command."""

from __future__ import annotations

import os
import sqlite3
import tempfile
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path

from app.core.config import Settings
from app.core.paths import ResolvedPaths
from app.maintenance.base import MaintenanceError, ensure_private_directory, profile_lock

CandidateHook = Callable[[Path], None]


def effective_store(settings: Settings, paths: ResolvedPaths) -> Path:
    """Return the local file that contains the effective data for this mode."""
    if settings.turso_database_url and settings.turso_local_first:
        return Path(f"{paths.database}.sync")
    return paths.database


def _readonly_connection(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)


def validate_snapshot(path: Path) -> None:
    """Require both SQLite integrity and foreign-key checks to pass."""
    try:
        with _readonly_connection(path) as conn:
            integrity = conn.execute("PRAGMA integrity_check").fetchall()
            if integrity != [("ok",)]:
                detail = "; ".join(str(row[0]) for row in integrity[:3])
                raise MaintenanceError(f"snapshot integrity check failed: {detail}")
            violations = conn.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                tables = sorted({str(row[0]) for row in violations})
                raise MaintenanceError("snapshot foreign-key check failed in: " + ", ".join(tables))
    except MaintenanceError:
        raise
    except (OSError, sqlite3.Error) as exc:
        raise MaintenanceError(f"snapshot is not a valid readable SQLite database: {exc}") from exc


def _copy_database(source: Path, candidate: Path) -> None:
    with _readonly_connection(source) as source_conn, sqlite3.connect(candidate) as target_conn:
        source_conn.backup(target_conn)
        target_conn.commit()


def _sync_file(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _sync_directory(path: Path) -> None:
    if os.name != "posix":
        return
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def snapshot_database(
    source: Path,
    destination: Path,
    *,
    replace: bool = False,
    prepare_candidate: CandidateHook | None = None,
    before_install: CandidateHook | None = None,
) -> Path:
    """Copy, validate, and atomically install a SQLite database."""
    source = source.resolve()
    destination = destination.resolve()
    if source == destination:
        raise MaintenanceError("source and destination database paths must differ")
    if not source.is_file():
        raise MaintenanceError(f"local database does not exist: {source}")
    if destination.exists() and not replace:
        raise MaintenanceError(f"destination already exists: {destination}")
    if not destination.parent.is_dir():
        raise MaintenanceError(f"destination directory does not exist: {destination.parent}")

    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    os.close(fd)
    candidate = Path(temporary_name)
    if os.name == "posix":
        candidate.chmod(0o600)
    try:
        _copy_database(source, candidate)
        validate_snapshot(candidate)
        if prepare_candidate is not None:
            prepare_candidate(candidate)
            validate_snapshot(candidate)
        _sync_file(candidate)
        if before_install is not None:
            before_install(destination)
        if replace:
            os.replace(candidate, destination)
        else:
            try:
                os.link(candidate, destination)
            except FileExistsError as exc:
                raise MaintenanceError(f"destination already exists: {destination}") from exc
            candidate.unlink()
        if os.name == "posix":
            destination.chmod(0o600)
        _sync_directory(destination.parent)
        return destination
    except MaintenanceError:
        raise
    except (OSError, sqlite3.Error) as exc:
        raise MaintenanceError(f"could not create validated snapshot: {exc}") from exc
    finally:
        with suppress(FileNotFoundError):
            candidate.unlink()


def backup_profile(
    settings: Settings, paths: ResolvedPaths, output: Path, *, operation: str = "backup"
) -> Path:
    """Snapshot the effective local store while holding the profile lock."""
    with profile_lock(paths, operation=operation):
        return snapshot_database(effective_store(settings, paths), output)


def preserve_before_startup_pull(settings: Settings, paths: ResolvedPaths) -> Path | None:
    """Preserve an existing local replica before a Turso driver can pull."""
    if not settings.turso_database_url:
        return None
    source = effective_store(settings, paths)
    if not source.exists():
        return None
    recovery_dir = paths.backup_dir / "recovery"
    ensure_private_directory(recovery_dir)
    return snapshot_database(source, recovery_dir / "pre-pull.sqlite", replace=True)

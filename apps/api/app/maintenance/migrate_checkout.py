"""Explicit, source-preserving adoption of a legacy checkout database."""

from __future__ import annotations

from contextlib import ExitStack
from dataclasses import replace
from pathlib import Path

from dotenv import dotenv_values

from app.core.config import Settings
from app.core.paths import ResolvedPaths, resolve_paths
from app.maintenance.backup import snapshot_database
from app.maintenance.base import MaintenanceError, ensure_private_directory, profile_lock
from app.maintenance.restore import _migrate_candidate


def _boolean(value: str | None, *, name: str) -> bool:
    if value is None:
        return False
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off", ""}:
        return False
    raise MaintenanceError(f"legacy checkout has an invalid {name} boolean")


def _source_paths(checkout: Path) -> tuple[ResolvedPaths, Path]:
    checkout = checkout.resolve()
    api_dir = checkout / "apps" / "api"
    if not api_dir.is_dir():
        raise MaintenanceError(f"not a Job Tracker checkout: {checkout}")
    config_file = api_dir / ".env"
    values = dotenv_values(config_file, interpolate=False) if config_file.is_file() else {}
    raw_database = values.get("DB_PATH") or "jobtracker.db"
    database = Path(raw_database)
    if not database.is_absolute():
        database = api_dir / database
    has_remote = bool(values.get("TURSO_DATABASE_URL"))
    local_first = _boolean(values.get("TURSO_LOCAL_FIRST"), name="TURSO_LOCAL_FIRST")
    effective = (
        Path(f"{database.resolve()}.sync") if has_remote and local_first else database.resolve()
    )
    paths = resolve_paths(
        profile="source", environ={"JOB_TRACKER_APP_DIR": str(checkout)}, cwd=api_dir
    )
    return replace(paths, database=database.resolve()), effective


def _destination_is_empty(database: Path) -> bool:
    candidates = [database]
    candidates.extend(database.parent.glob(f"{database.name}-*"))
    candidates.extend(database.parent.glob(f"{database.name}.sync*"))
    return not any(path.exists() for path in candidates)


def migrate_checkout(settings: Settings, paths: ResolvedPaths, checkout: Path) -> Path:
    """Install a checkout snapshot into an empty, local packaged destination."""
    if paths.profile != "packaged":
        raise MaintenanceError("migrate-checkout requires the packaged profile")
    if settings.turso_database_url:
        raise MaintenanceError(
            "migrate-checkout requires a local packaged destination; configure Turso "
            "only after validating the adopted database"
        )

    source_paths, source = _source_paths(checkout)
    destination = paths.database.resolve()
    if source == destination:
        raise MaintenanceError("legacy source and packaged destination must differ")
    ensure_private_directory(paths.data_dir)

    lock_paths = sorted((source_paths, paths), key=lambda item: str(item.lock_file.resolve()))
    if lock_paths[0].lock_file.resolve() == lock_paths[1].lock_file.resolve():
        raise MaintenanceError("legacy source and packaged destination share a server lock")

    with ExitStack() as stack:
        for locked_paths in lock_paths:
            stack.enter_context(profile_lock(locked_paths, operation="migrate-checkout"))
        if not _destination_is_empty(destination):
            raise MaintenanceError(
                "packaged destination is not empty; migrate-checkout never merges databases"
            )
        return snapshot_database(
            source,
            destination,
            prepare_candidate=lambda candidate: _migrate_candidate(candidate, paths.schema_file),
        )

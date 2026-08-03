"""Foreground command line interface with delayed application imports."""

from __future__ import annotations

import argparse
import os
import stat
import sys
from collections.abc import MutableMapping, Sequence
from pathlib import Path
from typing import TYPE_CHECKING

from app.core.paths import (
    PathResolutionError,
    ResolvedPaths,
    inferred_application_root,
    settings_paths,
)

if TYPE_CHECKING:
    from app.core.config import Settings


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="job-tracker")
    parser.add_argument("--profile", choices=("direct", "source", "packaged"))
    parser.add_argument("--app-dir", type=Path)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--config-dir", type=Path)
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--config-file", type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    start = commands.add_parser("start", help="run the localhost server in the foreground")
    start.add_argument("--port", type=int)
    commands.add_parser("status", help="report stopped, healthy, or unhealthy-lock state")
    commands.add_parser("paths", help="print the resolved non-secret path inventory")
    commands.add_parser("version", help="print the product version")
    commands.add_parser("doctor", help="run bounded, redacted local diagnostics")
    backup = commands.add_parser("backup", help="create a validated offline SQLite snapshot")
    backup.add_argument("output", type=Path)
    restore = commands.add_parser("restore", help="restore through a validated local candidate")
    restore.add_argument("backup", type=Path)
    restore.add_argument("--target", type=Path)
    restore.add_argument("--replace", action="store_true")
    migrate = commands.add_parser(
        "migrate-checkout", help="adopt a legacy checkout into an empty packaged profile"
    )
    migrate.add_argument("checkout", type=Path)
    return parser


def _establish_profile(args: argparse.Namespace, environment: MutableMapping[str, str]) -> None:
    environment["JOB_TRACKER_PROFILE"] = (
        args.profile or environment.get("JOB_TRACKER_PROFILE") or "packaged"
    )
    environment.setdefault("JOB_TRACKER_APP_DIR", str(inferred_application_root()))
    options = {
        "JOB_TRACKER_APP_DIR": args.app_dir,
        "JOB_TRACKER_DATA_DIR": args.data_dir,
        "JOB_TRACKER_CONFIG_DIR": args.config_dir,
        "JOB_TRACKER_STATE_DIR": args.state_dir,
        "JOB_TRACKER_CONFIG_FILE": args.config_file,
    }
    for name, value in options.items():
        if value is not None:
            environment[name] = str(value.resolve())
    if getattr(args, "port", None) is not None:
        if not 1 <= args.port <= 65535:
            raise PathResolutionError("port must be between 1 and 65535")
        environment["PORT"] = str(args.port)


def _load_runtime() -> tuple[Settings, ResolvedPaths]:
    # Import only after profile overrides are established. get_settings chooses the
    # profile config file, then these assignments anchor its relative path values.
    from app.core.config import get_settings

    settings = get_settings()
    paths = settings_paths(settings)
    settings.db_path = str(paths.database)
    settings.scripts_output_dir = paths.scripts_output_dir
    settings.web_dist_path = paths.web_dist
    return settings, paths


def _product_version(paths: ResolvedPaths) -> str:
    return paths.version_file.read_text().strip()


def _configured_mode(settings: Settings) -> str:
    if not settings.turso_database_url:
        return "local-sqlite"
    return "local-first" if settings.turso_local_first else "embedded-replica"


def _permission_diagnostics(paths: ResolvedPaths, database: Path) -> tuple[str, bool]:
    if os.name != "posix":
        return "unsupported on this platform", False
    problems: list[str] = []
    for path, expected in (
        (paths.data_dir, 0o700),
        (paths.config_dir, 0o700),
        (paths.state_dir, 0o700),
        (paths.backup_dir, 0o700),
        (paths.config_file, 0o600),
        (database, 0o600),
        (paths.lock_file, 0o600),
    ):
        if path.exists():
            actual = stat.S_IMODE(path.stat().st_mode)
            if actual != expected:
                problems.append(f"{path} is {actual:04o}, expected {expected:04o}")
    return ("ok" if not problems else "; ".join(problems[:4])), bool(problems)


def _doctor(settings: Settings, paths: ResolvedPaths) -> int:
    from app.core.lifecycle import inspect_server
    from app.maintenance.backup import effective_store, validate_snapshot
    from app.maintenance.base import MaintenanceError

    failed = False
    print(f"product_version: {_product_version(paths)}")
    print(
        f"python_version: {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    )
    print(f"profile: {paths.profile}")
    print(f"mode: {_configured_mode(settings)}")
    for name, value in paths.display().items():
        if name != "profile":
            print(f"path_{name}: {value}")

    try:
        server = inspect_server(paths)
        print(f"server: {server.state} ({server.detail})")
    except (OSError, RuntimeError) as exc:
        server = None
        failed = True
        print(f"server: unavailable ({exc})")

    database = effective_store(settings, paths)
    if not database.exists():
        print("database_integrity: not-created")
    elif server is not None and server.state != "stopped":
        print("database_integrity: skipped while server lock is held")
    else:
        try:
            validate_snapshot(database)
            print("database_integrity: ok")
        except MaintenanceError as exc:
            failed = True
            print(f"database_integrity: failed ({exc})")

    permissions, permission_failure = _permission_diagnostics(paths, database)
    failed = failed or permission_failure
    print(f"permissions: {permissions}")
    return 2 if failed else 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        _establish_profile(args, os.environ)
        settings, paths = _load_runtime()
    except (OSError, PathResolutionError, ValueError) as exc:
        print(f"job-tracker: {exc}", file=sys.stderr)
        return 2

    if args.command == "paths":
        for name, value in paths.display().items():
            print(f"{name}: {value}")
        return 0

    if args.command == "version":
        try:
            print(_product_version(paths))
        except OSError as exc:
            print(f"job-tracker: cannot read product version: {exc}", file=sys.stderr)
            return 2
        return 0

    if args.command == "doctor":
        try:
            return _doctor(settings, paths)
        except (OSError, RuntimeError) as exc:
            print(f"job-tracker: doctor failed: {exc}", file=sys.stderr)
            return 2

    if args.command == "status":
        from app.core.lifecycle import inspect_server

        status = inspect_server(paths)
        print(f"{status.state}: {status.detail}")
        return {"healthy": 0, "stopped": 1, "lock-held-but-unhealthy": 2}[status.state]

    try:
        if args.command == "backup":
            from app.maintenance.backup import backup_profile

            output = backup_profile(settings, paths, args.output.resolve())
            print(f"backup created: {output}")
            return 0

        if args.command == "restore":
            from app.maintenance.restore import restore_profile

            target = args.target.resolve() if args.target is not None else None
            restored = restore_profile(
                settings, paths, args.backup.resolve(), target=target, replace=args.replace
            )
            print(f"restore created: {restored}")
            return 0

        if args.command == "migrate-checkout":
            from app.maintenance.migrate_checkout import migrate_checkout

            adopted = migrate_checkout(settings, paths, args.checkout.resolve())
            print(f"checkout adopted: {adopted}")
            return 0
    except (OSError, RuntimeError) as exc:
        print(f"job-tracker: {exc}", file=sys.stderr)
        return 2

    # Importing uvicorn does not import app.main. Its import string is resolved only
    # after every packaged path/config override above is in place.
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.port)
    return 0


if __name__ == "__main__":  # pragma: no cover - console-script wrapper owns this path
    raise SystemExit(main())

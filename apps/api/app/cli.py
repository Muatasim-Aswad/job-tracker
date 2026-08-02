"""Foreground command line interface with delayed application imports."""

from __future__ import annotations

import argparse
import os
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
            print(paths.version_file.read_text().strip())
        except OSError as exc:
            print(f"job-tracker: cannot read product version: {exc}", file=sys.stderr)
            return 2
        return 0

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

"""Explicit source, packaged, and direct-development path resolution."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

Profile = Literal["direct", "source", "packaged"]


class PathResolutionError(ValueError):
    """Raised when an explicit profile cannot be resolved safely."""


@dataclass(frozen=True)
class ResolvedPaths:
    profile: Profile
    runtime_cwd: Path
    app_dir: Path
    data_dir: Path
    config_dir: Path
    state_dir: Path
    database: Path
    config_file: Path
    backup_dir: Path
    scripts_output_dir: Path
    web_dist: Path
    version_file: Path
    schema_file: Path
    lock_file: Path

    def with_runtime_overrides(
        self,
        *,
        database: str | Path | None = None,
        scripts_output_dir: str | Path | None = None,
        web_dist: str | Path | None = None,
    ) -> ResolvedPaths:
        """Resolve settings/config-file values against their owning roots."""
        compatibility = self.profile in {"direct", "source"}
        return replace(
            self,
            database=_owned_path(
                database, self.runtime_cwd if compatibility else self.data_dir, self.database
            ),
            scripts_output_dir=_owned_path(
                scripts_output_dir,
                self.runtime_cwd if compatibility else self.data_dir,
                self.scripts_output_dir,
            ),
            web_dist=_owned_path(
                web_dist, self.runtime_cwd if compatibility else self.app_dir, self.web_dist
            ),
        )

    def display(self) -> dict[str, str]:
        """Return the public path inventory; it deliberately contains no secrets."""
        return {
            "profile": self.profile,
            "application": str(self.app_dir),
            "data": str(self.data_dir),
            "configuration": str(self.config_dir),
            "state": str(self.state_dir),
            "database": str(self.database),
            "dashboard": str(self.web_dist),
            "schema": str(self.schema_file),
            "version": str(self.version_file),
        }


def inferred_application_root() -> Path:
    """Return the source/runtime-bundle root from this module's fixed layout."""
    return Path(__file__).resolve().parents[4]


def _absolute(value: str | Path, name: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise PathResolutionError(f"{name} must be an absolute path: {path}")
    return path.resolve()


def _owned_path(value: str | Path | None, owner: Path, default: Path) -> Path:
    if value is None:
        return default
    path = Path(value)
    return path.resolve() if path.is_absolute() else (owner / path).resolve()


def _env_path(environment: Mapping[str, str], name: str, default: Path) -> Path:
    value = environment.get(name)
    return _absolute(value, name) if value else default


def resolve_paths(
    *,
    profile: Profile | None = None,
    environ: Mapping[str, str] | None = None,
    cwd: Path | None = None,
) -> ResolvedPaths:
    """Resolve one path profile without consulting cwd to select that profile.

    Tests pass an explicit environment map and cwd, so they never depend on the
    executing user's home or checkout state.
    """
    environment = os.environ if environ is None else environ
    selected = profile or environment.get("JOB_TRACKER_PROFILE", "direct")
    if selected not in {"direct", "source", "packaged"}:
        raise PathResolutionError(f"unknown JOB_TRACKER_PROFILE: {selected}")
    selected_profile: Profile = selected  # type: ignore[assignment]
    working_dir = (Path.cwd() if cwd is None else cwd).resolve()
    inferred_app = inferred_application_root()

    if selected_profile == "direct":
        app_dir = _env_path(environment, "JOB_TRACKER_APP_DIR", inferred_app)
        data_dir = _env_path(environment, "JOB_TRACKER_DATA_DIR", working_dir)
        config_dir = _env_path(environment, "JOB_TRACKER_CONFIG_DIR", working_dir)
        state_dir = _env_path(
            environment, "JOB_TRACKER_STATE_DIR", working_dir / ".job-tracker-state"
        )
        config_file = _owned_path(
            environment.get("JOB_TRACKER_CONFIG_FILE"), config_dir, config_dir / ".env"
        )
        database = _owned_path(
            environment.get("DB_PATH"), working_dir, working_dir / "jobtracker.db"
        )
        scripts_output = _owned_path(
            environment.get("SCRIPTS_OUTPUT_DIR"), working_dir, working_dir / "script-output"
        )
    elif selected_profile == "source":
        app_dir = _env_path(environment, "JOB_TRACKER_APP_DIR", inferred_app)
        api_dir = app_dir / "apps" / "api"
        data_dir = _env_path(environment, "JOB_TRACKER_DATA_DIR", api_dir)
        config_dir = _env_path(environment, "JOB_TRACKER_CONFIG_DIR", api_dir)
        state_dir = _env_path(environment, "JOB_TRACKER_STATE_DIR", api_dir / ".job-tracker-state")
        config_file = _owned_path(
            environment.get("JOB_TRACKER_CONFIG_FILE"), config_dir, config_dir / ".env"
        )
        database = _owned_path(environment.get("DB_PATH"), working_dir, api_dir / "jobtracker.db")
        scripts_output = _owned_path(
            environment.get("SCRIPTS_OUTPUT_DIR"), working_dir, api_dir / "script-output"
        )
    else:
        app_value = environment.get("JOB_TRACKER_APP_DIR")
        if not app_value:
            raise PathResolutionError("packaged profile requires JOB_TRACKER_APP_DIR")
        app_dir = _absolute(app_value, "JOB_TRACKER_APP_DIR")
        home_value = environment.get("HOME")
        xdg_data = environment.get("XDG_DATA_HOME")
        xdg_config = environment.get("XDG_CONFIG_HOME")
        xdg_state = environment.get("XDG_STATE_HOME")
        if not home_value and not (xdg_data and xdg_config and xdg_state):
            raise PathResolutionError(
                "packaged profile requires HOME or explicit XDG data/config/state roots"
            )
        home = _absolute(home_value, "HOME") if home_value else Path("/")
        data_default = _absolute(xdg_data, "XDG_DATA_HOME") if xdg_data else home / ".local/share"
        config_default = (
            _absolute(xdg_config, "XDG_CONFIG_HOME") if xdg_config else home / ".config"
        )
        state_default = (
            _absolute(xdg_state, "XDG_STATE_HOME") if xdg_state else home / ".local/state"
        )
        data_dir = _env_path(environment, "JOB_TRACKER_DATA_DIR", data_default / "job-tracker")
        config_dir = _env_path(
            environment, "JOB_TRACKER_CONFIG_DIR", config_default / "job-tracker"
        )
        state_dir = _env_path(environment, "JOB_TRACKER_STATE_DIR", state_default / "job-tracker")
        config_file = _owned_path(
            environment.get("JOB_TRACKER_CONFIG_FILE"), config_dir, config_dir / "config.env"
        )
        database = _owned_path(environment.get("DB_PATH"), data_dir, data_dir / "jobtracker.db")
        scripts_output = _owned_path(
            environment.get("SCRIPTS_OUTPUT_DIR"), data_dir, data_dir / "script-output"
        )

    backup_dir = _owned_path(
        environment.get("JOB_TRACKER_BACKUP_DIR"), data_dir, data_dir / "backups"
    )
    web_owner = working_dir if selected_profile in {"direct", "source"} else app_dir
    web_dist = _owned_path(
        environment.get("WEB_DIST_PATH"), web_owner, app_dir / "apps" / "web" / "dist"
    )
    return ResolvedPaths(
        profile=selected_profile,
        runtime_cwd=working_dir,
        app_dir=app_dir,
        data_dir=data_dir,
        config_dir=config_dir,
        state_dir=state_dir,
        database=database,
        config_file=config_file,
        backup_dir=backup_dir,
        scripts_output_dir=scripts_output,
        web_dist=web_dist,
        version_file=app_dir / "VERSION",
        schema_file=app_dir / "apps" / "api" / "app" / "core" / "schema.sql",
        lock_file=state_dir / "server.lock",
    )


def settings_paths(settings: object, *, environ: Mapping[str, str] | None = None) -> ResolvedPaths:
    """Apply already-loaded settings values to the selected profile."""
    paths = resolve_paths(environ=environ)
    return paths.with_runtime_overrides(
        database=getattr(settings, "db_path", None),
        scripts_output_dir=getattr(settings, "scripts_output_dir", None),
        web_dist=getattr(settings, "web_dist_path", None),
    )

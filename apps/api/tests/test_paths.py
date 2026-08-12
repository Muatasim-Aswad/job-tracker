from __future__ import annotations

from pathlib import Path

import pytest

from app.core.paths import PathResolutionError, resolve_paths


def _packaged_env(tmp_path: Path) -> dict[str, str]:
    return {"JOB_TRACKER_APP_DIR": str(tmp_path / "app"), "HOME": str(tmp_path / "home")}


def test_packaged_profile_uses_an_injected_home_and_separate_roots(tmp_path: Path) -> None:
    paths = resolve_paths(
        profile="packaged", environ=_packaged_env(tmp_path), cwd=tmp_path, platform="linux"
    )

    assert paths.app_dir == (tmp_path / "app").resolve()
    assert paths.data_dir == (tmp_path / "home/.local/share/job-tracker").resolve()
    assert paths.config_file == (tmp_path / "home/.config/job-tracker/config.env").resolve()
    assert paths.state_dir == (tmp_path / "home/.local/state/job-tracker").resolve()
    assert paths.database == paths.data_dir / "jobtracker.db"
    assert paths.web_dist == paths.app_dir / "apps/web/dist"


def test_packaged_relative_values_anchor_to_their_owning_roots(tmp_path: Path) -> None:
    environment = _packaged_env(tmp_path) | {
        "DB_PATH": "db/custom.sqlite",
        "WEB_DIST_PATH": "dashboard",
        "SCRIPTS_OUTPUT_DIR": "reports",
    }
    paths = resolve_paths(
        profile="packaged", environ=environment, cwd=tmp_path / "elsewhere", platform="linux"
    )

    assert paths.database == paths.data_dir / "db/custom.sqlite"
    assert paths.web_dist == paths.app_dir / "dashboard"
    assert paths.scripts_output_dir == paths.data_dir / "reports"


def test_source_profile_uses_explicit_synthetic_checkout(tmp_path: Path) -> None:
    app_dir = tmp_path / "checkout"
    paths = resolve_paths(
        profile="source", environ={"JOB_TRACKER_APP_DIR": str(app_dir)}, cwd=tmp_path / "other"
    )

    assert paths.database == app_dir / "apps/api/jobtracker.db"
    assert paths.config_file == app_dir / "apps/api/.env"
    assert paths.version_file == app_dir / "VERSION"
    assert paths.schema_file == app_dir / "apps/api/app/core/schema.sql"


def test_direct_profile_retains_cwd_relative_api_defaults(tmp_path: Path) -> None:
    paths = resolve_paths(profile="direct", environ={}, cwd=tmp_path)

    assert paths.database == tmp_path / "jobtracker.db"
    assert paths.config_file == tmp_path / ".env"
    assert paths.scripts_output_dir == tmp_path / "script-output"


def test_packaged_profile_rejects_relative_or_home_less_roots(tmp_path: Path) -> None:
    with pytest.raises(PathResolutionError, match="JOB_TRACKER_APP_DIR"):
        resolve_paths(profile="packaged", environ={"HOME": str(tmp_path)}, cwd=tmp_path)
    with pytest.raises(PathResolutionError, match="absolute"):
        resolve_paths(
            profile="packaged",
            environ={"HOME": str(tmp_path), "JOB_TRACKER_APP_DIR": "relative"},
            cwd=tmp_path,
        )

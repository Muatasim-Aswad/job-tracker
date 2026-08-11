from __future__ import annotations

import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

from app.core.paths import resolve_paths

ROOT = Path(__file__).resolve().parents[3]
VERSION = (ROOT / "VERSION").read_text().strip()


def test_macos_packaged_profile_uses_application_support(tmp_path: Path) -> None:
    app_dir = tmp_path / "installed-resources"
    home = tmp_path / "home"
    paths = resolve_paths(
        profile="packaged",
        environ={"JOB_TRACKER_APP_DIR": str(app_dir), "HOME": str(home)},
        cwd=tmp_path / "outside",
        platform="darwin",
    )

    support = home / "Library/Application Support/Job Tracker"
    assert paths.data_dir == support / "data"
    assert paths.config_file == support / "configuration/config.env"
    assert paths.state_dir == support / "state"


def test_release_workflow_smokes_the_downloaded_wheel_with_fresh_tool_roots() -> None:
    workflow = (ROOT / ".github/workflows/release.yml").read_text()
    smoke = (ROOT / "scripts/smoke-wheel.sh").read_text()

    assert (
        'bash scripts/smoke-wheel.sh "$RELEASE_DIR/job_tracker-$VERSION-py3-none-any.whl"'
        in workflow
    )
    for required in (
        "env -i",
        "UV_TOOL_DIR=$TOOL_DIR",
        "UV_TOOL_BIN_DIR=$BIN_DIR",
        'cd "$OUTSIDE"',
        'uv tool install "${install_options[@]}" "$WHEEL"',
        "uv tool uninstall job-tracker",
    ):
        assert required in smoke
    assert "--with" not in smoke


@pytest.mark.wheel
def test_generated_wheel_has_canonical_metadata_and_runtime_resources(tmp_path: Path) -> None:
    release_dir = tmp_path / "release"
    environment = os.environ.copy()
    environment.update(
        {"JOB_TRACKER_RELEASE_DIR": str(release_dir), "UV_CACHE_DIR": str(tmp_path / "uv-cache")}
    )
    subprocess.run(
        ["bash", str(ROOT / "scripts/build-wheel.sh")],
        cwd=ROOT,
        env=environment,
        check=True,
        text=True,
    )

    wheel = release_dir / f"job_tracker-{VERSION}-py3-none-any.whl"
    assert wheel.is_file()
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        metadata = archive.read(f"job_tracker-{VERSION}.dist-info/METADATA").decode()
        assert "app/core/schema.sql" in names
        assert "app/resources/VERSION" in names
        assert "app/resources/apps/web/dist/index.html" in names
        assert f"job_tracker-{VERSION}.dist-info/licenses/LICENSE" in names
        assert archive.read("app/resources/VERSION").decode().strip() == VERSION
        assert f"Version: {VERSION}\n" in metadata
        assert "Name: job-tracker\n" in metadata
        assert "License-Expression: MIT\n" in metadata
        assert "Description-Content-Type: text/markdown\n" in metadata
        assert not any("/tests/" in name or name.endswith(".map") for name in names)

    extracted = tmp_path / "installed"
    with zipfile.ZipFile(wheel) as archive:
        archive.extractall(extracted)
    probe = subprocess.run(
        [sys.executable, "-c", "from app.cli import main; raise SystemExit(main(['paths']))"],
        cwd=tmp_path,
        env={
            "PATH": os.environ["PATH"],
            "HOME": str(tmp_path / "home"),
            "PYTHONPATH": str(extracted),
            "JOB_TRACKER_PROFILE": "packaged",
        },
        check=True,
        text=True,
        capture_output=True,
    )
    assert str(extracted / "app/resources/VERSION") in probe.stdout
    assert str(extracted / "app/core/schema.sql") in probe.stdout
    assert str(extracted / "app/resources/apps/web/dist") in probe.stdout
    assert str(ROOT) not in probe.stdout

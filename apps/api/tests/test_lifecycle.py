from __future__ import annotations

import json
import multiprocessing
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core.lifecycle import (
    LockHeldError,
    ServerLock,
    inspect_server,
    prepare_private_directories,
    private_creation_mask,
    protect_new_database,
)
from app.core.paths import resolve_paths


def _environment(tmp_path: Path) -> dict[str, str]:
    return {"JOB_TRACKER_APP_DIR": str(tmp_path / "app"), "HOME": str(tmp_path / "home")}


def _attempt_lock(environment: dict[str, str], result: multiprocessing.Queue[str]) -> None:
    paths = resolve_paths(profile="packaged", environ=environment)
    lock = ServerLock(paths, port=3456, version="test")
    try:
        lock.acquire()
    except LockHeldError:
        result.put("held")
    else:
        result.put("acquired")
        lock.release()


@pytest.mark.skipif(os.name != "posix", reason="POSIX advisory-lock assertion")
def test_two_processes_cannot_own_the_same_database_profile(tmp_path: Path) -> None:
    environment = _environment(tmp_path)
    paths = resolve_paths(profile="packaged", environ=environment)
    with ServerLock(paths, port=3456, version="test"):
        context = multiprocessing.get_context("spawn")
        result: multiprocessing.Queue[str] = context.Queue()
        process = context.Process(target=_attempt_lock, args=(environment, result))
        process.start()
        process.join(timeout=10)
        assert process.exitcode == 0
        assert result.get(timeout=2) == "held"


@pytest.mark.skipif(os.name != "posix", reason="POSIX advisory-lock assertion")
def test_stale_lock_is_reused_without_signalling_its_recorded_pid(tmp_path: Path) -> None:
    paths = resolve_paths(profile="packaged", environ=_environment(tmp_path))
    paths.state_dir.mkdir(parents=True)
    paths.lock_file.write_text('{"pid": 1, "port": 9}\n')

    with ServerLock(paths, port=3456, version="test"):
        assert json.loads(paths.lock_file.read_text())["pid"] != 1


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission assertion")
def test_mutable_directories_and_lock_are_private(tmp_path: Path) -> None:
    paths = resolve_paths(profile="packaged", environ=_environment(tmp_path))
    prepare_private_directories(paths)
    for directory in (paths.data_dir, paths.config_dir, paths.state_dir, paths.backup_dir):
        assert directory.stat().st_mode & 0o777 == 0o700
    with ServerLock(paths, port=3456, version="test"):
        assert paths.lock_file.stat().st_mode & 0o777 == 0o600
    paths.database.write_text("")
    paths.database.chmod(0o666)
    protect_new_database(paths.database, existed_before_open=False)
    assert paths.database.stat().st_mode & 0o777 == 0o600
    sidecar = tmp_path / "new-sidecar"
    with private_creation_mask():
        sidecar.write_text("")
    assert sidecar.stat().st_mode & 0o777 == 0o600


class _HealthyResponse:
    status = 200

    def __enter__(self) -> _HealthyResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None


@pytest.mark.skipif(os.name != "posix", reason="POSIX advisory-lock assertion")
def test_status_distinguishes_free_and_held_unhealthy_lock(tmp_path: Path) -> None:
    paths = resolve_paths(profile="packaged", environ=_environment(tmp_path))
    assert inspect_server(paths).state == "stopped"
    with ServerLock(paths, port=1, version="test"):
        assert inspect_server(paths, timeout=0.01).state == "lock-held-but-unhealthy"
    assert inspect_server(paths).state == "stopped"


@pytest.mark.skipif(os.name != "posix", reason="POSIX advisory-lock assertion")
def test_status_reports_a_healthy_lock_owner(tmp_path: Path) -> None:
    paths = resolve_paths(profile="packaged", environ=_environment(tmp_path))
    with (
        ServerLock(paths, port=3456, version="test"),
        patch("app.core.lifecycle.urlopen", return_value=_HealthyResponse()),
    ):
        status = inspect_server(paths)
    assert status.state == "healthy"

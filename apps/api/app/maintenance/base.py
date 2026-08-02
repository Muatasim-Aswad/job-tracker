"""Shared safety primitives for offline maintenance commands."""

from __future__ import annotations

import errno
import json
import os
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from pathlib import Path

from app.core.paths import ResolvedPaths


class MaintenanceError(RuntimeError):
    """An actionable refusal or failure safe to show on the command line."""


def ensure_private_directory(path: Path) -> None:
    """Create a maintenance-owned directory without widening existing modes."""
    existed = path.exists()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == "posix" and not existed:
        path.chmod(0o700)


def _lock_owner(fd: int) -> str:
    try:
        os.lseek(fd, 0, os.SEEK_SET)
        raw = os.read(fd, 16_384).decode(errors="replace")
        metadata = json.loads(raw)
        pid = metadata.get("pid")
        if isinstance(pid, int) and pid > 0:
            return f"PID {pid}"
    except OSError, UnicodeError, json.JSONDecodeError, AttributeError:
        pass
    return "an unknown process"


@contextmanager
def profile_lock(paths: ResolvedPaths, *, operation: str) -> Iterator[None]:
    """Hold the server lock without rewriting stale diagnostic metadata."""
    if os.name != "posix":
        raise MaintenanceError("offline maintenance locking is unsupported on this platform")

    import fcntl

    state_existed = paths.state_dir.exists()
    ensure_private_directory(paths.state_dir)
    lock_existed = paths.lock_file.exists()
    fd = os.open(paths.lock_file, os.O_RDWR | os.O_CREAT, 0o600)
    acquired = False
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except OSError as exc:
            if exc.errno not in {errno.EACCES, errno.EAGAIN}:
                raise
            owner = _lock_owner(fd)
            raise MaintenanceError(
                f"{operation} refused: {paths.profile} profile lock is held by {owner}; "
                "stop that Job Tracker server with Ctrl-C, then retry"
            ) from exc
        yield
    finally:
        if acquired:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
        if acquired and not lock_existed:
            with suppress(FileNotFoundError):
                paths.lock_file.unlink()
        if acquired and not state_existed:
            with suppress(OSError):
                paths.state_dir.rmdir()

"""Private profile preparation and server-owned advisory process locking."""

from __future__ import annotations

import errno
import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import TracebackType
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from app.core.paths import ResolvedPaths


class LockHeldError(RuntimeError):
    """Raised when another server owns the selected database profile."""


def _chmod_private(path: Path, mode: int) -> None:
    if os.name == "posix":
        path.chmod(mode)


@contextmanager
def private_creation_mask() -> Iterator[None]:
    """Keep databases, sidecars, and runtime files private for server lifetime."""
    previous = os.umask(0o077) if os.name == "posix" else None
    try:
        yield
    finally:
        if previous is not None:
            os.umask(previous)


def prepare_private_directories(paths: ResolvedPaths) -> None:
    """Create mutable profile roots with private POSIX permissions."""
    for directory in (paths.data_dir, paths.config_dir, paths.state_dir, paths.backup_dir):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        _chmod_private(directory, 0o700)


def protect_new_database(path: Path, *, existed_before_open: bool) -> None:
    """Repair a newly created database before request handling exposes it."""
    if not existed_before_open and path.exists():
        _chmod_private(path, 0o600)


def _try_lock(fd: int) -> None:
    if os.name != "posix":
        raise RuntimeError("advisory server locking is not supported on this platform")
    import fcntl

    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock(fd: int) -> None:
    if os.name == "posix":
        import fcntl

        fcntl.flock(fd, fcntl.LOCK_UN)


class ServerLock:
    """An exclusive lock held from before database open through database close."""

    def __init__(self, paths: ResolvedPaths, *, port: int, version: str) -> None:
        self.paths = paths
        self.port = port
        self.version = version
        self._fd: int | None = None

    def acquire(self) -> None:
        prepare_private_directories(self.paths)
        fd = os.open(self.paths.lock_file, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            _chmod_private(self.paths.lock_file, 0o600)
            _try_lock(fd)
        except OSError as exc:
            os.close(fd)
            if exc.errno in {errno.EACCES, errno.EAGAIN}:
                raise LockHeldError(
                    f"database profile is already running ({self.paths.database}); "
                    "stop that Job Tracker server before starting another"
                ) from exc
            raise
        except Exception:
            os.close(fd)
            raise

        metadata = {
            "version": self.version,
            "pid": os.getpid(),
            "started_at": datetime.now(UTC).isoformat(),
            "address": "127.0.0.1",
            "port": self.port,
            "profile": self.paths.profile,
            "data": str(self.paths.data_dir.resolve()),
            "state": str(self.paths.state_dir.resolve()),
            "database": str(self.paths.database.resolve()),
        }
        payload = (json.dumps(metadata, sort_keys=True) + "\n").encode()
        os.ftruncate(fd, 0)
        os.write(fd, payload)
        os.fsync(fd)
        self._fd = fd

    def release(self) -> None:
        if self._fd is None:
            return
        fd, self._fd = self._fd, None
        _unlock(fd)
        os.close(fd)

    def __enter__(self) -> ServerLock:
        self.acquire()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.release()


@dataclass(frozen=True)
class ServerStatus:
    state: str
    detail: str


def _lock_is_held(lock_file: Path) -> bool:
    if not lock_file.exists():
        return False
    fd = os.open(lock_file, os.O_RDONLY)
    try:
        try:
            _try_lock(fd)
        except OSError as exc:
            if exc.errno in {errno.EACCES, errno.EAGAIN}:
                return True
            raise
        _unlock(fd)
        return False
    finally:
        os.close(fd)


def inspect_server(paths: ResolvedPaths, *, timeout: float = 0.4) -> ServerStatus:
    """Inspect lock ownership and loopback health without touching the database."""
    if not _lock_is_held(paths.lock_file):
        return ServerStatus("stopped", "server lock is free")
    try:
        metadata = json.loads(paths.lock_file.read_text())
        port = int(metadata["port"])
    except OSError, ValueError, TypeError, KeyError, json.JSONDecodeError:
        return ServerStatus("lock-held-but-unhealthy", "lock metadata is unreadable")
    try:
        with urlopen(f"http://127.0.0.1:{port}/health", timeout=timeout) as response:  # noqa: S310
            if response.status == 200:
                return ServerStatus("healthy", f"server is healthy on 127.0.0.1:{port}")
    except HTTPError, URLError, TimeoutError, OSError:
        pass
    return ServerStatus(
        "lock-held-but-unhealthy", f"lock is held but health failed on 127.0.0.1:{port}"
    )

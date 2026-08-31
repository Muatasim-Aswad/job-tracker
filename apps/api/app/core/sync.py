"""Background sync scheduler for pyturso local-first mode (core.db mode 1).

Writes land in the local DB instantly; this coalesces bursts of them and pushes to
the remote primary once activity settles, keeping the network off the request path
entirely. It also **pulls** the primary periodically, so writes made on another
laptop show up without a restart. One daemon thread drives both rather than the
event loop, so endpoints running in FastAPI's worker threadpool can signal a write
with a plain method call and never block.
"""

import logging
import threading
import time

from app.core.db import Database

logger = logging.getLogger("uvicorn.error")


class PushScheduler:
    def __init__(
        self, db: Database, debounce_seconds: float, pull_interval_seconds: float = 0.0
    ) -> None:
        self._db = db
        self._debounce = debounce_seconds
        # <= 0 disables periodic pulls (the startup pull in core.db still runs).
        self._pull_interval = pull_interval_seconds
        self._dirty = threading.Event()  # a write happened since the last push
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._last_write = 0.0
        self._clock = threading.Lock()  # guards _last_write
        # connect() already pulled on startup, so the first periodic pull is due
        # one interval from now.
        self._last_pull = time.monotonic()
        self._thread = threading.Thread(target=self._run, name="turso-sync", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def notify_write(self) -> None:
        """Called after a write commit (from a worker thread). Marks the DB dirty
        and (re)arms the debounce window."""
        with self._clock:
            self._last_write = time.monotonic()
        self._dirty.set()
        self._wake.set()

    def stop(self, timeout: float = 10.0) -> bool:
        """Request a final flush and wait at most ``timeout`` seconds.

        False leaves the daemon thread and connection for process exit rather than
        blocking shutdown behind an unresponsive remote.
        """
        self._stop.set()
        self._wake.set()
        self._thread.join(timeout=timeout)
        if self._thread.is_alive():
            logger.warning(
                "turso sync did not stop within %.1fs; local data remains durable and "
                "will retry on the next start",
                timeout,
            )
            return False
        return True

    # --- internals --------------------------------------------------------

    def _run(self) -> None:
        try:
            while not self._stop.is_set():
                # Pull first: pick up remote writes even when nothing local is pending.
                self._maybe_pull()
                # Wake for a write or stop. The 1s idle timeout paces pull checks.
                self._wake.wait(timeout=1.0)
                self._wake.clear()
                if self._stop.is_set() or not self._dirty.is_set():
                    continue
                # Wait for the write-quiet window. A later write advances
                # _last_write, so the next iteration extends the debounce.
                while not self._stop.is_set():
                    with self._clock:
                        quiet = time.monotonic() - self._last_write
                    if quiet >= self._debounce:
                        break
                    self._stop.wait(timeout=self._debounce - quiet)
                if self._stop.is_set():
                    continue
                self._dirty.clear()
                self._push()
        finally:
            if self._dirty.is_set():
                self._dirty.clear()
                self._push()

    def _maybe_pull(self) -> None:
        if self._pull_interval <= 0:
            return
        if time.monotonic() - self._last_pull < self._pull_interval:
            return
        try:
            self._db.pull()
        except Exception:
            # Non-fatal: local state stays valid, just possibly stale; retry next
            # cycle. Reset the clock either way so a failing remote isn't hammered.
            logger.warning("turso pull failed; will retry", exc_info=True)
        self._last_pull = time.monotonic()

    def _push(self) -> None:
        try:
            self._db.push()
        except Exception:
            # Keep the local writes marked dirty so the next cycle retries; the
            # data is safe on disk regardless.
            logger.warning("turso push failed; will retry", exc_info=True)
            self._dirty.set()
            self._wake.set()

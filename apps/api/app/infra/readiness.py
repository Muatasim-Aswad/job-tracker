"""Bound readiness responses without accumulating workers behind a stalled driver."""

import asyncio

from app.infra.database import Database


class DatabaseReadiness:
    def __init__(self, db: Database) -> None:
        self._db = db
        self._pending: asyncio.Task[bool] | None = None
        self._stopped = False

    def stop(self) -> None:
        self._stopped = True

    async def check(self, timeout: float = 1.0) -> bool:
        if self._stopped:
            return False
        if self._pending is None or self._pending.done():
            self._pending = asyncio.create_task(asyncio.to_thread(self._query, timeout))
        try:
            ready = await asyncio.wait_for(asyncio.shield(self._pending), timeout)
        except TimeoutError:
            return False
        return ready and not self._stopped

    def _query(self, timeout: float) -> bool:
        if not self._db.lock.acquire(timeout=timeout):
            return False
        try:
            if self._stopped:
                return False
            return self._db.conn.execute("SELECT 1").fetchone() is not None
        except Exception:
            # Driver diagnostics may contain private paths or connection details.
            return False
        finally:
            self._db.lock.release()

"""Exercise real FastAPI dependency scheduling in a disposable process.

A worker-pool deadlock must fail with a timeout rather than hang the test runner.
No application lifespan or configured database is opened.
"""

from __future__ import annotations

import asyncio
import sqlite3
import subprocess
import sys
from contextlib import suppress

import anyio.to_thread
import httpx
from fastapi import Depends, FastAPI, HTTPException

from app.core import deps
from app.core.db import Database
from app.core.deps import service_factory


def test_requests_exceeding_worker_capacity_complete() -> None:
    result = subprocess.run([sys.executable, __file__], capture_output=True, text=True, timeout=12)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "concurrency checks passed" in result.stdout


async def _exercise() -> None:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.execute("CREATE TABLE writes (value INTEGER)")
    db = Database(conn)
    app = FastAPI()
    app.state.db = db

    class Service:
        def __init__(self, conn: sqlite3.Connection) -> None:
            self.conn = conn

    get_service = service_factory(Service)

    @app.post("/write")
    def write(value: int, service=Depends(get_service)) -> dict[str, bool]:
        service.conn.execute("INSERT INTO writes VALUES (?)", (value,))
        if value < 0:
            raise HTTPException(400, "rollback this write")
        return {"ok": True}

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        limiter = anyio.to_thread.current_default_thread_limiter()
        assert limiter.total_tokens == 40
        db.lock.acquire()  # emulate a background pull temporarily owning the connection
        requests = [asyncio.create_task(client.post(f"/write?value={i}")) for i in range(60)]
        await asyncio.sleep(0.2)
        try:
            # The DB-free synchronous probe must run while requests wait for sync.
            response = await asyncio.wait_for(client.get("/health"), timeout=1)
            assert response.status_code == 200
            assert limiter.borrowed_tokens <= 1
        finally:
            db.lock.release()
        responses = await asyncio.wait_for(asyncio.gather(*requests), timeout=3)
        assert all(response.status_code == 200 for response in responses)
        assert conn.execute("SELECT COUNT(*) FROM writes").fetchone() == (60,)
        assert not db.lock.locked()
        assert not db.request_slot.locked()

        assert (await client.post("/write?value=-1")).status_code == 400
        assert conn.execute("SELECT COUNT(*) FROM writes WHERE value < 0").fetchone() == (0,)

        # A queued cancellation must not strand admission or touch the transaction.
        await db.request_slot.acquire()
        queued = asyncio.create_task(client.post("/write?value=100"))
        await asyncio.sleep(0.05)
        queued.cancel()
        with suppress(asyncio.CancelledError):
            await queued
        db.request_slot.release()
        assert (await client.post("/write?value=101")).status_code == 200
        assert conn.execute("SELECT COUNT(*) FROM writes WHERE value = 100").fetchone() == (0,)

        # Both admission and background-sync waits are bounded and recoverable.
        deps.DATABASE_WAIT_SECONDS = 0.05
        for lock in (db.request_slot, db.lock):
            if lock is db.request_slot:
                await lock.acquire()
            else:
                lock.acquire()
            try:
                response = await asyncio.wait_for(client.post("/write?value=200"), timeout=1)
                assert response.status_code == 503
                assert response.headers["Retry-After"] == "1"
            finally:
                lock.release()
            assert (await client.post("/write?value=201")).status_code == 200
        assert conn.execute("SELECT COUNT(*) FROM writes WHERE value = 200").fetchone() == (0,)
    conn.close()


if __name__ == "__main__":
    asyncio.run(_exercise())
    print("concurrency checks passed")

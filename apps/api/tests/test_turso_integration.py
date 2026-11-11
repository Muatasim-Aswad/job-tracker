"""Integration tests against a real (throwaway) Turso DB.

Excluded from the default offline run — opt in with `pytest -m turso`, which also
needs TURSO_TEST_DATABASE_URL / TURSO_TEST_AUTH_TOKEN in the environment (see
.env.example). Use this file for behaviours in-memory sqlite can't reproduce:
pyturso push()/pull() sync, embedded-replica write-through, libSQL driver quirks.
Everything else belongs in the fast in-memory suite.
"""

from __future__ import annotations

import uuid

import pytest

from app.infra.database import Conn, query_one

pytestmark = pytest.mark.turso


def test_schema_round_trips_on_real_turso(turso_conn: Conn) -> None:
    # A minimal smoke: the schema initialised on the real replica and a write reads
    # back through the same connection. Proves the driver + connect() path is live.
    # Unique id so repeated runs against the persistent test DB never collide, and
    # we delete it afterwards to leave the throwaway DB clean.
    job_id = f"turso-smoke-{uuid.uuid4()}"
    try:
        turso_conn.execute(
            "INSERT INTO jobs (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (job_id, "Integration Smoke", "2026-07-07T00:00:00Z", "2026-07-07T00:00:00Z"),
        )
        turso_conn.commit()
        row = query_one(turso_conn, "SELECT title FROM jobs WHERE id = ?", (job_id,))
        assert row is not None
        assert row["title"] == "Integration Smoke"
    finally:
        turso_conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        turso_conn.commit()

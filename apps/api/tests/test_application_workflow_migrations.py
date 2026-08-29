"""The append-only application-workflow foundation migration."""

from __future__ import annotations

import sqlite3
from unittest.mock import patch

import pytest

from app.core import db


def test_migration_upgrades_the_released_shape_once() -> None:
    conn = sqlite3.connect(":memory:")
    db.configure_connection(conn)
    conn.executescript(db._SCHEMA_PATH.read_text())
    conn.commit()

    db.init_schema(conn)
    db.init_schema(conn)

    columns = [row[1] for row in conn.execute("PRAGMA table_info(application_workflows)")]
    assert columns == [
        "job_id",
        "submitted_event_id",
        "preparation_lane",
        "submission_actor",
        "submission_channel",
        "narratives_json",
        "measured_human_time_seconds",
        "references_json",
        "revision",
        "created_at",
        "updated_at",
    ]
    assert conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE key = ?", ("create_application_workflows_v1",)
    ).fetchone() == (1,)
    conn.close()


def test_event_job_foreign_key_moves_and_removes_the_workflow(conn: sqlite3.Connection) -> None:
    for job_id in ("j1", "j2"):
        conn.execute(
            "INSERT INTO jobs (id, status, created_at, updated_at) VALUES (?, 'applied', 't', 't')",
            (job_id,),
        )
    conn.execute("INSERT INTO events (id, job_id, event, ts) VALUES (1, 'j1', 'applied', 't')")
    conn.execute(
        "INSERT INTO application_workflows ("
        "job_id, submitted_event_id, preparation_lane, submission_actor, submission_channel, "
        "narratives_json, references_json, created_at, updated_at"
        ") VALUES ('j1', 1, 'unknown', 'unknown', 'unknown', '[]', '[]', 't', 't')"
    )

    conn.execute("UPDATE events SET job_id = 'j2' WHERE id = 1")
    assert conn.execute(
        "SELECT job_id, submitted_event_id FROM application_workflows"
    ).fetchall() == [("j2", 1)]

    conn.execute("DELETE FROM events WHERE id = 1")
    assert conn.execute("SELECT COUNT(*) FROM application_workflows").fetchone() == (0,)


def test_migration_rerun_preserves_existing_workflow(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ('j1', 'applied', 't', 't')"
    )
    conn.execute("INSERT INTO events (id, job_id, event, ts) VALUES (1, 'j1', 'applied', 't')")
    conn.execute(
        "INSERT INTO application_workflows ("
        "job_id, submitted_event_id, preparation_lane, submission_actor, submission_channel, "
        "narratives_json, references_json, created_at, updated_at"
        ") VALUES ('j1', 1, 'unknown', 'unknown', 'unknown', '[]', '[]', 't', 't')"
    )
    conn.commit()

    db.init_schema(conn)
    db.init_schema(conn)

    assert conn.execute("SELECT job_id, revision FROM application_workflows").fetchall() == [
        ("j1", 1)
    ]


def test_migration_is_atomic_and_retries_after_failure() -> None:
    conn = sqlite3.connect(":memory:")
    db.configure_connection(conn)
    conn.executescript(db._SCHEMA_PATH.read_text())
    conn.commit()

    def fail_after_ddl(connection: db.Conn) -> None:
        db._create_application_workflows(connection)
        raise RuntimeError("injected failure before the ledger write")

    with (
        patch(
            "app.core.db._DATA_MIGRATIONS", (("create_application_workflows_v1", fail_after_ddl),)
        ),
        pytest.raises(RuntimeError, match="injected failure"),
    ):
        db._apply_data_migrations(conn)

    assert (
        conn.execute(
            "SELECT name FROM sqlite_master WHERE name = 'application_workflows'"
        ).fetchone()
        is None
    )
    assert (
        conn.execute(
            "SELECT name FROM sqlite_master WHERE name = 'idx_events_id_job_id'"
        ).fetchone()
        is None
    )
    assert conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE key = 'create_application_workflows_v1'"
    ).fetchone() == (0,)

    db.init_schema(conn)
    assert conn.execute(
        "SELECT name FROM sqlite_master WHERE name = 'application_workflows'"
    ).fetchone() == ("application_workflows",)
    conn.close()


def test_database_constraints_reject_invalid_typed_values(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ('j1', 'applied', 't', 't')"
    )
    conn.execute("INSERT INTO events (id, job_id, event, ts) VALUES (1, 'j1', 'applied', 't')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO application_workflows ("
            "job_id, submitted_event_id, preparation_lane, submission_actor, "
            "submission_channel, narratives_json, measured_human_time_seconds, "
            "references_json, created_at, updated_at"
            ") VALUES ('j1', 1, 'invented', 'unknown', 'unknown', '[]', -1, '[]', 't', 't')"
        )

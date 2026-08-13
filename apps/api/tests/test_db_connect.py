"""app/core/db.py: connect()'s three-way mode selection (plain file / embedded
replica / pyturso local-first) and the migration helpers init_schema() drives.

Mode selection is unit-tested against mocked `libsql`/`turso.sync` drivers — the
real Turso round-trip belongs to the `turso`-marked integration suite
(test_turso_integration.py) instead. The migration helpers run against plain
in-memory sqlite, same as every other test in this suite (conftest's `conn`)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import cast
from unittest.mock import MagicMock, patch

import libsql
import pytest
import turso.sync

from app.core.config import Settings
from app.core.db import (
    _COLUMN_MIGRATIONS,
    _DATA_MIGRATIONS,
    Conn,
    _apply_data_migrations,
    _ensure_column,
    check_foreign_keys,
    configure_connection,
    connect,
    init_schema,
)
from app.core.errors import DataIntegrityError


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    # Explicit turso_* defaults so a real .env (the dev machine's own — see
    # .env.example) never bleeds into these mocked-driver tests: pydantic_settings
    # merges env_file values UNDER explicit kwargs, but only for kwargs actually
    # passed, so every field connect() branches on must be set here.
    defaults: dict[str, object] = {
        "db_path": str(tmp_path / "jobtracker.db"),
        "turso_database_url": None,
        "turso_auth_token": None,
        "turso_local_first": False,
    }
    defaults.update(overrides)
    return Settings(**defaults)  # type: ignore[arg-type]


def test_connect_plain_file_mode_when_no_turso_vars(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    fake_conn = MagicMock()
    with patch("app.core.db.libsql.connect", return_value=fake_conn) as libsql_connect:
        result = connect(settings)

    libsql_connect.assert_called_once_with(settings.db_path, _check_same_thread=False)
    assert result is fake_conn
    fake_conn.sync.assert_not_called()  # no remote to pull from


def test_connect_creates_a_not_yet_existing_db_dir(tmp_path: Path) -> None:
    nested = tmp_path / "sub" / "dir"
    settings = _settings(tmp_path, db_path=str(nested / "jobtracker.db"))
    assert not nested.exists()
    with patch("app.core.db.libsql.connect", return_value=MagicMock()):
        connect(settings)
    assert nested.is_dir()


def test_connect_embedded_replica_mode_pulls_on_startup(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        turso_database_url="libsql://primary.example",
        turso_auth_token="tok",
        turso_pull_interval_seconds=30,
    )
    fake_conn = MagicMock()
    with patch("app.core.db.libsql.connect", return_value=fake_conn) as libsql_connect:
        result = connect(settings)

    libsql_connect.assert_called_once_with(
        settings.db_path,
        sync_url="libsql://primary.example",
        auth_token="tok",
        sync_interval=30,
        _check_same_thread=False,
    )
    fake_conn.sync.assert_called_once()  # startup pull
    assert result is fake_conn


def test_connect_pyturso_local_first_mode_bootstraps_and_pulls(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        turso_database_url="libsql://primary.example",
        turso_auth_token="tok",
        turso_local_first=True,
    )
    fake_conn = MagicMock()
    with patch.object(turso.sync, "connect", return_value=fake_conn) as sync_connect:
        result = connect(settings)

    sync_connect.assert_called_once_with(
        f"{settings.db_path}.sync",
        remote_url="libsql://primary.example",
        auth_token="tok",
        bootstrap_if_empty=True,
    )
    fake_conn.pull.assert_called_once()  # startup pull
    assert result is fake_conn


def test_connect_pyturso_local_first_mode_omits_blank_auth_token(tmp_path: Path) -> None:
    # auth_token="" is falsy — connect() passes None rather than the empty string.
    settings = _settings(
        tmp_path,
        turso_database_url="libsql://primary.example",
        turso_auth_token="",
        turso_local_first=True,
    )
    with patch.object(turso.sync, "connect", return_value=MagicMock()) as sync_connect:
        connect(settings)
    assert sync_connect.call_args.kwargs["auth_token"] is None


def test_ensure_column_adds_a_missing_column_and_is_idempotent() -> None:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE widgets (id INTEGER PRIMARY KEY)")

    _ensure_column(conn, "widgets", "note", "note TEXT")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(widgets)").fetchall()}
    assert "note" in columns

    _ensure_column(conn, "widgets", "note", "note TEXT")  # no error re-adding


def test_fresh_schema_uses_the_public_search_log_baseline(conn: sqlite3.Connection) -> None:
    columns = [row[1] for row in conn.execute("PRAGMA table_info(search_log)").fetchall()]
    assert columns == [
        "id",
        "ts",
        "host",
        "seed",
        "query",
        "results",
        "job_id",
        "seed_rule",
        "seed_results",
    ]


def test_apply_data_migrations_runs_each_key_at_most_once(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE migration_probe (value TEXT)")
    migration = (("probe_once", "INSERT INTO migration_probe VALUES ('applied')"),)

    with patch("app.core.db._DATA_MIGRATIONS", migration):
        _apply_data_migrations(conn)
        _apply_data_migrations(conn)

    assert conn.execute("SELECT COUNT(*) FROM migration_probe").fetchone()[0] == 1
    assert (
        conn.execute("SELECT COUNT(*) FROM schema_migrations WHERE key = 'probe_once'").fetchone()[
            0
        ]
        == 1
    )


def test_init_schema_is_idempotent_when_run_twice(conn: sqlite3.Connection) -> None:
    init_schema(conn)  # conftest already ran it once; a second run must not raise
    row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
    assert row[0] == 0


def test_init_schema_pushes_a_local_first_connection() -> None:
    sqlite = sqlite3.connect(":memory:")
    conn = MagicMock(wraps=sqlite)
    conn.push = MagicMock()

    init_schema(cast(Conn, conn))

    conn.push.assert_called_once_with()


# --- foreign-key enforcement -------------------------------------------------


def test_init_schema_enables_foreign_keys(conn: sqlite3.Connection) -> None:
    # conftest's conn went through init_schema(), which must leave enforcement on.
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_foreign_keys_enforced_on_libsql_connection(tmp_path: Path) -> None:
    # The app runs on libsql, not stdlib sqlite3 — prove the real driver both
    # accepts the PRAGMA and reports it enabled (the acceptance criterion names
    # local libSQL explicitly).
    conn = libsql.connect(str(tmp_path / "fk.db"))
    configure_connection(cast(Conn, conn))
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_configure_connection_refuses_when_driver_ignores_pragma() -> None:
    # A driver that silently drops the PRAGMA (read-back still 0) must not be
    # served — we refuse rather than run without enforcement.
    fake = MagicMock()
    fake.execute.return_value.fetchone.return_value = (0,)
    with pytest.raises(DataIntegrityError):
        configure_connection(cast(Conn, fake))


def test_foreign_key_enforcement_rejects_orphan_reference(conn: sqlite3.Connection) -> None:
    # events.job_id REFERENCES jobs(id); with enforcement on, an event pointing at
    # a non-existent job must fail rather than silently persist a dangling row.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO events (job_id, event, ts) VALUES (?, ?, ?)",
            ("no-such-job", "seen", "2026-01-01T00:00:00Z"),
        )
        conn.commit()


def test_check_foreign_keys_passes_on_clean_database(conn: sqlite3.Connection) -> None:
    check_foreign_keys(conn)  # conftest DB is empty and consistent — no raise


def test_check_foreign_keys_detects_preexisting_orphans(tmp_path: Path) -> None:
    # Simulate a legacy database that accumulated an orphan while enforcement was
    # off: the pre-flight must surface it with an actionable error, not delete it.
    db = sqlite3.connect(str(tmp_path / "legacy.db"))
    init_schema(db)
    db.execute("PRAGMA foreign_keys = OFF")  # bypass enforcement to plant the orphan
    db.execute(
        "INSERT INTO events (job_id, event, ts) VALUES (?, ?, ?)",
        ("ghost-job", "seen", "2026-01-01T00:00:00Z"),
    )
    db.commit()
    db.execute("PRAGMA foreign_keys = ON")

    with pytest.raises(DataIntegrityError) as exc:
        check_foreign_keys(db)
    assert "events" in str(exc.value)
    # The orphan is reported, never deleted.
    assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
    db.close()


def test_check_foreign_keys_skips_when_driver_lacks_pragma() -> None:
    # pyturso (the turso_local_first runtime path) accepts `PRAGMA foreign_keys`
    # but rejects `PRAGMA foreign_key_check` as an unknown pragma. The pre-flight
    # must degrade to a skip on such a driver, not crash startup.
    fake = MagicMock()
    fake.execute.side_effect = RuntimeError("Parse error: Not a valid pragma name")
    check_foreign_keys(cast(Conn, fake))  # must not raise


def test_check_foreign_keys_reraises_non_pragma_errors() -> None:
    # A failure unrelated to pragma support must propagate — we only swallow the
    # specific "unknown pragma" case, never arbitrary driver errors.
    fake = MagicMock()
    fake.execute.side_effect = RuntimeError("database is locked")
    with pytest.raises(RuntimeError):
        check_foreign_keys(cast(Conn, fake))


# --- migration atomicity -----------------------------------------------------


def test_failed_data_migration_rolls_back_data_and_ledger(conn: sqlite3.Connection) -> None:
    # A migration that fails after its data change (here: the ledger timestamp
    # raises) must leave BOTH the data and the ledger untouched, so the next
    # startup can retry it cleanly. Seed a row the migration would delete.
    conn.execute(
        "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ('j1', 'new', 't', 't')"
    )
    conn.execute(
        "INSERT INTO documents (job_id, type, provided, created_at, updated_at) "
        "VALUES ('j1', 'notes', 0, 't', 't')"
    )
    conn.commit()

    failing = (("boom", "DELETE FROM documents"),)
    with (
        patch("app.core.db._DATA_MIGRATIONS", failing),
        patch("app.core.db.utc_now", side_effect=RuntimeError("clock exploded")),
        pytest.raises(RuntimeError),
    ):
        _apply_data_migrations(conn)

    # The DELETE was rolled back...
    assert conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 1
    # ...and no ledger row was written for the failed key.
    assert (
        conn.execute("SELECT COUNT(*) FROM schema_migrations WHERE key = 'boom'").fetchone()[0] == 0
    )


# --- 1.0.0 release baseline --------------------------------------------------


def test_release_baseline_keeps_pre_release_migrations_folded() -> None:
    # Every pre-release migration is folded into schema.sql. Post-release entries
    # are appended, never edited: the form-fill foundation is the first such data
    # migration, while the column-migration baseline remains empty.
    assert _COLUMN_MIGRATIONS == ()
    assert tuple(key for key, _migration in _DATA_MIGRATIONS) == ("create_form_fill_foundation_v1",)


def test_fresh_database_records_only_form_fill_migration_key(conn: sqlite3.Connection) -> None:
    # conftest's conn is a fresh database that already went through init_schema().
    assert conn.execute("SELECT key FROM schema_migrations").fetchall() == [
        ("create_form_fill_foundation_v1",)
    ]


def test_legacy_database_opens_under_the_baseline_without_data_loss(
    conn: sqlite3.Connection,
) -> None:
    """A pre-1.0 database must survive `init_schema` untouched.

    Representative of what the pre-release migrations left behind: closure events
    the batch repair classified (`legacy: true`), ambiguous ones it deliberately
    left with NULL meta, and the ledger keys it wrote. 1.0.0 no longer carries
    those migrations, so opening such a database must neither re-run them, drop
    their ledger rows, nor rewrite any data. The append-only form-fill migration
    adds its own ledger key without disturbing that history.
    """
    conn.execute(
        "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ('j1', 'closed', 't', 't')"
    )
    conn.execute(
        "INSERT INTO listings (id, job_id, platform, platform_id, title, captured_at, closed_at) "
        "VALUES ('l1', 'j1', 'linkedin', '1', 'Role', 't', '2026-07-20T12:00:00+00:00')"
    )
    classified = '{"source": "automatic", "reason": "listing_closed", "legacy": true}'
    conn.execute(
        "INSERT INTO events (id, job_id, event, ts, meta) VALUES (1, 'j1', 'closed', ?, ?)",
        ("2026-07-20T12:00:00+00:00", classified),
    )
    conn.execute(
        "INSERT INTO events (id, job_id, event, ts, meta) VALUES (2, 'j1', 'closed', ?, NULL)",
        ("2020-01-01T00:00:00+00:00",),
    )
    for key in ("drop_notes_documents", "classify_legacy_automatic_closures"):
        conn.execute("INSERT INTO schema_migrations (key, applied_at) VALUES (?, 't')", (key,))
    conn.commit()
    before = conn.execute("SELECT id, event, ts, meta FROM events ORDER BY id").fetchall()

    init_schema(conn)

    assert conn.execute("SELECT id, event, ts, meta FROM events ORDER BY id").fetchall() == before
    # The already-recorded pre-release keys stay alongside the form-fill key.
    assert [row[0] for row in conn.execute("SELECT key FROM schema_migrations ORDER BY key")] == [
        "classify_legacy_automatic_closures",
        "create_form_fill_foundation_v1",
        "drop_notes_documents",
    ]
    assert conn.execute("SELECT COUNT(*) FROM listings").fetchone()[0] == 1
    assert conn.execute("SELECT status FROM jobs WHERE id = 'j1'").fetchone()[0] == "closed"


def test_appended_post_release_migrations_apply_through_init_schema(
    conn: sqlite3.Connection,
) -> None:
    # The machinery is retained for post-release upgrades even though 1.0.0
    # registers nothing: an appended column and data migration must still run,
    # in that order, and record their ledger row.
    columns = (("jobs", "archived_at", "archived_at TEXT"),)
    data = (("backfill_archived_at", "UPDATE jobs SET archived_at = 'x'"),)
    conn.execute(
        "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ('j1', 'new', 't', 't')"
    )
    conn.commit()

    with (
        patch("app.core.db._COLUMN_MIGRATIONS", columns),
        patch("app.core.db._DATA_MIGRATIONS", data),
    ):
        init_schema(conn)

    assert conn.execute("SELECT archived_at FROM jobs WHERE id = 'j1'").fetchone()[0] == "x"
    assert (
        conn.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE key = 'backfill_archived_at'"
        ).fetchone()[0]
        == 1
    )

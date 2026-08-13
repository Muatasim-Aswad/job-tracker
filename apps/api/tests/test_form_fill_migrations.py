"""The append-only form-fill foundation migration."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from unittest.mock import patch

import pytest

from app.core import db

FORM_TABLES = {
    "form_answers",
    "form_answer_choices",
    "form_questions",
    "form_question_options",
    "form_question_mappings",
    "form_mapping_option_bindings",
    "form_captures",
    "form_knowledge_events",
}


def _table_names(conn: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'form_%'"
        )
    }


@pytest.fixture
def released_conn() -> Iterator[sqlite3.Connection]:
    """A database at the prior released shape: schema.sql, no later migrations."""
    conn = sqlite3.connect(":memory:")
    db.configure_connection(conn)
    conn.executescript(db._SCHEMA_PATH.read_text())
    conn.commit()
    assert _table_names(conn) == set()
    yield conn
    conn.close()


def test_fresh_and_prior_released_databases_reach_the_same_form_shape(
    released_conn: sqlite3.Connection,
) -> None:
    fresh = sqlite3.connect(":memory:")
    db.init_schema(fresh)
    db.init_schema(released_conn)

    assert _table_names(fresh) == FORM_TABLES
    assert _table_names(released_conn) == FORM_TABLES
    for conn in (fresh, released_conn):
        assert conn.execute(
            "SELECT key FROM schema_migrations WHERE key = ?", ("create_form_fill_foundation_v1",)
        ).fetchone() == ("create_form_fill_foundation_v1",)
    fresh.close()


def test_migration_is_atomic_and_retries_after_failure(released_conn: sqlite3.Connection) -> None:
    def fail_after_ddl(conn: db.Conn) -> None:
        db._create_form_fill_foundation(conn)
        raise RuntimeError("injected failure before the ledger write")

    with (
        patch(
            "app.core.db._DATA_MIGRATIONS", (("create_form_fill_foundation_v1", fail_after_ddl),)
        ),
        pytest.raises(RuntimeError, match="injected failure"),
    ):
        db._apply_data_migrations(released_conn)

    assert _table_names(released_conn) == set()
    assert released_conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE key = ?", ("create_form_fill_foundation_v1",)
    ).fetchone() == (0,)

    db.init_schema(released_conn)
    assert _table_names(released_conn) == FORM_TABLES


def test_migration_rerun_is_a_noop(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO form_questions ("
        "id, signature, identity_kind, site_scope, adapter_id, adapter_version, "
        "stable_field_key, normalizer_version, control_kind, normalized_question, "
        "raw_question, normalized_section, normalized_help, autocomplete_token, "
        "option_set_hash, review_state, revision, capture_conflict, last_unresolved_reason, "
        "seen_count, last_seen_scan_id, first_seen_at, last_seen_at"
        ") VALUES ('q1', 'sig', 'generic_signature', 'scope', 'adapter', '1', '', 1, "
        "'text', 'question', 'Question', '', '', '', '', 'open', 1, 0, "
        "'no_knowledge', 1, 'scan', 't', 't')"
    )
    conn.commit()

    before_schema = {
        row[0]: row[1]
        for row in conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE name LIKE 'form_%' ORDER BY name"
        )
    }
    db.init_schema(conn)
    db.init_schema(conn)

    after_schema = {
        row[0]: row[1]
        for row in conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE name LIKE 'form_%' ORDER BY name"
        )
    }
    assert after_schema == before_schema
    assert conn.execute("SELECT id FROM form_questions").fetchall() == [("q1",)]
    assert conn.execute(
        "SELECT COUNT(*) FROM schema_migrations WHERE key = ?", ("create_form_fill_foundation_v1",)
    ).fetchone() == (1,)


def test_form_foreign_keys_are_enforced_and_lookup_columns_are_indexed(
    conn: sqlite3.Connection,
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO form_answer_choices "
            "(id, answer_id, choice_key, display_label, status, created_at, updated_at) "
            "VALUES ('c1', 'missing', 'yes', 'Yes', 'active', 't', 't')"
        )

    for table in FORM_TABLES:
        indexed_first_columns = set()
        for index in conn.execute(f"PRAGMA index_list({table})").fetchall():
            columns = conn.execute(f"PRAGMA index_info({index[1]})").fetchall()
            if columns:
                indexed_first_columns.add(columns[0][2])
        for foreign_key in conn.execute(f"PRAGMA foreign_key_list({table})").fetchall():
            assert foreign_key[3] in indexed_first_columns, (
                f"{table}.{foreign_key[3]} must lead an index for FK lookup"
            )


def test_revisioned_resources_and_value_free_history_have_the_required_columns(
    conn: sqlite3.Connection,
) -> None:
    for table in ("form_answers", "form_questions", "form_question_mappings", "form_captures"):
        columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        assert "revision" in columns

    event_columns = {row[1] for row in conn.execute("PRAGMA table_info(form_knowledge_events)")}
    assert not {"value", "value_json", "before_value", "after_value"} & event_columns

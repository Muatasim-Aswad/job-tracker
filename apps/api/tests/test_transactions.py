"""The transaction scope is usable without an HTTP request or application."""

import sqlite3

import pytest

from app.infra.database import Database
from app.infra.transactions import DatabaseBusyError, transaction


def test_scope_commits_before_notification_and_rolls_back_failed_work() -> None:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE writes (value TEXT)")
    db = Database(conn)
    observed = []

    def committed(elapsed_ms: float) -> None:
        observed.append((conn.in_transaction, conn.execute("SELECT * FROM writes").fetchall()))

    with transaction(db, after_commit=committed) as scoped:
        assert scoped is conn
        assert conn.in_transaction
        conn.execute("INSERT INTO writes VALUES ('committed')")

    assert observed == [(False, [("committed",)])]
    with (
        pytest.raises(ValueError, match="failed write"),
        transaction(db, after_commit=committed) as scoped,
    ):
        scoped.execute("INSERT INTO writes VALUES ('rolled back')")
        raise ValueError("failed write")

    assert conn.execute("SELECT * FROM writes").fetchall() == [("committed",)]
    assert len(observed) == 1
    assert not db.lock.locked()
    conn.close()


def test_failed_commit_rolls_back_without_publishing() -> None:
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("CREATE TABLE parents (id INTEGER PRIMARY KEY)")
    conn.execute(
        "CREATE TABLE children (parent_id INTEGER REFERENCES parents(id) "
        "DEFERRABLE INITIALLY DEFERRED)"
    )
    db = Database(conn)
    published = []

    with (
        pytest.raises(sqlite3.IntegrityError),
        transaction(db, after_commit=published.append) as scoped,
    ):
        scoped.execute("INSERT INTO children VALUES (42)")

    assert conn.execute("SELECT * FROM children").fetchall() == []
    assert published == []
    assert not conn.in_transaction
    assert not db.lock.locked()
    conn.close()


def test_busy_scope_cannot_enter_or_publish_a_transaction() -> None:
    conn = sqlite3.connect(":memory:")
    db = Database(conn)
    published = []
    db.lock.acquire()
    try:
        with (
            pytest.raises(DatabaseBusyError),
            transaction(db, timeout=0, after_commit=published.append),
        ):
            pytest.fail("busy connection must not enter the scope")
        assert not conn.in_transaction
        assert published == []
    finally:
        db.lock.release()
        conn.close()

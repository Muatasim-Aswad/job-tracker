"""app/core/deps.py::get_conn — the commit-on-success/rollback-on-error contract
every route's DB access rides on, plus the push-scheduler nudge for writes.

Driven directly as a generator (bypassing FastAPI's Depends plumbing) so the
commit/rollback paths can be forced without a real request round-trip."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.core.db import Database
from app.core.deps import get_conn


def _request(method: str, path: str, db: Database, push_scheduler: Any = None) -> Any:
    state = SimpleNamespace(db=db)
    if push_scheduler is not None:
        state.push_scheduler = push_scheduler
    return SimpleNamespace(
        app=SimpleNamespace(state=state), method=method, url=SimpleNamespace(path=path)
    )


def test_commits_on_a_successful_request() -> None:
    db = Database(conn=MagicMock())
    gen = get_conn(_request("GET", "/api/jobs", db))

    conn = next(gen)
    assert conn is db.conn
    with pytest.raises(StopIteration):
        next(gen)  # the dependency's re-entry after the route handler returns

    db.conn.commit.assert_called_once()
    db.conn.rollback.assert_not_called()


def test_rolls_back_and_reraises_on_a_failed_request() -> None:
    db = Database(conn=MagicMock())
    gen = get_conn(_request("POST", "/api/jobs", db))
    next(gen)

    with pytest.raises(ValueError, match="boom"):
        gen.throw(ValueError("boom"))

    db.conn.rollback.assert_called_once()
    db.conn.commit.assert_not_called()


def test_notifies_the_push_scheduler_after_a_non_get_commit() -> None:
    db = Database(conn=MagicMock())
    scheduler = MagicMock()
    gen = get_conn(_request("POST", "/api/jobs", db, push_scheduler=scheduler))
    next(gen)
    with pytest.raises(StopIteration):
        next(gen)

    scheduler.notify_write.assert_called_once()


def test_does_not_notify_the_push_scheduler_for_a_get() -> None:
    db = Database(conn=MagicMock())
    scheduler = MagicMock()
    gen = get_conn(_request("GET", "/api/jobs", db, push_scheduler=scheduler))
    next(gen)
    with pytest.raises(StopIteration):
        next(gen)

    scheduler.notify_write.assert_not_called()


def test_tolerates_no_push_scheduler_configured() -> None:
    # app.state.push_scheduler is only set once main.py's lifespan starts it
    # (pyturso local-first mode); every other mode leaves it unset.
    db = Database(conn=MagicMock())
    gen = get_conn(_request("POST", "/api/jobs", db))
    next(gen)
    with pytest.raises(StopIteration):
        next(gen)  # no AttributeError from the missing state.push_scheduler

    db.conn.commit.assert_called_once()


def test_logs_a_commit_line_for_a_non_get(caplog: pytest.LogCaptureFixture) -> None:
    db = Database(conn=MagicMock())
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        gen = get_conn(_request("PATCH", "/api/jobs/1", db))
        next(gen)
        with pytest.raises(StopIteration):
            next(gen)

    assert any("db commit" in r.message for r in caplog.records)


def test_does_not_log_a_commit_line_for_a_get(caplog: pytest.LogCaptureFixture) -> None:
    db = Database(conn=MagicMock())
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        gen = get_conn(_request("GET", "/api/jobs", db))
        next(gen)
        with pytest.raises(StopIteration):
            next(gen)

    assert not any("db commit" in r.message for r in caplog.records)


def test_closing_an_unfinished_transaction_rolls_back_and_releases_lock() -> None:
    db = Database(conn=MagicMock())
    gen = get_conn(_request("POST", "/api/jobs", db))
    next(gen)
    assert db.lock.locked()
    gen.close()
    db.conn.rollback.assert_called_once()
    db.conn.commit.assert_not_called()
    assert not db.lock.locked()

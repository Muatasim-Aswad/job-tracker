"""PushScheduler (app/core/sync.py): debounced push after a burst of writes, the
periodic pull cadence, and the final flush on a clean stop()."""

from __future__ import annotations

import threading
import time
from unittest.mock import Mock

from app.core import sync as sync_module
from app.core.sync import PushScheduler


class FakeDb:
    """Stands in for `Database` — PushScheduler only ever calls .push()/.pull()."""

    def __init__(self) -> None:
        self.push = Mock()
        self.pull = Mock()


def test_debounce_coalesces_a_burst_of_writes_into_one_push() -> None:
    db = FakeDb()
    sched = PushScheduler(db, debounce_seconds=0.05, pull_interval_seconds=0)
    sched.start()
    try:
        for _ in range(5):
            sched.notify_write()
            time.sleep(0.01)  # each write re-arms the debounce window
        time.sleep(0.3)  # let the quiet window elapse and the push fire
        assert db.push.call_count == 1
    finally:
        # Tear down inside `finally` so a failed assertion above doesn't leak the thread.
        sched.stop()


def test_stop_flushes_a_pending_write_that_never_reached_the_debounce_window() -> None:
    db = FakeDb()
    # A debounce longer than the test itself: the loop never fires its own push.
    sched = PushScheduler(db, debounce_seconds=10.0, pull_interval_seconds=0)
    sched.start()
    sched.notify_write()
    time.sleep(0.05)
    assert db.push.call_count == 0  # still inside the debounce window
    assert sched.stop()
    assert db.push.call_count == 1  # stop()'s final flush pushed the pending write


def test_stop_skips_final_push_when_nothing_is_pending() -> None:
    db = FakeDb()
    sched = PushScheduler(db, debounce_seconds=10.0, pull_interval_seconds=0)
    sched.start()
    assert sched.stop()
    db.push.assert_not_called()


def test_stop_returns_after_deadline_when_pull_is_blocked() -> None:
    entered = threading.Event()
    release = threading.Event()
    db = FakeDb()

    def blocked_pull() -> None:
        entered.set()
        release.wait(timeout=2)

    db.pull.side_effect = blocked_pull
    sched = PushScheduler(db, debounce_seconds=10.0, pull_interval_seconds=1.0)
    sched._last_pull = 0.0
    sched.start()
    assert entered.wait(timeout=1)

    started = time.monotonic()
    assert not sched.stop(timeout=0.05)
    assert time.monotonic() - started < 0.5

    release.set()
    sched._thread.join(timeout=1)
    assert not sched._thread.is_alive()


def test_maybe_pull_skips_before_the_interval_elapses(monkeypatch: object) -> None:
    fake_now = [1_000.0]
    monkeypatch.setattr(sync_module.time, "monotonic", lambda: fake_now[0])  # type: ignore[attr-defined]
    db = FakeDb()
    sched = PushScheduler(db, debounce_seconds=999, pull_interval_seconds=10.0)

    sched._maybe_pull()  # no time has passed since construction
    db.pull.assert_not_called()

    fake_now[0] += 5  # still under the 10s interval
    sched._maybe_pull()
    db.pull.assert_not_called()

    fake_now[0] += 5  # now at 10s — due
    sched._maybe_pull()
    db.pull.assert_called_once()


def test_maybe_pull_disabled_for_non_positive_interval(monkeypatch: object) -> None:
    fake_now = [1_000.0]
    monkeypatch.setattr(sync_module.time, "monotonic", lambda: fake_now[0])  # type: ignore[attr-defined]
    db = FakeDb()
    sched = PushScheduler(db, debounce_seconds=999, pull_interval_seconds=0)

    fake_now[0] += 1_000_000
    sched._maybe_pull()
    db.pull.assert_not_called()


def test_maybe_pull_swallows_a_failing_pull_and_still_advances_the_clock(
    monkeypatch: object,
) -> None:
    fake_now = [1_000.0]
    monkeypatch.setattr(sync_module.time, "monotonic", lambda: fake_now[0])  # type: ignore[attr-defined]
    db = FakeDb()
    db.pull.side_effect = Exception("boom")
    sched = PushScheduler(db, debounce_seconds=999, pull_interval_seconds=10.0)

    fake_now[0] += 10
    sched._maybe_pull()  # doesn't raise
    assert db.pull.call_count == 1

    fake_now[0] += 5  # under the interval again — not hammered on failure
    sched._maybe_pull()
    assert db.pull.call_count == 1


def test_push_failure_leaves_the_scheduler_dirty_for_a_retry() -> None:
    db = FakeDb()
    db.push.side_effect = Exception("boom")
    sched = PushScheduler(db, debounce_seconds=999, pull_interval_seconds=0)

    sched._dirty.clear()
    sched._push()

    assert sched._dirty.is_set()
    assert sched._wake.is_set()


def test_push_success_does_not_request_a_retry() -> None:
    db = FakeDb()
    sched = PushScheduler(db, debounce_seconds=999, pull_interval_seconds=0)

    sched._dirty.clear()
    sched._push()

    assert not sched._dirty.is_set()

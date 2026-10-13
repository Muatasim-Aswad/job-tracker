from unittest.mock import Mock

import pytest

from app.core import diagnostics


def test_database_stacks_are_rate_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [100.0]
    monkeypatch.setattr(diagnostics.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(diagnostics, "_last_report", float("-inf"))
    dump = Mock()
    monkeypatch.setattr(diagnostics.faulthandler, "dump_traceback", dump)
    diagnostics.report_database_stall("request queue")
    diagnostics.report_database_stall("connection lock")
    assert dump.call_count == 1
    now[0] += 60
    diagnostics.report_database_stall("connection lock")
    assert dump.call_count == 2


def test_unavailable_stderr_does_not_break_busy_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(diagnostics, "_last_report", float("-inf"))
    monkeypatch.setattr(
        diagnostics.faulthandler, "dump_traceback", Mock(side_effect=OSError("no file descriptor"))
    )
    diagnostics.report_database_stall("request queue")

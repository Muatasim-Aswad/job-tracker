"""Timestamp helpers. All timestamps are stored as UTC ISO strings; `ts` is the
sole time field on events."""

from datetime import UTC, datetime


def utc_now() -> str:
    return datetime.now(UTC).isoformat()

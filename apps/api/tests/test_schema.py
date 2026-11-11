"""Schema-file integrity guards (schema.sql), independent of any one migration."""

from __future__ import annotations


def test_schema_sql_is_ascii_only() -> None:
    # pyturso's executescript reports a byte offset but slices the SQL by character
    # index, so a single multibyte char (e.g. an em-dash) desyncs the offset and
    # chops a later statement, failing app startup on a mangled keyword (`near "EATE"`
    # for a truncated CREATE). Keep schema.sql strictly ASCII; comments too.
    from app.infra.database import _SCHEMA_PATH

    text = _SCHEMA_PATH.read_text()
    offenders = [(i, ch) for i, ch in enumerate(text) if ord(ch) > 127]
    assert not offenders, (
        f"schema.sql must be ASCII (pyturso executescript gotcha); found {offenders[:5]}"
    )

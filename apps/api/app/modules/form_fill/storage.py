"""Form-fill storage."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from app.infra.database import Conn


def _new_id() -> str:
    return uuid.uuid4().hex


def _json(value: object) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")

    return json.dumps(value, sort_keys=True, separators=(",", ":"))


@contextmanager
def _atomic(conn: Conn) -> Iterator[None]:
    name = f"form_fill_{uuid.uuid4().hex}"
    conn.execute(f"SAVEPOINT {name}")
    try:
        yield
    except Exception:
        conn.execute(f"ROLLBACK TO {name}")
        conn.execute(f"RELEASE {name}")
        raise

    conn.execute(f"RELEASE {name}")

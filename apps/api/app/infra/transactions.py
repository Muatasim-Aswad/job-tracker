"""Serialized transactions shared by HTTP and in-process application callers."""

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from app.infra.database import Conn, Database


class DatabaseBusyError(Exception):
    """The connection lock was not available before transaction entry."""


@contextmanager
def transaction(
    db: Database,
    *,
    begin: bool = True,
    timeout: float = 30.0,
    after_commit: Callable[[float], None] | None = None,
) -> Iterator[Conn]:
    if not db.lock.acquire(timeout=timeout):
        raise DatabaseBusyError
    try:
        try:
            if begin:
                # Revision/precondition reads must share the write transaction.
                db.conn.execute("BEGIN")
            yield db.conn
            start = time.perf_counter()
            db.conn.commit()
            elapsed_ms = (time.perf_counter() - start) * 1000
            if after_commit is not None:
                after_commit(elapsed_ms)
        except BaseException:
            db.conn.rollback()
            raise
    finally:
        db.lock.release()

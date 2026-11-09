"""Profile ownership, database startup and bounded resource cleanup."""

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from app.config import Settings
from app.core.build_info import BuildInfo
from app.core.lifecycle import ServerLock, private_creation_mask, protect_new_database
from app.core.paths import ResolvedPaths
from app.core.version import PRODUCT_VERSION
from app.infra.database import Conn, Database, connect, init_schema
from app.infra.sync import PushScheduler

logger = logging.getLogger("uvicorn.error")


@dataclass
class RuntimeResources:
    paths: ResolvedPaths
    db: Database | None = None
    push_scheduler: PushScheduler | None = None

    def database(self) -> Database:
        if self.db is None:
            raise RuntimeError("database runtime has not started")
        return self.db


def _close_connection(conn: Conn | None, db: Database | None) -> bool:
    if conn is None:
        return True
    if db is None:
        conn.close()
        return True
    # An ASGI cancellation can leave its synchronous worker owning the connection.
    if not db.lock.acquire(blocking=False):
        return False
    try:
        conn.close()
    finally:
        db.lock.release()
    return True


def _cleanup(conn: Conn | None, resources: RuntimeResources, lock: ServerLock) -> None:
    complete = True
    try:
        if resources.push_scheduler is not None:
            complete = resources.push_scheduler.stop()
    finally:
        try:
            if complete:
                complete = _close_connection(conn, resources.db)
        finally:
            if complete:
                lock.release()
            else:
                logger.warning(
                    "leaving the database connection and server lock for process exit "
                    "because database work is still active"
                )


@contextmanager
def open_runtime(
    settings: Settings, resources: RuntimeResources, build_info: BuildInfo
) -> Iterator[None]:
    paths = resources.paths
    logger.info("running build", extra={"event": "runtime.started", "build": build_info})
    lock = ServerLock(paths, port=settings.port, version=PRODUCT_VERSION)
    with private_creation_mask():
        lock.acquire()  # Before open, pull or schema initialization.
        conn = None
        resources.db = None
        resources.push_scheduler = None
        live_path = (
            paths.database.with_name(f"{paths.database.name}.sync")
            if settings.turso_local_first and settings.turso_database_url
            else paths.database
        )
        existed_before_open = live_path.exists()
        try:
            conn = connect(settings)
            protect_new_database(live_path, existed_before_open=existed_before_open)
            init_schema(conn, paths.schema_file)
            resources.db = db = Database(conn)
            if db.syncable:
                resources.push_scheduler = PushScheduler(
                    db, settings.turso_push_debounce_seconds, settings.turso_pull_interval_seconds
                )
                resources.push_scheduler.start()
            yield
        finally:
            _cleanup(conn, resources, lock)

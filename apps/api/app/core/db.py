"""Database connection lifecycle and a thin, driver-agnostic query layer.

The app runs on the `libsql` client, tests on stdlib `sqlite3`. Both speak the
same SQL and expose the same cursor API, but neither offers a row factory that
survives across drivers, so `query_all`/`query_one` build plain dicts from
`cursor.description`. Repositories depend only on these helpers and the `Conn`
protocol, never on a concrete driver.
"""

import json
import logging
import threading
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, Protocol, cast

import libsql

from app.core.config import Settings
from app.core.errors import DataIntegrityError
from app.core.paths import resolve_paths, settings_paths
from app.core.timeutil import utc_now

Row = dict[str, Any]
Params = Sequence[Any]

# Kept as the public test/tool compatibility handle; it now follows the selected
# application profile instead of assuming a repository parent layout.
_SCHEMA_PATH = resolve_paths().schema_file

logger = logging.getLogger("uvicorn.error")


class Cursor(Protocol):
    description: Any
    lastrowid: int | None

    def fetchone(self) -> Any: ...
    def fetchall(self) -> list[Any]: ...


class Conn(Protocol):
    """The subset of the DB-API connection that repositories rely on."""

    def execute(self, sql: str, parameters: Params = ..., /) -> Cursor: ...
    def executescript(self, sql: str, /) -> Any: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...
    def close(self) -> None: ...


def query_all(conn: Conn, sql: str, params: Params = ()) -> list[Row]:
    cur = conn.execute(sql, params)
    columns = [c[0] for c in cur.description]
    return [dict(zip(columns, row, strict=True)) for row in cur.fetchall()]


def query_one(conn: Conn, sql: str, params: Params = ()) -> Row | None:
    cur = conn.execute(sql, params)
    row = cur.fetchone()
    if row is None:
        return None
    columns = [c[0] for c in cur.description]
    return dict(zip(columns, row, strict=True))


def execute(conn: Conn, sql: str, params: Params = ()) -> Cursor:
    """Run a write statement and return the cursor. To read back a generated id,
    prefer `INSERT ... RETURNING` via `query_one`: `lastrowid` is unreliable on the
    libSQL replica connection."""
    return conn.execute(sql, params)


def hydrate_json(row: Row, field: str = "meta", empty: Any = None) -> Row:
    """Replace `row[field]`'s stored JSON text with the parsed value, so a
    repository's `_to_<model>` mapper can hand the row straight to its pydantic
    model. A NULL or empty column reads back as `empty` — `{}` for the
    always-a-dict `meta` on jobs/listings, `None` for events' nullable one."""
    data = dict(row)
    raw = data.pop(field, None)
    data[field] = json.loads(raw) if raw else empty
    return data


def connect(settings: Settings) -> Conn:
    """Open the app connection. Three modes, by settings:

    1. pyturso local-first (`turso_local_first`): reads and writes are local, a
       startup `pull()` seeds from the primary, and writes are pushed in the
       background (core.sync). Removes the network from the write path.
    2. libSQL embedded replica (`turso_database_url` only): reads local, writes
       write-through to the primary.
    3. plain local file (no Turso vars): no sync at all.
    """
    # Preserve an existing replica before constructing a Turso driver: construction
    # itself may bootstrap or pull, so doing this later could lose unsynced local
    # writes left by a crashed process. A missing store is a first-run bootstrap and
    # needs no recovery point.
    if settings.turso_database_url:
        from app.maintenance.backup import preserve_before_startup_pull

        preserve_before_startup_pull(settings, settings_paths(settings))

    # db_path may point into a not-yet-created dir (.test-db/ under APP_ENV=test) and
    # the drivers won't mkdir it. A no-op for the default cwd-relative path.
    Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
    if settings.turso_local_first and settings.turso_database_url:
        import turso.sync

        # pyturso keeps its own replica and metadata, whose on-disk format is
        # incompatible with the libSQL embedded-replica files at db_path — reusing
        # them fails with "unexpected metadata file format". A sibling file lets it
        # bootstrap from the remote and leaves db_path untouched as an instant
        # `TURSO_LOCAL_FIRST=false` fallback.
        sync_conn = turso.sync.connect(
            f"{settings.db_path}.sync",
            remote_url=settings.turso_database_url,
            auth_token=settings.turso_auth_token or None,
            bootstrap_if_empty=True,
        )
        sync_conn.pull()  # pull the latest remote state on startup before serving
        out = cast(Conn, sync_conn)
        configure_connection(out)
        return out
    if settings.turso_database_url:
        conn = libsql.connect(
            settings.db_path,
            sync_url=settings.turso_database_url,
            auth_token=settings.turso_auth_token or "",
            sync_interval=settings.turso_pull_interval_seconds,
            _check_same_thread=False,
        )
        conn.sync()  # pull the latest remote state on startup before serving
    else:
        conn = libsql.connect(settings.db_path, _check_same_thread=False)
    out = cast(Conn, conn)
    configure_connection(out)
    return out


def configure_connection(conn: Conn) -> None:
    """Enable and *verify* SQLite foreign-key enforcement on a freshly opened
    connection. Enforcement is per-connection, defaults OFF, and the PRAGMA is a
    no-op inside a transaction — hence running here, right after the connection
    opens and before any schema init or request handling. The read-back guards
    against a driver that silently ignores the PRAGMA: refuse to serve without
    enforcement rather than assume it took."""
    conn.execute("PRAGMA foreign_keys = ON")
    row = conn.execute("PRAGMA foreign_keys").fetchone()
    if not row or not row[0]:
        raise DataIntegrityError(
            "driver did not accept `PRAGMA foreign_keys = ON`; refusing to serve "
            "without referential-integrity enforcement"
        )


def check_foreign_keys(conn: Conn) -> None:
    """Pre-flight an existing database against its foreign keys. Enabling
    enforcement doesn't retro-validate rows already present, so a database written
    while it was off can carry orphans — a child pointing at a missing parent.
    `PRAGMA foreign_key_check` lists them, and any hit aborts startup with an
    actionable error rather than deleting rows: the operator inspects and repairs,
    or restores from a backup. A clean database reports nothing.

    The pyturso driver (the `turso_local_first` path) doesn't yet implement this
    pragma and rejects it as unknown. Enforcement itself still guards every new
    write there, verified in `configure_connection`; only this legacy-orphan
    pre-flight is unavailable, so log and skip rather than refuse to start."""
    try:
        cur = conn.execute("PRAGMA foreign_key_check")
    except Exception as exc:  # noqa: BLE001 — driver-specific, matched by message
        if "pragma" in str(exc).lower():
            logger.warning(
                "driver does not implement `PRAGMA foreign_key_check`; skipping the "
                "legacy-orphan pre-flight (per-connection foreign-key enforcement is "
                "still active for new writes). Driver said: %s",
                exc,
            )
            return
        raise
    violations = cur.fetchall()
    if violations:
        tables = sorted({str(v[0]) for v in violations})
        raise DataIntegrityError(
            f"database has {len(violations)} orphaned row(s) whose foreign keys point at "
            f"missing parents, in: {', '.join(tables)}. Foreign-key enforcement was left on "
            "and initialization aborted rather than deleting the rows. Inspect with "
            "`PRAGMA foreign_key_check`, repair the offending rows, or restore from a backup "
            "(see the server README backup/restore procedure), then restart."
        )


# 1.0.0 starts from schema.sql as its baseline: every pre-release migration is
# already folded into that file, so both tables below are deliberately empty.
# Post-release compatibility migrations are appended here and never edited or
# reordered once released — a released key has already run on user databases, so
# changing it would silently skip the change on some and not others. Additive
# column migrations first, then data ones; see docs/DEVELOPMENT.md.
_COLUMN_MIGRATIONS: tuple[tuple[str, str, str], ...] = ()

DataMigration = str | Callable[[Conn], None]

_DATA_MIGRATIONS: tuple[tuple[str, DataMigration], ...] = ()


def _ensure_column(conn: Conn, table: str, column: str, ddl: str) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column in existing:
        return
    # Its own transaction, committed on success and rolled back on failure, so a
    # column add never lands half-applied.
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def _apply_data_migrations(conn: Conn) -> None:
    applied = {row[0] for row in conn.execute("SELECT key FROM schema_migrations").fetchall()}
    for key, migrate in _DATA_MIGRATIONS:
        if key in applied:
            continue
        # Each migration is atomic: the data change and its ledger row commit
        # together or neither does. A failure rolls both back, so the next startup
        # retries cleanly instead of leaving a cleanup applied without its ledger
        # marker, or the reverse.
        try:
            if isinstance(migrate, str):
                conn.execute(migrate)
            else:
                migrate(conn)
            conn.execute(
                "INSERT INTO schema_migrations (key, applied_at) VALUES (?, ?)", (key, utc_now())
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def init_schema(conn: Conn, schema_path: Path | None = None) -> None:
    """Bring a connection's database to the current schema, idempotently.

    Order matters. Foreign-key enforcement is enabled and verified first, covering
    connections that don't come through `connect()`, such as tests. The base schema
    goes through `executescript`, which some SQLite-compatible drivers commit
    around, so it stays out of any surrounding transaction and commits on its own.
    The database is then pre-flighted for orphaned references before any migration
    mutates it, and finally the additive column and one-time data migrations run,
    each in its own transaction. A local-first connection is pushed before startup
    completes, so schema changes can't remain local while the Turso primary keeps
    an older column layout."""
    configure_connection(conn)
    resolved_schema = schema_path or _SCHEMA_PATH
    conn.executescript(resolved_schema.read_text())
    conn.commit()
    check_foreign_keys(conn)
    for table, column, ddl in _COLUMN_MIGRATIONS:
        _ensure_column(conn, table, column, ddl)
    _apply_data_migrations(conn)
    push = getattr(conn, "push", None)
    if push is not None:
        push()


class Database:
    """The single process-wide connection plus a lock serializing access. The tool
    is single-user and low-concurrency, so one connection behind a lock is simpler
    and safer than a pool, and removes any cross-thread worry from FastAPI's sync
    threadpool."""

    def __init__(self, conn: Conn) -> None:
        self.conn = conn
        self.lock = threading.Lock()

    @property
    def syncable(self) -> bool:
        """True in pyturso local-first mode, where the connection can `push()` local
        writes to the primary. False for embedded-replica and plain-file ones."""
        return hasattr(self.conn, "push")

    def push(self) -> None:
        """Ship pending local writes to the remote primary (pyturso sync mode).
        Held under the same lock as every other connection use; a no-op when the
        connection isn't syncable."""
        push = getattr(self.conn, "push", None)
        if push is None:
            return
        with self.lock:
            push()

    def pull(self) -> None:
        """Refresh the local replica from the remote primary (pyturso sync mode).
        Held under the same lock as every other connection use, so it never
        interleaves with a mid-flight request transaction. A no-op when the
        connection isn't syncable."""
        pull = getattr(self.conn, "pull", None)
        if pull is None:
            return
        with self.lock:
            pull()

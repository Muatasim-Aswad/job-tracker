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


def _create_form_fill_foundation(conn: Conn) -> None:
    """Create the additive form-fill knowledge boundary.

    Statements intentionally run one at a time in an explicit transaction. Using
    `executescript` here would allow drivers to commit between statements and break
    the migration-ledger atomicity guarantee.
    """
    # sqlite3 starts transactions implicitly for DML but not DDL. Beginning here
    # keeps this migration's schema changes and `_apply_data_migrations`' ledger row
    # atomic without changing the transaction contract of unrelated migrations.
    conn.execute("BEGIN")
    statements = (
        """
        CREATE TABLE form_answers (
            id TEXT PRIMARY KEY,
            answer_key TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            description TEXT,
            value_kind TEXT NOT NULL,
            value_json TEXT NOT NULL,
            status TEXT NOT NULL,
            fill_policy TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            verified_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX idx_form_answers_browse ON form_answers (status, updated_at DESC, id)",
        "CREATE INDEX idx_form_answers_kind_status ON form_answers (value_kind, status)",
        """
        CREATE TABLE form_answer_choices (
            id TEXT PRIMARY KEY,
            answer_id TEXT NOT NULL REFERENCES form_answers (id),
            choice_key TEXT NOT NULL,
            display_label TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (answer_id, choice_key)
        )
        """,
        "CREATE INDEX idx_form_answer_choices_answer ON form_answer_choices (answer_id)",
        """
        CREATE TABLE form_questions (
            id TEXT PRIMARY KEY,
            signature TEXT NOT NULL UNIQUE,
            identity_kind TEXT NOT NULL,
            site_scope TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            adapter_version TEXT NOT NULL,
            stable_field_key TEXT NOT NULL,
            normalizer_version INTEGER NOT NULL,
            control_kind TEXT NOT NULL,
            normalized_question TEXT NOT NULL,
            raw_question TEXT NOT NULL,
            normalized_section TEXT NOT NULL,
            raw_section TEXT,
            normalized_help TEXT NOT NULL,
            raw_help TEXT,
            autocomplete_token TEXT NOT NULL,
            option_set_hash TEXT NOT NULL,
            review_state TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            capture_conflict INTEGER NOT NULL DEFAULT 0,
            last_unresolved_reason TEXT,
            seen_count INTEGER NOT NULL DEFAULT 1,
            last_seen_scan_id TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX idx_form_questions_review ON form_questions (review_state, last_seen_at DESC, id)",
        "CREATE INDEX idx_form_questions_seen ON form_questions (seen_count DESC, id)",
        "CREATE INDEX idx_form_questions_scope ON form_questions (site_scope, last_seen_at DESC, id)",
        """
        CREATE TABLE form_question_options (
            id TEXT PRIMARY KEY,
            question_id TEXT NOT NULL REFERENCES form_questions (id),
            normalized_label TEXT NOT NULL,
            raw_label TEXT NOT NULL,
            stable_option_key TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (question_id, normalized_label, stable_option_key)
        )
        """,
        "CREATE INDEX idx_form_question_options_question ON form_question_options (question_id)",
        """
        CREATE TABLE form_question_mappings (
            id TEXT PRIMARY KEY,
            question_id TEXT NOT NULL UNIQUE REFERENCES form_questions (id),
            answer_id TEXT NOT NULL REFERENCES form_answers (id),
            status TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            approved_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX idx_form_question_mappings_question ON form_question_mappings (question_id)",
        "CREATE INDEX idx_form_question_mappings_answer ON form_question_mappings (answer_id)",
        """
        CREATE TABLE form_mapping_option_bindings (
            mapping_id TEXT NOT NULL REFERENCES form_question_mappings (id),
            question_option_id TEXT NOT NULL REFERENCES form_question_options (id),
            answer_choice_id TEXT NOT NULL REFERENCES form_answer_choices (id),
            created_at TEXT NOT NULL,
            PRIMARY KEY (mapping_id, question_option_id),
            UNIQUE (mapping_id, answer_choice_id)
        )
        """,
        "CREATE INDEX idx_form_bindings_mapping ON form_mapping_option_bindings (mapping_id)",
        "CREATE INDEX idx_form_bindings_question_option ON form_mapping_option_bindings (question_option_id)",
        "CREATE INDEX idx_form_bindings_answer_choice ON form_mapping_option_bindings (answer_choice_id)",
        """
        CREATE TABLE form_captures (
            id TEXT PRIMARY KEY,
            capture_key TEXT NOT NULL UNIQUE,
            question_id TEXT NOT NULL REFERENCES form_questions (id),
            mapping_id TEXT REFERENCES form_question_mappings (id),
            answer_revision_used INTEGER,
            mapping_revision_used INTEGER,
            application_context_id TEXT NOT NULL,
            job_id TEXT REFERENCES jobs (id),
            listing_id TEXT REFERENCES listings (id),
            source TEXT NOT NULL,
            value_kind TEXT NOT NULL,
            value_json TEXT,
            status TEXT NOT NULL,
            superseded_by_id TEXT REFERENCES form_captures (id),
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            resolved_at TEXT
        )
        """,
        "CREATE INDEX idx_form_captures_question_status ON form_captures (question_id, status, created_at DESC)",
        "CREATE INDEX idx_form_captures_status_updated ON form_captures (status, updated_at DESC, id)",
        "CREATE INDEX idx_form_captures_mapping ON form_captures (mapping_id)",
        "CREATE INDEX idx_form_captures_job ON form_captures (job_id)",
        "CREATE INDEX idx_form_captures_listing ON form_captures (listing_id)",
        "CREATE INDEX idx_form_captures_superseded_by ON form_captures (superseded_by_id)",
        """
        CREATE TABLE form_knowledge_events (
            id TEXT PRIMARY KEY,
            event TEXT NOT NULL,
            answer_id TEXT REFERENCES form_answers (id),
            mapping_id TEXT REFERENCES form_question_mappings (id),
            question_id TEXT REFERENCES form_questions (id),
            capture_id TEXT REFERENCES form_captures (id),
            before_answer_id TEXT REFERENCES form_answers (id),
            after_answer_id TEXT REFERENCES form_answers (id),
            before_revision INTEGER,
            after_revision INTEGER,
            reason TEXT,
            created_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX idx_form_events_answer ON form_knowledge_events (answer_id, created_at DESC)",
        "CREATE INDEX idx_form_events_mapping ON form_knowledge_events (mapping_id, created_at DESC)",
        "CREATE INDEX idx_form_events_question ON form_knowledge_events (question_id, created_at DESC)",
        "CREATE INDEX idx_form_events_capture ON form_knowledge_events (capture_id, created_at DESC)",
        "CREATE INDEX idx_form_events_before_answer ON form_knowledge_events (before_answer_id)",
        "CREATE INDEX idx_form_events_after_answer ON form_knowledge_events (after_answer_id)",
    )
    for statement in statements:
        conn.execute(statement)


def _create_job_id_aliases(conn: Conn) -> None:
    """Keep dissolved merge identities resolvable to one live canonical job."""
    conn.execute("BEGIN")
    conn.execute(
        """
        CREATE TABLE job_id_aliases (
            old_job_id TEXT PRIMARY KEY,
            canonical_job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
            merged_at TEXT NOT NULL,
            CHECK (old_job_id <> canonical_job_id)
        )
        """
    )
    conn.execute("CREATE INDEX idx_job_id_aliases_canonical ON job_id_aliases (canonical_job_id)")


def _create_application_workflows(conn: Conn) -> None:
    """Create the singular, event-anchored application-workflow artifact."""
    conn.execute("BEGIN")
    # SQLite requires the complete parent key of a composite foreign key to be
    # unique. Keeping job_id in that key makes an event move carry its workflow
    # record atomically during relinking and merging. Maintenance tests can supply
    # a deliberately minimal alternate schema; like SQLite's deferred parent-table
    # checks for the existing form/alias migrations, leave its absent parent alone.
    # The product schema always creates events before migrations run.
    has_events = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'events'"
    ).fetchone()
    if has_events:
        conn.execute("CREATE UNIQUE INDEX idx_events_id_job_id ON events (id, job_id)")
    conn.execute(
        """
        CREATE TABLE application_workflows (
            job_id TEXT PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
            submitted_event_id INTEGER NOT NULL,
            preparation_lane TEXT NOT NULL CHECK (
                preparation_lane IN ('human_only', 'agent_assisted', 'agent_led', 'unknown')
            ),
            submission_actor TEXT NOT NULL CHECK (
                submission_actor IN ('human', 'agent', 'unknown')
            ),
            submission_channel TEXT NOT NULL CHECK (
                submission_channel IN ('easy_apply', 'external_form', 'email', 'other', 'unknown')
            ),
            narratives_json TEXT NOT NULL,
            measured_human_time_seconds INTEGER CHECK (
                measured_human_time_seconds IS NULL OR measured_human_time_seconds >= 0
            ),
            references_json TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (submitted_event_id, job_id)
                REFERENCES events (id, job_id) ON DELETE CASCADE ON UPDATE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX idx_application_workflows_event ON application_workflows "
        "(submitted_event_id, job_id)"
    )


_DATA_MIGRATIONS: tuple[tuple[str, DataMigration], ...] = (
    ("create_form_fill_foundation_v1", _create_form_fill_foundation),
    ("create_job_id_aliases_v1", _create_job_id_aliases),
    ("create_application_workflows_v1", _create_application_workflows),
)


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

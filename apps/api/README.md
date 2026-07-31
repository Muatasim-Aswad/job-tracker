# Job Tracker API

Local FastAPI backend for the personal job tracker (see [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)). Runs on **port 3456**, against a libSQL/SQLite file by default, with optional Turso sync for cross-device state.

## Run the API directly

```bash
uv run uvicorn app.main:app --host 127.0.0.1 --port 3456 --reload
```

Every feature route is mounted under `/api` (e.g. `POST /api/events`); OpenAPI docs stay unprefixed at <http://localhost:3456/docs>. The schema is created on startup (`jobtracker.db` in this directory by default).

## Dashboard (web UI)

A React + TS + Vite Kanban dashboard lives in [`../web/`](../web). It talks to this API over relative `/api/...` paths, so it runs the same in dev and prod.

- **Dev** (hot reload): `cd ../web && pnpm install && pnpm dev` → <http://localhost:5173>. Vite proxies `/api` (plus `/docs`/`/openapi.json`) to this server on :3456, so run `uvicorn` too.
- **Prod / one process**: from the repository root, `pnpm run build:web` produces `apps/web/dist`, which FastAPI serves at the root on startup ([main.py](app/main.py)) via `Settings.web_dist_path`. Then the whole thing is just <http://localhost:3456>. The mount is skipped when that directory is absent, so the API still runs without a build.

The board is the active funnel (`new → … → offered`); drag a card to transition it (`POST /events`), or use the card menu / detail drawer for terminal outcomes, flags, identity edits, and documents. Each column can be ordered by activity, creation date, or title; ordering is a browser-local dashboard preference.

### Needs attention and ghosting

`GET /api/jobs` derives an `attention` suggestion for a job sitting in `applied` or `in_process` without a newer status-setting event or note — 21 whole days by default for `applied`, 14 for `in_process`. A note counts as activity and resets the clock; starring, hiding, and descriptive edits don't. Hidden jobs are omitted from the dashboard's attention badge and attention-only view.

Attention is read-only derived state, so no read or background process ever writes a status event: the user adds a note, moves or corrects the job, or confirms `Mark ghosted` in the drawer. A normal `ghosted` transition is accepted only from `applied` and `in_process`; anything else needs the correction control.

## Test & type-check

```bash
uv run pytest          # in-memory sqlite, no network, no Turso
uv run mypy            # strict
```

## Layout

Feature modules follow the same `router → service → repository` dependency direction. Shared helpers such as `core.deps.service_factory` and `core.db.hydrate_json` keep repeated wiring and row hydration out of individual modules.

```
app/
├── core/       config (Settings + get_settings), db, schema.sql, enums, ids,
│               text, timeutil, similarity, hashing, sync, errors, deps
├── jobs/       /jobs, /jobs/states, /jobs/matches, /jobs/{id}
├── listings/   /listings, /listings/{id}  (link_listing_to_job cascade lives here)
├── events/     /events, /jobs/{id}/corrections, /jobs/{id}/status/revert
├── documents/  /jobs/{id}/documents, /documents/{id}
├── meta/       /meta/vocabulary, /meta/note-titles
├── stats/      /stats
├── blocked/    /blocked-companies
└── search_log/ /search-log, /search-log/report
```

`scripts/` holds standalone maintenance tools (`merge_duplicates.py`, `audit_funnel.py`, `dump_openapi.py`, `scan_event_order.py`), typed and covered by the same ruff/mypy/pytest gate as `app/`. Run them as modules from here: `uv run python -m scripts.merge_duplicates`. Private scrapers live in the gitignored `scripts/local/` overlay — see [../../docs/PRIVATE.md](../../docs/PRIVATE.md).

## Configuration

Copy `.env.example` to `.env` only to override defaults (`DB_PATH`, `PORT`, `SCRIPTS_OUTPUT_DIR`, the `TURSO_*` sync settings — see `.env.example` for the full list).

| Setting | Default | Meaning |
| --- | --- | --- |
| `ATTENTION_APPLIED_DAYS` | `21` | Whole inactive days before an `applied` job needs attention; `0` disables it. |
| `ATTENTION_IN_PROCESS_DAYS` | `14` | Whole inactive days before an `in_process` job needs attention; `0` disables it. |

Both must be non-negative integers, validated at startup. The thresholds are server-owned and not duplicated in the clients.

## Security

Proportionate to a local personal tool, not a hardened public service:

- **CORS allowlist** — `Settings.web_dev_origin` (Vite's dev server) and the extension's fixed `chrome-extension://<Settings.extension_id>` origin are the only browser origins the API answers to with CORS headers.
- **`TrustedHostMiddleware`** — rejects requests whose `Host` header isn't `Settings.trusted_hosts` (DNS-rebinding guard).
- **Optional `X-API-Key`** — leave `API_KEY` unset for the normal local setup. When set, every `/api/*` request must carry a matching header or get a `401`; `/docs` and `/openapi.json` stay ungated. Neither the dashboard nor the extension stores or transmits it, so neither can talk to a gated server directly. Use it only behind a trusted intermediary that injects the header, or for scripts that send it themselves.

This is not a supported public-internet authentication model. If the service is made reachable beyond the local machine, put it behind HTTPS and a proper VPN/reverse-proxy identity layer rather than treating the shared key as a login.

## Database

One env-var picks the mode; no new variables are needed. The schema is created automatically on first boot, so any mode works against an empty file.

| Mode | `.env` | Behaviour |
| --- | --- | --- |
| **Local file** (default) | _(nothing)_ | Single SQLite file at `DB_PATH` (default `jobtracker.db`). No network, no sync. |
| **Embedded replica** | `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Reads from the local file; each write is written through to the remote primary. Pulls on boot and every `TURSO_PULL_INTERVAL_SECONDS`. |
| **Local-first** (recommended) | the two above **+** `TURSO_LOCAL_FIRST=true` | Reads _and_ writes stay local/instant; writes are pushed to the primary in the background and the primary is pulled on boot + on interval. Uses a sibling `<DB_PATH>.sync` replica. |

### Local file — setup

Nothing to do: `uv run uvicorn app.main:app --port 3456` creates `jobtracker.db` and starts serving. Point elsewhere with `DB_PATH=/path/to/jobtracker.db`.

### Cross-device sync (Turso) — setup

Provision the remote once:

1. Install the CLI: `curl -sSfL https://tur.so/install.sh | bash`, then `turso auth login`.
2. `turso db create job-tracker`
3. URL: `turso db show job-tracker --url` · token: `turso db tokens create job-tracker`
4. On each laptop, put in `.env`:
   ```
   TURSO_DATABASE_URL=libsql://job-tracker-<org>.turso.io
   TURSO_AUTH_TOKEN=<token>
   TURSO_LOCAL_FIRST=true   # omit (or =false) for plain embedded-replica mode
   ```
5. Restart the server. Startup pulls the latest remote state before serving.

### Backup & restore

Every mode keeps a plain SQLite file on disk, so dump it to portable SQL. The file is `DB_PATH`, except in local-first mode where the live data sits in the `<DB_PATH>.sync` sibling:

```bash
sqlite3 jobtracker.db      .dump > backup.sql   # local-file / embedded-replica mode
sqlite3 jobtracker.db.sync .dump > backup.sql   # local-first mode
```

Restore into a **fresh, non-existent path**: the dump recreates the schema, so never point it at a DB the server has already initialised.

```bash
sqlite3 restored.db < backup.sql   # then run with DB_PATH=restored.db
```

In a synced mode the Turso remote is authoritative, and a fresh local-first client rebuilds its `.sync` replica from the primary on first boot, so a restore is only needed when reseeding that primary.

### Testing against a throwaway DB

Set `APP_ENV=test` to point the app at the disposable `TURSO_TEST_DATABASE_URL` and relocate the local replica under `.test-db/`, so neither prod data nor prod replica files are touched. The same vars back the `turso`-marked integration tests: `uv run pytest -m turso`, which a plain `pytest` skips.

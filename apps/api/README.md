# Job Tracker API

Local FastAPI backend for the personal job tracker (see [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)). Runs on **port 3456**, against a libSQL/SQLite file by default, with optional Turso sync for cross-device state.

## Run the API directly

```bash
uv run uvicorn app.main:app --host 127.0.0.1 --port 3456 --reload
```

Every feature route is mounted under `/api` (e.g. `POST /api/events`); OpenAPI docs stay unprefixed at <http://localhost:3456/docs>. The schema is created on startup (`jobtracker.db` in this directory by default).

This direct command intentionally keeps cwd-relative `jobtracker.db`, `.env`, and `script-output` defaults. It still acquires `.job-tracker-state/server.lock` before opening the database, so a second direct or wrapped server cannot use the same profile.

The delayed-import CLI is also available from this directory:

```bash
uv run python -m app.cli --profile direct start [--port PORT]
uv run python -m app.cli --profile direct status
uv run python -m app.cli --profile direct paths
uv run python -m app.cli --profile direct version
uv run python -m app.cli --profile direct doctor
uv run python -m app.cli --profile direct backup /safe/path/job-tracker.sqlite
uv run python -m app.cli --profile direct restore /safe/path/job-tracker.sqlite
```

`start` binds only to `127.0.0.1` and runs in the foreground. `status` never opens or mutates the database. `doctor` reports redacted path, version, mode, lock/health, permission, and safe integrity diagnostics. Backup, restore, and checkout adoption are offline-only and refuse while the selected server lock is held. Source launchers and packaged operation select their profile explicitly; see the authoritative [distribution and lifecycle contract](../../docs/DISTRIBUTION.md).

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
├── core/       paths, config, lifecycle/process lock, db, schema.sql, enums,
│               ids, text, timeutil, similarity, hashing, sync, errors, deps
├── cli.py      delayed-import start/status/paths/version entry point
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

Direct development reads this directory's `.env`. Source and packaged profiles instead resolve the explicit `JOB_TRACKER_CONFIG_FILE` (or their profile default), with process environment values taking precedence. Direct development and the source launchers retain their `apps/api/` compatibility anchor for relative settings; the packaged profile anchors `DB_PATH` and `SCRIPTS_OUTPUT_DIR` to its data root and `WEB_DIST_PATH` to its application root.

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

Stop the server, then use the delayed-import CLI to create a consistent SQLite snapshot. It selects `DB_PATH` for local and embedded-replica modes and `<DB_PATH>.sync` for local-first mode, validates SQLite integrity and foreign keys, writes a private temporary sibling, and atomically installs the completed output. The output directory must already exist.

```bash
uv run python -m app.cli --profile direct backup /safe/path/job-tracker.sqlite
```

Local SQLite restore validates and migrates a fresh candidate before atomically installing it at `DB_PATH`. An existing destination is refused unless `--replace` is explicit; replacement first preserves a verified automatic backup under the selected backup root.

```bash
uv run python -m app.cli --profile direct restore /safe/path/job-tracker.sqlite
uv run python -m app.cli --profile direct restore /safe/path/job-tracker.sqlite --replace
```

In either Turso mode, general restore never reseeds the primary or overwrites the configured replica. Supply a separate, explicit local recovery target for inspection:

```bash
uv run python -m app.cli --profile direct restore /safe/path/job-tracker.sqlite --target /safe/path/recovery.sqlite
```

Startup preserves and validates an existing local Turso store at `<backup root>/recovery/pre-pull.sqlite` before constructing a driver that can pull remote state. If that recovery snapshot fails, startup refuses before contacting the driver.

Packaged installations can adopt an older checkout only while both installations are stopped and the packaged database family is empty:

```bash
job-tracker migrate-checkout /path/to/old-checkout
```

The command snapshots the checkout's effective local database without copying its `.env`, credentials, private overlays, logs, or script output, and leaves the checkout unchanged. Validate the adopted local database before configuring Turso separately.

### Testing against a throwaway DB

Set `APP_ENV=test` to point the app at the disposable `TURSO_TEST_DATABASE_URL` and relocate the local replica under `.test-db/`, so neither prod data nor prod replica files are touched. The same vars back the `turso`-marked integration tests: `uv run pytest -m turso`, which a plain `pytest` skips.

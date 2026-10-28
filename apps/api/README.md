# Job Tracker API

Local FastAPI backend on **port 3456**, using SQLite by default with optional Turso synchronization. See [architecture](../../docs/ARCHITECTURE.md) for domain boundaries.

## Run the API directly

```bash
uv run uvicorn app.main:app --host 127.0.0.1 --port 3456 --timeout-graceful-shutdown 15 --reload
```

Every feature route is mounted under `/api` (e.g. `POST /api/events`); OpenAPI docs stay unprefixed at <http://localhost:3456/docs>. The schema is created on startup (`jobtracker.db` in this directory by default).

This direct command intentionally keeps cwd-relative `jobtracker.db`, `.env`, and `script-output` defaults. It still acquires `.job-tracker-state/server.lock` before opening the database, so a second direct or wrapped server cannot use the same profile.

The delayed-import CLI is also available from this directory:

```bash
uv run python -m app.cli --profile direct start [--port PORT]
uv run python -m app.cli --profile direct status
uv run python -m app.cli --profile direct paths
uv run python -m app.cli --profile direct version
uv run python -m app.cli --profile direct build-info
uv run python -m app.cli --profile direct doctor
uv run python -m app.cli --profile direct backup /safe/path/job-tracker.sqlite
uv run python -m app.cli --profile direct restore /safe/path/job-tracker.sqlite
```

`start` binds only to `127.0.0.1` and runs in the foreground. `status` never opens or mutates the database. `doctor` reports redacted path, version, mode, lock/health, permission, and safe integrity diagnostics. Backup, restore, and checkout adoption are offline-only and refuse while the selected server lock is held. Source launchers and packaged operation select their profile explicitly; see the authoritative [distribution and lifecycle contract](../../docs/DISTRIBUTION.md).

## Busy requests and shutdown

Database requests wait in an asynchronous admission queue, preserving worker slots for the request holding the connection. Admission and connection-lock waits each expire after 30 seconds with `503`, `Retry-After: 1`, and `Cache-Control: no-store`. Retrying a rejected request is safe: it has not entered its transaction. A DB-free health response proves reachability, not database readiness.

A timed-out database wait logs its stage and dumps Python thread stacks to stderr at most once per minute. Dumps omit frame locals, SQL, credentials, and request bodies; under systemd they appear in the service journal. Capture those logs before restarting a future unresponsive server.

The CLI and source launchers give Uvicorn 15 seconds to drain active requests before cancellation and application cleanup. Direct Uvicorn commands and custom service units must also set `--timeout-graceful-shutdown 15`; the scheduler's separate 10-second cleanup bound only applies once Uvicorn reaches application shutdown. A service manager still needs a final process-stop deadline for native driver stalls; a shutdown timeout does not terminate a running Python worker thread. Application cleanup leaves an owned connection and its profile lock for process exit instead of closing them under that worker.

## Dashboard (web UI)

The [dashboard](../web/README.md) uses relative `/api/...` paths in development and production.

- **Dev** (hot reload): follow the [dashboard development procedure](../web/README.md#development). Vite proxies API requests to this server; keep the API running in a separate terminal.
- **Prod / one process**: from the repository root, `pnpm run build:web` produces `apps/web/dist`, which FastAPI serves at the root on startup ([main.py](app/main.py)) via `Settings.web_dist_path`. Then the whole thing is just <http://localhost:3456>. The mount is skipped when that directory is absent, so the API still runs without a build.

Job-addressed reads and ordinary writes accept merged aliases, return canonical IDs, and set `Content-Location`. Deletion through an alias returns `409 job_merged` and requires repeating the request against the survivor. See [identity](../../docs/ARCHITECTURE.md#identity) for merge invariants.

### Duplicate suggestions and merging

`GET /api/jobs/{job_id}/matches` needs only a stored job ID. It uses the job's canonical title/company and compares all its listings with each candidate's listings, returning the existing `JobMatch[]` shape once per candidate. Missing title/company yields an empty list; an unknown ID returns `404`. Merged aliases resolve to the survivor, and `Content-Location` names `/api/jobs/{canonical_job_id}/matches`. Matching is read-only and retains false-match exclusions. The [architecture](../../docs/ARCHITECTURE.md#identity) defines candidate selection and evidence aggregation.

`POST /api/jobs/{job_id}/link-job` accepts `{"other_job_id": "..."}` and merges both complete jobs using the existing survivor rules and conflict safeguards. Both IDs accept merged aliases. It returns `{"job_id": "<survivor>", "merged_from": ["<loser>"]}` with `Content-Location: /api/jobs/{survivor}`. Linking a job to itself, including a retry through an alias, is a no-op with an empty `merged_from`; an unknown ID returns `404`. The source path does not determine the survivor.

The extension's existing `GET /api/jobs/matches` and `POST /api/listings/link-job` retain their listing-based inputs and responses. These additions require no UI changes.

### Shared extension settings

Startup seeds one settings row if absent: description highlights enabled with default words, no title rules, Easy Apply on, filtered jobs hidden, and diagnostics Never. The seed uses the existing migration ledger and preserves every existing row, including disabled highlights, empty keyword lists, and an empty highlight collection. Existing browser settings are ignored.

`GET /api/settings` returns the stored `{revision, settings}`. `PATCH /api/settings` takes `{expected_revision, changes}` and merges supplied fields; a stale revision returns `409` with the current state. All settings responses and errors use `Cache-Control: no-store`.

Settings contain `description_highlights`, `title_rules`, `easy_apply_enabled`, `hide_mode` (`dim`/`remove`), and `search_diagnostics` (`scope` and Unix-millisecond `expires_at`). Rules have a stable ID, enabled flag, condition (`contains`, `starts_with`, `not_contains`), alternative `terms`, and action (`outline_job_card`, `hide`, `star`, `skip`). Up to 100 rules and 200 keywords per list are accepted; keywords are trimmed and deduplicated. Lists require unique IDs. Explicit null settings and empty title-rule keyword lists are refused. A temporary diagnostics scope requires an expiry; disabled or expired capture makes search-log submissions a no-op. Settings are ordinary database data, included in backups and optional Turso synchronization.

### Listing capture timestamps

Listings in `GET /api/jobs/{job_id}` expose `captured_at` (first capture of any kind) and `last_detail_captured_at` (latest successful full-detail capture). `POST /api/listings` accepts `capture_kind: "detail" | "partial"`, defaulting to `partial`. Detail requests must supply a nonblank title and string `meta.description`; stored fields and `meta_patch` cannot satisfy that requirement. Each accepted detail capture advances `last_detail_captured_at`, including identical recaptures. Partial card captures, availability-only updates, manual edits, relinks, and merges preserve it.

Both capture timestamps use server UTC time and are not caller-supplied fields. `updated_at` records broader listing changes, while `availability_observed_at` records availability evidence only. Uncaptured stubs have null capture timestamps. Existing listings retain their original `captured_at` and start with null `last_detail_captured_at` until a marked detail capture; older clients without the marker cannot advance it. The former `last_captured_at` database column is retained without further updates for additive migration compatibility; its values are neither exposed nor copied into the detail timestamp. The migration preserves existing data and is safe to rerun.

### Listing availability

`POST /api/listings` accepts `availability` (`unknown`, `open`, `unavailable`, or `closed`), an optional `availability_message`, and an optional timezone-aware `availability_observed_at` (server time when omitted). `GET /api/jobs/{job_id}` returns these fields on each listing. Omitted or unknown observations preserve prior evidence; older observations are ignored. Notice and timestamp require an availability value. An open observation clears the listing closure; unavailable observations neither close a listing nor undo a recorded closure. Repeated closure captures preserve the first `closed_at` until reopening; explicit closure edits can still replace or clear it. `GET /api/jobs` includes `listing_availability` with unavailable/closed counts and dates plus `linkedin_open_count` for compact cards. Availability is independent of funnel progress; automatic reconciliation and manual-closure safeguards still apply.

`GET /api/jobs` and `GET /api/jobs/{job_id}` also return top-level `availability`, calculated from the current listings on each read: `open` when any LinkedIn listing is confirmed open, otherwise `unavailable` when any listing is unavailable, otherwise `closed` when any listing is closed, otherwise `unknown`. Open listings on other platforms do not override warnings or establish job-level `open`. The field is read-only, is not a database column, and remains separate from funnel `status`; the dashboard displays this result without recalculating it. Existing listing counts remain available for filters.

### Document creation retries

`POST /api/jobs/{job_id}/documents` accepts an optional globally unique `creation_key` (1–200 characters, not whitespace-only). A new key returns `201`; an identical retry returns `200` with the same document ID and its current representation, even after edits or a merge. The key retains a hash of the original normalized creation payload; reuse with different fields or another canonical job returns `409 document_creation_key_conflict`. Omitting the key keeps ordinary independent creation. Keys and hashes are internal and removed when their document is deleted; retrying after deletion creates a new document. Document creation and key retention commit together.

### Duplicate exclusions

`POST /api/jobs/{job_id}/false-match` accepts `{ "other_job_id": "..." }` and mutually excludes two stored jobs from duplicate suggestions without a listing address. Both IDs resolve merged aliases; repeated exclusions and self-pairs are no-ops. Missing jobs return `404`. Success returns `204` with the canonical source job in `Content-Location`. The listing-addressed endpoint remains available for uncaptured postings.

### Application-workflow analytics

Agents can use `GET` and `PUT /api/jobs/{job_id}/application-workflow` after submission has been explicitly confirmed by an effective `applied` or `corrected:applied` event. The singular record captures a typed preparation lane, submission actor and channel, narrative kinds and provenance, an optional measured human-time duration in integer seconds, and bounded opaque references to canonical agent artifacts or submission evidence. Use `unknown` when a required workflow fact is unknown, `null` only when human time was not measured, and an empty narrative list only when no narrative was used; do not infer or estimate missing facts.

`PUT` replaces the complete workflow representation. On creation, `expected_revision` is null or omitted; a differing update must supply the current positive revision. Retrying an identical create or update is a no-op even if its precondition is now stale, while a differing stale write returns `409` with the current record. The response and `Content-Location` always use the canonical job ID, including when the request used a merged alias. There is no public delete endpoint.

The record names the exact submitted event. Reverting that event, correcting the job back to a pre-application state, or hard-deleting the job removes the record. Relinks and merges move it with its event; an operation that would collapse two records returns `409 application_workflow_conflict`. Outcomes remain derived from the event history, and agent model, token, and cost details remain in the referenced canonical artifacts rather than being duplicated here. The API does not backfill earlier applications and no dashboard UI exists for this resource yet. All success and error responses for this path carry `Cache-Control: no-store`.

### Needs attention and ghosting

`GET /api/jobs` derives an `attention` suggestion for a job sitting in `applied` or `in_process` without a newer status-setting event or note — 21 whole days by default for `applied`, 14 for `in_process`. A note counts as activity and resets the clock; starring, hiding, and descriptive edits don't. Hidden jobs are omitted from the dashboard's attention badge and attention-only view.

Attention is read-only derived state, so no read or background process ever writes a status event: the user adds a note, moves or corrects the job, or confirms `Mark ghosted` in the drawer. A normal `ghosted` transition is accepted only from `applied` and `in_process`; anything else needs the correction control.

### Form-fill knowledge

`/api/form-fill` owns the typed, revision-checked knowledge used by supported application forms:

- `POST /resolutions` observes exact Questions and returns one typed result per request field in request order.
- `/answers` manages reusable verified values, fill policies, and revision-checked stable-key corrections. An Answer can be permanently deleted only while no Match points to it.
- `/questions` manages review state and each Question's singleton Match, including complete one-to-one choice-option bindings. Saving a Match also applies the one non-conflicting current Capture when the resulting mapped action exactly equals the Answer's current action; a differing Capture remains provisional.
- `/captures` stores provisional user-entered or explicitly remembered values for review and applies them through one of the explicit promotion/update workflows.
- `/questions/{id}/capture-conflicts/resolve` selects a winner only when the Question revision and complete current Capture revision set still agree.

`GET /questions?review_inbox=true` returns the union of actionable Questions and Questions with current Captures, once per Question. `include_matched=true` and `include_dismissed=true` independently extend that inbox with active Matches on open Questions and ignored Questions. These options require `review_inbox=true`; all filters participate in cursor identity. Summaries include section/help context and active-option, current-Capture, and ignored-Capture counts without Answer values. `review_state=ignored` and `GET /captures?status=ignored` provide dismissed-item history; Capture summaries include their Question label. Dismissed Capture values are cleared and cannot be reopened without a retained value.

Radio and single-choice dropdown observations share normalizer-version-2 Question identity, stored as `control_kind=radio`. Requests retain their DOM kind and actions select request-local options. Existing version-1 choice knowledge requires explicit matching; see [form-fill identity](../../docs/ARCHITECTURE.md#form-fill-knowledge).

Answer collections accept `sort=updated_at` (default, descending), `label` (case-insensitive ascending), or `mapping_count` (descending, counting all Matches). Question collections accept `sort=last_seen` (default), `seen_count`, or `prompt` (ascending normalized prompt). Stable ID tie-breakers keep pagination deterministic; cursors are bound to the filters and order. These collection reads never include retained values.

`GET /captures`, Question-embedded Capture summaries, apply/conflict summaries, and all revision-conflict responses omit retained Capture values, including the `value` field. The dashboard presence poll uses this value-free collection. `GET /captures/{id}`, Capture creation/retry responses, and successful Capture review updates retain the detail value where available. Explicit resolution actions and Question-scoped Answer candidate previews also return private values for filling or review.

`GET /questions/{id}/answer-candidates` returns active Answers compatible with that Question before pagination: scalar write compatibility (including integer constraints), equal active choice counts, and, for default suggestions, an unambiguous normalized label set or complete previously verified bindings. Default suggestions require meaningful prompt-word overlap with the Answer label/description or an active verified Question match; generic words such as years and experience do not qualify alone. Verified matches rank first, followed by label and description overlap, with normalized label and ID tie-breakers. Explicit `q` searches stable key, label, and description and relaxes relevance and option-label matching while retaining type, numeric, active-choice, and count checks for manual binding review. Candidate rows return ID, label, revision, and a readable value preview capped at 160 characters. Cursors bind the Question revision, search, and ranked Answer revisions; changed results require restarting pagination. Existing Match writes recheck revisions, scalar compatibility, and complete one-to-one bindings. The broader Match API continues to support extra Answer choices; candidate selection is deliberately stricter.

Choice Questions, Answer vocabularies, and complete Match bindings share a 512-item bound. This covers legitimate long controls such as phone-country-code lists while keeping page-derived request and mutation payloads bounded.

A Capture key identifies its original operation: an identical clear can be retried, while changing a value capture into a clear requires a new key even after its retained value has been removed. Legacy rows without an operation marker conservatively reject clear retries with the old key. Dashboard listing rollups project only text-valued `meta.apply_url`; other JSON types remain in listing metadata and produce a null application URL.

Answer, Question, Match, and Capture writes use expected revisions; a stale write rolls back atomically and returns a current value-free summary. Question-context Answer creation derives compatible type and choice bindings from the Question and installs the Answer and Match in the same transaction. Without an eligible active Match, competing current Captures resolve to no action. Question detail and collection projections derive that conflict from the current set, and Capture apply refuses it until complete-set winner selection; reads preserve revisions. Superseding, clearing, ignoring, applying, or losing a conflict removes a Capture's retained value, while lifecycle events never copy Answer or Capture values. Every successful or error response under `/api/form-fill/` carries `Cache-Control: no-store`.

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
├── application_workflows/  /jobs/{id}/application-workflow
├── form_fill/  /form-fill resolutions, answers, questions/matches, captures
├── meta/       /meta/vocabulary, /meta/note-titles
├── stats/      /stats
├── blocked/    /blocked-companies
├── preferences/ /settings
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

Turso settings select the database mode. Startup creates the schema for an empty file.

| Mode | `.env` | Behaviour |
| --- | --- | --- |
| **Local file** (default) | _(nothing)_ | Single SQLite file at `DB_PATH` (default `jobtracker.db`). No network, no sync. |
| **Embedded replica** | `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Reads from the local file; each write is written through to the remote primary. Pulls on boot and every `TURSO_PULL_INTERVAL_SECONDS`. |
| **Local-first** (recommended) | the two above **+** `TURSO_LOCAL_FIRST=true` | Reads _and_ writes stay local/instant; writes are pushed to the primary in the background and the primary is pulled on boot + on interval. Uses a sibling `<DB_PATH>.sync` replica. |

Local-first pyturso HTTP operations use `TURSO_HTTP_TIMEOUT_SECONDS` (default `10`) as their socket-progress timeout. Scheduled pulls use a one-second server long poll because the scheduler owns their cadence. A timed-out push remains pending in the local replica and retries later; shutdown also stays bounded if the remote is unreachable.

### Local file — setup

The [direct startup command](#run-the-api-directly) creates `jobtracker.db`. Override the path with `DB_PATH=/path/to/jobtracker.db`.

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

Every database mode, manual snapshot, automatic pre-replacement backup, and pre-pull recovery snapshot includes retained form Answer values and current remembered values. Treat those files and the configured Turso database as private data, and delete each copy separately when removing that data.

### Testing against a throwaway DB

Set `APP_ENV=test` to point the app at the disposable `TURSO_TEST_DATABASE_URL` and relocate the local replica under `.test-db/`, so neither prod data nor prod replica files are touched. The same vars back the `turso`-marked integration tests: `uv run pytest -m turso`, which a plain `pytest` skips.

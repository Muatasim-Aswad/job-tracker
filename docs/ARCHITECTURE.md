# Job Tracker architecture

This document records the system boundaries and the decisions that are costly to rediscover. The following sources own implementation detail:

- Database columns and constraints: [`apps/api/app/core/schema.sql`](../apps/api/app/core/schema.sql)
- API paths and payloads: the feature routers under `apps/api/app/` and generated OpenAPI at `/docs`
- Installation, configuration, and maintenance: [`README.md`](../README.md) and [`apps/api/README.md`](../apps/api/README.md)
- Supported extension adapters: [`apps/extension/README.md`](../apps/extension/README.md)

## Repository layout

```text
job-tracker/
├── apps/
│   ├── api/        FastAPI API, database, and maintenance tools
│   ├── extension/  Chromium extension
│   └── web/        React dashboard
├── packages/
│   └── shared/     shared TypeScript contracts and utilities
├── scripts/        repository setup, checks, and launchers
├── docs/           product, architecture, and development documentation
└── templates/
    └── private-overlay/  scaffold for a separate private overlay
```

Each component documents its own internal structure and commands. This map only shows the stable repository boundaries.

## Scope and deployment

Job Tracker is a single-user application. FastAPI and the dashboard run on the user's machine; the extension connects to that configured origin. SQLite is the default database. Optional Turso modes provide cross-device synchronization without hosting the API.

The server is designed for localhost, not direct public exposure. Trusted-host checks, a CORS allowlist, and the optional API key reduce accidental access but do not provide user authentication. See [`SECURITY.md`](../SECURITY.md) for the supported threat model.

Path selection is a runtime boundary rather than a cwd heuristic. `core.paths` resolves the direct-development, source-checkout, or packaged profile; settings then apply configuration-file values and process overrides against those roots. Root launchers select the source profile explicitly, while the `job-tracker` entry point establishes packaged roots before importing FastAPI, settings, version, or static-resource modules. Version, schema, and dashboard lookup all use the same selected application root.

The Linux runtime bundle and wheel are replaceable packaged application layouts over persistent platform roots. The optional Linux/amd64 container uses the same packaged profile with explicit `/app`, `/data`, `/config`, `/state`, and `/backups` boundaries. These surfaces share one lifecycle and maintenance implementation; packaging does not create a second database or locking model.

The FastAPI lifespan owns the profile's advisory process lock. It acquires that lock before opening, pulling, or initializing the database and releases it only after background sync stops and the connection closes. Consequently direct Uvicorn startup and the CLI have the same single-owner database boundary; wrappers are not a separate source of locking truth. The detailed profile, permission, and stale-lock contract is in [`docs/DISTRIBUTION.md`](DISTRIBUTION.md).

Offline database maintenance lives under `app.maintenance`. Its snapshot primitive uses the SQLite API, validates integrity and foreign keys, and installs temporary siblings atomically; restore applies schema migrations only to a candidate. The CLI owns user-facing backup, restore, and checkout-adoption dispatch, while `core.db` invokes only the recovery-snapshot hook before constructing a Turso driver that can perform a startup pull. Maintenance never contains a remote-primary mutation path.

## Domain model

A tracked opportunity and a scraped posting are separate entities:

- A **job** holds the user's canonical title, company, funnel state, flags, and custom metadata.
- A **listing** records one platform's representation of that job. A job can have several listings.
- An **event** records how job state changed. Listing-originated events may retain listing provenance.
- A **document** belongs to the job rather than to a particular listing.

This separation prevents a repost on another platform from creating a second application history while preserving platform-specific URLs and scraped fields.

### Identity

The API uses three identifiers:

- `(platform, platform_id)` is a listing's external natural key.
- `listing_id` is an opaque stored surrogate.
- `job_id` is an opaque stored surrogate for the canonical opportunity.

Clients never construct `listing_id` or `job_id`. Listing-oriented extension operations use the natural key; dashboard operations use stored job or listing IDs. Legacy rows may retain older readable listing IDs, but no current code parses or recreates them.

The first complete capture seeds the job's title and company. Later captures update their own listings without replacing that canonical identity. An explicit dashboard edit can change it. Normalized `company_key` and `title_key` values support duplicate suggestions only; capture never merges jobs from those values. Equal company and title strings are insufficient evidence that two openings are the same.

### Linking and merging

Creating or updating a listing and deciding which job it belongs to are separate operations. Explicit linking moves the listing and its attributed events. If the source job then has no listings, its remaining events and documents move to the target before the empty job is deleted.

The duplicate-suggestion flow can merge two complete jobs. The job further along the funnel survives; ties preserve the older job. Listings, events, documents, and false-match exclusions are consolidated under the survivor. State is reprojected from the merged event history without allowing an ordinary backdated event to undo the survivor's stronger status.

Deleting the last listing also deletes the now-unaddressable job and its remaining history. Deleting a job directly is therefore reserved for unwanted data; a real opportunity that ended should receive a terminal status instead.

## State and events

Job state consists of one funnel status and two independent flags:

```text
active: new → seen → to_apply → applied → in_process → offered
terminal: skipped, closed, withdrawn, rejected, ghosted
flags: hidden, starred
```

`in_process` intentionally covers all post-application evaluation stages. Specific interviews, assessments, or take-home assignments belong in event metadata rather than in a fixed sequential status list.

Ordinary status events move forward. They may skip stages, but they cannot move backward, revive a terminal job, or replace one terminal outcome with another. `ghosted` is valid only from `applied` or `in_process`. A deliberate correction can set any status and is logged as `corrected:<status>`; reverting removes the latest status-setting event and reprojects the previous state.

Flags do not change funnel status. Flag events without metadata update the projected flag without adding repetitive audit rows. A metadata-bearing flag event is logged only when its metadata differs from the latest event of that kind. Notes are dated activity records that change neither status nor flags.

An uncaptured listing can read as `untracked`. This is a client-facing projection, not a stored status or a valid transition target.

### Closed listings

When the extension detects that a posting no longer accepts applications, it records `listings.closed_at`. The server automatically closes a pre-application job only when all its listings are closed. The event carries automatic provenance and is superseded if an open listing appears through reopening, relinking, or merging. Manual closures are never reversed. Applied and later jobs keep their status because the application may remain active after the posting closes.

### Attention

`GET /jobs` derives an attention suggestion for stalled `applied` and `in_process` jobs. The clock starts at the latest status-setting event or note; older rows without either fall back to `jobs.updated_at`. Reading attention never writes an event or changes status. Thresholds are server configuration and zero disables the corresponding stage.

## API boundaries

All feature routes are mounted under `/api`; `/docs` and `/openapi.json` remain unprefixed. OpenAPI is the contract for endpoint and payload detail.

The main boundaries are:

- Listing capture is an idempotent upsert by `(platform, platform_id)`.
- State changes go through `POST /events`, addressed by either a listing natural key or a job ID.
- Dashboard identity edits do not write funnel state.
- Batch listing-state reads return one self-describing result per requested platform ID, including `untracked` results.
- Attention, duplicate matches, and statistics are read projections.

The shared TypeScript API schema is generated from FastAPI's OpenAPI output. Repository checks fail if the generated file differs from the server contract.

## API organization

Server features use the same dependency direction:

```text
router → service → repository → database
```

Routers translate HTTP requests, services enforce domain rules, and repositories own SQL. Pydantic models validate boundary and hydrated database data. Raw SQL is kept behind the driver-neutral helpers in `app/core/db.py`; there is no ORM.

Platform-specific fields remain in a listing's JSON metadata until they become stable query or reporting dimensions. Funnel state and other invariants stay in typed columns rather than in open metadata.

## Database and synchronization

The API supports three connection modes:

- **Local SQLite:** all reads and writes use one local file.
- **Embedded replica:** reads use the local replica and writes go through to the Turso primary.
- **Local-first:** reads and writes use a local pyturso replica; a background scheduler pushes after a quiet period and periodically pulls remote changes.

All modes initialize the same schema. Foreign-key enforcement is enabled and verified for every connection. `schema.sql` is the 1.0.0 baseline, so the additive column and one-time data migration tables both start empty. Startup applies any registered migration that has no row in the `schema_migrations` ledger; each logical migration and its ledger write commit together, so a failed one rolls back whole and the next start retries it. The rules for adding a migration are in the [development guide](DEVELOPMENT.md#database-migration-compatibility).

The local-first scheduler never discards a failed push. Local data remains on disk, the dirty state remains set, and a later cycle retries. Shutdown performs a final push for pending writes.

## Extension architecture

Each supported surface implements the adapter contract in `apps/extension/src/adapters/`. Adapters own selectors, listing identity, and platform-specific extraction. The shared engine owns state caching, action bars, capture, duplicate matching, blocking, and the scan lifecycle.

A debounced scan runs after DOM mutations and single-page navigation. It tags cards, refreshes their state in one batch, processes the active detail view, and retries incomplete captures on a later scan. List actions first capture the available card fields so their events do not create titleless stubs.

Content scripts relay API calls through the background service worker. This keeps cross-origin access in the extension context covered by manifest host permissions. Listing state is cached in `chrome.storage` for synchronous card rendering and refreshed from the server in batches; the server remains the source of truth.

Built-in adapters ship with the public extension. Optional local adapters are loaded from gitignored overlay directories and require no server changes. See [`docs/PRIVATE.md`](PRIVATE.md) for that boundary.

## Testing

Most server tests exercise routers, services, repositories, and real SQL together against in-memory SQLite. This catches query and constraint failures that mocked repositories would hide. Pure normalization and projection helpers also have focused unit tests.

Cross-language golden and contract fixtures keep the Python and TypeScript implementations of funnel, text, and time rules aligned. Extension adapters use small synthetic HTML fixtures. Sync scheduler behavior is tested locally, while driver-specific Turso integration tests are opt-in because they require a throwaway remote database.

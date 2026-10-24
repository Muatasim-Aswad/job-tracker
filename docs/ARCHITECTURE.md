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

The FastAPI lifespan owns the profile's advisory process lock. It acquires that lock before opening, pulling, or initializing the database and releases it only after background sync stops and the connection closes. If bounded Turso cleanup expires or a worker still owns the connection, the process instead retains both resources for operating-system cleanup at exit, preventing another owner from overlapping the blocked connection. Consequently direct Uvicorn startup and the CLI have the same single-owner database boundary; wrappers are not a separate source of locking truth. The detailed profile, permission, and stale-lock contract is in [`docs/DISTRIBUTION.md`](DISTRIBUTION.md).

Offline database maintenance lives under `app.maintenance`. Its snapshot primitive uses the SQLite API, validates integrity and foreign keys, and installs temporary siblings atomically; restore applies schema migrations only to a candidate. The CLI owns user-facing backup, restore, and checkout-adoption dispatch, while `core.db` invokes only the recovery-snapshot hook before constructing a Turso driver that can perform a startup pull. Maintenance never contains a remote-primary mutation path.

## Domain model

A tracked opportunity and a scraped posting are separate entities:

- A **job** holds the user's canonical title, company, funnel state, flags, and custom metadata.
- A **listing** records one platform's representation of that job. A job can have several listings.
- An **event** records how job state changed. Listing-originated events may retain listing provenance.
- A **document** belongs to the job rather than to a particular listing.
- An **application workflow** is the singular, prospective analytics artifact for how one confirmed application was prepared and submitted. It records typed workflow facts and references, not funnel outcomes or copied agent-run details.

This separation prevents a repost on another platform from creating a second application history while preserving platform-specific URLs and scraped fields.

### Identity

The API uses three identifiers:

- `(platform, platform_id)` is a listing's external natural key.
- `listing_id` is an opaque stored surrogate.
- `job_id` is an opaque stored surrogate for the canonical opportunity.

Clients never construct `listing_id` or `job_id`. Listing-oriented extension operations use the natural key; dashboard operations use stored job or listing IDs. Legacy rows may retain older readable listing IDs, but no current code parses or recreates them.

A merged job ID remains a durable alias of the surviving job. Reads and ordinary writes addressed with an alias resolve to the canonical ID; responses carry the canonical ID and job-addressed responses identify its URL with `Content-Location`. Destructive deletion through an alias is refused with a conflict so a stale caller cannot silently delete the survivor. Alias rows always point directly to a live job: when that survivor is merged again, every prior alias is flattened to the new survivor. A deliberate hard deletion removes its aliases.

The first complete capture seeds the job's title and company. Later captures update their own listings without replacing that canonical identity. An explicit dashboard edit can change it. Normalized `company_key` and `title_key` values support duplicate suggestions only; capture never merges jobs from those values. Listing-based matching uses the caller's live title/company and one stored source listing; job-based matching uses canonical title/company and all source listings. A candidate shares the source's `company_key` and either its `title_key` or a normalized `meta.apply_url` from any source/candidate listing pair. Both identity keys are required. Equal company and title strings are insufficient evidence that two openings are the same, so each candidate also reports field-level evidence and timing from stored listings. Description similarity is the highest Jaccard overlap across all source/candidate listing pairs with nonempty descriptions; it is absent when either side has no description. Each field agrees if any pair agrees; otherwise it reports each side's earliest-captured comparable value, or no evidence when either side lacks the field. Timing compares the earliest known source appearance (posting date, falling back to capture time per listing) with the candidate's last closure: any open or later-closed candidate listing implies overlap, otherwise it reports the smallest gap. Each candidate appears once, strongest similarity first, unscored last, with newest job creation breaking ties. Evidence is advisory: it never excludes a candidate. LinkedIn profile subpages normalize to their profile root only when the parsed hostname is `linkedin.com` or one of its subdomains; other hosts retain their full paths.

### Linking and merging

Creating or updating a listing and deciding which job it belongs to are separate operations. Explicit linking moves the listing and its attributed events. If the source job then has no listings, its remaining events and documents move to the target before the empty job is deleted.

The duplicate-suggestion flow can merge two complete jobs, addressed by either a source listing or two stored job IDs. Both routes share the merge implementation in `ListingService`. The job further along the funnel survives; ties preserve the older job. Listings, events, documents, form-capture job context, and false-match exclusions are consolidated under the survivor before the losing ID becomes an alias. State is reprojected from the merged event history without allowing an ordinary backdated event to undo the survivor's stronger status.

An application workflow is anchored to the exact applied or corrected-applied event that confirmed submission. Its composite event/job foreign key makes it follow that evidence when a listing is relinked or a job is merged, including through repeated merges and old aliases. A merge or relink that would collapse two workflow records is refused with a conflict rather than choosing one and losing data.

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

Application-workflow analytics require both a current applied-or-later status and a specific effective event that set `applied`; an implied post-application status alone is insufficient. Reverting or deleting that submitted event removes its workflow record through the foreign key. A correction or relink whose settled projection no longer carries applied evidence also removes the record. This is deliberate lifecycle cleanup, not a public workflow-delete operation.

Flags do not change funnel status. Flag events without metadata update the projected flag without adding repetitive audit rows. A metadata-bearing flag event is logged only when its metadata differs from the latest event of that kind. Notes are dated activity records that change neither status nor flags.

An uncaptured listing can read as `untracked`. This is a client-facing projection, not a stored status or a valid transition target.

### Listing availability

Listings expose `availability` independently of the job funnel: `unknown`, `open`, `unavailable`, or `closed`, with an optional original `availability_message` and `availability_observed_at` timestamp. Captures update this evidence together; omitted or unknown observations preserve it, and older timestamped observations cannot replace newer ones. Existing `closed_at` values project as `closed` without rewriting historical data. Capture upserts preserve the first closure timestamp until an open observation clears it; a later closure starts a new timestamp. Explicit listing edits retain authority to replace or clear the closure. Job summaries batch unavailable/closed counts and dates plus the confirmed-open LinkedIn count. `ListingAvailabilitySummary.state` owns the job-level projection exposed as top-level `availability` in job summaries and details: confirmed-open LinkedIn wins, then Unavailable, then Closed, otherwise Unknown. Unknown and Open listings on other platforms do not suppress warnings. This state is computed on each read, never persisted on the job, and does not change funnel status. Clients display the API result; listing-based filters still use the counts.

LinkedIn’s gray “Not currently accepting applications” notice records `unavailable` without closing the listing or job. It does not establish that the employer paused hiring. A visible, enabled Apply control records `open`, clears the notice and listing closure, and lets the normal automatic-closure reconciliation restore a job closed only by automation. An informational notice alone cannot undo an earlier explicit closure. Missing controls, loading content, descriptions, and recommendation cards provide no availability evidence. Full captures repeat when availability changes, including within one document.

### Closed listings

When the extension detects LinkedIn’s red “No longer accepting applications” notice, or LinkedIn reports that a recorded posting ID is invalid or removed, it records `listings.closed_at`. The unavailable-page path first confirms that the listing is already tracked, so an arbitrary invalid URL cannot create a stub. The server automatically closes a pre-application job only when all its listings are closed. The event carries automatic provenance and is superseded if an open listing appears through reopening, relinking, or merging. Manual closures are never reversed. Applied and later jobs keep their status because the application may remain active after the posting closes.

### Attention

`GET /jobs` derives an attention suggestion for stalled `applied` and `in_process` jobs. The clock starts at the latest status-setting event or note; older rows without either fall back to `jobs.updated_at`. Reading attention never writes an event or changes status. Thresholds are server configuration and zero disables the corresponding stage.

### Form-fill knowledge

Form filling uses durable semantic identities rather than page-local selectors:

- A **Question** is the exact normalized prompt, section, help, semantic control kind, stable field evidence, and active option vocabulary within a site scope. Radio groups and single-choice dropdowns share one semantic kind; their physical DOM controls remain request-local. DOM handles and client option IDs exist only for one resolution request.
- An **Answer** is a reusable typed value with an explicit fill policy and revision. Choice Answers own their reusable vocabulary.
- A **Match** is the singleton relationship for one Question. It points to one Answer and, for choice controls, binds every active Question option to an Answer choice.
- A **Capture** is a provisional value attributed to trusted user input or the explicit **Remember existing** action. It remains reviewable until cleared, superseded, ignored, applied, or selected as a conflict winner.

Single-choice identity uses normalizer version 2 and the existing `radio` control kind as its canonical representation. Both generic signatures and versioned adapter keys share that representation; their other identity evidence and active option vocabulary retain the existing rules. Other controls retain their version-1 signatures. This is forward-only: version-1 radio and select Questions, Matches, and Captures are retained without automatic fallback, merge, or migration. Existing verified Answers can be explicitly matched to newly observed Questions.

Mutations compare expected revisions inside the same transaction. Stale Answer, Question, Match, Capture, and conflict-resolution writes have no effect and return current value-free summaries for review. Resolution gives an eligible active Match priority, then an unambiguous current Capture, and otherwise returns a typed non-fill result. Muted Questions, disabled or retired Matches, disabled Answers, `never` policies, incomplete option bindings, and competing Captures cannot produce an automatic action.

Extension presentation separates writes from knowledge capture: **filled** means a currently owned extension write, and **already match** means an untouched value agrees with the resolved action. User capture, capture clearing, deliberate preservation, and reversion have separate current-step states; none contributes to fills or agreement.

Question-context Answer creation derives the Answer value kind from the Question control and uses the active Question options as the complete choice vocabulary and binding set. Creating the Answer and installing or retargeting the singleton Match is one revision-checked transaction, so neither resource can persist without a compatible relationship.

Capture conflicts are derived from more than one current row, including independently synchronized arrivals; reading that state does not change the Question revision. Applying a conflicted Capture requires explicit complete-set winner resolution. Active Match resolution retains its documented priority.

Question `review_state` records explicit open/muted intent; actionable review is derived separately as an open Question without an active Match, or one with a Capture conflict. The dashboard inbox is a separate read projection: actionable review or any current Capture, with one row per Question and cursor pagination. Collection context and counts identify exact variants without exposing Answer values. A separate Question-scoped candidate projection filters and ranks before pagination and returns bounded private value previews; selecting an Answer still fetches its complete private detail for review. Candidate previews remain drawer-local runtime data and are discarded when the picker unmounts. Resolution stores its actual non-fill reason after observation instead of guessing before the Match and Capture state has been evaluated.

Capture collections, Question-embedded Captures, apply/conflict summaries, and stale-write summaries omit the value field entirely. Explicit Capture details, creation/retry responses, and successful review-update details retain available values; resolution actions and Question-scoped candidate previews are also intentional private responses. The [API guide](../apps/api/README.md#form-fill-knowledge) owns endpoint detail.

Capture keys identify immutable value or clear operations. An additive operation marker distinguishes clear retries from value captures even after lifecycle cleanup removes their values.

Current Answer and Capture values are deliberately retained private data. Superseding, clearing, ignoring, or applying a Capture removes its reusable value; lifecycle history records IDs, event kinds, timestamps, and optional reasons but never copies Answer or Capture values. Callers that supply an optional reason are responsible for keeping private values out of that metadata. Hard deletion is limited to an Answer with no Match: it removes the value, vocabulary, and Answer-only history, while shared lifecycle rows retain their remaining Question, Match, or Capture context with the deleted Answer references cleared.

## API boundaries

All feature routes are mounted under `/api`; `/docs` and `/openapi.json` remain unprefixed. OpenAPI is the contract for endpoint and payload detail.

Public running identity is a separate build boundary: `core.build_info` owns validation and source provenance, generators bake the same metadata into each artifact, and `/version.json` serves it with `no-store` outside OpenAPI and before static mounting. `/health` exposes revision for deployment comparison. Installed identity lookup never requires Git, configuration, database access, or startup; [distribution](DISTRIBUTION.md#build-identity-and-attribution) owns its timestamp, export, and attribution policy.

The built SPA entry document is served with `Cache-Control: no-cache` so an existing browser session revalidates it after a rebuild and loads the current content-hashed assets. The dashboard PWA worker keeps entry-document requests network-first and precaches only the built shell and static assets. Its offline fallback uses the canonical shell rather than caching visited URLs; API responses and private values never enter worker caches. Existing app windows finish on their current worker before an update activates.

The main boundaries are:

- Listing capture is an idempotent upsert by `(platform, platform_id)`.
- State changes go through `POST /events`, addressed by either a listing natural key or a job ID.
- Dashboard identity edits do not write funnel state.
- Job-addressed state writes return the resolved canonical job ID. Merged IDs remain valid aliases for reads and ordinary writes, while deletion through an alias returns a conflict naming the canonical ID.
- `GET` and `PUT /jobs/{job_id}/application-workflow` read or upsert one complete application-workflow artifact. `PUT` uses an absence-or-revision precondition, accepts an identical retry as a no-op, and returns the canonical job address. There is no public delete route.
- Batch listing-state reads return one self-describing result per requested platform ID, including `untracked` results.
- Attention, duplicate matches, and statistics are read projections.
- `/form-fill` routes own resolution, Answer, Question, Match, Capture, and conflict-review workflows. Every success and error response under that boundary carries `Cache-Control: no-store`.

`POST /listings` merges observed fields from `meta`, then `meta_patch`, into stored metadata, including nested objects. Omitted fields, nulls, blank strings, and empty arrays or objects preserve existing values; zero and false are observations. Blank identity fields and `apply_type: "unknown"` cannot overwrite known values. Posting date, precision, and raw age form one evidence group: missing dates and weaker precision preserve the stored group, while an equally precise or stronger date replaces it without borrowing the old raw age. Explicit `PATCH /listings/{listing_id}` metadata edits still replace the complete bag and can clear fields.

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

All modes initialize the same schema. Foreign-key enforcement is enabled and verified for every connection. `schema.sql` is the 1.0.0 baseline; additive column and one-time data migrations are append-only compatibility layers, including the form-fill foundation migration. Startup applies any registered migration that has no row in the `schema_migrations` ledger; each logical migration and its ledger write commit together, so a failed one rolls back whole and the next start retries it. The rules for adding a migration are in the [development guide](DEVELOPMENT.md#database-migration-compatibility).

Form Answers and current remembered values are ordinary database rows. Embedded-replica and local-first modes therefore synchronize them to the configured Turso database, and every full database snapshot or automatic recovery backup retains them until that copy is deleted or replaced. Value-free history does not make the current value tables value-free.

Form captures use enforced foreign keys for their optional job and listing context. Relinking and merging rewrite that context before a parent row is dissolved; deliberate deletion clears the affected context while retaining the capture lifecycle. Search diagnostics are different: their clicked `job_id` is deliberately foreign-key-free historical input, so it never blocks a real write or deletion. A retained merged ID can still be interpreted through the alias table.

Application workflows use the opposite retention rule: they are meaningful only with a live job and their named submitted event, so both references are enforced and deletion of either removes the record. The stored reference list contains opaque locators to canonical agent runs, artifacts, or external evidence. It does not copy model, token, cost, or tracker-outcome facts; reporting resolves those locators and derives funnel outcomes from events.

Requests enter an asynchronous admission queue before acquiring the connection's thread lock. Only the admitted request can wait for that lock in FastAPI's worker pool, leaving capacity for its service, endpoint, and transaction cleanup. The scheduler uses the same thread lock, so synchronization cannot overlap a request transaction. Both admission and connection-lock waits are bounded; timeout responses occur before transaction entry and produce rate-limited, value-free thread diagnostics. See the [API operations guide](../apps/api/README.md#busy-requests-and-shutdown) for deadlines and recovery.

The local-first scheduler never discards a failed push. Local data remains on disk, the dirty state remains set, and a later cycle retries. Turso HTTP operations have a bounded socket-progress timeout. Shutdown attempts a final push for pending writes within a bounded scheduler join; if sync remains blocked, it leaves the connection and profile lock open for process exit so a restart cannot overlap the old database owner.

## Extension architecture

Each supported surface implements the adapter contract in `apps/extension/src/adapters/`. Adapters own selectors, listing identity, and platform-specific extraction. The shared engine owns state caching, action bars, capture, duplicate matching, blocking, and the scan lifecycle.

A debounced scan runs after DOM mutations and single-page navigation. It tags cards, refreshes their state in one batch, processes the active detail view, and retries incomplete captures on a later scan. Adapters may upsert identity and visible card metadata during discovery without emitting `seen`; card and detail captures both follow the evidence-preserving merge rules in [API boundaries](#api-boundaries). When a card and the detail page word the same fact differently, they use separate keys so neither overwrites the other, and readers prefer the detail key: LinkedIn cards write `card_location`, the detail page `location`. LinkedIn reads location independently of posting age and scopes both to the open job's top card, excluding promotion badges and recommendation rails. List actions always upsert their card first so their events do not create titleless stubs. The detail adapter owns `seen` once the full posting is open.

Content scripts relay API calls through the background service worker. This keeps cross-origin access in the extension context covered by manifest host permissions. Listing state is cached in content-script memory for synchronous card rendering and refreshed from the server in batches; the server remains the source of truth.

Shared preferences are one revisioned `user_preferences` database row, exposed through `/settings`. An append-only startup migration inserts defaults only when the row is absent, using a deterministic initial revision. Existing rows, disabled highlights, and empty lists are preserved. The extension reads server settings without importing browser preferences. Settings changes are broadcast to every matching frame; startup, popup access, and the 30-second poll refresh them. Content contexts keep only runtime snapshots and discard old-server responses. The popup offers immediate quick switches; the dashboard owns all highlight and rule management and diagnostic clearing. A popup link opens dashboard settings on the configured server. The dashboard edits the same settings with an explicit save and a stable draft/revision across refreshes. Stale edits return conflicts. Search-log writes enforce the saved diagnostics consent and expiry on the server.

Title rules are separate from description highlighting. Their conditions use case-insensitive, literal, word-boundaried alternatives; negative matching requires a nonempty title and no matching alternative. All matching persistent actions run sequentially through existing event guards after authoritative listing-state loading. Blocked cards are excluded, and rule changes or server switches stop queued actions. Outline is presentation-only; Skip never invokes native dismissal automatically.

The background worker also owns the configured server's public build identity and compares it with the extension's baked identity. Identity checks are independent of API reachability, reject stale responses after a newer check or server switch, and never gate data operations. Toolbar presentation gives connection failures priority over build mismatches; the popup receives cached identity and live worker updates. The [extension guide](../apps/extension/README.md#versioning) owns the warning presentation and comparison policy.

LinkedIn Easy Apply uses a dedicated content entry in every matching frame, including same-origin application frames. It scans only an open dialog with form controls that names Easy Apply in its markup or appeared right after an Easy Apply launcher was activated, and it reads questions by accessible name rather than LinkedIn layout selectors. Its scanner settles lazy DOM changes, establishes a per-step baseline, and re-resolves on forward, backward, and repeated steps. Unsupported or newly conditional controls remain local and manual. Supported controls are written only when empty or after an explicit, live-value-checked replacement; native input/change events are dispatched for host validation, but the scanner never invokes host navigation, review, consent, profile, résumé, or submission actions. Form values are not placed in browser storage.

Capture saves are ordered per server Question. Older completions cannot remove newer queued edits, replace newer status, or refill a pending clear. Suggestion selection requires live control identity and write ownership; disabling, step/root changes, replacement, or ownership loss cancels delayed selection. Disabling cancels unsent saves, while issued requests may finish without updating stale UI. The [extension guide](../apps/extension/README.md#linkedin-easy-apply-form-fill) owns scanner detail.

Built-in adapters ship with the public extension. Optional local adapters are loaded from gitignored overlay directories and require no server changes. See [`docs/PRIVATE.md`](PRIVATE.md) for that boundary.

## Testing

Most server tests exercise routers, services, repositories, and real SQL together against in-memory SQLite. This catches query and constraint failures that mocked repositories would hide. Pure normalization and projection helpers also have focused unit tests.

Cross-language golden and contract fixtures keep the Python and TypeScript implementations of funnel, text, and time rules aligned. Extension adapters use small synthetic HTML fixtures. Sync scheduler behavior is tested locally, while driver-specific Turso integration tests are opt-in because they require a throwaway remote database.

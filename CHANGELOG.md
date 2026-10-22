# Changelog

All notable user-facing changes to Job Tracker are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

One version covers the whole product. The extension, the dashboard, and the server ship from the same commit and share the version in the repository root [`VERSION`](VERSION) file, so any user-visible change in any of them determines the next bump: patch for fixes, minor for a new capability, major for a breaking change. Each change set affecting shipped behavior bumps it before merging to `main`, so source users receive a meaningful version too. Artifact releases tag and package the existing version as `vX.Y.Z`. See the [development guide](docs/DEVELOPMENT.md#releases-and-versions) for the full rule.

## [Unreleased]

## [1.5.0] - 2026-10-22

### Added

- Shared server settings for description highlights, title rules, Easy Apply enablement, filtered-job Dim/Hide mode, and search-diagnostic capture, initialized with stored defaults and no import of old browser preferences.
- Dashboard Extension settings manages shared preferences with guarded drafts and revision checks; the menu separates Blocked companies, groups Extension settings with Theme, and places About last. Web keyword fields use chips, rule editing fills the dialog, and refresh reports progress and completion.
- The extension keeps quick switches and links to the configured dashboard for all highlight and rule management. Title rules support Contains, Starts with, Does not contain, alternative keywords, and Outline job card, Hide, Star, or Skip.
- Web Search diagnostics has its own collapsible section, a tooltip explanation, and the web-only Clear stored data action with confirmation and feedback.
- Dashboard Listing filters have their own group with “Listing:” beside an All / Unavailable / Closed dropdown; other filters omit “only” beneath Show only.

### Changed

- Search-diagnostic capture and temporary expiry are enforced by the server; shared settings participate in database backups and optional Turso synchronization.

## [1.4.1] - 2026-10-20

### Changed

- Popup Settings labels the form-fill switch **LinkedIn Easy Apply Forms** without helper text and renames **Discovery lists** to **Filtered jobs**, with **Dim / Hide** display options.

## [1.4.0] - 2026-10-20

### Added

- The extension compares its build with the running server on startup and every 30 seconds. Mismatches show an amber toolbar arrow and replace the popup Settings gear with an amber arrow; opening Settings reveals the version banner. Connection failures retain the red warning and take priority.

### Changed

- Server settings show the active address and connection status in one compact row. A pencil opens editing with icon controls to test and save, cancel, or restore the default address.

## [1.3.0] - 2026-10-20

### Added

- Extension Settings can test and save a server address without rebuilding. Saved addresses override the build default, request access only to the selected server, and clear server-specific runtime state when switching.
- Dashboard cards show one undated availability label, prioritizing Unavailable over Closed and hiding it only for a confirmed Open LinkedIn listing. Listing details retain notices and precise observation times in accessible tooltips; Open and Unknown stay quiet.

### Changed

- Source setup, CI, and Docker share mise tool pins and tasks; pnpm no longer requires Corepack. Deployment instructions move to a dedicated guide with optional srvr management.
- Version changes accompany shipped behavior before merging to `main`; artifact publication tags the existing version.

### Fixed

- Repeated closure captures preserve the first closure date until the listing reopens; subsequent confirmations update availability evidence separately.

- Duplicate suggestions use the highest description similarity across a candidate job's listings instead of only its earliest captured description.

## [1.2.1] - 2026-10-14

### Changed

- One version-pinned Compose file supports published-image and plain Docker source deployments, with explicit local-image selection and concise Docker instructions.

### Fixed

- Extension ZIP timestamps use UTC consistently across release hosts.

## [1.2.0] - 2026-10-13

### Added

- Listing application availability with original notices and observation times in capture details. LinkedIn’s gray “Not currently accepting applications” notice records **Unavailable** independently of funnel status; visible Apply controls record **Open**, including after availability changes in the same page.

- User-controlled LinkedIn Easy Apply form filling for supported text, numeric, select, and single-choice radio questions, backed by revision-checked Answers, exact Question Matches, remembered-value review, and a Form Fill dashboard. Existing values are preserved; unsupported controls, navigation, review, consent, profile changes, résumés, and submission remain manual.
- An installable dashboard PWA with an offline static shell. Reading and saving jobs or answers still requires the server; API responses and navigation query strings are not cached.
- About in the dashboard burger menu shows build identity, checks the current server build, reports failures, and offers explicit reload with unsaved-edit protection. New verified revisions produce one update notice.
- Offline CLI `build-info` reports installed version, revision, commit time, build time, and development state without Git, network access, or database startup.
- Dashboard filters for Easy Apply and blocked companies alongside attention, starred, and hidden jobs; persistent workspace/filter/order choices; and collapsible job-drawer sections that preserve drafts.
- Prospective, API-only application-workflow records for explicitly confirmed submissions, with typed workflow facts, measured human time, canonical artifact references, revision-checked idempotent upserts, and merge/relink/revert lifecycle integrity.
- **Open new jobs (N)** in LinkedIn job-alert, Viewed Jobs reminder, and profile-match recommendation emails in Gmail. It opens unaffected postings in background tabs, skips already-open listings, and closes only bulk-opened tabs after a detected closure is saved.
- `Alt+H` and `Alt+T` shortcuts on LinkedIn job-detail views to toggle hiding or move forward to **To apply**. The popup can seed search from the company in a LinkedIn job page title.
- LinkedIn listing location and workplace type from detail pages, discovery cards, the Applied tracker, and Gmail messages. The dashboard prefers the detail page's fuller location.
- External application destinations on LinkedIn listings and direct destination links on **To apply** dashboard cards.
- Repost suggestions for same-company jobs sharing an external application destination under a changed title, with field-level match evidence and closure-to-repost timing in the extension and dashboard.

### Changed

- Form Fill uses a question-centered review inbox, active-first saved Answers, searchable paginated Answer selection with private previews, before/after review, editable choice bindings, dismissed-item recovery, and save-and-next actions. Technical details and history sit behind disclosures; drafts are protected and review resets when they change.
- Jobs and Form Fill share responsive search, filter, and order controls. Form Fill scrolls beneath the application header, avoids duplicate headings, and presents general help on hover or focus.
- Relinking opens a full-drawer view with likely duplicates, description similarity, status, listing counts, dates, and match evidence.
- **To apply** discovery cards follow the extension's **Dimmed / Removed** preference without changing the hidden flag. Discovery cards offer one **Skip job** action; expanded job views retain **Hide** and offer **Skip job** before application.
- Public GHCR installation needs only the versioned Compose file and matching image/extension; no clone or local build is required. Documentation clarifies version pinning, Linux/amd64 support, named-volume persistence, offline backups, and source builds.
- Release artifacts carry deterministic build identity and generated bundled dependency notices; deployment health checks compare the served identity with the installed build.

### Fixed

- Easy Apply capture saves run in Question order across field handles and disable/re-enable. Older responses cannot remove newer edits, replace newer status, or refill a pending clear; failed saves remain retryable, and disabling cancels unsent work.
- Valid first dropdown selections remain intact until explicit replacement, including options whose value matches their label. Ambiguous unnamed selections and multiple-selection controls remain manual.
- Capture retries distinguish saved values from clears; reusing a key for a different operation is rejected without retaining historical values.
- Competing remembered values appear consistently in Question lists and details, expose explicit winner selection, and cannot be applied before the conflict is resolved.
- Delayed Easy Apply suggestion selection and rollback require the same enabled scanner, root, step, control identity, and write ownership. LinkedIn's redesigned Location field selects only an exact matching suggestion; the legacy Location field remains text-fillable, and only trusted selections are remembered.
- Capture collections, Question-embedded Captures, apply/conflict summaries, and stale-write summaries omit retained values. Explicit details, resolution actions, and candidate previews remain private review/fill responses.
- Private API routes retain `Cache-Control: no-store` on framework and security errors; workflow merge/relink conflicts carry the same policy even on listing routes.
- Equivalent new radio and dropdown Questions share single-choice identity across LinkedIn modal layouts. Existing Questions and their knowledge remain intact and can be explicitly matched to verified Answers.
- Easy Apply scanning supports redesigned modals, standalone job pages, alternate search routes, same-origin preload frames, and open shadow roots. Shared step-level validation keys no longer cause field-check failures; later-rendered Questions stabilize before observation.
- Numeric classification follows explicit input type or input mode; years-of-experience fields without that evidence remain text. Integer fields reject decimal values. Choice controls retain complete identity up to 512 options; larger lists stay manual without blocking other fields.
- LinkedIn accepts filled radio answers and remembers trusted picks across option redraws. Empty radio groups offer no unusable Revert action. Résumé, file, and top-choice controls are omitted; the preselected follow-company checkbox is actually cleared once.
- Easy Apply summary counts distinguish fills, matching values, remembered values, clears, kept values, and reverts; its expanded/collapsed preference survives reloads. Pending eligible captures flush before step changes.
- Form Fill review queues refresh while open and select the queue containing work. Choice labels replace internal IDs, automatic Answer keys follow their names, and changed drafts or revisions invalidate review.
- Saved Answer drafts retain their original revision across background refreshes, preventing stale edits from overwriting newer values. Question Match and remembered-value reviews require renewed approval when their Answer, Match, or Capture context changes and wait for coherent summaries and details.
- Automatic listing captures merge observed metadata without erasing missing facts, known application types, or stronger posting-date evidence. LinkedIn location parsing is independent of posting age and handles promotion badges and prefixed or combined age text.
- Non-text application URL metadata no longer breaks the jobs collection.
- Concurrent Gmail bulk-open actions avoid duplicate tabs and preserve ownership markers for automatic closure.
- LinkedIn's unavailable-page response closes only an already-recorded listing, preserving applied-or-later job status without a false view or an invalid-ID stub.
- Merged job IDs remain aliases for reads and ordinary writes, including chained merges. Merge/deletion flows maintain form-capture context; destructive deletion through an alias requires the canonical ID.
- Database request bursts no longer deadlock the API worker pool. Busy waits return retry guidance and bounded thread diagnostics; launchers limit request draining, local-first HTTP operations have a socket-progress timeout, and shutdown preserves active connection ownership and local data for retry.
- Dashboard entry documents revalidate after rebuilds so new sessions load the current bundle.
- Dashboard menu and drawer keyboard navigation skips hidden, collapsed, and disabled controls while preserving Escape and return focus.

## [1.1.0] - 2026-08-12

### Added

- Linux x86_64 release preparation for a smoke-tested uv-managed runtime bundle and installable wheel, a separately loadable matching extension ZIP, optional Linux/amd64 Docker Compose operation, Windows 11 WSL2 x86_64 runtime support, offline backup/restore and checkout adoption, redacted diagnostics, and isolated release-readiness rehearsals. No native Windows, packaged macOS, multiarch container, background service, or automatic-update support is claimed.
- Support for LinkedIn's newer job search page, reached from job-alert notifications. Its cards and detail pane now carry action bars, and jobs opened there are captured.
- A ⚠ alert on a LinkedIn job that is no longer accepting applications, from the same sign that already closes it automatically.

### Changed

- Posting age and apply clicks now show on every LinkedIn job, compactly (`17d`, `25 clicks`), in a quiet strip at the top of the job. Age is tinted green, amber or grey by how far past fresh it is; the click count is tinted only where LinkedIn caps it at 100+.
- Apply clicks are labelled as clicks: LinkedIn counts who opened the apply flow, not who applied.
- The job's flags are three separate boxes now — the facts strip, then keyword findings, then alerts — and ⚠ appears only on an alert. Keyword findings no longer raise a warning: they are what you asked to be shown.

### Fixed

- A salary range reported as three pay signals: “€4500-€6000 euro” counted as three figures, not one.
- The stale-posting flag ignored the unit: it fired on a job posted 16 hours ago and stayed silent on one posted 3 weeks ago.
- Missing action bar on the classic LinkedIn search page, after LinkedIn renamed the detail pane's top card.
- Wrong posting age on the newer search page: it was read from the first job in the results, not the open one.

## [1.0.0] - 2026-07-29

Initial public release.

### Added

- Chrome extension that captures LinkedIn listings while you browse and recognizes LinkedIn job emails in Gmail, with integrated triage across supported pages and the popup: star, hide, block a company, add notes, and move through the application funnel.
- Kanban dashboard for applications, with history, documents, custom fields, duplicate hints, attention indicators and ordering, starring, filtering, description copying, and reopening terminal jobs.
- Keyboard-first extension popup for search, fast add, detail, and settings.
- Configurable keyword signals backed by `chrome.storage`, safe by default: persistent automatic actions are off until explicitly enabled.
- Opt-in full-context search diagnostics, off by default, with temporary or persistent capture, a clearable log, and retention capped at 1,000 rows.
- Local-first FastAPI server over SQLite, with optional Turso synchronization in embedded-replica or local-first mode.
- Automatic job closure derived from listing availability: it considers every linked listing, survives listing reopening, relinking, and merging, and never overrides a manual closure.
- One-command `scripts/setup.sh`, `scripts/dev.sh`, and `scripts/check.sh`.
- Private per-user adapters kept in a sibling private repository and synced into a gitignored local overlay by `scripts/sync-private.sh`.
- Documentation set: user README, [`PRIVACY.md`](PRIVACY.md), [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md), and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- CI secret scanning, dependency vulnerability checks, SHA-pinned actions, and an automated assertion that a public build's manifest requests only the configured API origin plus the LinkedIn and Gmail host patterns.

### Security

- Verified per-connection foreign-key enforcement, an orphan pre-flight where supported by the database driver, atomic migrations, and collision-safe listing identifiers.
- Localhost threat model with a CORS allowlist, a DNS-rebinding guard, and an optional API key; see [`SECURITY.md`](SECURITY.md).

[1.2.0]: https://github.com/Muatasim-Aswad/job-tracker/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Muatasim-Aswad/job-tracker/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Muatasim-Aswad/job-tracker/releases/tag/v1.0.0
[1.2.1]: https://github.com/Muatasim-Aswad/job-tracker/compare/v1.2.0...v1.2.1
[1.3.0]: https://github.com/Muatasim-Aswad/job-tracker/compare/v1.2.1...v1.3.0
[1.4.0]: https://github.com/Muatasim-Aswad/job-tracker/compare/v1.3.0...v1.4.0
[1.4.1]: https://github.com/Muatasim-Aswad/job-tracker/compare/v1.4.0...v1.4.1

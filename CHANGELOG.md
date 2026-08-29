# Changelog

All notable user-facing changes to Job Tracker are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

One version covers the whole product. The extension, the dashboard, and the server ship from the same commit and share the version in the repository root [`VERSION`](VERSION) file, so any user-visible change in any of them determines the next bump: patch for fixes, minor for a new capability, major for a breaking change. Individual commits do not bump it — the bump happens once while preparing a release, and the matching whole-repository commit is tagged `vX.Y.Z`. See the [development guide](docs/DEVELOPMENT.md#releases-and-versions) for the full rule.

## [Unreleased]

### Added

- LinkedIn job-alert, Viewed Jobs reminder, and profile-match recommendation emails in Gmail now provide an **Open new jobs (N)** action for opening every unaffected posting in background tabs while skipping already-open listings; bulk-opened tabs close automatically after a detected listing closure is saved.
- `Alt+H` and `Alt+T` shortcuts on LinkedIn job-detail views to hide or unhide the current job or move it forward to **To apply**.
- User-controlled LinkedIn Easy Apply form filling for supported text, numeric, select, and Yes/No questions, backed by revision-checked Answers, exact Question Matches, remembered-value review, and a Form Fill dashboard. Existing values are preserved by default; unsupported controls, application navigation, review, consent, profile changes, résumés, and submission remain manual.
- LinkedIn listings that apply on a company website now retain the external application destination as a clickable listing field.

### Changed

- Jobs selected as **To apply** now follow the extension's existing **Dimmed / Removed** treatment on discovery lists without changing their independent hidden flag.

### Fixed

- Merged job IDs now remain valid aliases of the surviving job for reads and ordinary writes, including chained merges. Merge and deletion flows also preserve or clear form-capture context explicitly instead of failing a foreign-key check; destructive deletion through an alias is refused until the canonical ID is used.
- Easy Apply review queues now refresh while the dashboard remains open, omit Questions already handled by an active Match, and open the queue that actually contains work. Later-rendered supported Questions stabilize into normal observation, pending answers flush before a step change, and transient capture failures can be retried. Résumé selectors and CV upload inputs no longer create manual-status rows. The dashboard entry document also revalidates after a rebuild instead of silently retaining an obsolete bundle.
- Long legitimate Easy Apply dropdowns such as phone-country-code lists now retain their complete choice identity and can remember the selected value. Lists above the bounded 512-option vocabulary stay manual without preventing the remaining questions on the step from being checked normally.
- The Easy Apply summary now remembers its expanded or collapsed state in device-local browser storage. LinkedIn follow-company and top-choice prompts are ignored entirely instead of appearing as manual application Questions.
- LinkedIn years-of-experience text inputs marked numeric by the form now resolve as integer questions when no decimal signal is present, while decimal values remain blocked from integer-only fields.
- Easy Apply form filling now keeps its scanner active when a job is opened through standalone job pages or alternate LinkedIn search routes, including application preload frames whose field handles do not repeat the job ID and LinkedIn's open interop Shadow DOM.

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

[Unreleased]: https://github.com/Muatasim-Aswad/job-tracker/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Muatasim-Aswad/job-tracker/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Muatasim-Aswad/job-tracker/releases/tag/v1.0.0

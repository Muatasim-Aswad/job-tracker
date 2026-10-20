# Job Tracker

**Track the opportunity, not the website where you found it.**

A job search rarely stays in one place. The same opportunity can appear in a search, return under a new URL, arrive by email, and become an application whose history is scattered across bookmarks, notes, and inbox messages. Spreadsheets and generic project boards can store those fragments, but leave you to connect them.

Job Tracker is a self-hosted workspace built around one lasting record per job. Listings, status changes, notes, decisions, and materials stay attached to that opportunity. A browser extension captures details and reliable lifecycle updates, while a local Kanban dashboard keeps the process visible and under your control.

Job Tracker gives AI agents structured context about your opportunities, application history, notes, and materials to support job-search decisions and application preparation. Agents can discover the API through the running server's OpenAPI schema at `/openapi.json`.

![Job Tracker overview](docs/images/social-preview.png)

## Features

- **One opportunity, one history.** Keep multiple listing URLs, status changes, notes, events, decisions, and materials connected to the same job.
- **Capture what can be captured.** Record supported listing details and lifecycle updates while you browse instead of retyping them later.
- **Reuse answers without giving up control.** Fill supported LinkedIn Easy Apply questions from exact, reviewed Matches; preserve existing values and keep unsupported controls, navigation, and submission manual.
- **Catch reposts without losing control.** Review suggested matches, confirm genuine reposts, and preserve the history already gathered; merging is never automatic.
- **Decide with context.** Surface experience requirements, languages, pay, seniority, applicant activity, listing age, custom terms, and company history with the evidence around each signal.
- **Act where you encounter the job.** Use in-page controls or the context-seeded popup to search, update status, backdate events, comment, add notes, or create a job manually.
- **Follow through.** Use a correctable timeline, attention rules, material records, custom fields, and a Kanban dashboard to keep applications moving.
- **Stay local and extensible.** Use SQLite by default, opt into Turso synchronization, and add new built-in or private integrations through the adapter model.

[Explore all features and workflows](docs/FEATURES.md), including automation boundaries, repost handling, decision signals, and follow-up tools.

## What's built in today

| Surface | Support |
| --- | --- |
| LinkedIn jobs | Listing capture and in-page triage on search cards and job details; user-controlled filling for supported Easy Apply questions |
| LinkedIn job emails in Gmail | Recognizes supported messages and adds tracker actions |
| Sites without a built-in integration | Add a job manually from the popup |

LinkedIn and supported LinkedIn job emails in Gmail are the only built-in integrations today. The integration layer is designed to support additional built-in or private/local adapters without changing the core job model.

These unofficial integrations depend on third-party page layouts, may require adapter updates when those layouts change, and remain subject to each platform’s terms.

## See it in action

### Dashboard

Keep every opportunity and its current stage visible from the local Kanban dashboard.

![Job Tracker dashboard](docs/images/dashboard.png)

### Browser extension

Capture job details, review decision signals, and update tracked opportunities without leaving the listing.

![Job Tracker browser extension](docs/images/extension.png)

## Data and privacy

Job Tracker is a single-user, self-hosted application designed for localhost use. By default, records—including verified form Answers and remembered values awaiting review—stay in a local SQLite file on your own machine; Turso synchronization is optional. Database backups and optional Turso synchronization include those retained private values. The extension talks only to the configured Job Tracker server, uses no third-party analytics, and keeps optional search diagnostics off by default.

On Gmail, the extension recognizes supported LinkedIn job messages in the browser and sends only the structured job and action data needed by the tracker; it does not send or store the email body as a job description. See [Privacy](PRIVACY.md) for captured fields, permissions, retention, and deletion, and [Security](SECURITY.md) for the supported localhost threat model.

## Installation

Run from [source](docs/DEPLOYMENT.md#install-from-source), use [Docker Compose](docs/DEPLOYMENT.md#run-with-docker-compose), or download a [Linux/WSL2 release](docs/DEPLOYMENT.md#install-a-linux-x86_64-release). Open <http://localhost:3456> and [load the matching extension](docs/DEPLOYMENT.md#load-the-extension).

[Deployment](docs/DEPLOYMENT.md) covers requirements, setup, updates, backups, and optional [srvr home-server management](docs/DEPLOYMENT.md#optional-manage-a-home-server-with-srvr).

## Project documentation

- Architecture and component boundaries: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- API, configuration, database modes, and maintenance: [`apps/api/README.md`](apps/api/README.md)
- Dashboard development: [`apps/web/README.md`](apps/web/README.md)
- Extension build, keyboard controls, and adapter guide: [`apps/extension/README.md`](apps/extension/README.md)
- Private/local adapter overlay: [`docs/PRIVATE.md`](docs/PRIVATE.md)
- Developer policy — quality gate, generated files, comment and Markdown style, migrations, and versioning: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- Contributions and support: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

Licensed under the [MIT License](LICENSE).

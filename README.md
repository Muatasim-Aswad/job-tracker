# Job Tracker

**Track the opportunity, not the website where you found it.**

A job search rarely stays in one place. The same opportunity can appear in a search, return under a new URL, arrive by email, and become an application whose history is scattered across bookmarks, notes, and inbox messages. Spreadsheets and generic project boards can store those fragments, but leave you to connect them.

Job Tracker is a self-hosted workspace built around one lasting record per job. Listings, status changes, notes, decisions, and materials stay attached to that opportunity. A browser extension captures details and reliable lifecycle updates, while a local Kanban dashboard keeps the process visible and under your control.

![Job Tracker overview](docs/images/social-preview.png)

## Features

- **One opportunity, one history.** Keep multiple listing URLs, status changes, notes, events, decisions, and materials connected to the same job.
- **Capture what can be captured.** Record supported listing details and lifecycle updates while you browse instead of retyping them later.
- **Catch reposts without losing control.** Review suggested matches, confirm genuine reposts, and preserve the history already gathered; merging is never automatic.
- **Decide with context.** Surface experience requirements, languages, pay, seniority, applicant activity, listing age, custom terms, and company history with the evidence around each signal.
- **Act where you encounter the job.** Use in-page controls or the context-seeded popup to search, update status, backdate events, comment, add notes, or create a job manually.
- **Follow through.** Use a correctable timeline, attention rules, material records, custom fields, and a Kanban dashboard to keep applications moving.
- **Stay local and extensible.** Use SQLite by default, opt into Turso synchronization, and add new built-in or private integrations through the adapter model.

[Explore all features and workflows](docs/FEATURES.md), including automation boundaries, repost handling, decision signals, and follow-up tools.

## What's built in today

| Surface | Support |
| --- | --- |
| LinkedIn jobs | Listing capture and in-page triage on search cards and job details |
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

Job Tracker is a single-user, self-hosted application designed for localhost use. By default, records stay in the local SQLite file `apps/api/jobtracker.db`; Turso synchronization is optional. The extension talks only to the configured Job Tracker server, uses no third-party analytics, and keeps optional search diagnostics off by default.

On Gmail, the extension recognizes supported LinkedIn job messages in the browser and sends only the structured job and action data needed by the tracker; it does not send or store the email body as a job description. See [Privacy](PRIVACY.md) for captured fields, permissions, retention, and deletion, and [Security](SECURITY.md) for the supported localhost threat model.

## Requirements

- Linux or macOS (the setup and run scripts use Bash). Windows is not supported. WSL2 may work but is currently untested; native Windows/Git Bash is unsupported.
- [Node.js](https://nodejs.org/en/download) **as pinned in `.node-version`** (currently 22.22.2)
- Corepack with [pnpm](https://pnpm.io/installation#using-corepack) (the repository pins the pnpm version)
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (downloads the Python version required by the project when necessary)
- Chrome, Edge, Brave, or another Chromium browser that can load unpacked Manifest V3 extensions

## Install

```bash
git clone https://github.com/Muatasim-Aswad/job-tracker.git
cd job-tracker
bash scripts/setup.sh
```

This validates prerequisites, installs JavaScript and Python dependencies from the lockfiles, and builds the dashboard and extension. It's safe to rerun and never creates or overwrites `apps/api/.env` or `apps/extension/.env`.

Start the usable local application with:

```bash
bash scripts/start.sh
```

Open <http://localhost:3456>. The server creates `apps/api/jobtracker.db` on first start.

The same checkout also exposes the initial CLI. From the repository root, inspect it without starting the server:

```bash
uv run --directory apps/api python -m app.cli --profile source --app-dir "$PWD" paths
uv run --directory apps/api python -m app.cli --profile source --app-dir "$PWD" status
uv run --directory apps/api python -m app.cli --profile source --app-dir "$PWD" version
```

`status` is read-only and distinguishes a stopped server from a healthy server and a lock owner whose loopback health check is failing. The complete source and packaged path/lifecycle contract is in [Distribution and lifecycle](docs/DISTRIBUTION.md).

### Load the extension

After setup:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the absolute `apps/extension/dist` directory printed by setup.

The extension defaults to <http://localhost:3456>. To use another address, follow [Configure the server address](apps/extension/README.md#configure-the-server-address) and rebuild the extension.

## Update

Back up first. If the checkout has local changes, review the upstream changes before updating. Then stop the server and run:

```bash
git pull --ff-only
bash scripts/setup.sh
```

Reload the unpacked extension from `chrome://extensions` after rebuilding. Schema updates run when the server starts.

## Backup, restore, and remove

The API README has the tested [SQLite/Turso backup and restore procedure](apps/api/README.md#backup--restore). Back up before upgrades and keep the SQL dump outside the repository.

To uninstall:

1. Stop the server and remove the unpacked extension in `chrome://extensions`.
2. Delete the configured `DB_PATH` (default `apps/api/jobtracker.db`) and, when present, its `.sync` sibling.
3. If you configured Turso, delete the remote database separately.
4. Delete the checkout and any backups once you no longer need them.

Removing the extension clears its browser preferences but erases no server records.

## Project documentation

- Architecture and component boundaries: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- API, configuration, database modes, and maintenance: [`apps/api/README.md`](apps/api/README.md)
- Dashboard development: [`apps/web/README.md`](apps/web/README.md)
- Extension build, keyboard controls, and adapter guide: [`apps/extension/README.md`](apps/extension/README.md)
- Private/local adapter overlay: [`docs/PRIVATE.md`](docs/PRIVATE.md)
- Developer policy — quality gate, generated files, comment and Markdown style, migrations, and versioning: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- Contributions and support: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

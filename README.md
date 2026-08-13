# Job Tracker

**Track the opportunity, not the website where you found it.**

A job search rarely stays in one place. The same opportunity can appear in a search, return under a new URL, arrive by email, and become an application whose history is scattered across bookmarks, notes, and inbox messages. Spreadsheets and generic project boards can store those fragments, but leave you to connect them.

Job Tracker is a self-hosted workspace built around one lasting record per job. Listings, status changes, notes, decisions, and materials stay attached to that opportunity. A browser extension captures details and reliable lifecycle updates, while a local Kanban dashboard keeps the process visible and under your control.

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

## Requirements

Every path needs a Chromium browser — Chrome, Edge, or Brave — that can load an unpacked extension. The rest depends on which installation path you pick:

| Path | Get the files | Platforms | Host tools |
| --- | --- | --- | --- |
| [Source checkout](#install-from-source) | Clone the repository | Linux, macOS | Git, [Node.js](https://nodejs.org/en/download) as pinned in `.node-version`, [pnpm through Corepack](https://pnpm.io/installation#using-corepack), [uv](https://docs.astral.sh/uv/getting-started/installation/) |
| [Docker Compose](#run-with-docker-compose) | Clone the repository or download the source archive; pull the [published image](https://github.com/Muatasim-Aswad/job-tracker/pkgs/container/job-tracker) | Linux/amd64 | Docker Engine with Compose |
| [Linux release](#install-a-linux-x86_64-release) | Download the [latest release](https://github.com/Muatasim-Aswad/job-tracker/releases/latest) | Linux x86_64, including Windows 11 [WSL2](docs/WSL2.md) x86_64 | [uv](https://docs.astral.sh/uv/getting-started/installation/) |

Neither the runtime bundle nor the wheel is a native executable, and neither contains Python: `uv` provisions the pinned Python runtime and dependencies. Native Windows and Git Bash are unsupported, and there is no packaged macOS artifact — on macOS, install from source.

## Install from source

```bash
git clone https://github.com/Muatasim-Aswad/job-tracker.git
cd job-tracker
bash scripts/setup.sh
bash scripts/start.sh
```

Setup installs the locked dependencies and builds the dashboard and extension. It prints the absolute extension path needed below. The [development guide](docs/DEVELOPMENT.md) covers the contributor launcher, quality gate, and per-component commands.

## Run with Docker Compose

From the cloned repository or extracted source archive:

```bash
docker compose pull
docker compose up -d
```

This runs the [current stable image](https://github.com/Muatasim-Aswad/job-tracker/pkgs/container/job-tracker) through its `latest` tag. Use `docker compose up -d --build` instead to build the checked-out source. The container serves the API and dashboard; use the matching extension ZIP from the [latest release](https://github.com/Muatasim-Aswad/job-tracker/releases/latest) in the shared step below. [Containers](docs/CONTAINERS.md) covers configuration, volumes, backups, and updates.

## Install a Linux x86_64 release

Download the runtime archive, extension ZIP, wheel, and `SHA256SUMS` from the [latest release](https://github.com/Muatasim-Aswad/job-tracker/releases/latest) into a single directory, then verify them:

```bash
sha256sum -c SHA256SUMS
```

Install the runtime bundle:

```bash
mkdir -p job-tracker-app
tar -xzf job-tracker-<version>-linux-x86_64.tar.gz -C job-tracker-app
job-tracker-app/job-tracker start
```

Or install the wheel instead:

```bash
uv tool install job_tracker-<version>-py3-none-any.whl
job-tracker start
```

On Windows 11, run this path inside a WSL2 distribution and follow [WSL2](docs/WSL2.md) for its requirements.

## Load the extension

After starting the server with any method above, open <http://localhost:3456>. Then load the matching extension unpacked:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `apps/extension/dist` path printed by source setup, or the directory extracted from `job-tracker-extension-<version>.zip` for a release or container installation.

Reload the extension after updating the server. It uses the local address above by default; another address means [reconfiguring](apps/extension/README.md#configure-the-server-address) and rebuilding it from source.

## Update, back up, and uninstall

Stop the server first. Each path then has one authoritative procedure:

- **Source checkout:** run `git pull --ff-only`, `bash scripts/setup.sh`, and reload the extension. This path keeps its database and configuration inside the checkout, so removing the checkout removes them too.
- **Runtime bundle or wheel:** [Distribution and lifecycle](docs/DISTRIBUTION.md#upgrade-downgrade-and-replacement) for upgrading, removal, and purging; [Packaged CLI](docs/CLI.md) for the `backup`, `restore`, and diagnostic commands.
- **Docker Compose:** [Containers](docs/CONTAINERS.md).

The [API guide](apps/api/README.md#backup--restore) holds the tested backup and restore procedure for every local and Turso mode.

## Project documentation

- Architecture and component boundaries: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- API, configuration, database modes, and maintenance: [`apps/api/README.md`](apps/api/README.md)
- Dashboard development: [`apps/web/README.md`](apps/web/README.md)
- Extension build, keyboard controls, and adapter guide: [`apps/extension/README.md`](apps/extension/README.md)
- Private/local adapter overlay: [`docs/PRIVATE.md`](docs/PRIVATE.md)
- Developer policy — quality gate, generated files, comment and Markdown style, migrations, and versioning: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- Contributions and support: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

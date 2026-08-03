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

Choose one server installation path:

- **Source checkout on Linux or macOS:** Git, [Node.js](https://nodejs.org/en/download) as pinned in `.node-version` (currently 22.22.2), Corepack with the repository-pinned [pnpm](https://pnpm.io/installation#using-corepack), and [uv](https://docs.astral.sh/uv/getting-started/installation/).
- **Runtime bundle or wheel on Linux x86_64:** `uv`. The runtime bundle is not a native executable; `uv` provisions its locked Python environment. The wheel does not contain Python and requires platform-compatible dependency wheels. These packaged paths have been smoke-tested only on Linux x86_64.
- **Optional container on Linux/amd64:** Docker Engine with Docker Compose. This path does not require Node, pnpm, `uv`, or Python on the host.

The browser extension requires Chrome, Edge, Brave, or another Chromium browser that can load an unpacked Manifest V3 extension. macOS is a supported source-checkout path, not a supported packaged target. WSL2 x86_64 remains a [candidate and unsupported](docs/WSL2.md); native Windows and Git Bash are unsupported.

## Install from source

```bash
git clone https://github.com/Muatasim-Aswad/job-tracker.git
cd job-tracker
bash scripts/setup.sh
```

This validates prerequisites, installs JavaScript and Python dependencies from the lockfiles, and builds the dashboard and extension. It is safe to rerun and never creates or overwrites `apps/api/.env` or `apps/extension/.env`.

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

### Load the source extension

After setup:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the absolute `apps/extension/dist` directory printed by setup.

The extension defaults to <http://localhost:3456>. To use another address, follow [Configure the server address](apps/extension/README.md#configure-the-server-address) and rebuild the extension.

## Install a packaged server on Linux x86_64

Release preparation produces a **uv-managed runtime bundle** and a **Python wheel**. Both carry the API and prebuilt dashboard, and neither is a native executable or contains Python. The separate extension ZIP carries the matching browser extension.

From a prepared checkout, build and verify the four-file release inventory:

```bash
bash scripts/build-release.sh
bash scripts/check-release-contents.sh dist/release
```

The generated `dist/release/` directory contains the runtime tarball, extension ZIP, wheel, and `SHA256SUMS`. Keep those files together and verify them before installation:

```bash
(cd dist/release && sha256sum -c SHA256SUMS)
```

For the runtime bundle, extract into a replaceable application directory and run its top-level launcher:

```bash
mkdir -p /path/to/job-tracker-release
tar -xzf dist/release/job-tracker-<version>-linux-x86_64.tar.gz -C /path/to/job-tracker-release
/path/to/job-tracker-release/job-tracker start
```

For the wheel, install it as an isolated tool and run the same foreground CLI:

```bash
uv tool install dist/release/job_tracker-<version>-py3-none-any.whl
job-tracker start
```

Both packaged paths use persistent XDG data, configuration, and state roots outside replaceable application files. See [Packaged CLI](docs/CLI.md) for commands and [Distribution and lifecycle](docs/DISTRIBUTION.md) for the complete path, upgrade, backup, and removal contract.

### Load the release extension

Extract `job-tracker-extension-<version>.zip` into a versioned directory, then open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose that extracted directory. Keep the extension version matched to the server version and reload it after an upgrade. The ZIP is an unpacked-extension artifact, not a Chrome Web Store installation.

### Optional Docker Compose

The released source tree also provides an optional Linux/amd64 Compose path. It publishes only to `127.0.0.1:3456`, runs as a non-root user, and keeps data, configuration, state, and backups in separate named volumes:

```bash
docker compose up -d --build
```

Follow [Containers](docs/CONTAINERS.md) for stopped-server backups, updates, verification, and destructive-volume warnings.

## Update

Back up the stopped server first. For a source checkout, review local and upstream changes, then run:

```bash
git pull --ff-only
bash scripts/setup.sh
```

Reload the unpacked extension from `chrome://extensions` after rebuilding. Schema updates run when the server starts.

For a runtime bundle, verify the new checksum, extract into a new sibling release directory, switch the `current` link only after extraction completes, start it, and verify the product version, health, dashboard, and extension before removing the retained prior release. For a wheel, install the verified replacement with `uv tool install --force <wheel>` and run the same checks. After a schema or data migration, switching older application files back is not a supported database downgrade; use the offline recovery procedure. For Compose, create an external copy of a stopped-server backup before rebuilding or replacing the image. The authoritative sequence and rollback boundary are in [Distribution and lifecycle](docs/DISTRIBUTION.md#upgrade-downgrade-and-replacement).

## Backup, restore, and uninstall

Stop the server before maintenance. The API README has the tested [SQLite/Turso backup, restore, and checkout-adoption procedure](apps/api/README.md#backup--restore). Back up before upgrades and keep the validated SQLite snapshot outside the repository; synced restores use a separate local recovery target and never reseed the Turso primary.

Ordinary uninstall removes application files but preserves data unless you explicitly purge it:

- **Source checkout:** stop the server, export any database you want to keep outside the repository, remove the extension, and then remove the checkout. The legacy source database and configuration live inside that checkout, so deleting it also deletes those local files.
- **Runtime bundle:** remove the user launcher, active pointer, and selected release directories. Leave the XDG data, configuration, state, and backup roots in place for reinstall or recovery.
- **Wheel:** run `uv tool uninstall job-tracker`. This removes the tool environment and launcher, not packaged data, configuration, state, or backups.
- **Compose:** run `docker compose down` to remove the container while preserving named volumes. Never use `docker compose down -v` as ordinary uninstall because it deletes the volumes.

Removing the extension clears its browser preferences but erases no server records. Purging persistent local roots is a separate, explicit action after confirming the server is stopped and backups are safe. No uninstall or purge command deletes or modifies a Turso primary; remote deletion is a separate provider operation performed directly by the user.

## Project documentation

- Architecture and component boundaries: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- API, configuration, database modes, and maintenance: [`apps/api/README.md`](apps/api/README.md)
- Dashboard development: [`apps/web/README.md`](apps/web/README.md)
- Extension build, keyboard controls, and adapter guide: [`apps/extension/README.md`](apps/extension/README.md)
- Private/local adapter overlay: [`docs/PRIVATE.md`](docs/PRIVATE.md)
- Developer policy — quality gate, generated files, comment and Markdown style, migrations, and versioning: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- Contributions and support: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

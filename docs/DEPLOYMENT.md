# Deployment

Every installation needs Chromium (Chrome, Edge, or Brave) for the unpacked extension.

| Method | Platforms | Host tools |
| --- | --- | --- |
| [Source](#install-from-source) | Linux, macOS | Git, [mise](https://mise.jdx.dev/getting-started.html) |
| [Docker Compose](#run-with-docker-compose) | Linux/amd64 | Docker Engine with Compose, `curl` |
| [Release](#install-a-linux-x86_64-release) | Linux x86_64, Windows 11 [WSL2](WSL2.md) x86_64 | [uv](https://docs.astral.sh/uv/getting-started/installation/) |

Native Windows and Git Bash are unsupported; macOS uses source. Runtime bundles and wheels contain no Python; uv resolves a compatible runtime and locked dependencies.

## Run with Docker Compose

Requires Docker with Compose. Download the release's Compose file and start the matching published image; no Git, Node, Python, or local build is needed:

```bash
mkdir -p job-tracker && cd job-tracker
curl -fsSLO https://raw.githubusercontent.com/Muatasim-Aswad/job-tracker/v1.2.1/compose.yaml
docker compose up -d --no-build
```

Open <http://localhost:3456>. Download `job-tracker-extension-1.2.1.zip` from the [matching release](https://github.com/Muatasim-Aswad/job-tracker/releases/tag/v1.2.1) and follow [Load the extension](#load-the-extension). Linux/amd64 only; no registry login is required. Compose binds to loopback and creates persistent named volumes. [Containers](CONTAINERS.md) covers configuration, backup, upgrades and removal.

### Build the Docker image from source

Requires Git and Docker with Compose; Docker installs all build tools internally:

```bash
git clone https://github.com/Muatasim-Aswad/job-tracker.git
cd job-tracker
export JOB_TRACKER_IMAGE=job-tracker:local
docker compose build
docker compose up -d --no-build --pull never
```

[`compose.yaml`](../compose.yaml) owns the build context, platform, and arguments. The exported image selection also applies to subsequent commands; save it in an ignored mode `0600` `.env` beside `compose.yaml` to retain it across shells. Ordinary source builds need no release metadata and report revision `dev`.

## Install from source

```bash
git clone https://github.com/Muatasim-Aswad/job-tracker.git
cd job-tracker
mise trust
mise install
mise run setup
mise run start
```

mise pins Node, Python, pnpm, and uv from [`mise.toml`](../mise.toml) and its generated locks. Setup installs locked dependencies, builds both clients, and prints the extension directory. [Development](DEVELOPMENT.md) covers contributor commands. Manual tool installations can run the same `scripts/setup.sh` and `scripts/start.sh` with those tools on `PATH`.

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

On Windows 11, run this path inside a WSL2 distribution and follow [WSL2](WSL2.md) for its requirements.

## Load the extension

After starting the server with any method above, open <http://localhost:3456>. Then load the matching extension unpacked:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `apps/extension/dist` path printed by source setup, or the directory extracted from `job-tracker-extension-<version>.zip` for a release or container installation.

Reload the extension after updating the server. It defaults to the build’s `VITE_SERVER_URL`, or `http://localhost:3456`. In extension **Settings**, use the pencil beside **Server** to change the address, then the checkmark to grant access, test, and save. No rebuild is needed.

## Optional: manage a home server with srvr

[srvr](https://github.com/Muatasim-Aswad/srvr) manages Compose updates, rollback, health checks, and backups. Follow its [host setup](https://github.com/Muatasim-Aswad/srvr/blob/main/docs/bootstrap.md) first; use a version supporting `--data-volume`.

For a source deployment, complete [Build the Docker image from source](#build-the-docker-image-from-source) on the server’s clean `main` checkout. Create an external mode `0600` env file at `~/.config/job-tracker/compose.env` (replace the hostname):

```dotenv
JOB_TRACKER_IMAGE=job-tracker:local
TRUSTED_HOSTS=["localhost","127.0.0.1","job-tracker.example.ts.net"]
```

Register the existing deployment (replace the checkout path and private URL):

```bash
srvr add job-tracker --kind git --workdir "$HOME/services/job-tracker" \
  --branch main --project job-tracker \
  --env-file "$HOME/.config/job-tracker/compose.env" \
  --data-volume job-tracker_job-tracker-data \
  --data-volume job-tracker_job-tracker-config \
  --data-volume job-tracker_job-tracker-state \
  --data-volume job-tracker_job-tracker-backups \
  --health http://127.0.0.1:3456/health \
  --version-url http://127.0.0.1:3456/version.json \
  --url https://job-tracker.example.ts.net -y
```

The four names assume the default Compose project; register resolved volume names if you renamed it. `srvr update job-tracker` then manages source builds and stopped-volume backups. These backups cover local volumes, not a Turso primary; see [database backup](../apps/api/README.md#backup--restore).

Keep the loopback binding. Publish through private HTTPS using srvr’s [Tailscale setup](https://github.com/Muatasim-Aswad/srvr/blob/main/docs/bootstrap.md), then set that HTTPS URL in extension **Settings**. See [Security](../SECURITY.md) for the access boundary; the URL option records an address and does not configure HTTPS itself.

## Update, back up, and uninstall

Stop the server first. Each path then has one authoritative procedure:

- **Source checkout:** run `git pull --ff-only`, `mise install`, `mise run setup`, and reload the extension. This path keeps its database and configuration inside the checkout, so removing the checkout removes them too.
- **Runtime bundle or wheel:** [Distribution and lifecycle](DISTRIBUTION.md#upgrade-downgrade-and-replacement) for upgrading, removal, and purging; [Packaged CLI](CLI.md) for the `backup`, `restore`, and diagnostic commands.
- **Docker Compose:** [Containers](CONTAINERS.md).

The [API guide](../apps/api/README.md#backup--restore) holds the tested backup and restore procedure for every local and Turso mode.

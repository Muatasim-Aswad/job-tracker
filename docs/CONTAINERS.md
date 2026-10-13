# Containers

Docker Compose is an optional Linux/amd64 deployment path. It runs the public Job Tracker API and prebuilt dashboard in one non-root container; the extension remains the separate versioned ZIP described in [Distribution and lifecycle](DISTRIBUTION.md). This image is not multi-architecture: Linux arm64 remains unsupported until the locked database dependency and an arm64 smoke test are validated.

## Start and stop

Follow the root README's [clone-free installation](../README.md#run-with-docker-compose) to download the canonical versioned `compose.yaml`, pull the public GHCR image, and start with `--no-build`. Keep that directory for later commands; it owns the Compose project and its volumes. Use the matching server/image/extension version. No registry login is required to pull the public image.

In that same shell and directory, inspect or restart the service with:

```bash
docker compose ps
docker compose up -d --no-build
```

`JOB_TRACKER_IMAGE=ghcr.io/muatasim-aswad/job-tracker:v<version>` pins a release. Export it again in a new shell before any command that creates a container; Compose otherwise defaults to the current stable `latest` image. Do not alternate pinned and `latest` deployments inadvertently. Source builds require a checkout containing the Dockerfile and use `docker compose up -d --build` instead.

The default publication is deliberately loopback-only: `127.0.0.1:3456:3456`. Open <http://127.0.0.1:3456>; do not change it to a public interface. The service runs as UID/GID `10001`, has no added Linux capabilities, and uses its image only for replaceable application files.

Compose creates separate named volumes for `/data`, `/config`, `/state`, and `/backups`. They hold the database family, optional configuration, server lock/runtime state, and backups respectively. Stop/start and container replacement preserve them; see [Update and removal](#update-and-removal) for uninstall and purge.

Stop the service without deleting any volumes:

```bash
docker compose stop
```

## Runtime configuration and credentials

The image contains no configuration file, `.env`, database, credentials, private overlay, test, or personal fixture. It carries the repository license at `/app/LICENSE`. Local SQLite needs no configuration. For optional Turso settings, supply `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` only at container runtime through your secret-management mechanism; never add them to the Dockerfile, image, or repository. The configuration volume is intentionally persistent and excluded from image layers.

The server listens on all container interfaces solely so Docker can forward the loopback host binding. It is not a supported public service. Keep the published host address at `127.0.0.1` and use the normal API-key and configuration guidance in the API README when applicable.

## Offline backup

Backup requires the server lock to be free. The checkout helper performs the required stopped-server sequence: it stops only this Compose service, runs the packaged `job-tracker backup` CLI once without publishing a port, writes into the explicitly mounted `/backups` volume, and starts the service again.

For a Compose-only installation, run the maintenance CLI directly from the installation directory, with the same exported image version:

```bash
docker compose stop job-tracker
docker compose run --rm --no-deps job-tracker job-tracker backup /backups/before-upgrade.sqlite
docker compose up -d --no-build job-tracker
```

Restart the service even if backup fails, and resolve the failure before upgrading. A source checkout can use the helper instead:

```bash
bash scripts/container-backup.sh
```

Pass a simple `.sqlite` filename to choose the backup name:

```bash
bash scripts/container-backup.sh before-upgrade.sqlite
```

The result is in the `job-tracker-backups` volume. Keep an additional copy outside Docker before upgrades or destructive volume operations. The helper never runs `down -v`, reseeds a Turso primary, or merges databases.

## Update and removal

Stop the service and create a verified backup before upgrading. Download the target release's canonical Compose file, export its versioned `JOB_TRACKER_IMAGE`, pull, and start with `--no-build` as in the README. Keep the installation directory and project name so the same named volumes are reused. Verify `/health`, the dashboard, and the matching extension before removing an old image. Database migrations and downgrade limits follow [Distribution and lifecycle](DISTRIBUTION.md#upgrade-downgrade-and-replacement).

`docker compose down` removes the service and network while retaining data. Removing the installation directory does not remove Docker volumes. `docker compose down -v` is a separate destructive purge that also deletes backups in the project's backup volume; copy backups outside Docker first.

## Verification

The container smoke test uses a temporary Compose project, fresh named volumes, and an automatically chosen loopback port. It never starts, stops, signals, or replaces a service using the default host port `3456`.

```bash
docker compose config -q
bash scripts/test-container.sh
```

It builds the image, verifies health, product version, dashboard serving, private data/state mounts, an offline backup, and restart persistence. Docker Engine access is required; no image publication occurs locally.

Validate the registry installation separately against an existing published tag:

```bash
bash scripts/test-container-install.sh 1.1.0
```

This copies only `compose.yaml` into a disposable directory, validates the versioned GitHub download, pulls the public image, and starts with `--no-build`. The older `v1.1.0` Compose fixture hardcodes a local build image; the test replaces only that image line with the current canonical image expression before startup. The `1.2.0` download URL can be exercised unchanged after publication. It verifies loopback publication, health/version/dashboard, isolated named volumes, offline backup, and synthetic-data persistence across stop/start and container recreation, then removes only its own project and volumes.

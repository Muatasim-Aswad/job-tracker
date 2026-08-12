# Containers

Docker Compose is an optional Linux/amd64 deployment path. It runs the public Job Tracker API and prebuilt dashboard in one non-root container; the extension remains the separate versioned ZIP described in [Distribution and lifecycle](DISTRIBUTION.md). This image is not multi-architecture: Linux arm64 remains unsupported until the locked database dependency and an arm64 smoke test are validated.

## Start and stop

From a released source tree or checked-out release containing `compose.yaml`:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Compose uses `ghcr.io/muatasim-aswad/job-tracker:latest`, the current stable image. Set `JOB_TRACKER_IMAGE` to a version tag for a pinned deployment, or run `docker compose up -d --build` to build the checked-out source instead.

The default publication is deliberately loopback-only: `127.0.0.1:3456:3456`. Open <http://127.0.0.1:3456>; do not change it to a public interface. The service runs as UID/GID `10001`, has no added Linux capabilities, and uses its image only for replaceable application files.

Compose creates separate named volumes for `/data`, `/config`, `/state`, and `/backups`. They hold the database family, optional configuration, server lock/runtime state, and backups respectively. `docker compose down` removes the container but preserves those volumes. `docker compose down -v` deletes them and is a separate destructive purge operation, not ordinary uninstall.

Stop the service without deleting any volumes:

```bash
docker compose stop
```

## Runtime configuration and credentials

The image contains no configuration file, `.env`, database, credentials, private overlay, test, or personal fixture. It carries the repository license at `/app/LICENSE`. Local SQLite needs no configuration. For optional Turso settings, supply `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` only at container runtime through your secret-management mechanism; never add them to the Dockerfile, image, or repository. The configuration volume is intentionally persistent and excluded from image layers.

The server listens on all container interfaces solely so Docker can forward the loopback host binding. It is not a supported public service. Keep the published host address at `127.0.0.1` and use the normal API-key and configuration guidance in the API README when applicable.

## Offline backup

Backup requires the server lock to be free. The helper performs the required stopped-server sequence: it stops only this Compose service, runs the packaged `job-tracker backup` CLI once without publishing a port, writes into the explicitly mounted `/backups` volume, and starts the service again.

```bash
bash scripts/container-backup.sh
docker compose up -d
```

Pass a simple `.sqlite` filename to choose the backup name:

```bash
bash scripts/container-backup.sh before-upgrade.sqlite
```

The result is in the `job-tracker-backups` volume. Keep an additional copy outside Docker before upgrades or destructive volume operations. The helper never runs `down -v`, reseeds a Turso primary, or merges databases.

## Verification

The container smoke test uses a temporary Compose project, fresh named volumes, and an automatically chosen loopback port. It never starts, stops, signals, or replaces a service using the default host port `3456`.

```bash
docker compose config -q
bash scripts/test-container.sh
```

It builds the image, verifies health, product version, dashboard serving, private data/state mounts, an offline backup, and restart persistence. Docker Engine access is required; no image publication occurs locally.

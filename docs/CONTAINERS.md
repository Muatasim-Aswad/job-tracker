# Containers

Docker Compose is an optional Linux/amd64 deployment path. It runs the public Job Tracker API and prebuilt dashboard in one non-root container; the extension remains the separate versioned ZIP described in [Distribution and lifecycle](DISTRIBUTION.md). This image is not multi-architecture: Linux arm64 remains unsupported until the locked database dependency and an arm64 smoke test are validated.

## Start and stop

Follow the [clone-free installation](DEPLOYMENT.md#run-with-docker-compose) to download the canonical versioned `compose.yaml`, pull the public GHCR image, and start with `--no-build`. Keep that directory for later commands; Compose uses project name `job-tracker` and reuses its named volumes. Use the matching server/image/extension version. No registry login is required to pull the public image.

In that same shell and directory, inspect or restart the service with:

```bash
docker compose ps
docker compose up -d --no-build
```

`JOB_TRACKER_IMAGE=ghcr.io/muatasim-aswad/job-tracker:v<version>` pins a release. Export it again in a new shell before any command that creates a container; Compose otherwise uses its versioned default image. On `main`, the default image remains pinned to the last published artifact while source `VERSION` can advance; a tagged artifact release must align them. For source builds, follow the [source build procedure](DEPLOYMENT.md#build-the-docker-image-from-source); the same Compose file owns build and runtime settings.

The default publication is deliberately loopback-only: `127.0.0.1:3456:3456`. Open <http://127.0.0.1:3456>; do not change it to a public interface. The service runs as UID/GID `10001`, has no added Linux capabilities, and uses its image only for replaceable application files.

The current source Compose configuration caps memory at 1 GiB and PIDs/threads at 128, leaves CPU uncapped, and retains three rotating 10 MB JSON log files. Its 30-second stop grace covers Uvicorn's 15-second request drain and the scheduler's separate 10-second cleanup bound. The image health check requires both matching build identity and [database readiness](../apps/api/README.md#busy-requests-and-shutdown). These defaults apply to the next artifact release; older versioned Compose files and images retain their shipped behavior. Override resource budgets with an external Compose override when measured workloads need more headroom.

Compose creates separate named volumes for `/data`, `/config`, `/state`, and `/backups`. They hold the database family, optional configuration, server lock/runtime state, and backups respectively. Stop/start and container replacement preserve them; see [Update and removal](#update-and-removal) for uninstall and purge.

Stop the service without deleting any volumes:

```bash
docker compose stop
```

## Runtime configuration and credentials

The image contains no configuration file, `.env`, database, credentials, private overlay, test, or personal fixture. It carries the repository license at `/app/LICENSE`. Local SQLite needs no configuration. For optional Turso settings, supply `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` only at container runtime through your secret-management mechanism; never add them to the Dockerfile, image, or repository. The configuration volume is intentionally persistent and excluded from image layers.

The server listens on all container interfaces solely so Docker can forward the loopback host binding. It is not a supported public service. Keep the published host address at `127.0.0.1` and use the normal API-key and configuration guidance in the API README when applicable.

Compose forwards `TRUSTED_HOSTS` as a JSON array, defaulting to localhost and `127.0.0.1`. Add a private HTTPS hostname when using the [srvr deployment recipe](DEPLOYMENT.md#optional-manage-a-home-server-with-srvr); this allowlist does not provide authentication.

## Offline backup

Backup requires the server lock to be free. The checkout helper performs the required stopped-server sequence: it stops only this Compose service, runs the packaged `job-tracker backup` CLI once without publishing a port, writes into the explicitly mounted `/backups` volume, and starts the service again.

For a Compose-only installation, run the maintenance CLI directly from the installation directory, with the same image selected through your shell or an ignored `.env`:

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

Stop the service and create a verified backup before upgrading. Download the target release's canonical Compose file, export its versioned `JOB_TRACKER_IMAGE`, pull with `docker compose pull --policy always`, and start with `--no-build` as in the README. Keep the installation directory and project name so the same named volumes are reused. Verify `/health/ready` (version 2 onward; `/health` on older images), the dashboard, and the matching extension before removing an old image. Database migrations and downgrade limits follow [Distribution and lifecycle](DISTRIBUTION.md#upgrade-downgrade-and-replacement).

`docker compose down` removes the service and network while retaining data. Removing the installation directory does not remove Docker volumes. `docker compose down -v` is a separate destructive purge that also deletes backups in the project's backup volume; copy backups outside Docker first.

## Verification

The container smoke test uses a temporary Compose project, fresh named volumes, and an automatically chosen loopback port. It never starts, stops, signals, or replaces a service using the default host port `3456`.

```bash
docker compose config -q
bash scripts/test-container.sh
```

It builds an isolated local image and verifies database readiness, build identity, effective resource/log/shutdown settings, dashboard serving, private data/state mounts, an offline backup, and restart persistence. Turso credentials are cleared for this disposable local-SQLite test. Docker Engine access is required; no image publication occurs locally.

Validate the registry installation separately against an existing published tag:

```bash
bash scripts/test-container-install.sh 1.1.0
```

This copies only `compose.yaml` into a disposable directory, validates the versioned GitHub download, pulls the public image, and starts with `--no-build`. The older `v1.1.0` Compose fixture hardcodes a local build image; the test replaces only that image line with the current canonical image expression before startup. The current release download can be exercised unchanged after publication. It verifies loopback publication, health/version/dashboard, isolated named volumes, offline backup, and synthetic-data persistence across stop/start and container recreation, then removes only its own project and volumes.

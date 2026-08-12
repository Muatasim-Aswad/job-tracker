# Packaged command-line interface

The `job-tracker` command is the foreground lifecycle and maintenance interface shipped by the runtime bundle and wheel. The authoritative path, persistence, upgrade, and platform contract remains [`DISTRIBUTION.md`](DISTRIBUTION.md); release preparation and publication approval remain in [`RELEASING.md`](RELEASING.md).

## Build and install the wheel

From a prepared source checkout, generate the wheel from the root product version and a fresh public dashboard build:

```bash
bash scripts/build-wheel.sh
uv tool install "dist/release/job_tracker-$(tr -d '[:space:]' < VERSION)-py3-none-any.whl"
```

The generator stages public API source, `schema.sql`, the root `VERSION`, and generated dashboard assets, then builds `job_tracker-<version>-py3-none-any.whl`. The source `apps/api/pyproject.toml` version is non-release checkout metadata; the staged wheel name and version are generated from the root `VERSION`. The wheel contains neither Python nor its native dependencies, so installation succeeds only where `uv` can resolve the declared Python version and compatible dependency wheels. Linux x86_64 is the currently proven prebuilt target; the wheel's pure-Python tag does not claim that every dependency or platform is supported.

`uv tool install` creates an isolated tool environment and exposes `job-tracker`. It needs no Node, pnpm, Git, source checkout, or repository-relative resource after the wheel has been built. The installed CLI selects the packaged profile and resolves its version, schema, and dashboard inside the installed wheel.

## Commands

Global path/profile overrides precede the command. Normal wheel users do not need `--profile` or `--app-dir`; release and test tooling supplies overrides only for isolated profiles.

```text
job-tracker start [--port PORT]
job-tracker status
job-tracker paths
job-tracker version
job-tracker doctor
job-tracker backup OUTPUT.sqlite
job-tracker restore BACKUP.sqlite [--target RECOVERY.sqlite] [--replace]
job-tracker migrate-checkout CHECKOUT
```

- `start` binds to `127.0.0.1`, stays in the foreground, and stops cleanly with Ctrl-C. Run it from a terminal or an operator-selected service manager; the CLI does not daemonize itself.
- `status` performs a bounded loopback health check and distinguishes stopped, healthy, and lock-held-but-unhealthy states. It does not open or mutate the database.
- `paths` prints the resolved non-secret application, persistent, schema, and dashboard paths. `version` prints the canonical product version.
- `doctor` reports the product and Python versions, profile, configured database mode, resolved non-secret paths, lock/health state, database integrity when it is safe to inspect, and POSIX permissions. It skips integrity inspection while the server lock is held, never prints tokens or the complete environment, and returns nonzero when a performed diagnostic fails.
- `backup`, `restore`, and `migrate-checkout` are offline operations with the refusal, validation, and copy/snapshot semantics in [`DISTRIBUTION.md`](DISTRIBUTION.md#database-lifecycle-and-backups). Stop the foreground server before using them.

To validate the complete wheel lifecycle in a disposable environment:

```bash
bash scripts/build-wheel.sh
bash scripts/smoke-wheel.sh "dist/release/job_tracker-$(tr -d '[:space:]' < VERSION)-py3-none-any.whl"
```

The smoke test installs only the wheel with `uv tool install`, changes cwd outside the checkout, assigns temporary XDG roots, starts on loopback port `34657`, checks the API and dashboard, stops cleanly, runs backup and `doctor`, then uninstalls the tool while asserting that data and the external backup remain.

## Deliberate exclusions

The CLI has no background-service installation, daemonization, `stop`, or automatic `update` command. Process termination remains the responsibility of the foreground terminal or a user-selected service manager. Automatic update is deferred until checksum verification, release-channel selection, rollback, and failure recovery have one stable design. Removing the tool with `uv tool uninstall job-tracker` removes application files only; packaged data, configuration, runtime state, and user-selected backups remain until the user handles them explicitly under the distribution contract.

# Distribution and lifecycle contract

This document is the authority for end-user distribution: artifact names, installation profiles, path resolution, persistent-state boundaries, permissions, lifecycle operations, upgrades, removal, and platform support. Component documentation may explain commands, but it must link here instead of defining a second distribution contract.

The contract includes source and packaged surfaces with different evidence. Linux x86_64 runtime-bundle and wheel artifacts and the optional Linux/amd64 Compose path have isolated smoke coverage; release publication is still a separate coordinator action. A surface marked **candidate**, **reserved**, or **unsupported** below is not supported merely because paths or validation tooling exist.

## Terms and profiles

- The **source checkout** is a Git working tree prepared with the repository setup scripts. It requires the contributor/end-user toolchain documented in the root README.
- The **runtime bundle** is a versioned archive containing the API application, locked production metadata, prebuilt dashboard, product version, notices, and a launcher. It is not a native executable: its launcher requires `uv`, which provisions the pinned Python runtime and dependencies. It requires neither Git nor Node/pnpm after extraction.
- The **extension ZIP** contains the built public Chromium extension at the archive root. It is separate from the runtime bundle, but both carry the same product version.
- The **wheel** contains the Python application and dashboard resources. It does not contain Python and remains subject to the native-wheel support of its dependencies.
- The **application root** contains replaceable program files. The **data root**, **configuration root**, **state root**, and backup locations contain user state and are never children of a packaged application root.
- A **profile** is one resolved application, data, configuration, state, and database path set. Source launchers select the source-checkout profile explicitly; a packaged launcher selects the packaged profile explicitly. The server never guesses a profile from the current working directory.

## Resolution rules

The path resolver and launcher implementations must use the following precedence, from highest to lowest:

1. an explicit CLI option or injected test setting;
2. a process environment variable;
3. the selected profile's configuration file;
4. the selected profile default in this document.

The profile itself is selected by the launcher, not by cwd inspection. Root `scripts/start.sh` and `scripts/dev.sh` pass absolute checkout paths. Direct API development from `apps/api/` retains its current cwd-relative `jobtracker.db` and `.env` defaults. The packaged launcher passes its application root and platform roots before importing settings, FastAPI, or resource-owning modules.

### Overrides and relative paths

| Input | Contract |
| --- | --- |
| `JOB_TRACKER_APP_DIR` | Replaceable application root. Set by packaged and root checkout launchers; tests inject it. |
| `JOB_TRACKER_DATA_DIR` | Persistent data root. |
| `JOB_TRACKER_CONFIG_DIR` | Persistent configuration and credentials root. |
| `JOB_TRACKER_STATE_DIR` | Persistent runtime-state root. |
| `JOB_TRACKER_CONFIG_FILE` | Configuration file; defaults to `<configuration root>/config.env` in packaged profiles. This process-level input cannot redirect itself from inside a config file. |
| `JOB_TRACKER_BACKUP_DIR` | Automatic-backup root; defaults to `<data root>/backups`. User-supplied backup output paths are not rewritten into this root. |
| `DB_PATH` | Database path; defaults to `<data root>/jobtracker.db`. |
| `WEB_DIST_PATH` | Built-dashboard path; defaults to the selected application layout's dashboard resource. |
| `SCRIPTS_OUTPUT_DIR` | Maintenance-script output; defaults to `<data root>/script-output` in packaged profiles and retains the current checkout-relative default in direct API development. |
| `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` | Linux packaged-profile base-directory overrides, used only when the corresponding `JOB_TRACKER_*_DIR` is absent. |

Packaged, CI, and container roots must be absolute. A relative `DB_PATH`, `WEB_DIST_PATH`, `SCRIPTS_OUTPUT_DIR`, or backup-directory override in those profiles resolves against its owning root: data, application, data, or data respectively. Relative path-valued options supplied as CLI operands, such as `backup ./copy.sqlite` and `migrate-checkout ../checkout`, resolve against the caller's cwd because the user supplied them interactively.

The direct API command remains the compatibility exception: its relative `.env`, `DB_PATH`, and script-output paths resolve from `apps/api/`, as they do today. Packaged startup never reads a checkout `.env` or any cwd `.env`. Within a packaged profile, process environment values override `<configuration root>/config.env`, and that file overrides non-path application defaults.

### Application resources

Resource lookup uses the selected application layout and never walks repository parents speculatively:

| Resource | Source checkout | Runtime bundle or wheel |
| --- | --- | --- |
| Product version | `<repository>/VERSION` | `<application root>/VERSION` or the wheel resource copied from it |
| Database schema | `apps/api/app/core/schema.sql` | the installed `app/core/schema.sql` package resource |
| Dashboard | `apps/web/dist/` | `<application root>/apps/web/dist/` in the runtime bundle or the wheel's installed dashboard resource |
| API project and lock | `apps/api/pyproject.toml`, `apps/api/uv.lock` | corresponding files inside the runtime bundle; not runtime resources in a wheel installation |

A missing version, schema, or required packaged dashboard is a broken installation and fails loudly. Moving an intact extracted runtime application directory must not change resource resolution.

## Runtime-bundle build and verification

`bash scripts/build-release.sh` creates the local release-preparation output under `dist/release/`:

```text
job-tracker-<version>-linux-x86_64.tar.gz
job-tracker-extension-<version>.zip
job_tracker-<version>-py3-none-any.whl
SHA256SUMS
```

The runtime tarball has its application files at archive root: `job-tracker`, `VERSION`, `LICENSE`, public API source with `pyproject.toml`/`uv.lock`, and the prebuilt dashboard. The extension ZIP has its public built extension contents, including `manifest.json`, at ZIP root. The wheel carries the API, schema, version, license, console entry point, and prebuilt dashboard as installed package resources. The generator first builds both frontends from a tracked-files-only temporary source tree. It therefore does not read or package ignored private overlays, checkout `.env` files, databases, credentials, fixtures, or local build output.

`bash scripts/check-release-contents.sh dist/release` verifies the exact four-file release directory, checksums, canonical versions, runtime and wheel allowlists, absence of source maps and private/developer artifacts, and the public extension host allowlist. `bash scripts/smoke-release.sh dist/release/job-tracker-<version>-linux-x86_64.tar.gz` extracts a runtime into disposable paths, moves it before startup, uses temporary XDG roots and loopback port `34656`, verifies health/OpenAPI/dashboard serving, and replaces the application directory while preserving data, configuration, and state. `bash scripts/smoke-wheel.sh dist/release/job_tracker-<version>-py3-none-any.whl` uses a fresh isolated `uv tool` environment outside the checkout on port `34657`, then verifies startup, backup, diagnostics, uninstall, and persistence.

The archives normalize owner, ordering, timestamps (default `SOURCE_DATE_EPOCH=315532800`), and compression metadata. `bash scripts/test-release-build.sh` builds twice in independent disposable roots and compares the outputs byte-for-byte. Determinism is scoped to identical tracked working-tree inputs and the pinned build toolchain; a changed toolchain or dependency lock is a new build input.

## Path inventory

All examples use `/` for readability. Implementations use native path objects and separators.

### Packaged Linux

The initial runtime target is a per-user Linux installation. The archive can run from any absolute extraction path; the standard atomic-upgrade layout is:

| Purpose | Path | Class |
| --- | --- | --- |
| Release directory | `~/.local/opt/job-tracker/releases/<version>/` | Replaceable application |
| Active application | `~/.local/opt/job-tracker/current` symlink to one release directory | Replaceable application |
| User launcher | `~/.local/bin/job-tracker` symlink to `current/job-tracker` | Replaceable application |
| Data root | `${XDG_DATA_HOME:-$HOME/.local/share}/job-tracker/` | Persistent |
| Database | `<data root>/jobtracker.db` | Persistent |
| Local-first replica family | `<data root>/jobtracker.db.sync` and driver sidecars | Persistent |
| Automatic backups | `<data root>/backups/` | Persistent local data |
| Configuration root | `${XDG_CONFIG_HOME:-$HOME/.config}/job-tracker/` | Persistent |
| Configuration and credentials | `<configuration root>/config.env` | Persistent secret-bearing file |
| State root | `${XDG_STATE_HOME:-$HOME/.local/state}/job-tracker/` | Persistent across application replacement |
| Server lock | `<state root>/server.lock` | Runtime state |
| Lifecycle marker | `<state root>/lifecycle.json` | Runtime state |

An installer or manual extraction may choose another application location without moving data, configuration, or state. `JOB_TRACKER_*` overrides may move the persistent roots independently.

### macOS packaged layout reservation

No macOS runtime artifact is currently promised. A future packaged launcher uses the fixed layout below; macOS source-checkout support is a separate claim and test path.

| Purpose | Path | Class |
| --- | --- | --- |
| Release directory | `~/Applications/Job Tracker/releases/<version>/` | Replaceable application |
| Active application | `~/Applications/Job Tracker/current` | Replaceable application |
| Data root | `~/Library/Application Support/Job Tracker/data/` | Persistent |
| Database and local-first family | `<data root>/jobtracker.db`, `<data root>/jobtracker.db.sync*` | Persistent |
| Automatic backups | `<data root>/backups/` | Persistent local data |
| Configuration root and file | `~/Library/Application Support/Job Tracker/configuration/`, then `config.env` | Persistent, secret-bearing |
| State root, lock, lifecycle marker | `~/Library/Application Support/Job Tracker/state/`, then `server.lock` and `lifecycle.json` | Persistent runtime state |

### Future native Windows layout reservation

Native Windows is unsupported. `%LOCALAPPDATA%/Job Tracker/` is nevertheless reserved so future work does not invent an incompatible layout.

| Purpose | Path | Class |
| --- | --- | --- |
| Release directory | `%LOCALAPPDATA%/Job Tracker/app/releases/<version>/` | Replaceable application |
| Active application | `%LOCALAPPDATA%/Job Tracker/app/current` | Replaceable application |
| Data root and database family | `%LOCALAPPDATA%/Job Tracker/data/`, then `jobtracker.db` and `jobtracker.db.sync*` | Persistent |
| Automatic backups | `%LOCALAPPDATA%/Job Tracker/data/backups/` | Persistent local data |
| Configuration root and file | `%LOCALAPPDATA%/Job Tracker/configuration/`, then `config.env` | Persistent, secret-bearing |
| State root, lock, lifecycle marker | `%LOCALAPPDATA%/Job Tracker/state/`, then `server.lock` and `lifecycle.json` | Persistent runtime state |

These reserved paths do not imply a native executable, Windows installer, or support commitment.

### Source checkout compatibility

The checkout is both application and legacy state location. This is an explicit compatibility exception to packaged separation, not a model for new artifacts.

| Purpose | Path | Class |
| --- | --- | --- |
| Application root | Repository root | Replaceable checkout files |
| Database and local-first family | `apps/api/jobtracker.db`, `apps/api/jobtracker.db.sync*` | Legacy persistent state inside the checkout |
| Configuration | `apps/api/.env` | Legacy persistent, secret-bearing file inside the checkout |
| State root, lock, lifecycle marker | `apps/api/.job-tracker-state/`, then `server.lock` and `lifecycle.json` | Legacy runtime state inside the checkout |
| Automatic backups | `apps/api/backups/` unless `JOB_TRACKER_BACKUP_DIR` is explicit | Legacy persistent state inside the checkout |
| Built dashboard and extension | `apps/web/dist/`, `apps/extension/dist/` | Replaceable generated application files |

Root launchers pass these as absolute paths. Direct API development from `apps/api/` obtains the same database and configuration through its retained relative defaults. User-created checkout backups should still be written outside the repository so deleting or replacing the checkout cannot remove them.

### CI and tests

Every test creates an isolated `<test root>` and explicitly supplies this complete mutable profile:

| Purpose | Test path | Class |
| --- | --- | --- |
| Application or staged artifact | `<test root>/app/` | Replaceable test input |
| Data root, database, local-first family | `<test root>/data/`, then `jobtracker.db` and `jobtracker.db.sync*` | Disposable test data |
| Configuration root and file | `<test root>/config/`, then `config.env` | Disposable test configuration |
| State root, lock, lifecycle marker | `<test root>/state/`, then `server.lock` and `lifecycle.json` | Disposable test state |
| Backup root | `<test root>/backups/` | Disposable test backups |

Tests never select a real platform home, inherit a developer's XDG roots, read a repository `.env`, or touch a non-test database. Tests that exercise source compatibility point to a synthetic checkout or explicitly safe repository resources and keep all mutable files under the test root.

### Containers

The optional container profile uses explicit roots rather than a home directory:

| Purpose | Container path | Persistence contract |
| --- | --- | --- |
| Application root | `/app` | Read-only image layer, replaceable with the image |
| Data root and database family | `/data`, then `jobtracker.db` and `jobtracker.db.sync*` | Named volume or bind mount |
| Configuration root and file | `/config`, then `config.env` | Read-only secret/config bind where practical |
| State root, lock, lifecycle marker | `/state`, then `server.lock` and `lifecycle.json` | Explicit runtime volume |
| Backup root | `/backups` | Separate named volume or host bind if backups must survive a data-volume purge |

Compose passes every root explicitly. `docker compose down` preserves volumes; `down -v` is destructive and must not be presented as ordinary uninstall. The optional Linux/amd64 image and Compose path are covered by `bash scripts/test-container.sh`, which uses a unique project, fresh volumes, and an automatically chosen loopback host port. Image publication remains a separate canonical-tag workflow action.

## Permissions and secrets

On POSIX platforms, the launcher sets a private creation mask before creating user state. Data, configuration, state, and backup directories are created with mode `0700`. Configuration/credential files, database files and their sidecars, lock and lifecycle files, and backup files are created with mode `0600`. Application directories and non-secret resources may use normal read-only distribution modes (`0755` directories and executable launchers, `0644` data files).

Code must apply private modes to files it creates and repair a newly created file before exposing it. It must not silently make an existing user file more permissive. A credential file that is accessible to other users produces an actionable refusal or warning according to the command's sensitivity; credentials are never printed by `paths`, `status`, logs, or errors. Platforms without POSIX modes must import and fail or warn cleanly rather than pretending that `chmod` provides protection.

Installed private overlays, checkout `.env` files, databases, personal fixtures, credentials, browser data, logs, and backups are never copied into a public runtime bundle, extension ZIP, wheel, image, or release log.

## Process and maintenance locking

The server owns an advisory exclusive lock on `<state root>/server.lock` for the full database lifecycle: it acquires the lock before opening, pulling, initializing, or migrating the database and releases it only after request handling stops, pending local-first writes are pushed, and the database connection closes. Direct Uvicorn startup goes through the same lifecycle, so a wrapper cannot be bypassed.

The lock file contains only non-secret diagnostic metadata: product version, PID, start time, bound loopback address/port, and canonical profile/data/state/database paths. Lock ownership is determined by the operating-system advisory lock, not merely by a PID or by the file's existence. A crash can leave the regular file behind, but releases the advisory lock; the next server may reuse it after acquiring the lock and must never kill a process based on stale metadata. A process that cannot acquire the lock refuses to start and identifies the profile and safe stop procedure.

`status` does not open or mutate the database. It reports one of: stopped when the lock is free, healthy when the lock is held and the bounded loopback health check succeeds, or lock-held-but-unhealthy when an owner exists but health does not respond. Maintenance commands acquire the same lock non-blockingly and refuse while the server owns it. The initial `backup`, `restore`, and `migrate-checkout` behavior is offline-only.

## Database lifecycle and backups

The effective live store is `DB_PATH` for local SQLite and embedded-replica mode, and `<DB_PATH>.sync` for local-first mode. Driver-created sidecars belong to the same database family and follow the same persistence and permission boundary.

Before any Turso pull that could replace local state, the current effective live store is snapshotted without first opening a connection that pulls. The verified recovery snapshot is atomically placed at `<backup root>/recovery/pre-pull.sqlite`; replacing this single recovery point avoids unbounded periodic-backup growth. In particular, the first pull after an unclean shutdown cannot erase unsynced local-first data before it has been preserved. A pull does not proceed when the recovery snapshot cannot be completed and validated. Pending writes are pushed successfully before later periodic pulls replace that recovery point.

`backup OUTPUT.sqlite` requires the server lock to be free, snapshots the effective live store, validates integrity and foreign keys, writes with mode `0600`, and atomically installs the completed output on its destination filesystem. The explicit output may be inside the default backup root or anywhere the user selected. External backup destinations are outside purge scope.

`restore BACKUP.sqlite` validates into a new candidate and never operates on a running profile. It refuses an existing destination unless `--replace` is explicit. Replacement first creates and verifies `<backup root>/automatic/<UTC timestamp>-pre-restore.sqlite`, then atomically renames the candidate over the destination on the same filesystem. General restore never reseeds, overwrites, or deletes a Turso primary; synced recovery uses an explicit local recovery target for inspection and separate user-directed remote procedures.

## Checkout adoption

Ordinary startup never searches for, moves, renames, imports, or deletes a legacy checkout database. Adoption is an explicit one-time operation:

```text
job-tracker migrate-checkout CHECKOUT
```

The command requires both source and destination server locks to be free. It resolves the checkout's effective live store from that checkout's source profile, without logging credentials, snapshots and validates the source, and installs the snapshot only into an empty packaged destination. Empty means that the destination database and local-first family do not exist and contain no initialized schema or user rows. A second invocation therefore refuses rather than merging.

The source checkout and all of its files remain untouched. Configuration, Turso credentials, private overlays, logs, and script output are not copied. The user configures sync separately only after validating the adopted local data. There is no merge-style import between populated installations.

## Upgrade, downgrade, and replacement

An upgrade follows this order:

1. Stop the server and verify that the profile lock is free.
2. Create and validate a backup of the effective local store before changing application files or allowing a new version to pull or migrate. Keep at least one copy outside the application directory; for a Turso profile the pre-pull recovery rule still applies.
3. Verify the new artifact checksum and exact contents. Extract into a new sibling staging directory on the same filesystem as the release directory; never unpack over the active application.
4. Rename the complete staging directory to `releases/<version>` and atomically replace the `current` link or equivalent pointer. Data, configuration, state, and backups are not moved. Retain the previous release until the new version is verified.
5. Start the new version. It acquires the profile lock, preserves any required pre-pull recovery point, then applies additive schema and one-time data migrations before serving requests. A failed migration aborts startup and does not mark that migration complete.
6. Verify the reported product version, API health, dashboard, and matching extension version before removing an older application directory.

Application replacement is atomic; database migration is a separate startup transaction and is not made reversible by switching the application pointer. If the new release has not changed the database, switching `current` back to a retained release is the normal application rollback. After a schema or data migration, running older code is unsupported unless that release's notes explicitly declare downgrade compatibility. Restore the verified pre-upgrade backup offline to a local recovery target when necessary; do not use general restore to roll a Turso primary backward. Additive columns may physically remain understandable to older SQLite code, but that is not a downgrade guarantee.

Configuration files are persistent user input. An upgrade may validate or document new keys, but never replace the file or copy a release's example over it. The runtime bundle, extension ZIP, and wheel from one release must report the same canonical product version.

## Uninstall and purge

Ordinary uninstall stops the server, removes the loaded extension, user launcher, `current` pointer, and selected release application directories. It leaves the data, configuration, state, default backups, user-selected external backups, and any Turso remote untouched so reinstall or rollback remains possible.

A purge is a separate, explicitly confirmed procedure. It may remove the local packaged data, configuration, state, and default backup roots after showing their resolved paths and confirming that the server is stopped. It never removes a user-selected external backup and never deletes or modifies a Turso remote. Remote deletion is a separate provider operation performed directly by the user. Source-checkout removal follows the current root README because its legacy database and configuration live inside the checkout; external backups and remotes still remain separate.

## Current command surface

The delayed-import `job-tracker` entry point now provides the shared command surface used by staged applications and later packaged artifacts:

- `job-tracker start [--port PORT]` runs the server in the foreground on `127.0.0.1`; Ctrl-C performs the normal FastAPI shutdown, including final sync and lock release.
- `job-tracker status` reads advisory-lock ownership and performs a bounded loopback health check. It reports `stopped`, `healthy`, or `lock-held-but-unhealthy` and never opens or creates the database or lock.
- `job-tracker paths` prints the selected application, data, configuration, state, database, dashboard, schema, and version paths without configuration values or credentials.
- `job-tracker version` prints the selected application's canonical `VERSION` value.
- `job-tracker doctor` reports redacted product/runtime, profile, database-mode, path, lock/health, integrity, and permission diagnostics. It skips database inspection while the lock is held and returns nonzero for a diagnostic failure.
- `job-tracker backup OUTPUT.sqlite` creates a private, validated, atomic snapshot of the stopped profile's effective local store.
- `job-tracker restore BACKUP.sqlite [--target TARGET.sqlite] [--replace]` validates and migrates a local candidate before installation. Turso profiles require a separate explicit recovery target and never reseed a primary.
- `job-tracker migrate-checkout CHECKOUT` snapshots a stopped legacy checkout into an empty local packaged destination without copying configuration, credentials, or other checkout state.

The command defaults to the packaged profile because it is the installed/staged entry point. Source-checkout use selects `--profile source` or uses the root launchers; direct `uvicorn app.main:app` from `apps/api/` remains the explicit direct-development compatibility profile.

## Support and artifact matrix

| Surface | Status | Runtime/tooling contract |
| --- | --- | --- |
| Linux x86_64 source checkout | Supported current path | Git, pinned Node/pnpm, and `uv`; public setup and checks cover it. |
| macOS source checkout | Supported source path, tested separately | Same source toolchain. It is not evidence of a macOS runtime bundle or wheel. |
| Linux x86_64 uv-managed runtime bundle | Built and smoke-tested release artifact; publication pending | Requires `uv`; no Git or Node/pnpm at runtime. Not a native executable. |
| Public Chromium extension ZIP | Built and content-verified release artifact; publication pending | Separate unpacked-extension archive with the same version as the server; Chromium-family browser required. |
| `job-tracker` CLI | Implemented for source, runtime-bundle, wheel, and container layouts | Foreground `start`, read-only `status`/`paths`, `version`, `doctor`, offline backup/restore, and packaged checkout adoption; no daemon or automatic updater. |
| Python wheel on Linux x86_64 | Built and fresh-environment smoke-tested release artifact; publication pending | Installed with `uv tool`; contains no Python runtime and requires platform-compatible dependency wheels. |
| WSL2 on x86_64 | Candidate, unsupported pending recorded validation | Uses the Linux artifact inside WSL2; active database files must stay on the Linux filesystem, not `/mnt/c`. |
| Native Windows | Unsupported | Reserved paths only; no native installer, launcher, driver validation, or support claim. |
| macOS runtime bundle or wheel | Not currently planned as a released artifact | Source-checkout support does not overcome the absence of a matching locked prebuilt dependency set. |
| Linux arm64 runtime bundle or image | Unsupported | No matching locked `libsql` wheel in the current dependency set. |
| Linux amd64 container and Compose | Optional built and smoke-tested path | Explicit `/app`, `/data`, `/config`, `/state`, and `/backups` roots; GHCR publication occurs only from the canonical-tag workflow. |

The locked `libsql 0.1.11` dependency currently supplies a CPython 3.14 wheel only for manylinux x86_64. That makes Linux x86_64 the only straightforward prebuilt target. Building an sdist on another platform is not equivalent to a reproducible, tested release artifact and must not be used to imply support.

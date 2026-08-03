# Releasing Job Tracker

This is the coordinator procedure for publishing the Linux x86_64 uv-managed runtime bundle and the separate public extension ZIP. It does not make either archive a native executable, and it does not add support for other platforms. Distribution paths, artifact contents, upgrades, backup, and removal remain authoritative in [Distribution and lifecycle](DISTRIBUTION.md).

The [release workflow](../.github/workflows/release.yml) starts only for a canonical `vX.Y.Z` tag. It checks out that exact tag with credentials not persisted, validates that the tag is the root `VERSION`, installs the pinned toolchains, runs `bash scripts/check.sh`, builds the C1 artifacts, validates their exact contents and checksums, then re-checks and smoke-tests the downloaded artifact shape. Only its final publication job has `contents: write`; it creates one GitHub Release containing exactly the runtime tarball, extension ZIP, and `SHA256SUMS`.

## Local no-publish rehearsal

Run this from a prepared checkout:

```bash
bash scripts/test-release-workflow.sh
bash scripts/rehearse-release.sh
```

The rehearsal computes the canonical tag from `VERSION`, creates no tag, and uses a temporary tracked-only archive plus temporary XDG roots. It makes isolated copy-on-write copies of the prepared frozen module trees where the filesystem supports them and copies Corepack metadata into that temporary checkout, never an environment file or credential. The rehearsal disables Vite+'s automatic dependency installation and makes its dependency-status report-only; commands that repair the isolated module copy may still contact package registries, but cannot mutate the coordinator checkout. It then runs the build, exact-content/checksum checks, local artifact handoff/download simulation, and extracted-runtime smoke test as the workflow. Its generated artifacts, application paths, data, configuration, state, dependency cache, and simulated publication directories are all removed on exit; the smoke test binds only `127.0.0.1:34656`. It neither uploads nor retains an artifact, and it does not read checkout overlays, `.env` files, databases, credentials, or user data.

## Coordinator approval checklist

Before creating or pushing a tag, the coordinator records all of the following against the intended commit:

- A clean working tree and an explicit review of the intended commit.
- The changelog moved from `Unreleased` and the root `VERSION` bumped together according to the release scope.
- A passing `bash scripts/check.sh` from the intended commit.
- The three-file artifact inventory: `job-tracker-<version>-linux-x86_64.tar.gz`, `job-tracker-extension-<version>.zip`, and `SHA256SUMS`.
- Passing checksum and exact-content results, plus the extracted-runtime smoke result on port `34656`.
- Explicit authorization, obtained after the preceding fresh checks, to create and push exactly `v<version>`.

Only after that authorization may the coordinator create the canonical annotated tag and push that tag. The tag push starts the workflow; no local command creates a GitHub Release or uploads a release asset. If any tag, root version, API version, extension version, artifact filename, checksum, or extracted runtime check disagrees, stop and correct the release commit before seeking authorization again.

# Development guide

Repository-wide contributor setup and policy live here; component-specific implementation and commands stay with their component documentation:

| Topic | Authority |
| --- | --- |
| End-user prerequisites, setup, install, and normal startup | [`README.md`](../README.md) |
| Distribution artifacts, packaged paths, lifecycle, upgrades, and platform support | [`docs/DISTRIBUTION.md`](DISTRIBUTION.md) |
| Repository-wide contributor setup, full-app launcher, and quality gate | This guide |
| User-facing features and workflows | [`docs/FEATURES.md`](FEATURES.md) |
| Component structure and invariants | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |
| API-specific commands, configuration, database modes, backup/restore | [`apps/api/README.md`](../apps/api/README.md) |
| Extension build, adapters, keyboard controls | [`apps/extension/README.md`](../apps/extension/README.md) |
| Dashboard development | [`apps/web/README.md`](../apps/web/README.md) |
| Private/local adapter overlay | [`docs/PRIVATE.md`](PRIVATE.md) |
| Captured data, retention, and permissions | [`PRIVACY.md`](../PRIVACY.md) |
| Threat model and reporting | [`SECURITY.md`](../SECURITY.md) |
| Release history | [`CHANGELOG.md`](../CHANGELOG.md) |
| Contribution and support workflow | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |

## Local development

After cloning or forking the repository, install the prerequisites listed in the root [README](../README.md#requirements), then prepare the whole workspace from the repository root:

```bash
bash scripts/setup.sh
```

Start the assembled application for contributor work with:

```bash
bash scripts/dev.sh
```

The development launcher performs the same built-dashboard preflight as the normal launcher, binds to `127.0.0.1:3456`, and enables Uvicorn's automatic reload. For a component-only workflow such as Vite hot reload or starting just the API, use the commands in the relevant component README.

## Quality gate

`bash scripts/check.sh` is the single local entry point and runs the CI-equivalent gates: private-overlay drift, launcher/setup and release-contract tests, formatting, linting, type checking, tests, builds, generated-API drift, Markdown formatting, and version consistency. Linux also runs deterministic production of the Linux x86_64 artifacts; macOS skips that Linux-only production step while retaining every source-checkout gate. Its WSL2 check is a static safety self-test, not external WSL2 evidence, and it does not run Docker, use credentials, publish, or contact a Turso database. Run it before calling a change done; a green run is what CI reproduces for that platform, while release approval still requires the Linux artifact gates documented in the release procedure.

Git hooks run a subset earlier so failures surface sooner. Install them once:

```bash
uv run --directory apps/api pre-commit install
```

Formatters that rewrite files stop at the commit stage — a push-stage fixer would land its fix in the working tree, outside the commits being pushed. The push stage re-checks the same ground in report-only form.

Individual tasks (`pnpm exec vp run test`, `uv run --directory apps/api pytest`, and the per-component scripts in each README) exist for fast iteration, but they are not a substitute for the gate.

## Source and generated files

Generated source artifacts are tracked so that a clean checkout builds and type-checks without first booting the server, but they are never hand-edited. Each has one generator, and the gate fails on drift:

| Generated file | Generator | Source of truth |
| --- | --- | --- |
| `packages/shared/src/api/schema.ts` | `pnpm --filter @job-tracker/shared gen:api` | FastAPI route and model definitions |
| `packages/shared/src/funnel/funnel.contract.json` | API test suite | `apps/api/app/core/enums.py` |
| `packages/shared/src/text/text.golden.json` | API test suite | `apps/api/app/core/text.py` |

Build output (`apps/*/dist/`), including `apps/extension/dist/manifest.json`, tool caches, and the four gitignored private overlay directories are not tracked. `pnpm run build:ext` regenerates the manifest from `apps/extension/manifest.config.ts` and the root `VERSION`; the gate builds and version-checks it. Changing a tracked generated artifact's shape means changing its generator and committing the regenerated result in the same change.

## Comments and documentation

Treat comments and documentation as release artifacts:

- Use always concise, plain language, without dropping necessary meaning.
- Explain intent, invariants, constraints, and non-obvious tradeoffs.
- Prefer clearer code and names over comments that restate the implementation.
- Remove historical narration, repeated facts, padding, and phrases that add no useful context.
- Keep each fact in one authoritative place and link to it when needed.
- Keep examples, commands, behavior descriptions, and version information accurate in the same change that affects them.
- Preserve important context when shortening text. A comment should explain why the code exists or what must remain true, not translate the code into prose.

## Markdown formatting

Prettier owns Markdown formatting, pinned in `package.json` and configured in `.prettierrc.json`. It is deliberately configured **not** to hard-wrap prose: a paragraph is one line, and your editor supplies the visual wrapping. This keeps diffs to the sentences that actually changed instead of reflowing whole paragraphs, and removes hand-cleaning from review.

```bash
pnpm run format:md   # write
pnpm run check:md    # report only, as scripts/check.sh runs it
```

Hard breaks, lists, tables, links, and fenced code keep their structure — only prose wrapping is normalized. `.prettierignore` excludes build output, dependencies, and `docs/plans/`, which holds immutable execution plans rather than public documentation.

This policy covers Markdown only. Ruff formats Python and the workspace TypeScript formatter (`vp fmt`, oxfmt) formats TypeScript; neither defers to Prettier.

## Database migration compatibility

`apps/api/app/core/schema.sql` is the 1.0.0 baseline: every pre-release migration is folded into it, so `_COLUMN_MIGRATIONS` and `_DATA_MIGRATIONS` in `apps/api/app/core/db.py` both start empty. See [architecture](ARCHITECTURE.md#database-and-synchronization) for how migrations are applied.

After 1.0.0, migrations are **append-only**:

- Add new entries at the end. Never edit, reorder, or remove a released entry: it has already run on some user databases and not others, so changing it makes those two states diverge silently.
- Give every migration a stable, unique key. The key is the ledger row in `schema_migrations` and the only record that it ran.
- Keep column migrations additive. Dropping or retyping a column breaks an older client still reading the same synchronized database.
- Migrations run at server start against whatever database is configured, including a Turso primary. Assume real data and no operator supervision, and back up first ([procedure](../apps/api/README.md#backup--restore)).
- Cover a new migration with a test that starts from a database in the _old_ shape and asserts the repair, and one that proves re-running it is a no-op.

A change that cannot be expressed additively is a breaking change and needs a major version bump plus an explicit note in `CHANGELOG.md`.

## Releases and versions

The repository root `VERSION` file is the one product version, in SemVer. It covers the extension, the dashboard, and the server together — they ship from the same commit and are not independently versioned.

Everything else derives from it: `apps/extension/manifest.config.ts` reads it into the built manifest, and `apps/api/app/core/version.py` reads it into the API's OpenAPI metadata. `apps/extension/package.json` deliberately declares no `version` at all, and `apps/api/pyproject.toml`'s version is packaging metadata uv requires — neither is a release authority, and nothing ships either number. `bash scripts/check-version.sh` (part of the gate) fails if the canonical value, the built manifest, the API metadata, or a `vX.Y.Z` tag disagree.

Decide the bump from user-visible effect, in any component:

| Bump | When |
| --- | --- |
| Patch (`x.y.Z`) | Fixes and internal work with no new capability |
| Minor (`x.Y.0`) | New capability: an adapter surface, a setting, a dashboard or API feature |
| Major (`X.0.0`) | A breaking change, including a non-additive database change |

Individual commits do not bump the version. Bump once while preparing a release, then tag that same whole-repository commit `vX.Y.Z` and move the `CHANGELOG.md` entry from `Unreleased` to the new version. The gate rejects a tag that disagrees with `VERSION`, and any tag that does not match `vX.Y.Z`.

## Platform support

Linux and macOS source checkouts are supported. Packaged support is narrower: the runtime bundle and wheel are proven only on Linux x86_64, and the optional container is Linux/amd64 only. A passing source-checkout gate on macOS is not evidence for a macOS runtime bundle or wheel.

Native Windows is unsupported: the setup and run scripts are Bash, and the locked `libsql`/`pyturso` dependency set has no straightforward native-Windows wheel path. WSL2 x86_64 remains candidate/unsupported until its external Linux-filesystem harness and Windows Chromium checks are completed and reviewed.

Supporting native Windows would require supported dependency artifacts or a database-driver decision, portable launcher commands and paths, and a Windows setup/runtime CI smoke test. Until those exist, do not add speculative compatibility edits that no test can hold in place.

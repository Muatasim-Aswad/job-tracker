#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Check drift before the general gates so they can never validate stale private
# copies. This also opts the gitignored overlay into formatting and linting;
# typecheck, tests, and builds below see it in the full public app context.
bash scripts/check-private.sh
bash scripts/test-setup.sh
bash scripts/test-launchers.sh
bash scripts/test-release-workflow.sh
bash scripts/test-validate-wsl2.sh
bash scripts/test-release-build.sh

pnpm exec vp check

# These are package.json scripts, which vite-plus leaves uncached unless a run
# forces it on; a config task cannot shadow a script of the same name, so the
# flag is the only lever. Fingerprints include gitignored files, so an overlay
# edit still invalidates.
pnpm exec vp run -r --cache typecheck
pnpm exec vp run -r --cache test
pnpm exec vp run -r --cache build

# Via the root config's tasks, not the bare commands: they declare cache inputs
# that exclude the tool caches each one writes.
pnpm exec vp run py:format
pnpm exec vp run py:lint
pnpm exec vp run py:typecheck
pnpm exec vp run py:test

pnpm exec vp run api:check

# Markdown prose formatting; `pnpm run format:md` writes the fix.
pnpm run --silent check:md

# Last, because it reads the extension manifest the build above produced.
bash scripts/check-version.sh

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Check overlay drift first, then validate installed copies in the app context.
bash scripts/check-private.sh
bash scripts/test-setup.sh
bash scripts/test-launchers.sh
bash scripts/test-release-workflow.sh
bash scripts/test-validate-wsl2.sh

# Require Linux artifact determinism; macOS gates only its supported source surface.
case "$(uname -s)" in
  Linux) bash scripts/test-release-build.sh ;;
  Darwin) printf '%s\n' 'release build determinism: skipped (Linux x86_64 artifact only)' ;;
  *)
    printf 'check: unsupported source platform: %s\n' "$(uname -s)" >&2
    exit 1
    ;;
esac

pnpm exec vp check

# Force caching for package scripts, which config tasks cannot shadow.
# Ignored overlay files participate in fingerprints.
pnpm exec vp run -r --cache typecheck
pnpm exec vp run -r --cache test
pnpm exec vp run -r --cache build

# Root tasks exclude caches they write from their own inputs.
pnpm exec vp run py:format
pnpm exec vp run py:lint
pnpm exec vp run py:typecheck
pnpm exec vp run py:test

pnpm exec vp run api:check

pnpm run --silent check:md

# Read the manifest produced by the preceding build.
bash scripts/check-version.sh

#!/usr/bin/env bash
# Sync this private source, then validate it in the public application context.

set -euo pipefail

PRIVATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_ROOT="${JOB_TRACKER_PUBLIC_DIR:-$PRIVATE_ROOT/.public}"

if [[ ! -f "$PUBLIC_ROOT/scripts/check-private.sh" ]]; then
  echo "error: public job-tracker checkout not found at $PUBLIC_ROOT" >&2
  echo "hint: run bash scripts/setup-private-dev.sh from the public checkout" >&2
  exit 2
fi
PUBLIC_ROOT="$(cd "$PUBLIC_ROOT" && pwd)"

MODE=full
if [[ "${1:-}" == "--fast" ]]; then
  MODE=fast
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--fast]" >&2
  exit 2
fi

# Refresh disposable installed copies before checking to avoid validating stale source.
JOB_TRACKER_PRIVATE_DIR="$PRIVATE_ROOT" bash "$PUBLIC_ROOT/scripts/sync-private.sh"

if [[ "$MODE" == fast ]]; then
  JOB_TRACKER_PRIVATE_DIR="$PRIVATE_ROOT" bash "$PUBLIC_ROOT/scripts/check-private.sh"
  (
    cd "$PUBLIC_ROOT"
    pnpm exec vp run typecheck
  )
else
  JOB_TRACKER_PRIVATE_DIR="$PRIVATE_ROOT" bash "$PUBLIC_ROOT/scripts/check.sh"
fi

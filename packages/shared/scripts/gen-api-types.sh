#!/usr/bin/env bash
# Regenerate packages/shared/src/api/schema.ts from the server's OpenAPI schema.
#
# FastAPI is the source of truth. `--check` reports drift instead of writing, so
# the gates that only need an answer never mutate a tracked file — a pre-push
# hook that rewrote this one would strand the fix outside the commits being
# pushed.
set -euo pipefail

CHECK=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK=1
elif [[ $# -gt 0 ]]; then
  echo "usage: ${BASH_SOURCE[0]##*/} [--check]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="$ROOT/packages/shared/src/api/schema.ts"
SCHEMA="$(mktemp)"
GENERATED="$(mktemp)"
trap 'rm -f "$SCHEMA" "$GENERATED"' EXIT

# Boot the app in-process and dump app.openapi() (pure — no DB, no HTTP server).
# Run as a module from apps/api/ so the app package is importable (matches pytest's
# pythonpath=["."]).
(cd "$ROOT/apps/api" && uv run python -m scripts.dump_openapi) >"$SCHEMA"

# --alphabetize keeps the output stable across runs regardless of schema traversal
# order, so the drift diff only ever reflects a real API change.
"$ROOT/packages/shared/node_modules/.bin/openapi-typescript" "$SCHEMA" \
  --output "$GENERATED" \
  --alphabetize

if (( CHECK )); then
  if ! cmp -s "$OUT" "$GENERATED"; then
    diff -u "$OUT" "$GENERATED" || true
    echo "generated API schema is stale; run 'pnpm --filter @job-tracker/shared gen:api'" >&2
    exit 1
  fi
  echo "generated API schema is up to date"
else
  cp "$GENERATED" "$OUT"
fi

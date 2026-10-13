#!/usr/bin/env bash
# Generate API types from FastAPI. --check reports drift without rewriting tracked
# files, keeping push checks from leaving fixes outside the commits being pushed.
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

# Module execution makes app importable; OpenAPI generation opens no database or server.
(cd "$ROOT/apps/api" && uv run python -m scripts.dump_openapi) >"$SCHEMA"

# Stable ordering prevents schema traversal order from creating drift.
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

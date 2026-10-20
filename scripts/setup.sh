#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'setup: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 ||
  fail "Node.js is required. Run mise install, then mise run setup."

command -v pnpm >/dev/null 2>&1 ||
  fail "pnpm is required. Run mise install, then mise run setup."

command -v uv >/dev/null 2>&1 ||
  fail "uv is required. Install it from https://docs.astral.sh/uv/ and retry."

cd "$ROOT"
uv python find --project apps/api >/dev/null ||
  fail "uv could not resolve project Python. Run mise install, then mise run setup."
pnpm install --frozen-lockfile
uv sync --directory apps/api --frozen ||
  fail "uv could not create the API environment. Check the uv error above and retry."
pnpm run build:web
pnpm run build:ext

printf '\nSetup complete.\n'
printf 'Dashboard: http://localhost:3456\n'
printf 'Extension directory: %s/apps/extension/dist\n' "$ROOT"
printf 'Start Job Tracker with: bash scripts/start.sh\n'

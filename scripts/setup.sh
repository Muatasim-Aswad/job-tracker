#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_REQUIREMENT="22.22.2+, 24.15+, or 26+"

fail() {
  printf 'setup: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 ||
  fail "Node.js $NODE_REQUIREMENT is required. Install it, then rerun this command."
node -e '
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const atLeast = (wantedMinor, wantedPatch) =>
  minor > wantedMinor || (minor === wantedMinor && patch >= wantedPatch);
const supported =
  (major === 22 && atLeast(22, 2)) ||
  (major === 24 && atLeast(15, 0)) ||
  major >= 26;
if (!supported) process.exit(1);
' || fail "Node.js $NODE_REQUIREMENT is required; found $(node --version)."

command -v corepack >/dev/null 2>&1 ||
  fail "Corepack is required. Install a Node.js distribution that includes Corepack."
corepack pnpm --version >/dev/null 2>&1 ||
  fail "pnpm is unavailable through Corepack. Run 'corepack enable' and retry."

command -v uv >/dev/null 2>&1 ||
  fail "uv is required. Install it from https://docs.astral.sh/uv/ and retry."

cd "$ROOT"
uv python find --project apps/api >/dev/null ||
  fail "uv could not find or download the Python version required by apps/api/.python-version and apps/api/pyproject.toml. Check the uv error above and retry."
corepack pnpm install --frozen-lockfile
uv sync --directory apps/api --frozen ||
  fail "uv could not create the API environment. Check the uv error above and retry."
corepack pnpm run build:web
corepack pnpm run build:ext

printf '\nSetup complete.\n'
printf 'Dashboard: http://localhost:3456\n'
printf 'Extension directory: %s/apps/extension/dist\n' "$ROOT"
printf 'Start Job Tracker with: bash scripts/start.sh\n'

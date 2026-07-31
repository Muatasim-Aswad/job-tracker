#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT/apps/web/dist/index.html" ]]; then
  printf 'start: dashboard build is missing; run bash scripts/setup.sh first.\n' >&2
  exit 1
fi

printf 'Job Tracker: http://localhost:3456\n'
printf 'API docs: http://localhost:3456/docs\n'
printf 'Extension directory: %s/apps/extension/dist\n' "$ROOT"
printf 'Press Ctrl-C to stop.\n\n'

cd "$ROOT/apps/api"
exec uv run uvicorn app.main:app --host 127.0.0.1 --port 3456

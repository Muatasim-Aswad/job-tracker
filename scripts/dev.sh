#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export JOB_TRACKER_PROFILE=source
export JOB_TRACKER_APP_DIR="$ROOT"
export JOB_TRACKER_DATA_DIR="$ROOT/apps/api"
export JOB_TRACKER_CONFIG_DIR="$ROOT/apps/api"
export JOB_TRACKER_STATE_DIR="$ROOT/apps/api/.job-tracker-state"
export JOB_TRACKER_CONFIG_FILE="$ROOT/apps/api/.env"
export WEB_DIST_PATH="$ROOT/apps/web/dist"

if [[ ! -f "$ROOT/apps/web/dist/index.html" ]]; then
  printf 'dev: dashboard build is missing; run bash scripts/setup.sh first.\n' >&2
  exit 1
fi

printf 'Job Tracker: http://localhost:3456\n'
printf 'API docs: http://localhost:3456/docs\n'
printf 'Extension directory: %s/apps/extension/dist\n' "$ROOT"
printf 'Press Ctrl-C to stop.\n\n'

cd "$ROOT/apps/api"
exec uv run uvicorn app.main:app --host 127.0.0.1 --port 3456 --reload

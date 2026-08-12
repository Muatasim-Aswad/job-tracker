#!/usr/bin/env bash
# Create an offline container backup without deleting data, configuration, or state.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_NAME="${1:-job-tracker-$(date -u +%Y%m%dT%H%M%SZ).sqlite}"

fail() {
  printf 'container-backup: %s\n' "$1" >&2
  exit 2
}

[[ "$BACKUP_NAME" == *.sqlite ]] || fail "backup filename must end in .sqlite"
[[ "$BACKUP_NAME" != */* && "$BACKUP_NAME" != .* ]] || fail "backup filename must be a plain filename"

cd "$ROOT"
docker compose config -q
docker compose stop job-tracker
restart_needed=1
restart_after_failure() {
  local status=$?
  if ((status != 0 && restart_needed)); then
    docker compose up -d job-tracker >&2 || true
  fi
  exit "$status"
}
trap restart_after_failure EXIT

docker compose run --rm --no-deps job-tracker job-tracker backup "/backups/$BACKUP_NAME"
docker compose up -d job-tracker
restart_needed=0
printf 'backup created in the job-tracker-backups volume: %s\n' "$BACKUP_NAME"

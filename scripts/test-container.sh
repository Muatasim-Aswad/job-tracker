#!/usr/bin/env bash
# Exercise a disposable Compose project without touching the default :3456 binding.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-container.XXXXXX")"
PROJECT="job-tracker-f1-${RANDOM}${RANDOM}"
BACKUP_NAME="smoke-backup.sqlite"

cleanup() {
  local status=$?
  if docker info >/dev/null 2>&1; then
    if ((status != 0)); then
      docker compose --project-name "$PROJECT" --project-directory "$ROOT" logs --no-color >&2 || true
    fi
    docker compose --project-name "$PROJECT" --project-directory "$ROOT" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf -- "$WORK"
  exit "$status"
}
trap cleanup EXIT

fail() {
  printf 'test-container: %s\n' "$1" >&2
  exit 1
}

docker info >/dev/null 2>&1 || fail "Docker Engine is required and the current user cannot reach it."
docker compose version >/dev/null

PORT="$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
export JOB_TRACKER_HOST_PORT="$PORT"

cd "$ROOT"
docker compose --project-name "$PROJECT" config -q
timeout 300 docker compose --project-name "$PROJECT" up --build -d

IMAGE="$(docker compose --project-name "$PROJECT" config --images | head -n 1)"
docker run --rm --entrypoint /bin/sh "$IMAGE" -c '
  set -eu
  test "$(id -u)" = 10001
  test -x /app/apps/api/.venv/bin/job-tracker
  test -f /app/apps/api/app/core/schema.sql
  test -f /app/apps/web/dist/index.html
  test -f /app/VERSION
  test -f /app/LICENSE
  ! command -v node >/dev/null
  ! command -v pnpm >/dev/null
  ! command -v git >/dev/null
  ! command -v uv >/dev/null
  ! find /app -type f \( -name "*.env" -o -name "*.db" \) -print -quit | grep -q .
  ! find /app/apps/api/app -type f \( -path "*/tests/*" -o -path "*/local/*" \) -print -quit | grep -q .
'

BASE_URL="http://127.0.0.1:$PORT"
deadline=$((SECONDS + 90))
until curl --fail --silent --show-error "$BASE_URL/health" >"$WORK/health.json"; do
  ((SECONDS < deadline)) || fail "container did not become healthy within 90 seconds"
  sleep 1
done

VERSION="$(tr -d '[:space:]' <VERSION)"
grep -Fq "\"version\":\"$VERSION\"" "$WORK/health.json" || fail "health version differs from VERSION"
curl --fail --silent --show-error "$BASE_URL/" >"$WORK/dashboard.html"
grep -Fq '<div id="root"></div>' "$WORK/dashboard.html" || fail "dashboard was not served"

CONTAINER_ID="$(docker compose --project-name "$PROJECT" ps -q job-tracker)"
[[ -n "$CONTAINER_ID" ]] || fail "Compose did not create the service container"
health_deadline=$((SECONDS + 90))
until [[ "$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER_ID")" == "healthy" ]]; do
  ((SECONDS < health_deadline)) || fail "Docker health check did not become healthy within 90 seconds"
  sleep 1
done
docker compose --project-name "$PROJECT" exec -T job-tracker test -s /data/jobtracker.db
docker compose --project-name "$PROJECT" exec -T job-tracker test -f /state/server.lock

# This stops and restarts only the disposable project. `docker compose run` has no
# published service port, so it cannot contend with a user's :3456 development server.
COMPOSE_PROJECT_NAME="$PROJECT" JOB_TRACKER_HOST_PORT="$PORT" \
  bash "$ROOT/scripts/container-backup.sh" "$BACKUP_NAME"
docker compose --project-name "$PROJECT" run --rm --no-deps --entrypoint /bin/sh job-tracker \
  -c "test -s /backups/$BACKUP_NAME"

deadline=$((SECONDS + 45))
until curl --fail --silent --show-error "$BASE_URL/health" >/dev/null; do
  ((SECONDS < deadline)) || fail "container did not restart after backup"
  sleep 1
done
docker compose --project-name "$PROJECT" exec -T job-tracker test -s /data/jobtracker.db

printf 'container smoke passed on isolated loopback port %s\n' "$PORT"

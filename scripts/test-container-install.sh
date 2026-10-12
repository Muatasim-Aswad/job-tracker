#!/usr/bin/env bash
# Prove a public-image install with only Compose, isolated volumes, and loopback.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_VERSION="${1:-1.1.0}"
[[ $# -le 1 && "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  printf 'usage: bash scripts/test-container-install.sh [X.Y.Z]\n' >&2
  exit 2
}
WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-install.XXXXXX")"
PROJECT="job-tracker-install-${RANDOM}${RANDOM}"
export DOCKER_CONFIG="$WORK/docker-config"
export JOB_TRACKER_IMAGE="ghcr.io/muatasim-aswad/job-tracker:v$RELEASE_VERSION"
export TURSO_DATABASE_URL= TURSO_AUTH_TOKEN=
mkdir -p "$DOCKER_CONFIG" "$WORK/current" "$WORK/released"
COMPOSE_DIR="$WORK/released"

compose() {
  docker compose --env-file /dev/null --project-name "$PROJECT" --project-directory "$COMPOSE_DIR" "$@"
}

cleanup() {
  local status=$?
  if ((status != 0)); then compose logs --no-color >&2 || true; fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
  exit "$status"
}
trap cleanup EXIT

fail() {
  printf 'test-container-install: %s\n' "$1" >&2
  exit 1
}

docker info >/dev/null 2>&1 || fail "Docker Engine is required."
export JOB_TRACKER_HOST_PORT="$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"

# Neither directory has a Dockerfile, source tree, or environment file.
cp "$ROOT/compose.yaml" "$WORK/current/compose.yaml"
curl -fLsS "https://raw.githubusercontent.com/Muatasim-Aswad/job-tracker/v$RELEASE_VERSION/compose.yaml" \
  -o "$WORK/released/compose.yaml"
# v1.1.0 predates the registry image expression. Change only its temporary fixture.
if [[ "$RELEASE_VERSION" == 1.1.0 ]]; then
  python3 - "$WORK/released/compose.yaml" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
old = "    image: job-tracker:compose\n"
assert source.count(old) == 1
path.write_text(source.replace(old, "    image: ${JOB_TRACKER_IMAGE:-ghcr.io/muatasim-aswad/job-tracker:latest}\n"))
PY
fi
docker compose --env-file /dev/null --project-name "$PROJECT" --project-directory "$WORK/released" config -q
COMPOSE_DIR="$WORK/current"
compose config -q
COMPOSE_DIR="$WORK/released"
compose pull
compose up -d --no-build

BASE_URL="http://127.0.0.1:$JOB_TRACKER_HOST_PORT"
wait_ready() {
  local deadline=$((SECONDS + 90))
  until curl --fail --silent "$BASE_URL/health" >"$WORK/health.json"; do
    ((SECONDS < deadline)) || fail "service did not become ready within 90 seconds"
    sleep 1
  done
  python3 - "$WORK/health.json" "$RELEASE_VERSION" <<'PY'
import json
import sys

with open(sys.argv[1]) as source:
    assert json.load(source)["version"] == sys.argv[2]
PY
}
wait_ready
curl -fLsS "$BASE_URL/" >"$WORK/dashboard.html"
grep -Fq '<div id="root"></div>' "$WORK/dashboard.html" || fail "dashboard was not served"

CONTAINER_ID="$(compose ps -q job-tracker)"
docker inspect "$CONTAINER_ID" >"$WORK/container.json"
python3 - "$WORK/container.json" "$PROJECT" "$JOB_TRACKER_HOST_PORT" <<'PY'
import json
import sys

with open(sys.argv[1]) as source:
    container = json.load(source)[0]
assert container["HostConfig"]["PortBindings"]["3456/tcp"] == [
    {"HostIp": "127.0.0.1", "HostPort": sys.argv[3]}
]
mounts = {item["Destination"]: item for item in container["Mounts"]}
for destination, suffix in {
    "/data": "data", "/config": "config", "/state": "state", "/backups": "backups"
}.items():
    mount = mounts[destination]
    assert mount["Type"] == "volume"
    assert mount["Name"] == f"{sys.argv[2]}_job-tracker-{suffix}"
PY
deadline=$((SECONDS + 90))
until [[ "$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER_ID")" == "healthy" ]]; do
  ((SECONDS < deadline)) || fail "Docker health check did not become healthy"
  sleep 1
done

curl -fLsS -H 'Content-Type: application/json' -X POST "$BASE_URL/api/listings" \
  --data '{"platform":"manual","platform_id":"install-smoke","title":"Synthetic install smoke","company":"Synthetic company","via":"manual"}' \
  >"$WORK/listing.json"
check_persistence() {
  curl -fLsS "$BASE_URL/api/listings/lookup?platform=manual&platform_id=install-smoke" >"$WORK/lookup.json"
  python3 - "$WORK/listing.json" "$WORK/lookup.json" <<'PY'
import json
import sys

with open(sys.argv[1]) as source:
    created = json.load(source)
with open(sys.argv[2]) as source:
    lookup = json.load(source)
assert lookup["job_id"] == created["job_id"]
assert lookup["listing_id"] == created["listing_id"]
PY
}
compose stop job-tracker
compose run --rm --no-deps job-tracker job-tracker backup /backups/install-smoke.sqlite
compose up -d --no-build job-tracker
wait_ready
compose exec -T job-tracker test -s /backups/install-smoke.sqlite
check_persistence

# Recreate from the checkout's Compose-only copy using the same isolated volumes.
compose down
COMPOSE_DIR="$WORK/current"
compose up -d --no-build
wait_ready
check_persistence
printf 'registry install smoke passed: v%s, isolated loopback port %s, project %s\n' \
  "$RELEASE_VERSION" "$JOB_TRACKER_HOST_PORT" "$PROJECT"

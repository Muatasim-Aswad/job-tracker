#!/usr/bin/env bash
# Validate a published runtime bundle from inside an x86_64 WSL2 distribution.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=34658
ARTIFACT=""
EXTENSION=""
CHECKSUMS=""
KEEP_WORK=false
SELF_TEST=false

usage() {
  cat <<'EOF'
usage: validate-wsl2.sh --artifact PATH --extension PATH --checksums PATH [--keep-work]
       validate-wsl2.sh --self-test

Run this inside WSL2. The active database and every mutable root are created
under the Linux filesystem; do not place them under /mnt/c.
EOF
}

fail() {
  printf 'validate-wsl2: %s\n' "$1" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --artifact) ARTIFACT="${2:-}"; shift 2 ;;
    --extension) EXTENSION="${2:-}"; shift 2 ;;
    --checksums) CHECKSUMS="${2:-}"; shift 2 ;;
    --keep-work) KEEP_WORK=true; shift ;;
    --self-test) SELF_TEST=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "unknown argument: $1" ;;
  esac
done

if "$SELF_TEST"; then
  [[ -z "$ARTIFACT" && -z "$EXTENSION" && -z "$CHECKSUMS" ]] || fail "--self-test accepts no artifact arguments"
  bash -n "$ROOT/scripts/validate-wsl2.sh"
  grep -Fq 'Candidate, unsupported' "$ROOT/docs/WSL2.md"
  grep -Fq '/mnt/c' "$ROOT/docs/WSL2.md"
  grep -Fq 'Windows Chromium' "$ROOT/docs/evidence/wsl2-template.md"
  printf 'WSL2 harness self-test OK (static safety and evidence contract only)\n'
  exit 0
fi

[[ -n "$ARTIFACT" && -n "$EXTENSION" ]] || { usage >&2; fail "--artifact and --extension are required"; }
[[ -n "$CHECKSUMS" ]] || { usage >&2; fail "--checksums is required for a real validation run"; }
[[ "$(uname -m)" == x86_64 ]] || fail "this harness requires x86_64; found $(uname -m)"
[[ -r /proc/sys/kernel/osrelease ]] && grep -qi 'wsl2' /proc/sys/kernel/osrelease ||
  fail "this harness must run inside WSL2; use --self-test for its Linux-only checks"
ARTIFACT="$(realpath -e "$ARTIFACT")" || fail "runtime artifact does not exist"
[[ "$ARTIFACT" == *.tar.gz ]] || fail "artifact must be a runtime .tar.gz"
case "$ARTIFACT" in /mnt/*) fail "artifact is under /mnt; copy it to the Linux filesystem first" ;; esac
EXTENSION="$(realpath -e "$EXTENSION")" || fail "extension ZIP does not exist"
[[ "$EXTENSION" == *.zip ]] || fail "extension must be a .zip"
case "$EXTENSION" in /mnt/*) fail "extension is under /mnt; copy it to the Linux filesystem first" ;; esac
CHECKSUMS="$(realpath -e "$CHECKSUMS")" || fail "checksum file does not exist"
case "$CHECKSUMS" in /mnt/*) fail "checksums are under /mnt; copy them to the Linux filesystem first" ;; esac

expected_hash() {
  local name="$1"
  local hashes
  hashes="$(awk -v name="$name" '$2 == name { print $1 }' "$CHECKSUMS")"
  [[ "$(printf '%s\n' "$hashes" | sed '/^$/d' | wc -l)" == 1 ]] ||
    fail "SHA256SUMS must contain exactly one hash for $name"
  printf '%s\n' "$hashes"
}

verify_supplied_hash() {
  local path="$1"
  local expected actual
  expected="$(expected_hash "$(basename "$path")")"
  actual="$(sha256sum "$path" | awk '{ print $1 }')"
  [[ "$actual" == "$expected" ]] || fail "SHA-256 mismatch for supplied path: $path"
}

verify_supplied_hash "$ARTIFACT"
verify_supplied_hash "$EXTENSION"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-wsl2.XXXXXX")"
SERVER_PID=""
LAUNCH_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -INT -- "-$SERVER_PID" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$SERVER_PID" 2>/dev/null || true
  fi
  [[ -n "$LAUNCH_PID" ]] && wait "$LAUNCH_PID" 2>/dev/null || true
  if "$KEEP_WORK"; then printf 'validation work retained: %s\n' "$WORK"; else rm -rf -- "$WORK"; fi
}
trap cleanup EXIT

APP="$WORK/app"
DATA="$WORK/data"
CONFIG="$WORK/config"
STATE="$WORK/state"
BACKUPS="$WORK/backups"
HOME_ROOT="$WORK/home"
for path in "$WORK" "$DATA" "$CONFIG" "$STATE" "$BACKUPS" "$HOME_ROOT"; do
  case "$path" in /mnt/*) fail "refusing mutable path under /mnt: $path" ;; esac
done
mkdir -p "$APP" "$DATA" "$CONFIG" "$STATE" "$BACKUPS" "$HOME_ROOT"
tar -xzf "$ARTIFACT" -C "$APP"
[[ -x "$APP/job-tracker" ]] || fail "archive has no executable job-tracker launcher"
unzip -Z1 "$EXTENSION" | grep -Fxq manifest.json || fail "extension ZIP has no root manifest.json"
VERSION="$(tr -d '[:space:]' <"$APP/VERSION")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "extracted runtime VERSION is not plain SemVer"
[[ "$(basename "$ARTIFACT")" == "job-tracker-$VERSION-linux-x86_64.tar.gz" ]] ||
  fail "runtime filename does not match extracted VERSION $VERSION"
[[ "$(basename "$EXTENSION")" == "job-tracker-extension-$VERSION.zip" ]] ||
  fail "extension filename does not match extracted runtime VERSION $VERSION"

run() {
  env -i PATH="$PATH" HOME="$HOME_ROOT" XDG_DATA_HOME="$DATA" XDG_CONFIG_HOME="$CONFIG" \
    XDG_STATE_HOME="$STATE" JOB_TRACKER_BACKUP_DIR="$BACKUPS" UV_CACHE_DIR="$WORK/uv-cache" \
    "$APP/job-tracker" "$@"
}

start() {
  : >"$WORK/server.pid"
  (
    trap - INT TERM
    exec setsid bash -c 'printf "%s\n" "$$" >"$1"; shift; exec "$@"' bash \
      "$WORK/server.pid" env -i PATH="$PATH" HOME="$HOME_ROOT" XDG_DATA_HOME="$DATA" \
      XDG_CONFIG_HOME="$CONFIG" XDG_STATE_HOME="$STATE" JOB_TRACKER_BACKUP_DIR="$BACKUPS" \
      UV_CACHE_DIR="$WORK/uv-cache" "$APP/job-tracker" start --port "$PORT"
  ) >"$WORK/server.log" 2>&1 &
  LAUNCH_PID=$!
  for _ in $(seq 1 240); do
    [[ -s "$WORK/server.pid" ]] && SERVER_PID="$(<"$WORK/server.pid")"
    curl --fail --silent "http://127.0.0.1:$PORT/health" >"$WORK/health.json" && return 0
    if ! kill -0 "$LAUNCH_PID" 2>/dev/null; then cat "$WORK/server.log" >&2; fail "server exited before readiness"; fi
    sleep .5
  done
  cat "$WORK/server.log" >&2
  fail "server did not become ready on 127.0.0.1:$PORT"
}

stop() {
  [[ -n "$SERVER_PID" ]] || fail "server PID was not recorded"
  kill -INT -- "-$SERVER_PID"
  for _ in $(seq 1 20); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      wait "$LAUNCH_PID" || { status=$?; [[ "$status" == 130 ]] || return "$status"; }
      SERVER_PID=""; LAUNCH_PID=""; return 0
    fi
    sleep .5
  done
  fail "server did not shut down cleanly"
}

run paths >"$WORK/paths.txt"
grep -Fq "data: $DATA/job-tracker" "$WORK/paths.txt" || fail "packaged data path is not under Linux temporary storage"
grep -Fq "state: $STATE/job-tracker" "$WORK/paths.txt" || fail "packaged state path is not under Linux temporary storage"
start
grep -Fq '"version"' "$WORK/health.json" || fail "health response has no product version"
curl --fail --silent "http://127.0.0.1:$PORT/" >"$WORK/dashboard.html"
grep -Fq '<div id="root"></div>' "$WORK/dashboard.html" || fail "dashboard was not served"
stop

DATABASE="$DATA/job-tracker/jobtracker.db"
[[ -f "$DATABASE" ]] || fail "database was not created in packaged data root"
[[ "$(stat -c '%a' "$DATA/job-tracker")" == 700 && "$(stat -c '%a' "$DATABASE")" == 600 ]] ||
  fail "packaged state permissions are not private (expected 0700 directory and 0600 database)"
BACKUP="$WORK/backup.sqlite"
run backup "$BACKUP"
[[ -f "$BACKUP" && "$(stat -c '%a' "$BACKUP")" == 600 ]] || fail "offline backup was not private"
RECOVERY="$WORK/recovery.sqlite"
run restore "$BACKUP" --target "$RECOVERY"
[[ -f "$RECOVERY" ]] || fail "restore did not create a separate recovery target"

printf 'persistent sentinel\n' >"$STATE/job-tracker/wsl2-sentinel"
mv "$APP" "$WORK/previous-app"
mkdir "$APP"
tar -xzf "$ARTIFACT" -C "$APP"
start
stop
[[ -f "$DATABASE" && -f "$RECOVERY" && -f "$STATE/job-tracker/wsl2-sentinel" ]] ||
  fail "application replacement did not preserve persistent state"
printf 'WSL2 runtime lifecycle validation OK. Complete docs/WSL2.md host-browser steps and record docs/evidence/wsl2-template.md before claiming support.\n'

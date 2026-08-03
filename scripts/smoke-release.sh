#!/usr/bin/env bash
# Exercise an extracted runtime bundle with disposable persistent roots only.
set -euo pipefail

ARCHIVE="${1:?usage: smoke-release.sh PATH/TO/job-tracker-X.Y.Z-linux-x86_64.tar.gz}"
PORT=34656
WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-release-smoke.XXXXXX")"
SERVER_PID=""
LAUNCH_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$LAUNCH_PID" ]]; then wait "$LAUNCH_PID" 2>/dev/null || true; fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT

fail() {
  printf 'smoke-release: %s\n' "$1" >&2
  exit 1
}

ARCHIVE="$(realpath -e "$ARCHIVE")" || fail "archive does not exist."
VERSION="$(basename "$ARCHIVE" | sed -nE 's/^job-tracker-([0-9]+\.[0-9]+\.[0-9]+)-linux-x86_64\.tar\.gz$/\1/p')"
[[ -n "$VERSION" ]] || fail "archive name is not a runtime bundle name."

mkdir -p "$WORK/extracted"
tar -xzf "$ARCHIVE" -C "$WORK/extracted"
mv "$WORK/extracted" "$WORK/moved-app"
APP="$WORK/moved-app"
DATA="$WORK/data"
CONFIG="$WORK/config"
STATE="$WORK/state"
HOME_ROOT="$WORK/home"
mkdir -p "$DATA" "$CONFIG/job-tracker" "$STATE" "$HOME_ROOT"
printf 'ATTENTION_APPLIED_DAYS=3\n' >"$CONFIG/job-tracker/config.env"

start() {
  # A background Bash job inherits ignored SIGINT in a non-interactive shell.
  # Reset it, create a dedicated session, and record the post-setsid PID: some
  # setsid implementations fork before exec, so `$!` alone is not reliable.
  : >"$WORK/server.pid"
  (
    trap - INT TERM
    exec setsid bash -c '
      trap - INT TERM
      printf "%s\n" "$$" >"$1"
      shift
      exec env -i PATH="$1" HOME="$2" XDG_DATA_HOME="$3" XDG_CONFIG_HOME="$4" \
        XDG_STATE_HOME="$5" UV_CACHE_DIR="$6" UV_HTTP_RETRIES=5 \
        "$7" start --port "$8"
    ' bash "$WORK/server.pid" "$PATH" "$HOME_ROOT" "$DATA" "$CONFIG" "$STATE" \
      "$WORK/uv-cache" "$APP/job-tracker" "$PORT"
  ) >"$WORK/server.log" 2>&1 &
  LAUNCH_PID=$!
  # A clean runtime may need to download the frozen production wheels before the
  # first start. Keep readiness bounded, but allow that provisioning to finish.
  for _ in $(seq 1 240); do
    if [[ -s "$WORK/server.pid" ]]; then SERVER_PID="$(<"$WORK/server.pid")"; fi
    if curl --fail --silent "http://127.0.0.1:$PORT/health" >"$WORK/health.json"; then
      return 0
    fi
    if [[ -n "$SERVER_PID" ]] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
      wait "$LAUNCH_PID" || true
      cat "$WORK/server.log" >&2
      fail "server exited before becoming ready."
    fi
    if ! kill -0 "$LAUNCH_PID" 2>/dev/null && [[ -z "$SERVER_PID" ]]; then
      wait "$LAUNCH_PID" || true
      cat "$WORK/server.log" >&2
      fail "server launcher exited before recording its process group."
    fi
    sleep 0.5
  done
  cat "$WORK/server.log" >&2
  fail "server did not become ready on 127.0.0.1:$PORT."
}

stop() {
  [[ -n "$SERVER_PID" ]] || fail "server process group was not recorded."
  kill -INT -- "-$SERVER_PID"
  for _ in $(seq 1 20); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      if wait "$LAUNCH_PID"; then
        exit_status=0
      else
        exit_status=$?
      fi
      # A process group stopped by our SIGINT conventionally reports 130 even
      # after Uvicorn completes its graceful application shutdown.
      [[ "$exit_status" == 0 || "$exit_status" == 130 ]] ||
        fail "server did not exit cleanly (status $exit_status)."
      SERVER_PID=""
      LAUNCH_PID=""
      return 0
    fi
    sleep 0.5
  done
  # Leave no process behind if the graceful path is broken, but report that as
  # a smoke failure rather than presenting forced termination as a clean stop.
  kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-$SERVER_PID" 2>/dev/null || true
  wait "$LAUNCH_PID" 2>/dev/null || true
  SERVER_PID=""
  LAUNCH_PID=""
  fail "server did not stop cleanly."
}

start
grep -Fq "\"version\":\"$VERSION\"" "$WORK/health.json" || fail "health version disagrees with archive."
curl --fail --silent "http://127.0.0.1:$PORT/openapi.json" >"$WORK/openapi.json"
grep -Fq "\"version\":\"$VERSION\"" "$WORK/openapi.json" || fail "OpenAPI version disagrees with archive."
curl --fail --silent "http://127.0.0.1:$PORT/" >"$WORK/dashboard.html"
grep -Fq '<div id="root"></div>' "$WORK/dashboard.html" || fail "dashboard was not served."
stop

DATABASE="$DATA/job-tracker/jobtracker.db"
[[ -f "$DATABASE" ]] || fail "database was not created under the disposable data root."
case "$DATABASE" in "$APP"/*) fail "database was created inside application files." ;; esac
DB_SUM="$(sha256sum "$DATABASE")"
printf 'state survives application replacement\n' >"$STATE/job-tracker/release-sentinel"

# Simulate atomic application replacement: persistent roots stay fixed while the
# extracted directory is discarded and a fresh copy of the same archive starts.
mv "$APP" "$WORK/previous-app"
mkdir "$WORK/replacement-app"
tar -xzf "$ARCHIVE" -C "$WORK/replacement-app"
APP="$WORK/replacement-app"
start
stop

[[ "$(sha256sum "$DATABASE")" == "$DB_SUM" ]] || fail "application replacement changed the database."
[[ -f "$CONFIG/job-tracker/config.env" ]] || fail "application replacement changed configuration."
[[ -f "$STATE/job-tracker/release-sentinel" ]] || fail "application replacement changed runtime state."
printf 'release smoke test OK: %s\n' "$ARCHIVE"

#!/usr/bin/env bash
# Install and exercise only the built wheel from outside the repository.
set -euo pipefail

WHEEL="${1:?usage: smoke-wheel.sh PATH/TO/job_tracker-X.Y.Z-py3-none-any.whl}"
PORT=34657
WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-wheel-smoke.XXXXXX")"
SERVER_PID=""
LAUNCH_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    sleep 1
    kill -KILL "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$LAUNCH_PID" ]]; then wait "$LAUNCH_PID" 2>/dev/null || true; fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT

fail() {
  printf 'smoke-wheel: %s\n' "$1" >&2
  exit 1
}

WHEEL="$(realpath -e "$WHEEL")" || fail "wheel does not exist."
VERSION="$(basename "$WHEEL" | sed -nE 's/^job_tracker-([0-9]+\.[0-9]+\.[0-9]+)-py3-none-any\.whl$/\1/p')"
[[ -n "$VERSION" ]] || fail "wheel name is not canonical."

HOME_ROOT="$WORK/home"
DATA="$WORK/data"
CONFIG="$WORK/config"
STATE="$WORK/state"
TOOL_DIR="$WORK/tools"
BIN_DIR="$WORK/bin"
UV_CACHE="${JOB_TRACKER_SMOKE_UV_CACHE:-$WORK/uv-cache}"
OUTSIDE="$WORK/outside"
mkdir -p "$HOME_ROOT" "$DATA" "$CONFIG/job-tracker" "$STATE" "$BIN_DIR" "$OUTSIDE" "$WORK/backups"
printf 'TURSO_AUTH_TOKEN=never-print-wheel-smoke\n' >"$CONFIG/job-tracker/config.env"
chmod 0600 "$CONFIG/job-tracker/config.env"

PYTHON="$(UV_CACHE_DIR="$UV_CACHE" uv python find 3.14)"
tool_env=(
  env -i
  "PATH=$PATH"
  "HOME=$HOME_ROOT"
  "XDG_DATA_HOME=$DATA"
  "XDG_CONFIG_HOME=$CONFIG"
  "XDG_STATE_HOME=$STATE"
  "UV_CACHE_DIR=$UV_CACHE"
  "UV_TOOL_DIR=$TOOL_DIR"
  "UV_TOOL_BIN_DIR=$BIN_DIR"
  "UV_PYTHON_DOWNLOADS=never"
)
for uv_option in UV_OFFLINE UV_FIND_LINKS UV_NO_INDEX; do
  if [[ -n "${!uv_option:-}" ]]; then tool_env+=("$uv_option=${!uv_option}"); fi
done

install_options=(--python "$PYTHON")
if [[ -n "${UV_FIND_LINKS:-}" ]]; then install_options+=(--find-links "$UV_FIND_LINKS"); fi
if [[ -n "${UV_NO_INDEX:-}" ]]; then install_options+=(--no-index); fi
"${tool_env[@]}" uv tool install "${install_options[@]}" "$WHEEL"
[[ -x "$BIN_DIR/job-tracker" ]] || fail "uv tool install did not create the CLI."

(
  cd "$OUTSIDE"
  [[ "$("${tool_env[@]}" "$BIN_DIR/job-tracker" version)" == "$VERSION" ]] ||
    fail "installed CLI version disagrees with the wheel."
  "${tool_env[@]}" "$BIN_DIR/job-tracker" paths >"$WORK/paths.txt"
  grep -Fq "application: $TOOL_DIR/" "$WORK/paths.txt" || fail "wheel paths are not installed resources."
)

start() {
  (
    cd "$OUTSIDE"
    exec "${tool_env[@]}" "$BIN_DIR/job-tracker" start --port "$PORT"
  ) >"$WORK/server.log" 2>&1 &
  SERVER_PID=$!
  LAUNCH_PID=$SERVER_PID
  for _ in $(seq 1 120); do
    if curl --fail --silent "http://127.0.0.1:$PORT/health" >"$WORK/health.json"; then
      return 0
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      wait "$LAUNCH_PID" || true
      cat "$WORK/server.log" >&2
      fail "installed server exited before readiness."
    fi
    sleep 0.5
  done
  cat "$WORK/server.log" >&2
  fail "installed server did not become ready."
}

stop() {
  [[ -n "$SERVER_PID" ]] || fail "server process was not recorded."
  kill -TERM "$SERVER_PID"
  for _ in $(seq 1 20); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      if wait "$LAUNCH_PID"; then exit_status=0; else exit_status=$?; fi
      [[ "$exit_status" == 0 || "$exit_status" == 143 ]] ||
        fail "installed server did not exit cleanly (status $exit_status)."
      SERVER_PID=""
      LAUNCH_PID=""
      return 0
    fi
    sleep 0.5
  done
  fail "installed server did not stop cleanly."
}

start
grep -Fq "\"version\":\"$VERSION\"" "$WORK/health.json" || fail "health version disagrees."
curl --fail --silent "http://127.0.0.1:$PORT/" >"$WORK/dashboard.html"
grep -Fq '<div id="root"></div>' "$WORK/dashboard.html" || fail "wheel dashboard was not served."
stop

DATABASE="$DATA/job-tracker/jobtracker.db"
[[ -f "$DATABASE" ]] || fail "wheel database was not created under disposable XDG data."
(
  cd "$OUTSIDE"
  "${tool_env[@]}" "$BIN_DIR/job-tracker" backup "$WORK/backups/job-tracker.sqlite"
  "${tool_env[@]}" "$BIN_DIR/job-tracker" doctor >"$WORK/doctor.txt"
)
grep -Fq 'database_integrity: ok' "$WORK/doctor.txt" || fail "doctor did not validate the database."
if grep -Fq 'never-print-wheel-smoke' "$WORK/doctor.txt"; then fail "doctor disclosed a token."; fi
[[ -f "$WORK/backups/job-tracker.sqlite" ]] || fail "installed backup command produced no snapshot."

"${tool_env[@]}" uv tool uninstall job-tracker
[[ ! -e "$BIN_DIR/job-tracker" ]] || fail "uv tool uninstall left the CLI installed."
[[ -f "$DATABASE" ]] || fail "uv tool uninstall removed persistent data."
[[ -f "$WORK/backups/job-tracker.sqlite" ]] || fail "uv tool uninstall removed an external backup."

printf 'wheel smoke test OK: %s\n' "$WHEEL"

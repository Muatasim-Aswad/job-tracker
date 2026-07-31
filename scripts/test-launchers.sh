#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMP="$(mktemp -d)"

cleanup() {
  rm -rf -- "$TEST_TMP"
}
trap cleanup EXIT

fail() {
  printf 'launcher tests: %s\n' "$1" >&2
  exit 1
}

mkdir -p "$TEST_TMP/repo/scripts" "$TEST_TMP/repo/apps/api" "$TEST_TMP/bin"
cp "$ROOT/scripts/start.sh" "$ROOT/scripts/dev.sh" "$TEST_TMP/repo/scripts/"

cat >"$TEST_TMP/bin/uv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$PWD" >"$LAUNCHER_CWD_FILE"
printf '%s\n' "$*" >"$LAUNCHER_ARGS_FILE"
EOF
chmod +x "$TEST_TMP/bin/uv"

for launcher in start dev; do
  if output="$(PATH="$TEST_TMP/bin:$PATH" bash "$TEST_TMP/repo/scripts/$launcher.sh" 2>&1)"; then
    fail "$launcher.sh started without a dashboard build"
  fi
  expected="$launcher: dashboard build is missing; run bash scripts/setup.sh first."
  [[ "$output" == *"$expected"* ]] ||
    fail "$launcher.sh did not report its missing-build preflight"
done

mkdir -p "$TEST_TMP/repo/apps/web/dist"
touch "$TEST_TMP/repo/apps/web/dist/index.html"

run_launcher() {
  local launcher="$1"
  local expected_args="$2"
  local args_file="$TEST_TMP/$launcher.args"
  local cwd_file="$TEST_TMP/$launcher.cwd"
  local output_file="$TEST_TMP/$launcher.output"

  LAUNCHER_ARGS_FILE="$args_file" LAUNCHER_CWD_FILE="$cwd_file" \
    PATH="$TEST_TMP/bin:$PATH" bash "$TEST_TMP/repo/scripts/$launcher.sh" >"$output_file"

  [[ "$(cat "$cwd_file")" == "$TEST_TMP/repo/apps/api" ]] ||
    fail "$launcher.sh did not start from apps/api"
  [[ "$(cat "$args_file")" == "$expected_args" ]] ||
    fail "$launcher.sh invoked uv with unexpected arguments: $(cat "$args_file")"
  [[ "$(cat "$output_file")" == *'Job Tracker: http://localhost:3456'* ]] ||
    fail "$launcher.sh did not print the localhost URL"
}

run_launcher start 'run uvicorn app.main:app --host 127.0.0.1 --port 3456'
run_launcher dev 'run uvicorn app.main:app --host 127.0.0.1 --port 3456 --reload'

printf 'launcher tests: ok\n'

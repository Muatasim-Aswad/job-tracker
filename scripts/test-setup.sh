#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMP="$(mktemp -d)"
TEST_BIN="$TEST_TMP/bin"

cleanup() {
  rm -rf -- "$TEST_TMP"
}
trap cleanup EXIT

fail() {
  printf 'setup tests: %s\n' "$1" >&2
  exit 1
}

mkdir -p "$TEST_BIN"
ln -s "$(command -v bash)" "$TEST_BIN/bash"
ln -s "$(command -v dirname)" "$TEST_BIN/dirname"

cat >"$TEST_BIN/node" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$TEST_BIN/corepack" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TEST_BIN/node" "$TEST_BIN/corepack"

if output="$(PATH="$TEST_BIN" /bin/bash "$ROOT/scripts/setup.sh" 2>&1)"; then
  fail 'setup succeeded without uv'
fi
[[ "$output" == *'setup: uv is required.'* ]] ||
  fail 'setup did not report the missing uv prerequisite'

cat >"$TEST_BIN/uv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$SETUP_UV_CALLS_FILE"
if [[ "${SETUP_UV_FAIL_FIND:-}" == 1 && "$1 $2" == 'python find' ]]; then
  printf 'simulated Python provisioning failure\n' >&2
  exit 1
fi
EOF
chmod +x "$TEST_BIN/uv"

calls_file="$TEST_TMP/provisioning-failure.calls"
if output="$(SETUP_UV_CALLS_FILE="$calls_file" SETUP_UV_FAIL_FIND=1 PATH="$TEST_BIN" \
  /bin/bash "$ROOT/scripts/setup.sh" 2>&1)"; then
  fail 'setup succeeded after Python provisioning failed'
fi
[[ "$output" == *'setup: uv could not find or download the Python version required by apps/api/.python-version and apps/api/pyproject.toml.'* ]] ||
  fail 'setup did not explain the Python provisioning failure'

calls_file="$TEST_TMP/success.calls"
output="$(SETUP_UV_CALLS_FILE="$calls_file" PATH="$TEST_BIN" \
  /bin/bash "$ROOT/scripts/setup.sh" 2>&1)"
[[ "$(cat "$calls_file")" == $'python find --project apps/api\nsync --directory apps/api --frozen' ]] ||
  fail 'setup did not resolve project Python before syncing the API environment'
[[ "$output" == *'Start Job Tracker with: bash scripts/start.sh'* ]] ||
  fail 'setup did not print the normal startup command'

printf 'setup tests: ok\n'

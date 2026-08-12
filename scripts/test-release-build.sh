#!/usr/bin/env bash
# Prove that two clean release builds from identical tracked inputs are identical.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-release-test.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT

for script in build-release.sh check-release-contents.sh smoke-release.sh test-release-build.sh; do
  bash -n "$ROOT/scripts/$script"
done
grep -Fq 'command -v zip' "$ROOT/scripts/build-release.sh" || {
  printf '%s\n' 'test-release-build: release builder must preflight zip.' >&2
  exit 1
}

SOURCE_DATE_EPOCH=315532800 JOB_TRACKER_RELEASE_DIR="$WORK/first" bash "$ROOT/scripts/build-release.sh"
bash "$ROOT/scripts/check-release-contents.sh" "$WORK/first"
SOURCE_DATE_EPOCH=315532800 JOB_TRACKER_RELEASE_DIR="$WORK/second" bash "$ROOT/scripts/build-release.sh"
bash "$ROOT/scripts/check-release-contents.sh" "$WORK/second"

diff -qr "$WORK/first" "$WORK/second" >/dev/null || {
  printf '%s\n' 'test-release-build: repeated builds differ.' >&2
  exit 1
}
printf 'release build determinism OK\n'

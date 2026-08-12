#!/usr/bin/env bash
# Statically hold the C2 release boundary without creating a tag or contacting GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/release.yml"
CONTAINER_WORKFLOW="$ROOT/.github/workflows/container.yml"
REHEARSAL="$ROOT/scripts/rehearse-release.sh"
CHECK="$ROOT/scripts/check.sh"

fail() {
  printf 'test-release-workflow: %s\n' "$1" >&2
  exit 1
}

for path in "$WORKFLOW" "$CONTAINER_WORKFLOW" "$REHEARSAL" "$CHECK" "$ROOT/scripts/test-release-workflow.sh"; do
  [[ -f "$path" ]] || fail "missing $path"
done
bash -n "$REHEARSAL" "$ROOT/scripts/test-release-workflow.sh"

grep -Fq 'Linux) bash scripts/test-release-build.sh ;;' "$CHECK" ||
  fail "Linux check gate must run deterministic release production."
grep -Fq "Darwin) printf '%s\\n' 'release build determinism: skipped (Linux x86_64 artifact only)' ;;" "$CHECK" ||
  fail "macOS check gate must skip only Linux artifact production."

grep -Fq 'tags: ["v[0-9]+.[0-9]+.[0-9]+"]' "$WORKFLOW" || fail "workflow tag filter is not canonical SemVer."
grep -Fq 'contents: read' "$WORKFLOW" || fail "workflow lacks read-only default permissions."
grep -A5 '^  publish:' "$WORKFLOW" | grep -Fq 'contents: write' || fail "publication job lacks contents: write."
[[ "$(grep -Fc 'contents: write' "$WORKFLOW")" == 1 ]] || fail "contents: write must be limited to publication."
[[ "$(grep -Fc 'persist-credentials: false' "$WORKFLOW")" == 2 ]] || fail "every checkout must disable persisted credentials."
[[ "$(grep -Fc 'ref: ${{ github.ref }}' "$WORKFLOW")" == 2 ]] || fail "every checkout must select the pushed ref."
[[ "$(grep -Fc 'astral-sh/setup-uv@c771a70e6277c0a99b617c7a806ffedaca235ff9' "$WORKFLOW")" == 2 ]] || fail "every job that runs release scripts must install pinned uv."
[[ "$(grep -Fc 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020' "$WORKFLOW")" == 2 ]] || fail "every job that verifies release contents must install pinned Node."
grep -Fq 'workflow_dispatch:' "$CONTAINER_WORKFLOW" || fail "container workflow lacks manual release recovery."
[[ "$(grep -Fc "format('refs/tags/{0}', inputs.tag)" "$CONTAINER_WORKFLOW")" == 2 ]] ||
  fail "container recovery must check out the requested tag in both jobs."
grep -Fq 'IMAGE="ghcr.io/${GITHUB_REPOSITORY,,}"' "$CONTAINER_WORKFLOW" ||
  fail "container image repository must be normalized to lowercase."
grep -Fq 'SOURCE_SHA="$(git rev-parse HEAD)"' "$CONTAINER_WORKFLOW" ||
  fail "container SHA tag must identify the checked-out release commit."
if grep -Fq 'github.repository_owner' "$CONTAINER_WORKFLOW"; then
  fail "container image path must not preserve mixed-case repository ownership."
fi
for required in \
  'astral-sh/setup-uv@c771a70e6277c0a99b617c7a806ffedaca235ff9' \
  'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86' \
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020' \
  'pnpm install --frozen-lockfile' \
  'bash scripts/check.sh' \
  'bash scripts/build-release.sh' \
  'bash scripts/check-release-contents.sh' \
  'bash scripts/smoke-release.sh' \
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' \
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c' \
  'gh release create'; do
  grep -Fq "$required" "$WORKFLOW" || fail "workflow is missing $required."
done
for forbidden in 'git tag' 'git push' 'gh release' 'curl ' 'wget '; do
  if grep -Fq "$forbidden" "$REHEARSAL"; then fail "rehearsal must not contain $forbidden"; fi
done
for required in \
  'git -C "$ROOT" archive --format=tar HEAD' \
  'git -C "$SOURCE" init -q' \
  'env -i' \
  'COREPACK_HOME=$WORK/corepack' \
  'JOB_TRACKER_RELEASE_DIR="$RELEASE_DIR"' \
  'PUBLISHED_DIR' \
  'DOWNLOADED_DIR' \
  'PORT=34656' \
  'cp -a --reflink=auto "$ROOT/$path" "$SOURCE/$path"' \
  'VP_SKIP_INSTALL=1' \
  'pnpm_config_verify_deps_before_run=warn' \
  'CI=true' \
  'bash scripts/check.sh' \
  'bash scripts/check-release-contents.sh' \
  'bash scripts/smoke-release.sh'; do
  grep -Fq "$required" "$REHEARSAL" || fail "rehearsal is missing $required."
done

printf 'release workflow contract OK\n'

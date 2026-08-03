#!/usr/bin/env bash
# Statically hold the C2 release boundary without creating a tag or contacting GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/release.yml"
REHEARSAL="$ROOT/scripts/rehearse-release.sh"

fail() {
  printf 'test-release-workflow: %s\n' "$1" >&2
  exit 1
}

for path in "$WORKFLOW" "$REHEARSAL" "$ROOT/scripts/test-release-workflow.sh"; do
  [[ -f "$path" ]] || fail "missing $path"
done
bash -n "$REHEARSAL" "$ROOT/scripts/test-release-workflow.sh"

grep -Fq 'tags: ["v[0-9]+.[0-9]+.[0-9]+"]' "$WORKFLOW" || fail "workflow tag filter is not canonical SemVer."
grep -Fq 'contents: read' "$WORKFLOW" || fail "workflow lacks read-only default permissions."
grep -A5 '^  publish:' "$WORKFLOW" | grep -Fq 'contents: write' || fail "publication job lacks contents: write."
[[ "$(grep -Fc 'contents: write' "$WORKFLOW")" == 1 ]] || fail "contents: write must be limited to publication."
[[ "$(grep -Fc 'persist-credentials: false' "$WORKFLOW")" == 2 ]] || fail "every checkout must disable persisted credentials."
[[ "$(grep -Fc 'ref: ${{ github.ref }}' "$WORKFLOW")" == 2 ]] || fail "every checkout must select the pushed ref."
[[ "$(grep -Fc 'astral-sh/setup-uv@c771a70e6277c0a99b617c7a806ffedaca235ff9' "$WORKFLOW")" == 2 ]] || fail "every job that runs release scripts must install pinned uv."
[[ "$(grep -Fc 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020' "$WORKFLOW")" == 2 ]] || fail "every job that verifies release contents must install pinned Node."
for required in \
  'astral-sh/setup-uv@c771a70e6277c0a99b617c7a806ffedaca235ff9' \
  'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271' \
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020' \
  'pnpm install --frozen-lockfile' \
  'bash scripts/check.sh' \
  'bash scripts/build-release.sh' \
  'bash scripts/check-release-contents.sh' \
  'bash scripts/smoke-release.sh' \
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02' \
  'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093' \
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

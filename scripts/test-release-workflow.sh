#!/usr/bin/env bash
# Check release boundaries without creating tags or contacting GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/release.yml"
CONTAINER_WORKFLOW="$ROOT/.github/workflows/container.yml"
COMPOSE="$ROOT/compose.yaml"
REHEARSAL="$ROOT/scripts/rehearse-release.sh"
CHECK="$ROOT/scripts/check.sh"

fail() {
  printf 'test-release-workflow: %s\n' "$1" >&2
  exit 1
}

for path in "$WORKFLOW" "$CONTAINER_WORKFLOW" "$COMPOSE" "$REHEARSAL" "$CHECK" "$ROOT/scripts/test-release-workflow.sh"; do
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
[[ "$(grep -Fc 'astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d' "$WORKFLOW")" == 2 ]] || fail "every job that runs release scripts must install pinned uv."
[[ "$(grep -Fc 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020' "$WORKFLOW")" == 2 ]] || fail "every job that verifies release contents must install pinned Node."
grep -Fq 'workflow_dispatch:' "$CONTAINER_WORKFLOW" || fail "container workflow lacks manual release recovery."
[[ "$(grep -Fc "format('refs/tags/{0}', inputs.tag)" "$CONTAINER_WORKFLOW")" == 2 ]] ||
  fail "container recovery must check out the requested tag in both jobs."
grep -Fq 'IMAGE="ghcr.io/${GITHUB_REPOSITORY,,}"' "$CONTAINER_WORKFLOW" ||
  fail "container image repository must be normalized to lowercase."
grep -Fq 'SOURCE_SHA="$(git rev-parse HEAD)"' "$CONTAINER_WORKFLOW" ||
  fail "container SHA tag must identify the checked-out release commit."
grep -A5 '^      update_latest:' "$CONTAINER_WORKFLOW" | grep -Fq 'default: false' ||
  fail "manual container recovery must not move latest by default."
grep -Fq "UPDATE_LATEST: \${{ github.event_name == 'push' || inputs.update_latest }}" "$CONTAINER_WORKFLOW" ||
  fail "canonical tag pushes must update latest."
grep -Fq 'TAGS+=(--tag "$IMAGE:latest")' "$CONTAINER_WORKFLOW" ||
  fail "container publication lacks the current-stable latest alias."
VERSION="$(tr -d '[:space:]' <"$ROOT/VERSION")"
grep -Fq "image: \${JOB_TRACKER_IMAGE:-ghcr.io/muatasim-aswad/job-tracker:v$VERSION}" "$COMPOSE" ||
  fail "Compose default image must match VERSION."
if grep -Fq 'github.repository_owner' "$CONTAINER_WORKFLOW"; then
  fail "container image path must not preserve mixed-case repository ownership."
fi
for required in \
  'astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d' \
  'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413' \
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

for argument in APP_REVISION APP_COMMIT_TIME APP_BUILD_TIME APP_IDENTITY_ATTESTED SOURCE_DATE_EPOCH; do
  grep -Fq -- "--build-arg \"$argument=" "$CONTAINER_WORKFLOW" || fail "container publication omits $argument."
  grep -Fq "$argument:" "$COMPOSE" || fail "Compose build omits $argument."
done
grep -Fq 'build-metadata.py --require-release' "$WORKFLOW" || fail "release workflow omits original-source attestation."
python3 - "$WORKFLOW" <<'PY'
import sys
from pathlib import Path

workflow = Path(sys.argv[1]).read_text()
for heading in (
    "Verify downloaded artifact names, contents, and checksums",
    "Smoke-test the downloaded runtime bundle and wheel",
):
    block = workflow.split(f"- name: {heading}", 1)[1].split("\n      - name:", 1)[0]
    assert "build-metadata.py --require-release --format shell" in block, heading
    assert 'source "$RUNNER_TEMP/' in block, heading
    assert block.index("build-metadata.py") < block.index("bash scripts/check-release-contents.sh"), heading
print("downloaded artifacts and smokes bind to the checked-out release commit")
PY
grep -Fq 'build-metadata.py" --require-release' "$REHEARSAL" || fail "export rehearsal omits original-source attestation."
grep -Fq '"APP_REVISION=$APP_REVISION"' "$REHEARSAL" || fail "export rehearsal omits revision propagation."
grep -Fq '/version.json' "$ROOT/Dockerfile" || fail "container health must compare served identity."
printf 'release workflow and build identity caller contract OK\n'

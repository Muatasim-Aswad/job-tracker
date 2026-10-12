#!/usr/bin/env bash
# Exercise the release workflow locally without a tag, network upload, or retained output.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' <"$ROOT/VERSION")"
TAG="${JOB_TRACKER_RELEASE_TAG:-v$VERSION}"
PORT=34656
WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-release-rehearsal.XXXXXX")"
SOURCE="$WORK/source"
RELEASE_DIR="$WORK/release"
PUBLISHED_DIR="$WORK/published"
DOWNLOADED_DIR="$WORK/downloaded"
COREPACK_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/node/corepack"

cleanup() {
  rm -rf -- "$WORK"
}
trap cleanup EXIT

fail() {
  printf 'rehearse-release: %s\n' "$1" >&2
  exit 1
}

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "VERSION must be plain SemVer."
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "release tag must be canonical vX.Y.Z."
[[ "$TAG" == "v$VERSION" ]] || fail "release tag and VERSION disagree."

# Stage tracked inputs through a temporary index; keep all Git writes under WORK.
# Ignored overlays, environments, databases, and other checkout state stay excluded.
mkdir "$SOURCE"
git -C "$ROOT" archive --format=tar HEAD | tar -xf - -C "$SOURCE"
git -C "$SOURCE" init -q
git -C "$SOURCE" add --all
for path in node_modules apps/web/node_modules apps/extension/node_modules packages/shared/node_modules; do
  [[ -d "$ROOT/$path" ]] || fail "workspace dependencies are missing; run bash scripts/setup.sh first."
  mkdir -p "$SOURCE/$(dirname "$path")"
  # Reflinks isolate dependency mutations cheaply; auto falls back to portable copies.
  cp -a --reflink=auto "$ROOT/$path" "$SOURCE/$path"
done
# Copied task caches retain absolute paths; discard them to prevent outside writes.
if [[ -d "$SOURCE/node_modules/.vite/task-cache" ]]; then
  find "$SOURCE/node_modules/.vite/task-cache" -depth -delete
fi
[[ -d "$COREPACK_CACHE" ]] || fail "the prepared Corepack cache is missing."
cp -a "$COREPACK_CACHE" "$WORK/corepack"

safe_env=(
  env -i
  "PATH=$PATH"
  "HOME=$WORK/home"
  "XDG_DATA_HOME=$WORK/data"
  "XDG_CONFIG_HOME=$WORK/config"
  "XDG_STATE_HOME=$WORK/state"
  "UV_CACHE_DIR=$WORK/uv-cache"
  "UV_HTTP_RETRIES=5"
  "COREPACK_HOME=$WORK/corepack"
  "VP_SKIP_INSTALL=1"
  "pnpm_config_verify_deps_before_run=warn"
  "CI=true"
)
mkdir -p "$WORK/home" "$WORK/data" "$WORK/config" "$WORK/state" "$WORK/uv-cache"

(
  cd "$SOURCE"
  # Use isolated prepared dependencies with automatic installation disabled;
  # verification must not mutate the coordinator checkout.
  "${safe_env[@]}" bash scripts/check.sh
  "${safe_env[@]}" JOB_TRACKER_RELEASE_DIR="$RELEASE_DIR" bash scripts/build-release.sh
  "${safe_env[@]}" bash scripts/check-release-contents.sh "$RELEASE_DIR"

  # Simulate handoff/download locally; runtime smoke owns port 34656.
  mkdir "$PUBLISHED_DIR" "$DOWNLOADED_DIR"
  cp "$RELEASE_DIR"/* "$PUBLISHED_DIR/"
  cp "$PUBLISHED_DIR"/* "$DOWNLOADED_DIR/"
  "${safe_env[@]}" bash scripts/check-release-contents.sh "$DOWNLOADED_DIR"
  grep -Fxq "PORT=$PORT" scripts/smoke-release.sh || fail "release smoke must use port $PORT."
  "${safe_env[@]}" bash scripts/smoke-release.sh "$DOWNLOADED_DIR/job-tracker-$VERSION-linux-x86_64.tar.gz"
)

printf 'release rehearsal OK: %s (local-only; no tag, upload, or release created)\n' "$TAG"

#!/usr/bin/env bash
# Build the resource-complete end-user wheel from isolated public staging files.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' <"$ROOT/VERSION")"
RELEASE_DIR="${JOB_TRACKER_RELEASE_DIR:-$ROOT/dist/release}"
WEB_DIST_SOURCE="${JOB_TRACKER_WEB_DIST:-}"

fail() {
  printf 'build-wheel: %s\n' "$1" >&2
  exit 1
}

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "VERSION must be plain SemVer."
RELEASE_DIR="$(realpath -m "$RELEASE_DIR")"
case "$RELEASE_DIR" in
  "$ROOT/dist/release" | /tmp/*) ;;
  *) fail "JOB_TRACKER_RELEASE_DIR must be $ROOT/dist/release or a disposable /tmp path." ;;
esac
[[ "$RELEASE_DIR" != / && "$RELEASE_DIR" != /tmp ]] || fail "refusing an unsafe release directory."

WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-wheel.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT

copy_tracked() {
  local destination="$1"
  shift
  local manifest="$WORK/tracked-files"
  git -C "$ROOT" ls-files -z -- "$@" >"$manifest"
  [[ -s "$manifest" ]] || fail "tracked-file allowlist was empty."
  tar -C "$ROOT" --null --verbatim-files-from --no-recursion --files-from="$manifest" -cf - |
    tar -C "$destination" -xf -
}

if [[ -z "$WEB_DIST_SOURCE" ]]; then
  BUILD_SOURCE="$WORK/public-source"
  mkdir -p "$BUILD_SOURCE"
  copy_tracked "$BUILD_SOURCE" \
    VERSION package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vite.config.ts \
    apps/web packages
  [[ -d "$ROOT/node_modules" ]] || fail "workspace dependencies are missing; run bash scripts/setup.sh first."
  ln -s "$ROOT/node_modules" "$BUILD_SOURCE/node_modules"
  for package_dir in apps/web packages/shared; do
    [[ -d "$ROOT/$package_dir/node_modules" ]] ||
      fail "workspace dependencies are missing for $package_dir; run bash scripts/setup.sh first."
    ln -s "$ROOT/$package_dir/node_modules" "$BUILD_SOURCE/$package_dir/node_modules"
  done
  (
    cd "$BUILD_SOURCE/apps/web"
    node "$ROOT/node_modules/vite-plus/bin/vp" build
  )
  WEB_DIST_SOURCE="$BUILD_SOURCE/apps/web/dist"
fi

WEB_DIST_SOURCE="$(realpath -e "$WEB_DIST_SOURCE")" || fail "dashboard build does not exist."
[[ -f "$WEB_DIST_SOURCE/index.html" ]] || fail "dashboard build has no index.html."

STAGE="$WORK/stage"
mkdir -p "$STAGE"
(
  cd "$ROOT"
  find apps/api/app -type f \( -name '*.py' -o -name '*.sql' \) \
    -not -path '*/__pycache__/*' -print0 >"$WORK/api-files"
)
[[ -s "$WORK/api-files" ]] || fail "API source allowlist was empty."
tar -C "$ROOT" --null --verbatim-files-from --no-recursion --files-from="$WORK/api-files" -cf - |
  tar -C "$STAGE" -xf -
mv "$STAGE/apps/api/app" "$STAGE/app"
rmdir "$STAGE/apps/api" "$STAGE/apps"
cp "$ROOT/apps/api/pyproject.toml" "$STAGE/pyproject.toml"
cp "$ROOT/apps/api/README.md" "$STAGE/README.md"
cp "$ROOT/LICENSE" "$STAGE/LICENSE"

# The checkout metadata remains deliberately non-release metadata. Only this
# isolated staging copy receives the canonical distribution name and VERSION.
sed -i 's/^name = "job-tracker-api"$/name = "job-tracker"/' "$STAGE/pyproject.toml"
sed -i "s/^version = \"0.1.0\"$/version = \"$VERSION\"/" "$STAGE/pyproject.toml"
sed -i '/^description = /a readme = "README.md"\nlicense = "MIT"\nlicense-files = ["LICENSE"]' "$STAGE/pyproject.toml"
grep -Fxq 'name = "job-tracker"' "$STAGE/pyproject.toml" || fail "could not stage wheel name."
grep -Fxq "version = \"$VERSION\"" "$STAGE/pyproject.toml" || fail "could not stage wheel version."
grep -Fxq 'readme = "README.md"' "$STAGE/pyproject.toml" || fail "could not stage wheel readme."
grep -Fxq 'license-files = ["LICENSE"]' "$STAGE/pyproject.toml" || fail "could not stage wheel license."

mkdir -p "$STAGE/app/resources/apps/web/dist"
cp "$ROOT/VERSION" "$STAGE/app/resources/VERSION"
cp -a "$WEB_DIST_SOURCE/." "$STAGE/app/resources/apps/web/dist/"

mkdir -p "$WORK/output" "$RELEASE_DIR"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-315532800}" \
  uv build --wheel --no-create-gitignore --out-dir "$WORK/output" "$STAGE"
WHEEL="$WORK/output/job_tracker-$VERSION-py3-none-any.whl"
[[ -f "$WHEEL" ]] || fail "uv did not produce the expected wheel name."
cp "$WHEEL" "$RELEASE_DIR/$(basename "$WHEEL")"

printf 'built wheel: %s/%s\n' "$RELEASE_DIR" "$(basename "$WHEEL")"

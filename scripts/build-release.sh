#!/usr/bin/env bash
# Build public, reproducible release artifacts from an explicit tracked-file allowlist.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' <"$ROOT/VERSION")"
RELEASE_DIR="${JOB_TRACKER_RELEASE_DIR:-$ROOT/dist/release}"
EPOCH="${SOURCE_DATE_EPOCH:-315532800}" # 1980-01-01: valid for both tar and ZIP.

fail() {
  printf 'build-release: %s\n' "$1" >&2
  exit 1
}

command -v zip >/dev/null 2>&1 ||
  fail "zip is required to build the extension archive; install it and retry."

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "VERSION must be plain SemVer."
[[ "$EPOCH" =~ ^[0-9]+$ ]] || fail "SOURCE_DATE_EPOCH must be an integer."

RELEASE_DIR="$(realpath -m "$RELEASE_DIR")"
case "$RELEASE_DIR" in
  "$ROOT/dist/release" | /tmp/*) ;;
  *) fail "JOB_TRACKER_RELEASE_DIR must be $ROOT/dist/release or a disposable /tmp path." ;;
esac
[[ "$RELEASE_DIR" != / && "$RELEASE_DIR" != /tmp ]] || fail "refusing an unsafe release directory."

WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-release.XXXXXX")"
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

BUILD_SOURCE="$WORK/public-source"
RUNTIME="$WORK/runtime"
mkdir -p "$BUILD_SOURCE" "$RUNTIME"
python3 "$ROOT/scripts/build-metadata.py" --format shell --output "$WORK/identity.env"
source "$WORK/identity.env"
export VP_SKIP_INSTALL=1 pnpm_config_verify_deps_before_run=warn

# Tracked public files alone can influence artifacts; ignored overlays and .env stay excluded.
copy_tracked "$BUILD_SOURCE" \
  VERSION package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vite.config.ts \
  apps/web apps/extension packages \
  scripts/build-metadata.py scripts/build-metadata.mjs scripts/third-party-notices.mjs \
  apps/api/app/core/build_info.py

# Reuse the prepared toolchain read-only to avoid user package-store writes.
[[ -d "$ROOT/node_modules" ]] || fail "workspace dependencies are missing; run bash scripts/setup.sh first."
ln -s "$ROOT/node_modules" "$BUILD_SOURCE/node_modules"
for package_dir in apps/web apps/extension packages/shared; do
  [[ -d "$ROOT/$package_dir/node_modules" ]] ||
    fail "workspace dependencies are missing for $package_dir; run bash scripts/setup.sh first."
  ln -s "$ROOT/$package_dir/node_modules" "$BUILD_SOURCE/$package_dir/node_modules"
done

(
  cd "$BUILD_SOURCE/apps/web"
  node "$ROOT/node_modules/vite-plus/bin/vp" build
)
(
  cd "$BUILD_SOURCE/apps/extension"
  node "$ROOT/node_modules/vite-plus/bin/vp" build
)

# Stage only packaged CLI sources, production metadata, dashboard, version, license, and launcher.
copy_tracked "$RUNTIME" VERSION LICENSE apps/api/app apps/api/pyproject.toml apps/api/uv.lock
python3 "$ROOT/scripts/build-metadata.py" --output "$RUNTIME/BUILD_INFO.json"
uv run --no-sync --directory "$ROOT/apps/api" python "$ROOT/scripts/third-party-notices.py" \
  --lock "$ROOT/apps/api/uv.lock" --output-dir "$RUNTIME"
mkdir -p "$RUNTIME/apps/web/dist"
cp -a "$BUILD_SOURCE/apps/web/dist/." "$RUNTIME/apps/web/dist/"

cat >"$RUNTIME/job-tracker" <<'WRAPPER'
#!/usr/bin/env sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -eq 1 ] && [ "$1" = build-info ]; then
  exec cat "$APP_DIR/BUILD_INFO.json"
fi
if [ "$#" -eq 1 ] && [ "$1" = version ]; then
  exec cat "$APP_DIR/VERSION"
fi
if ! command -v uv >/dev/null 2>&1; then
  printf '%s\n' 'job-tracker: uv is required by this runtime bundle; install uv and retry.' >&2
  exit 127
fi

exec uv run --frozen --no-dev --directory "$APP_DIR/apps/api" python -m app.cli \
  --profile packaged --app-dir "$APP_DIR" "$@"
WRAPPER
chmod 0755 "$RUNTIME/job-tracker"

# Normalize metadata after generation for byte-identical archives.
find "$RUNTIME" -exec touch -h -d "@$EPOCH" {} +

rm -rf -- "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
RUNTIME_ARCHIVE="$RELEASE_DIR/job-tracker-$VERSION-linux-x86_64.tar.gz"
EXTENSION_ARCHIVE="$RELEASE_DIR/job-tracker-extension-$VERSION.zip"
WHEEL="$RELEASE_DIR/job_tracker-$VERSION-py3-none-any.whl"

tar --sort=name --mtime="@$EPOCH" --owner=0 --group=0 --numeric-owner \
  -C "$RUNTIME" -cf - . | gzip -n >"$RUNTIME_ARCHIVE"

(
  cd "$BUILD_SOURCE/apps/extension/dist"
  find . -exec touch -h -d "@$EPOCH" {} +
  find . -type f -print | LC_ALL=C sort | zip -X -q "$EXTENSION_ARCHIVE" -@
)

JOB_TRACKER_RELEASE_DIR="$RELEASE_DIR" \
  JOB_TRACKER_WEB_DIST="$BUILD_SOURCE/apps/web/dist" \
  bash "$ROOT/scripts/build-wheel.sh"
[[ -f "$WHEEL" ]] || fail "wheel builder did not produce the expected artifact."

(
  cd "$RELEASE_DIR"
  sha256sum \
    "$(basename "$RUNTIME_ARCHIVE")" \
    "$(basename "$EXTENSION_ARCHIVE")" \
    "$(basename "$WHEEL")" >SHA256SUMS
)

printf 'built runtime bundle: %s\n' "$RUNTIME_ARCHIVE"
printf 'built extension ZIP: %s\n' "$EXTENSION_ARCHIVE"
printf 'built wheel: %s\n' "$WHEEL"
printf 'built checksums: %s/SHA256SUMS\n' "$RELEASE_DIR"

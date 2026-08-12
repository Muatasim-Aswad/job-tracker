#!/usr/bin/env bash
# Assert the exact public release shape without reading local overlays or configuration.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${1:-$ROOT/dist/release}"
VERSION="$(tr -d '[:space:]' <"$ROOT/VERSION")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-release-check.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT

fail() {
  printf 'check-release-contents: %s\n' "$1" >&2
  exit 1
}

RELEASE_DIR="$(realpath -e "$RELEASE_DIR")" || fail "release directory does not exist."
RUNTIME="job-tracker-$VERSION-linux-x86_64.tar.gz"
EXTENSION="job-tracker-extension-$VERSION.zip"
WHEEL="job_tracker-$VERSION-py3-none-any.whl"
EXPECTED=(SHA256SUMS "$RUNTIME" "$EXTENSION" "$WHEEL")

mapfile -t actual < <(find "$RELEASE_DIR" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)
[[ "${actual[*]}" == "${EXPECTED[*]}" ]] || fail "release directory must contain only $RUNTIME, $EXTENSION, $WHEEL, and SHA256SUMS."

(
  cd "$RELEASE_DIR"
  sha256sum -c SHA256SUMS
)

mkdir -p "$WORK/runtime"
tar -xzf "$RELEASE_DIR/$RUNTIME" -C "$WORK/runtime"
mapfile -t runtime_paths < <(tar -tzf "$RELEASE_DIR/$RUNTIME" | sed 's#^\./##')
for required in VERSION LICENSE job-tracker apps/api/pyproject.toml apps/api/uv.lock apps/api/app/main.py apps/api/app/core/schema.sql apps/web/dist/index.html; do
  printf '%s\n' "${runtime_paths[@]}" | grep -Fxq "$required" || fail "runtime is missing $required."
done
for path in "${runtime_paths[@]}"; do
  normalized="${path%/}"
  case "$normalized" in
    '' | . | apps | apps/api | apps/api/app | apps/web | apps/web/dist | apps/api/app/* | apps/web/dist/* | VERSION | LICENSE | job-tracker | apps/api/pyproject.toml | apps/api/uv.lock) ;;
    *) fail "runtime contains a non-allowlisted path: $path" ;;
  esac
  case "$path" in
    *'.env'* | *'.db'* | *'__pycache__'* | *'.pyc' | *'.map' | *'node_modules'* | *'/local/'* | *'/tests/'* | *'fixture'* | *'docs/plans/'*)
      fail "runtime contains forbidden path: $path"
      ;;
  esac
done
[[ -x "$WORK/runtime/job-tracker" ]] || fail "runtime launcher is not executable."
grep -Fq 'uv run --frozen --no-dev' "$WORK/runtime/job-tracker" || fail "runtime launcher is not frozen production uv."
grep -Fq -- '--profile packaged' "$WORK/runtime/job-tracker" || fail "runtime launcher does not select packaged profile."
if rg -a -Fq "$ROOT" "$WORK/runtime"; then
  fail "runtime contains a build-machine absolute path."
fi

mapfile -t extension_paths < <(unzip -Z1 "$RELEASE_DIR/$EXTENSION" | LC_ALL=C sort)
printf '%s\n' "${extension_paths[@]}" | grep -Fxq manifest.json || fail "extension ZIP has no root manifest.json."
for path in "${extension_paths[@]}"; do
  case "$path" in
    /* | ./* | */../* | ../* | *'.map' | *'.env'* | *'.db'* | *'node_modules'* | *'/local/'* | *'/fixtures/'*)
      fail "extension ZIP contains forbidden path: $path"
      ;;
  esac
done
unzip -q "$RELEASE_DIR/$EXTENSION" -d "$WORK/extension"
node --input-type=module - "$WORK/extension/manifest.json" "$VERSION" <<'NODE'
import { readFileSync } from "node:fs";

const [manifestPath, version] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const expectedHosts = new Set([
  "http://localhost:3456/api/*",
  "https://www.linkedin.com/*",
  "https://mail.google.com/*",
]);
const actualHosts = new Set(manifest.host_permissions ?? []);
if (manifest.version !== version) throw new Error(`manifest version is ${manifest.version}, expected ${version}`);
if (actualHosts.size !== expectedHosts.size || [...expectedHosts].some((host) => !actualHosts.has(host))) {
  throw new Error(`public host allowlist mismatch: ${[...actualHosts].join(", ")}`);
}
NODE

mapfile -t wheel_paths < <(unzip -Z1 "$RELEASE_DIR/$WHEEL" | LC_ALL=C sort)
for required in \
  app/cli.py \
  app/core/schema.sql \
  app/resources/VERSION \
  app/resources/apps/web/dist/index.html \
  "job_tracker-$VERSION.dist-info/METADATA" \
  "job_tracker-$VERSION.dist-info/licenses/LICENSE" \
  "job_tracker-$VERSION.dist-info/entry_points.txt"; do
  printf '%s\n' "${wheel_paths[@]}" | grep -Fxq "$required" || fail "wheel is missing $required."
done
for path in "${wheel_paths[@]}"; do
  case "$path" in
    /* | ./* | */../* | ../* | *'.env'* | *'.db'* | *'__pycache__'* | *'.pyc' | *'.map' | *'node_modules'* | *'/local/'* | *'/tests/'* | *'fixture'* | *'docs/plans/'*)
      fail "wheel contains forbidden path: $path"
      ;;
  esac
done
unzip -p "$RELEASE_DIR/$WHEEL" "job_tracker-$VERSION.dist-info/METADATA" >"$WORK/wheel-metadata"
grep -Fxq 'Name: job-tracker' "$WORK/wheel-metadata" || fail "wheel distribution name is not canonical."
grep -Fxq "Version: $VERSION" "$WORK/wheel-metadata" || fail "wheel version disagrees with VERSION."
unzip -p "$RELEASE_DIR/$WHEEL" app/resources/VERSION | grep -Fxq "$VERSION" || fail "wheel resource version disagrees with VERSION."
unzip -p "$RELEASE_DIR/$WHEEL" "job_tracker-$VERSION.dist-info/entry_points.txt" |
  grep -Fxq 'job-tracker = app.cli:main' || fail "wheel has no job-tracker console entry point."
mkdir "$WORK/wheel"
unzip -q "$RELEASE_DIR/$WHEEL" -d "$WORK/wheel"
if rg -a -Fq "$ROOT" "$WORK/wheel"; then
  fail "wheel contains a build-machine absolute path."
fi

printf 'release contents OK: %s\n' "$RELEASE_DIR"

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
for required in VERSION LICENSE BUILD_INFO.json THIRD_PARTY_NOTICES.python.txt THIRD_PARTY_INVENTORY.python.json job-tracker apps/api/pyproject.toml apps/api/uv.lock apps/api/app/main.py apps/api/app/core/schema.sql apps/web/dist/index.html apps/web/dist/version.json apps/web/dist/THIRD_PARTY_NOTICES.txt apps/web/dist/THIRD_PARTY_INVENTORY.json apps/web/dist/THIRD_PARTY_NOTICES.sw.txt apps/web/dist/THIRD_PARTY_INVENTORY.sw.json; do
  # Drain the listing: grep -q can SIGPIPE printf and fail a present path under pipefail.
  printf '%s\n' "${runtime_paths[@]}" | grep -Fx "$required" >/dev/null || fail "runtime is missing $required."
done
for path in "${runtime_paths[@]}"; do
  normalized="${path%/}"
  case "$normalized" in
    '' | . | apps | apps/api | apps/api/app | apps/web | apps/web/dist | apps/api/app/* | apps/web/dist/* | VERSION | LICENSE | BUILD_INFO.json | THIRD_PARTY_NOTICES.python.txt | THIRD_PARTY_INVENTORY.python.json | job-tracker | apps/api/pyproject.toml | apps/api/uv.lock) ;;
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
printf '%s\n' "${extension_paths[@]}" | grep -Fx manifest.json >/dev/null || fail "extension ZIP has no root manifest.json."
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
  app/resources/BUILD_INFO.json \
  app/resources/THIRD_PARTY_NOTICES.python.txt \
  app/resources/THIRD_PARTY_INVENTORY.python.json \
  app/resources/apps/web/dist/index.html \
  "job_tracker-$VERSION.dist-info/METADATA" \
  "job_tracker-$VERSION.dist-info/licenses/LICENSE" \
  "job_tracker-$VERSION.dist-info/entry_points.txt"; do
  printf '%s\n' "${wheel_paths[@]}" | grep -Fx "$required" >/dev/null || fail "wheel is missing $required."
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

python3 - "$WORK" "$VERSION" "$ROOT" <<'PY'
import json, os, re, runpy, sys
from pathlib import Path

root = Path(sys.argv[1])
runtime = root / "runtime"
web = runtime / "apps/web/dist"
extension = root / "extension"
wheel = root / "wheel/app/resources"
validate = runpy.run_path(str(Path(sys.argv[3]) / "apps/api/app/core/build_info.py"))["validate_info"]
infos = [validate(json.loads(path.read_text()), sys.argv[2]) for path in (
    runtime / "BUILD_INFO.json", web / "version.json", extension / "version.json",
    wheel / "BUILD_INFO.json", wheel / "apps/web/dist/version.json",
)]
assert all(info == infos[0] for info in infos), "artifact build identities differ"
info = infos[0]
assert set(info) == {"version", "revision", "commit_time", "build_time", "dev"}
assert info["version"] == sys.argv[2]
assert type(info["dev"]) is bool and info["dev"] == (info["revision"] == "dev")
assert info["revision"] == "dev" or re.fullmatch(r"[0-9a-f]{40,64}", info["revision"])
if os.environ.get("APP_IDENTITY_ATTESTED") == "1":
    assert info["revision"] == os.environ["APP_REVISION"], "candidate revision mismatch"
    assert info["commit_time"] == (os.environ.get("APP_COMMIT_TIME") or None)
    assert info["build_time"] == os.environ["APP_BUILD_TIME"]
for directory, suffix, expected in (
    (web, "", "lucide-react"), (extension, "", "lucide-static"),
    (web, ".sw", "workbox-precaching"), (runtime, ".python", "fastapi"),
    (wheel, ".python", "fastapi"),
):
    inventory = json.loads((directory / f"THIRD_PARTY_INVENTORY{suffix}.json").read_text())
    notices = (directory / f"THIRD_PARTY_NOTICES{suffix}.txt").read_text()
    assert expected in {entry["name"] for entry in inventory}, f"missing {expected} attribution"
    assert all(entry["licenses"] for entry in inventory)
    for entry in inventory:
        assert f"{entry['name']}@{entry['version']}" in notices
        assert all(re.fullmatch(r"[0-9a-f]{64}", license["sha256"]) for license in entry["licenses"])
    if expected.startswith("lucide"):
        assert "ISC License" in notices and "Cole Bemis" in notices and "MIT License" in notices
        names = {entry["name"] for entry in inventory}
        assert {"tailwindcss", "@voidzero-dev/vite-plus-core"} <= names
        assert ("vite-plugin-pwa" if directory == web else "@crxjs/vite-plugin") in names
assert (runtime / "THIRD_PARTY_NOTICES.python.txt").read_bytes() == (wheel / "THIRD_PARTY_NOTICES.python.txt").read_bytes()
assert (web / "THIRD_PARTY_NOTICES.txt").read_bytes() == (wheel / "apps/web/dist/THIRD_PARTY_NOTICES.txt").read_bytes()
assert (web / "THIRD_PARTY_NOTICES.sw.txt").read_bytes() == (wheel / "apps/web/dist/THIRD_PARTY_NOTICES.sw.txt").read_bytes()
assert "pytest" not in {entry["name"] for entry in json.loads((runtime / "THIRD_PARTY_INVENTORY.python.json").read_text())}
print("artifact identity and dependency attribution OK")
PY

printf 'release contents OK: %s\n' "$RELEASE_DIR"

#!/usr/bin/env bash
# Prove deterministic release builds and content checks for large asset inventories.
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

uv run --directory "$ROOT/apps/api" python - "$WORK/second" <<'PY'
import hashlib
import sys
import tarfile
from pathlib import Path

release = Path(sys.argv[1])
runtime = next(release.glob("*.tar.gz"))
candidate = runtime.with_suffix(".candidate")
with tarfile.open(runtime, "r:gz") as source, tarfile.open(candidate, "w:gz") as target:
    for member in source.getmembers():
        target.addfile(member, source.extractfile(member) if member.isfile() else None)
    for index in range(2048):
        target.addfile(tarfile.TarInfo(f"apps/web/dist/assets/content-check-{index}.js"))
candidate.replace(runtime)
checksums = [
    f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
    for path in sorted(release.iterdir())
    if path.name != "SHA256SUMS"
]
(release / "SHA256SUMS").write_text("".join(checksums))
PY
bash "$ROOT/scripts/check-release-contents.sh" "$WORK/second"
printf 'large release inventory checks OK\n'

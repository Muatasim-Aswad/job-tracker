#!/usr/bin/env bash
# Check artifact versions and canonical tags after builds produce the real manifest.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  printf 'check-version: %s\n' "$1" >&2
  exit 1
}

VERSION="$(tr -d '[:space:]' <VERSION)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  fail "VERSION must be a plain SemVer 'X.Y.Z'; found '$VERSION'."

# A version field here would be a second release authority that nothing reads.
if node -e 'process.exit("version" in require("./apps/extension/package.json") ? 0 : 1)'; then
  fail "apps/extension/package.json declares a 'version'; the root VERSION file owns it."
fi

MANIFEST="apps/extension/dist/manifest.json"
[[ -f "$MANIFEST" ]] ||
  fail "$MANIFEST is missing; run 'pnpm run build:ext' before this check."
MANIFEST_VERSION="$(node -e 'process.stdout.write(require("./'"$MANIFEST"'").version)')"
[[ "$MANIFEST_VERSION" == "$VERSION" ]] ||
  fail "built extension manifest is $MANIFEST_VERSION, VERSION is $VERSION."

# The API advertises the same number in its OpenAPI metadata (info.version).
API_VERSION="$(cd apps/api && uv run python -c 'from app.main import app; print(app.version)')"
[[ "$API_VERSION" == "$VERSION" ]] ||
  fail "API metadata is $API_VERSION, VERSION is $VERSION."

# HEAD release tags must match VERSION; historical tags need only canonical shape.
# Checks are inert in CI checkouts that fetch no tags.
while read -r tag; do
  [[ -z "$tag" ]] && continue
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    fail "tag '$tag' does not follow the vX.Y.Z release-tag convention."
done < <(git tag --list 'v*' 2>/dev/null || true)

while read -r tag; do
  [[ -z "$tag" ]] && continue
  [[ "$tag" == "v$VERSION" ]] ||
    fail "HEAD is tagged '$tag' but declares VERSION $VERSION; they must match."
done < <(git tag --points-at HEAD --list 'v*' 2>/dev/null || true)

printf 'version %s is consistent across VERSION, the built manifest, and the API.\n' "$VERSION"

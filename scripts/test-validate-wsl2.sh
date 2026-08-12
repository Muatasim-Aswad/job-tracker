#!/usr/bin/env bash
# Fast Linux-only contract checks for the manual WSL2 validation harness.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash -n "$ROOT/scripts/validate-wsl2.sh"
bash -n "$ROOT/scripts/test-validate-wsl2.sh"
"$ROOT/scripts/validate-wsl2.sh" --self-test

missing_checksums="$("$ROOT/scripts/validate-wsl2.sh" --artifact runtime.tar.gz --extension extension.zip 2>&1 || true)"
printf '%s\n' "$missing_checksums" | grep -Fq -- '--checksums is required for a real validation run' || {
  printf '%s\n' 'test-validate-wsl2: real runs must reject a missing checksum file.' >&2
  exit 1
}

for required in '--artifact' '--extension' '--checksums is required for a real validation run' "\$(uname -m)\" == x86_64" "grep -qi 'wsl2' /proc/sys/kernel/osrelease" '[[ "$(uname -s)" == Linux ]]' 'verify_supplied_hash "$ARTIFACT"' 'verify_supplied_hash "$EXTENSION"' 'runtime filename does not match extracted VERSION' 'extension filename does not match extracted runtime VERSION' 'job-tracker-validation' 'persistent XDG state root' 'backup' 'restore' 'Windows-host localhost' 'Candidate, unsupported'; do
  grep -Fq -- "$required" "$ROOT/scripts/validate-wsl2.sh" "$ROOT/docs/WSL2.md" "$ROOT/docs/evidence/wsl2-template.md" || {
    printf 'test-validate-wsl2: missing required WSL2 contract text: %s\n' "$required" >&2
    exit 1
  }
done
printf 'WSL2 harness contract OK\n'

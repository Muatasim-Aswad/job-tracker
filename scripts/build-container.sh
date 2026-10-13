#!/usr/bin/env bash
# Attest the original checkout before Docker discards Git identity.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/job-tracker-container-build.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
python3 "$ROOT/scripts/build-metadata.py" --format shell --output "$WORK/identity.env"
source "$WORK/identity.env"
cd "$ROOT"
if (($# == 0)); then set -- build; fi
docker compose --env-file /dev/null "$@"

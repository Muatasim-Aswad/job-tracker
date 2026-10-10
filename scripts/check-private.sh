#!/usr/bin/env bash
# Validate an installed private overlay with the public repository's toolchain.
#
# The private repository is only the editable source. Its files are copied into
# the gitignored local/ directories before this runs, giving lint and type-aware
# tools the same imports, configs, and dependencies as the application build.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_ROOT="${JOB_TRACKER_PRIVATE_DIR:-$ROOT/../job-tracker-private}"

if [[ ! -d "$PRIVATE_ROOT/overlay" ]]; then
  echo "private overlay: not installed; skipping"
  exit 0
fi

# Refuse to check stale installed files. sync-private.sh owns the allowlist and
# also verifies that the source is outside this public checkout.
JOB_TRACKER_PRIVATE_DIR="$PRIVATE_ROOT" bash "$ROOT/scripts/sync-private.sh" --check

ts_paths=(
  "$ROOT/apps/extension/src/adapters/local"
  "$ROOT/apps/web/src/platforms/local"
)

# These directories are deliberately gitignored, so explicitly opt them back
# into the format/lint gates. Enumerate files to avoid ignored-directory traversal.
# Keep formatter paths relative for fixture exclusions and Oxlint paths absolute
# to avoid its type-aware path-resolution panic on ignored relative inputs.
(
  cd "$ROOT"
  fmt_paths=()
  lint_paths=()
  for path in "${ts_paths[@]}"; do
    if [[ -d "$path" ]]; then
      while IFS= read -r -d '' file; do
        fmt_paths+=("${file#"$ROOT/"}")
        case "$file" in
          *.ts|*.tsx) lint_paths+=("$file") ;;
        esac
      done < <(find "$path" -type f -print0)
    fi
  done
  if (( ${#fmt_paths[@]} )); then
    pnpm exec vp fmt --check --ignore-path /dev/null "${fmt_paths[@]}"
  fi
  if (( ${#lint_paths[@]} )); then
    pnpm exec vp lint --no-ignore "${lint_paths[@]}"
  fi
)

python_path="$ROOT/apps/api/scripts/local"
if [[ -d "$python_path" ]]; then
  (
    cd "$ROOT/apps/api"
    uv run ruff format --check --no-respect-gitignore scripts/local
    uv run ruff check --no-respect-gitignore scripts/local
    uv run mypy scripts/local
  )
fi

echo "private overlay: source, formatting, and lint checks passed"

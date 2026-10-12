#!/usr/bin/env bash
# Validate installed overlays in the application context, using public workspace tooling.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_ROOT="${JOB_TRACKER_PRIVATE_DIR:-$ROOT/../job-tracker-private}"

if [[ ! -d "$PRIVATE_ROOT/overlay" ]]; then
  echo "private overlay: not installed; skipping"
  exit 0
fi

# Drift must fail before checking the installed copy; sync owns the destination allowlist.
JOB_TRACKER_PRIVATE_DIR="$PRIVATE_ROOT" bash "$ROOT/scripts/sync-private.sh" --check

ts_paths=(
  "$ROOT/apps/extension/src/adapters/local"
  "$ROOT/apps/web/src/platforms/local"
)

# Opt ignored overlays into lint/format explicitly. Relative formatter paths preserve
# fixture exclusions; absolute Oxlint paths avoid ignored-path resolution failures.
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

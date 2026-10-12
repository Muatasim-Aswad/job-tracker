#!/usr/bin/env bash
# Install the private source into allowlisted ignored destinations; absent overlays are valid.
# Use --check for report-only drift; source defaults to the sibling private repository
# or JOB_TRACKER_PRIVATE_DIR and must mirror destinations beneath overlay/.

set -euo pipefail

# Exact allowlist of overlay destinations (relative to the public repo root).
ALLOWED_DIRS=(
  "apps/extension/src/adapters/local"
  "apps/web/src/platforms/local"
  "apps/api/scripts/local"
)

# Files never copied, and never removed as "stale", regardless of location.
is_excluded() {
  case "$1" in
    *.env|*.env.*|*.db|*.db-*|*.sqlite|*.sqlite3|*.log|*.pyc) return 0 ;;
    *__pycache__/*|*.pytest_cache/*|*.mypy_cache/*) return 0 ;;
    *node_modules/*|*dist/*|*.venv/*|*script-output/*) return 0 ;;
    *browser-profile*|*.DS_Store) return 0 ;;
  esac
  return 1
}

MODE=sync
if [[ "${1:-}" == "--check" ]]; then
  MODE=check
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--check]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$ROOT/docs/PRIVATE.md" || ! -d "$ROOT/apps/extension" ]]; then
  echo "error: $ROOT does not look like the job-tracker repo root" >&2
  exit 2
fi

SRC_ROOT="${JOB_TRACKER_PRIVATE_DIR:-$ROOT/../job-tracker-private}"
if [[ ! -d "$SRC_ROOT" ]]; then
  echo "error: private repo not found at $SRC_ROOT" >&2
  echo "hint: clone it as a sibling of the public repo, or set JOB_TRACKER_PRIVATE_DIR" >&2
  exit 2
fi
SRC_ROOT="$(cd "$SRC_ROOT" && pwd)"
OVERLAY="$SRC_ROOT/overlay"
if [[ ! -d "$OVERLAY" ]]; then
  echo "error: $SRC_ROOT has no overlay/ directory — not a private overlay repo" >&2
  exit 2
fi
if [[ "$OVERLAY" == "$ROOT" || "$OVERLAY" == "$ROOT"/* ]]; then
  echo "error: private overlay source must live outside the public repo" >&2
  exit 2
fi

legacy_api_dir="$OVERLAY/server/scripts/local"
if [[ -d "$legacy_api_dir" ]]; then
  echo "error: private API overlay still uses the old overlay/server/ path" >&2
  echo "hint: move it to $OVERLAY/apps/api/scripts/local" >&2
  exit 2
fi

added=0 changed=0 removed=0 drift=0

for rel_dir in "${ALLOWED_DIRS[@]}"; do
  src_dir="$OVERLAY/$rel_dir"
  dst_dir="$ROOT/$rel_dir"

  if [[ -d "$src_dir" ]]; then
    while IFS= read -r -d '' src_file; do
      rel="${src_file#"$src_dir"/}"
      is_excluded "$rel_dir/$rel" && continue
      dst_file="$dst_dir/$rel"
      if [[ ! -e "$dst_file" ]]; then
        echo "add:     $rel_dir/$rel"
        drift=1; added=$((added + 1))
        if [[ "$MODE" == sync ]]; then
          mkdir -p "$(dirname "$dst_file")"
          cp -p "$src_file" "$dst_file"
        fi
      elif ! cmp -s "$src_file" "$dst_file"; then
        echo "update:  $rel_dir/$rel"
        drift=1; changed=$((changed + 1))
        [[ "$MODE" == sync ]] && cp -p "$src_file" "$dst_file"
      fi
    done < <(find "$src_dir" -type f -print0 | sort -z)
  fi

  # Remove stale files only within allowlisted destinations; never touch excluded patterns.
  if [[ -d "$dst_dir" ]]; then
    while IFS= read -r -d '' dst_file; do
      rel="${dst_file#"$dst_dir"/}"
      is_excluded "$rel_dir/$rel" && continue
      if [[ ! -e "$src_dir/$rel" ]]; then
        echo "remove:  $rel_dir/$rel"
        drift=1; removed=$((removed + 1))
        [[ "$MODE" == sync ]] && rm -f "$dst_file"
      fi
    done < <(find "$dst_dir" -type f -print0 | sort -z)
    [[ "$MODE" == sync ]] && find "$dst_dir" -type d -empty -delete
    [[ "$MODE" == sync ]] && mkdir -p "$dst_dir"
  elif [[ "$MODE" == sync ]]; then
    mkdir -p "$dst_dir"
  fi
done

if [[ "$MODE" == check ]]; then
  if [[ $drift -eq 1 ]]; then
    echo "drift: $added to add, $changed to update, $removed to remove" >&2
    exit 1
  fi
  echo "in sync: overlay matches $SRC_ROOT"
else
  echo "synced: $added added, $changed updated, $removed removed (source: $SRC_ROOT)"
fi

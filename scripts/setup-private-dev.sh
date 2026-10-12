#!/usr/bin/env bash
# Expose public dependencies through generated links; rootDirs merges mirrored sources.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_ROOT="${JOB_TRACKER_PRIVATE_DIR:-$ROOT/../job-tracker-private}"

if [[ ! -d "$PRIVATE_ROOT/overlay" ]]; then
  echo "error: private overlay not found at $PRIVATE_ROOT" >&2
  echo "hint: clone it as a sibling, or set JOB_TRACKER_PRIVATE_DIR" >&2
  exit 2
fi
PRIVATE_ROOT="$(cd "$PRIVATE_ROOT" && pwd)"

if [[ ! -d "$ROOT/apps/extension/node_modules" || ! -d "$ROOT/apps/web/node_modules" ]]; then
  echo "error: public app dependencies are missing" >&2
  echo "hint: run pnpm install in $ROOT first" >&2
  exit 2
fi

ensure_link() {
  local link_path="$1"
  local target="$2"

  if [[ -L "$link_path" ]]; then
    if [[ "$(readlink "$link_path")" == "$target" ]]; then
      echo "ok:      $link_path -> $target"
      return
    fi
    unlink "$link_path"
    ln -s "$target" "$link_path"
    echo "updated: $link_path -> $target"
    return
  fi
  if [[ -e "$link_path" ]]; then
    echo "error: $link_path exists and is not a symlink" >&2
    exit 2
  fi

  mkdir -p "$(dirname "$link_path")"
  ln -s "$target" "$link_path"
  echo "created: $link_path -> $target"
}

ensure_link "$PRIVATE_ROOT/.public" "$ROOT"
ensure_link \
  "$PRIVATE_ROOT/overlay/apps/extension/node_modules" \
  "../../../.public/apps/extension/node_modules"
ensure_link \
  "$PRIVATE_ROOT/overlay/apps/web/node_modules" \
  "../../../.public/apps/web/node_modules"

if [[ -f "$PRIVATE_ROOT/.pre-commit-config.yaml" ]]; then
  PRE_COMMIT_PYTHON="$ROOT/apps/api/.venv/bin/python"
  if [[ ! -x "$PRE_COMMIT_PYTHON" ]]; then
    echo "error: public Python environment is missing at $ROOT/apps/api/.venv" >&2
    echo "hint: run bash scripts/setup.sh in $ROOT first" >&2
    exit 2
  fi
  (
    cd "$PRIVATE_ROOT"
    "$PRE_COMMIT_PYTHON" -m pre_commit install
  )
fi

echo "private overlay development and hooks ready: $PRIVATE_ROOT"

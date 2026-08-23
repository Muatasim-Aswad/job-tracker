#!/usr/bin/env bash
# Render the Job Tracker social preview variants (1280x640, GitHub's size).
#
#   ./render-job-tracker-social-previews.sh            # render v3 v4 v5 v6 v7 v8
#   ./render-job-tracker-social-previews.sh v4         # render one variant
#   IMAGES_DIR=... OUTPUT_DIR=... ./render-...sh       # override locations
#
# Each variant is job-tracker-social-preview-<name>.svg in the svg directory
# beside this script. Screenshot crops are pre-scaled with ImageMagick
# (Lanczos) and injected through {{ASSETS}}, so the SVGs stay path-free.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
svg_dir="${SVG_DIR:-${script_dir}/svg}"
repo_dir="${REPO_DIR:-/home/axim/Projects/me/job-tracker}"
images_dir="${IMAGES_DIR:-${repo_dir}/docs/images}"
output_dir="${OUTPUT_DIR:-${script_dir}}"
dashboard_source="${images_dir}/dashboard.png"
extension_source="${images_dir}/extension.png"

work_dir="$(mktemp -d)"
assets_dir="${work_dir}/assets"
trap 'rm -rf -- "${work_dir}"' EXIT
mkdir -p "${assets_dir}"

for required_command in rsvg-convert magick; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 1
  fi
done

# The crop rectangles below are expressed in source pixels, so a screenshot of a
# different size would silently crop the wrong region.
require_source() {
  local file="$1" expected="$2" actual
  if [[ ! -f "${file}" ]]; then
    echo "Missing screenshot: ${file}" >&2
    exit 1
  fi
  actual="$(magick identify -format '%wx%h' "${file}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Unexpected size for ${file}: got ${actual}, expected ${expected}." >&2
    echo "Retake the screenshot or adjust the crop rectangles in this script." >&2
    exit 1
  fi
}

crop() {
  local source="$1" geometry="$2" size="$3" target="$4"
  magick "${source}" -crop "${geometry}" +repage \
    -filter Lanczos -resize "${size}!" \
    "${assets_dir}/${target}"
}

prepare_assets() {
  case "$1" in
    v3)
      require_source "${dashboard_source}" 1871x920
      # Board without the far-right columns, so cards stay legible when tilted.
      crop "${dashboard_source}" 1080x709+10+0 820x538 v3-dashboard.png
      ;;
    v4) : ;; # pure vector
    v5)
      require_source "${extension_source}" 1873x676
      # Listing header, tracker action bar, and the decision-signals box.
      crop "${extension_source}" 990x525+230+95 592x314 v5-listing.png
      # Popup search results.
      crop "${extension_source}" 415x364+1268+10 280x246 v5-popup.png
      ;;
    v6|v7|v8)
      require_source "${extension_source}" 1873x676
      require_source "${dashboard_source}" 1871x920
      # The same capture surfaces as v5, plus a small full-board overview.
      crop "${extension_source}" 990x525+230+95 588x296 "$1-listing.png"
      crop "${extension_source}" 415x364+1268+10 276x246 "$1-popup.png"
      crop "${dashboard_source}" 1871x920+0+0 470x230 "$1-dashboard.png"
      ;;
    *)
      echo "Unknown variant: $1 (expected v3, v4, v5, v6, v7, or v8)" >&2
      exit 1
      ;;
  esac
}

render() {
  local variant="$1"
  local svg="${svg_dir}/job-tracker-social-preview-${variant}.svg"
  local output="${output_dir}/job-tracker-social-preview-${variant}.png"

  if [[ ! -f "${svg}" ]]; then
    echo "Missing SVG source: ${svg}" >&2
    exit 1
  fi

  prepare_assets "${variant}"
  sed "s|{{ASSETS}}|file://${assets_dir}|g" "${svg}" > "${work_dir}/${variant}.svg"

  rsvg-convert --width 1280 --height 640 \
    "${work_dir}/${variant}.svg" \
    --output "${work_dir}/${variant}.png"

  magick "${work_dir}/${variant}.png" \
    -strip -define png:compression-level=9 \
    "${output}"

  echo "Wrote ${output}"
}

mkdir -p "${output_dir}"
variants=("$@")
if [[ ${#variants[@]} -eq 0 ]]; then
  variants=(v3 v4 v5 v6 v7 v8)
fi

for variant in "${variants[@]}"; do
  render "${variant}"
done

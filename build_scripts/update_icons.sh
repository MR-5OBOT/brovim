#!/usr/bin/env bash
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ICONS="${ROOT}/icons"

# Keep the supplied PNG as the master. Derived assets preserve its transparency.
for size in 16 48 128; do
  magick "${ICONS}/new-icon.png" -resize "${size}x${size}" -strip "${ICONS}/icon${size}.png"
done

for size in 16 32; do
  magick "${ICONS}/new-icon.png" -resize "${size}x${size}" -strip "${ICONS}/action_enabled_${size}.png"
  magick "${ICONS}/action_enabled_${size}.png" -colorspace gray -strip "${ICONS}/action_disabled_${size}.png"
  magick "${ICONS}/action_enabled_${size}.png" \
    \( "${ICONS}/action_disabled_${size}.png" -crop "${size}x$((size / 2))+0+0" +repage \) \
    -gravity North -compose Copy -composite -strip "${ICONS}/action_partial_${size}.png"
done

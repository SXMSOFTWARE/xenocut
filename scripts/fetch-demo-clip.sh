#!/usr/bin/env bash
# Source footage for the effect demo previews (src/assets/fx-demos/*.webp).
# Two seconds of "Tears of Steel" (c) Blender Foundation | mango.blender.org, CC BY 3.0.
# Only the small rendered previews are committed; this clip is fetched on demand.
# Usage: scripts/fetch-demo-clip.sh  then  (cd src-tauri && cargo test --lib generate_fx_demos -- --ignored)
set -euo pipefail
out="$(dirname "$0")/../src-tauri/target/fx-demo-src.mp4"
mkdir -p "$(dirname "$out")"
url="https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov"
# Range requests: ffmpeg only downloads the few MB around the seek point.
ffmpeg -hide_banner -loglevel error -y -ss 25.5 -i "$url" -t 2 -an \
  -vf "crop=ih*16/9:ih,scale=384:216" -c:v libx264 -crf 14 -pix_fmt yuv420p "$out"
echo "$out"

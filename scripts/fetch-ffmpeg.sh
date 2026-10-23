#!/usr/bin/env bash
# Download a static FFmpeg build and place it where Tauri expects an externalBin sidecar.
# The binary is GPL-3.0-or-later (John Van Sickle static builds, or the BtbN Windows build)
# and is not committed. Run this before `cargo check`, `npm run tauri dev`, or `npm run tauri build`.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/src-tauri/binaries"
mkdir -p "$dest"

triple="${1:-}"
if [[ -z "$triple" ]]; then
  if command -v rustc >/dev/null 2>&1; then
    triple="$(rustc -vV | awk '/^host:/ { print $2 }')"
  else
    echo "Pass a target triple, for example x86_64-unknown-linux-gnu" >&2
    exit 1
  fi
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

case "$triple" in
  x86_64-unknown-linux-gnu)
    url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    archive="$work/ffmpeg.tar.xz"
    curl -fL --retry 3 -o "$archive" "$url"
    tar -xJf "$archive" -C "$work"
    bin="$(find "$work" -type f -name ffmpeg -perm -111 | head -1)"
    out="$dest/ffmpeg-$triple"
    ;;
  aarch64-unknown-linux-gnu)
    url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"
    archive="$work/ffmpeg.tar.xz"
    curl -fL --retry 3 -o "$archive" "$url"
    tar -xJf "$archive" -C "$work"
    bin="$(find "$work" -type f -name ffmpeg -perm -111 | head -1)"
    out="$dest/ffmpeg-$triple"
    ;;
  x86_64-pc-windows-msvc)
    url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    archive="$work/ffmpeg.zip"
    curl -fL --retry 3 -o "$archive" "$url"
    if command -v unzip >/dev/null 2>&1; then
      unzip -q "$archive" -d "$work"
    else
      tar -xf "$archive" -C "$work"
    fi
    bin="$(find "$work" -type f -name ffmpeg.exe | head -1)"
    out="$dest/ffmpeg-$triple.exe"
    ;;
  *)
    echo "No FFmpeg download is mapped for $triple." >&2
    echo "Windows and Linux use this script. Android uses a prebuilt library instead of this sidecar." >&2
    exit 1
    ;;
esac

if [[ -z "${bin:-}" || ! -f "$bin" ]]; then
  echo "FFmpeg binary was not inside the archive from $url" >&2
  exit 1
fi

cp "$bin" "$out"
chmod +x "$out" 2>/dev/null || true
echo "Wrote $out"
echo "License: GPL-3.0-or-later. Shipping this binary means complying with that license."

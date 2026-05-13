#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOGO="$REPO/src/renderer/assets/logo.png"
OUT_DIR="$REPO/electron/build-resources"
ICONSET="$OUT_DIR/icon.iconset.tmp"
DEST="$OUT_DIR/icon.icns"
mkdir -p "$ICONSET"
trap 'rm -rf "$ICONSET"' EXIT
sips -z 16 16 "$LOGO" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$LOGO" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$LOGO" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$LOGO" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$LOGO" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$LOGO" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$LOGO" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$LOGO" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$LOGO" --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$LOGO" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$DEST"
echo "Wrote $DEST"

#!/bin/sh
# Builds the Chrome Web Store upload zip: dist/dualcoach-<version>.zip (runtime files only).
set -e
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
OUT="dist/dualcoach-$VERSION.zip"
rm -f "$OUT"
zip -qr "$OUT" manifest.json _locales icons src -x '*.DS_Store'
echo "$OUT"
unzip -l "$OUT" | tail -1

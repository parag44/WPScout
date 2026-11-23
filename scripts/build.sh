#!/usr/bin/env bash
# Builds the Chrome Web Store upload: dist/wpscout-<version>.zip
# Only runtime files are packaged; backups, store assets and docs stay out.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="dist/wpscout-${VERSION}.zip"

FILES=(
  manifest.json
  background.js
  content.js
  icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png
  icons/icon-dim-16.png icons/icon-dim-32.png icons/icon-dim-48.png icons/icon-dim-128.png
  popup/popup.html popup/popup.css popup/popup.js popup/detect.js popup/theme-init.js popup/logo.svg
  popup/fonts/Geist-Variable.woff2 popup/fonts/GeistMono-Variable.woff2 popup/fonts/LICENSE.txt
)

for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "Missing $f" >&2; exit 1; }
done
for f in background.js content.js popup/popup.js popup/detect.js popup/theme-init.js; do
  node --check "$f"
done
python3 -c "import json; json.load(open('manifest.json'))"

mkdir -p dist
rm -f "$OUT"
zip -q -X "$OUT" "${FILES[@]}"
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -n +4 | sed '$d' | sed '$d'

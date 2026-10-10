#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

if [[ ! -f "$ROOT/data/bg/1879/books.json" ]]; then
  echo "Brak data/bg/1879 — najpierw import BG" >&2
  exit 1
fi
if [[ ! -f "$ROOT/data/kjv/1769/books.json" ]]; then
  echo "Brak data/kjv/1769 — najpierw: cargo run -p ksiag-import-kjv --release -- --source … --out data" >&2
  exit 1
fi

rm -rf "$DIST"
mkdir -p "$DIST"

cp -a "$ROOT/web/." "$DIST/"
mkdir -p "$DIST/bg" "$DIST/kjv"
cp -a "$ROOT/data/bg/." "$DIST/bg/"
# KJV tekst + words.json + self-hosted Scourby MP3 (-L: rozwiąż symlinki z vendor/)
rsync -aL "$ROOT/data/kjv/" "$DIST/kjv/"
cp -f "$ROOT/data/translations.json" "$DIST/translations.json" 2>/dev/null || true
cp -f "$ROOT/llms.txt" "$DIST/llms.txt"
cp -f "$ROOT/AGENTS.md" "$DIST/AGENTS.md" 2>/dev/null || true
# katalog audio musi być w shellu (web/)
test -f "$DIST/audio-catalog.json" || {
  echo "Brak audio-catalog.json — python3 tools/audio-kjv/build_catalog.py" >&2
  exit 1
}
mp3_n=$(find "$DIST/kjv" -name '*.mp3' | wc -l | tr -d ' ')
if [[ "$mp3_n" -lt 1 ]]; then
  echo "Uwaga: brak MP3 w dist — uruchom fetch_scourby.py && install_layout.py" >&2
fi

echo "dist gotowe: $DIST (MP3: $mp3_n)"
du -sh "$DIST" "$DIST/bg" "$DIST/kjv"

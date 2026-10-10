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
cp -a "$ROOT/data/kjv/." "$DIST/kjv/"
cp -f "$ROOT/data/translations.json" "$DIST/translations.json" 2>/dev/null || true
cp -f "$ROOT/llms.txt" "$DIST/llms.txt"
cp -f "$ROOT/AGENTS.md" "$DIST/AGENTS.md" 2>/dev/null || true

echo "dist gotowe: $DIST"
du -sh "$DIST" "$DIST/bg" "$DIST/kjv"

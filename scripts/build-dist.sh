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

# PWA: edition root + book/chapter JSON (+ KJV words/mp3).
# Bez *.txt i per-verse {book}/{ch}/{v}.* — Workers Free: max 20k plików.
# src = katalog wydania (np. data/bg/1879), dest = dist/bg/1879
copy_pwa_edition() {
  local src="$1" dest="$2" follow_links="${3:-0}"
  local find_args=(.)
  mkdir -p "$dest"
  # Głębokość ≤2: books.json, 01-gen/1.json, 01-gen/1.mp3 — nie 01-gen/1/1.json
  # find -L: MP3 bywają symlinkami do vendor/
  if [[ "$follow_links" == "1" ]]; then
    find_args=(-L .)
  fi
  (
    cd "$src"
    # -maxdepth 2: books.json, {book}/{ch}.json|.mp3|.words.json — skip per-verse trees
    find "${find_args[@]}" -maxdepth 2 \( -type f -o -type l \) \( -name '*.json' -o -name '*.mp3' \) \
      | while IFS= read -r rel; do
          mkdir -p "$dest/$(dirname "$rel")"
          # DIST_HARD_LINKS=1: same-filesystem hard links (Pi CI — avoid doubling MP3s).
          if [[ "${DIST_HARD_LINKS:-0}" == "1" ]]; then
            local srcfile="$rel"
            if [[ -L "$rel" ]]; then
              srcfile="$(readlink -f -- "$rel")"
            fi
            ln -f -- "$srcfile" "$dest/$rel" 2>/dev/null || cp -L -- "$rel" "$dest/$rel"
          elif [[ "$follow_links" == "1" ]]; then
            cp -L -- "$rel" "$dest/$rel"
          else
            cp -a -- "$rel" "$dest/$rel"
          fi
        done
  )
}

shopt -s nullglob
for ed in "$ROOT"/data/bg/*/; do
  copy_pwa_edition "$ed" "$DIST/bg/$(basename "$ed")" 0
done
for ed in "$ROOT"/data/kjv/*/; do
  copy_pwa_edition "$ed" "$DIST/kjv/$(basename "$ed")" 1
done
shopt -u nullglob
cp -f "$ROOT/data/translations.json" "$DIST/translations.json" 2>/dev/null || true
cp -f "$ROOT/llms.txt" "$DIST/llms.txt"
cp -f "$ROOT/AGENTS.md" "$DIST/AGENTS.md" 2>/dev/null || true
# katalog audio musi być w shellu (web/)
test -f "$DIST/audio-catalog.json" || {
  echo "Brak audio-catalog.json — python3 tools/audio-kjv/build_catalog.py" >&2
  exit 1
}
mp3_n=$(find "$DIST/kjv" -name '*.mp3' | wc -l | tr -d ' ')
file_n=$(find "$DIST" -type f | wc -l | tr -d ' ')
if [[ "$mp3_n" -lt 1 ]]; then
  echo "Uwaga: brak MP3 w dist — uruchom fetch_scourby.py && install_layout.py" >&2
fi
if [[ "$file_n" -gt 20000 ]]; then
  echo "Uwaga: dist ma $file_n plików (>20k limit Workers Free)" >&2
fi

echo "dist gotowe: $DIST (pliki: $file_n, MP3: $mp3_n)"
du -sh "$DIST" "$DIST/bg" "$DIST/kjv"

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

# 1. Generate BG and KJV edition JSON from the git submodules in sources/ if missing.
if [[ ! -f "$ROOT/data/bg/1879/books.json" || ! -f "$ROOT/data/kjv/1769/books.json" ]]; then
  if [[ -f "$ROOT/.gitmodules" ]]; then
    echo "Generowanie tekstu wydań z submodułów w sources/..."
    node "$ROOT/scripts/import-editions.mjs" --web-only
  fi
fi

allow_missing="${PREVIEW_ALLOW_MISSING_DATA:-0}"
if [[ ! -f "$ROOT/data/bg/1879/books.json" ]]; then
  if [[ "$allow_missing" == "1" ]]; then
    echo "Uwaga: brak data/bg/1879 — podgląd bez tekstu BG" >&2
  else
    echo "Brak data/bg/1879 — najpierw: node scripts/import-editions.mjs" >&2
    exit 1
  fi
fi
if [[ ! -f "$ROOT/data/kjv/1769/books.json" ]]; then
  if [[ "$allow_missing" == "1" ]]; then
    echo "Uwaga: brak data/kjv/1769 — podgląd bez tekstu KJV" >&2
  else
    echo "Brak data/kjv/1769 — najpierw: node scripts/import-editions.mjs" >&2
    exit 1
  fi
fi

rm -rf "$DIST"
mkdir -p "$DIST"

cp -a "$ROOT/web/." "$DIST/"
mkdir -p "$DIST/bg" "$DIST/kjv"

# Edition root + book/chapter JSON + KJV words.json + chapter MP3s.
# MP3s may be Git LFS pointers. Wrangler substitutes the committed asset hash
# and uploads real bytes only for hashes Cloudflare does not already store.
copy_edition() {
  local src="$1" dest="$2" follow_links="${3:-0}"
  local find_args=(.)
  local name_filter=( \( -name '*.json' -o -name '*.mp3' \) )
  mkdir -p "$dest"
  if [[ "$follow_links" == "1" ]]; then
    find_args=(-L .)
  fi
  (
    cd "$src"
    find "${find_args[@]}" -maxdepth 2 \( -type f -o -type l \) "${name_filter[@]}" \
      | while IFS= read -r rel; do
          case "$rel" in
            ./audio-assets-manifest.json|audio-assets-manifest.json) continue ;;
          esac
          mkdir -p "$dest/$(dirname "$rel")"
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
  copy_edition "$ed" "$DIST/bg/$(basename "$ed")" 0
done
for ed in "$ROOT"/data/kjv/*/; do
  copy_edition "$ed" "$DIST/kjv/$(basename "$ed")" 1
done
shopt -u nullglob

# Drop stray Git LFS pointers. Chapter MP3 pointers stay: the wrangler patch
# publishes them under the hash in audio-assets-manifest.json.
while IFS= read -r -d '' pointer; do
  case "$pointer" in
    *.mp3) continue ;;
  esac
  if head -n 1 "$pointer" | grep -q 'git-lfs.github.com/spec/v1'; then
    rm -f -- "$pointer"
  fi
done < <(find "$DIST" -type f -size -4k -print0)

cp -f "$ROOT/data/translations.json" "$DIST/translations.json" 2>/dev/null || true
cp -f "$ROOT/llms.txt" "$DIST/llms.txt"
cp -f "$ROOT/AGENTS.md" "$DIST/AGENTS.md" 2>/dev/null || true

test -f "$DIST/audio-catalog.json" || {
  echo "Brak audio-catalog.json — python3 tools/audio-kjv/build_catalog.py" >&2
  exit 1
}
file_n=$(find "$DIST" -type f | wc -l | tr -d ' ')
if [[ "$file_n" -gt 20000 ]]; then
  echo "Uwaga: dist ma $file_n plików (>20k limit Workers Free)" >&2
fi

echo "dist gotowe: $DIST (pliki: $file_n, MP3 hashe z audio-assets-manifest.json)"
du -sh "$DIST" "$DIST/bg" "$DIST/kjv" 2>/dev/null || du -sh "$DIST" || true

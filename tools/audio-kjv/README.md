# KJV audio (Alexander Scourby) — self-hosted

Tekst KJV jest w domenie publicznej. **Oryginalna narracja Scourby’ego** traktujemy jako **public domain**.

Źródło PD (do pobrania raz na maszynę deweloperską):

- [Earnestly Contending for the Faith — Listen to the KJV](https://earnestlycontendingforthefaith.com/ListenToTheKingJamesBible.html)

Nowoczesne **remastery** (np. scourby.com) mogą mieć osobne prawa do masteringu — ich nie bundlujemy.

**Aplikacja serwuje MP3 z własnego originu:** `/kjv/1769/{book}/{chapter}.mp3`.  
Strona odtwarza je strumieniowo. Pobranie offline jest tylko w aplikacji Android.

## Katalog (commitowany)

```bash
python3 tools/audio-kjv/build_catalog.py   # → web/audio-catalog.json
```

## MP3 na dysku (wymagane do odtwarzania / dist)

```bash
export PATH="$HOME/.local/share/mise/installs/python/3.12.15/bin:$PATH"
python3 -m pip install -r tools/audio-kjv/requirements.txt
python3 tools/audio-kjv/fetch_scourby.py
# copy (nie --link): Git LFS potrzebuje zwykłych plików, nie symlinków do vendor/
python3 tools/audio-kjv/install_layout.py
# opcjonalnie align słów:
# python3 tools/audio-kjv/align_whisper.py --book 01-gen --chapter 1 --model base.en
git add data/kjv/1769/*/*.mp3 data/kjv/1769/*/*.words.json
```

`vendor/` i tekst wydań w `data/` są w `.gitignore`. KJV `*.mp3` / `*.words.json` są w **Git LFS**.

## Deploy

Podczas `npm run build` (`scripts/build-dist.sh`):
- `scripts/sync-r2-audio.mjs` porównuje wskaźniki Git LFS (`data/kjv/1769/*/*.mp3`) z `_meta/lfs-manifest.json` w koszyku R2 `66ksiag-audio`, pobiera brakujące/zmienione MP3 w paczkach po `N` (domyślnie 40), wysyła je do R2 i usuwa z dysku przed kolejną paczką.
- Worker (`worker/src/index.ts`) serwuje `/kjv/1769/{book}/{chapter}.mp3` z R2 (`env.AUDIO`, w tym żądania `Range`).
- `*.words.json` i JSON rozdziałów trafiają do `dist/` jako Workers Static Assets.

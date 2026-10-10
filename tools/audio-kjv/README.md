# KJV audio (Alexander Scourby) — self-hosted

Tekst KJV jest w domenie publicznej. **Oryginalna narracja Scourby’ego** traktujemy jako **public domain**.

Źródło PD (do pobrania raz na maszynę deweloperską):

- [Earnestly Contending for the Faith — Listen to the KJV](https://earnestlycontendingforthefaith.com/ListenToTheKingJamesBible.html)

Nowoczesne **remastery** (np. scourby.com) mogą mieć osobne prawa do masteringu — ich nie bundlujemy.

**Aplikacja serwuje MP3 z własnego originu:** `/kjv/1769/{book}/{chapter}.mp3`.  
„Pobierz audio” w PWA kopiuje je do Cache Storage (offline).

## Katalog (commitowany)

```bash
python3 tools/audio-kjv/build_catalog.py   # → web/audio-catalog.json
```

## MP3 na dysku (wymagane do odtwarzania / dist)

```bash
export PATH="$HOME/.local/share/mise/installs/python/3.12.15/bin:$PATH"
python3 -m pip install -r tools/audio-kjv/requirements.txt
python3 tools/audio-kjv/fetch_scourby.py
python3 tools/audio-kjv/install_layout.py --link
# opcjonalnie align słów:
# python3 tools/audio-kjv/align_whisper.py --book 01-gen --chapter 1 --model base.en
```

`data/` i `vendor/` są w `.gitignore`. `build-dist` kopiuje MP3 do `dist/` (symlinki są rozwijane).

## Deploy

Pełny zestaw (~1–2 GB) musi być w `dist/kjv/` przed `wrangler deploy`.  
Cloudflare Workers Assets / plan muszą unieść ten rozmiar (ew. R2 + custom routing).

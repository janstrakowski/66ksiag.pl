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

`vendor/` i tekst wydań w `data/` są w `.gitignore`. KJV `*.mp3` są w **Git LFS**. `*.words.json` są zwykłymi plikami gita.

Po zmianie bajtów MP3 przebuduj manifest hashy Static Assets i dodaj go do commita:

```bash
node tools/audio-kjv/build_assets_manifest.mjs
git add data/kjv/1769/audio-assets-manifest.json
```

## Deploy

Podczas `npx wrangler deploy` (`scripts/build-dist.sh` składa `dist/`):
- Wskaźniki `*.mp3` trafiają do `dist/`. Patch wranglera 4.149 podstawia hash i rozmiar z `audio-assets-manifest.json`, więc 1,6 GB audio nie jest hashowane na dysku builda.
- Cloudflare zwraca tylko hashe, których jeszcze nie ma. Te rozdziały są pobierane po kilka naraz (`git lfs pull` lokalnie, a w Workers Builds z hosta public-domain), wysyłane i usuwane z dysku.
- `*.words.json`, JSON rozdziałów i MP3 są Workers Static Assets. Żądania `Range` obsługuje krawędź, nie Worker.

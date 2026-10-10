# KJV audio (Alexander Scourby) — lokalny pipeline

Tekst KJV jest w domenie publicznej. **Oryginalna narracja Scourby’ego** (ok. 1953, projekt dla niewidomych / wczesne wydania) traktujemy w tym projekcie jako **public domain**. Nowoczesne **remastery** (np. komercyjne zestawy z scourby.com) mogą mieć osobne prawa do masteringu — ich nie bundlujemy.

Ten katalog:

1. Pobiera rozdziały z Internet Archive → lokalne `vendor/` / `data/` (gitignore).
2. Układa je pod kanoniczne ścieżki `data/kjv/1769/{book}/{chapter}.mp3`.
3. Wyrównuje słowa lokalnie (faster-whisper) → `{chapter}.words.json`.

MP3 nie commitujemy (rozmiar); `.words.json` można commitować albo regenerować.

## Wymagania

- Python 3.12+ z `faster-whisper` (np. mise python + pip)
- `ffmpeg`
- Zaimportowany tekst KJV w `data/kjv/1769/`

```bash
export PATH="$HOME/.local/share/mise/installs/python/3.12.15/bin:$PATH"
python3 -m pip install -r tools/audio-kjv/requirements.txt
```

## Kroki

```bash
# 1) Pobierz 1189 rozdziałów (~0.7–1 GB)
python3 tools/audio-kjv/fetch_scourby.py

# 2) Skopiuj / zlinkuj do data/kjv/1769/…/*.mp3 + audio-manifest.json
python3 tools/audio-kjv/install_layout.py --link

# 3) Wyrównaj słowa (CPU: ~1–3 min/rozdział przy base.en / small.en)
python3 tools/audio-kjv/align_whisper.py --book 01-gen --chapter 1 --model base.en
python3 tools/audio-kjv/align_whisper.py --all --model base.en
```

Źródło domyślne: Archive item `19-psalm-119_202307` (pliki `01 Genesis 001.mp3` …) — rozdziały oryginalnej narracji, nie komercyjny remaster.

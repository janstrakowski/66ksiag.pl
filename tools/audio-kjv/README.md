# KJV audio (Alexander Scourby) — lokalny pipeline

Audio Scourby’ego jest **chronione prawem autorskim**. Ten katalog:

1. Pobiera rozdziały z Internet Archive **tylko do lokalnego `vendor/` / `data/`** (gitignore).
2. Układa je pod kanoniczne ścieżki `data/kjv/1769/{book}/{chapter}.mp3`.
3. Wyrównuje słowa lokalnie (faster-whisper) → `{chapter}.words.json`.

Nie commituj MP3. Publiczny deploy wymaga licencji (np. scourby.com) + hostingu (R2).

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

# 2) Skopiuj do data/kjv/1769/…/*.mp3 + audio-manifest.json
python3 tools/audio-kjv/install_layout.py

# 3) Wyrównaj słowa (CPU: ~1–3 min/rozdział przy small.en)
python3 tools/audio-kjv/align_whisper.py --book 01-gen --chapter 1
python3 tools/audio-kjv/align_whisper.py --all --model small.en
```

Źródło domyślne: Archive item `19-psalm-119_202307` (pliki `01 Genesis 001.mp3` …).

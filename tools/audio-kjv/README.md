# KJV audio (Alexander Scourby) — lokalny pipeline

Tekst KJV jest w domenie publicznej. **Oryginalna narracja Scourby’ego** traktujemy jako **public domain**.

Główne źródło PD (rozdziały MP3):

- [Earnestly Contending for the Faith — Listen to the KJV](https://earnestlycontendingforthefaith.com/ListenToTheKingJamesBible.html)

Nowoczesne **remastery** (np. scourby.com) mogą mieć osobne prawa do masteringu — ich nie bundlujemy.

Ten katalog:

1. Pobiera rozdziały → lokalne `vendor/scourby/raw/` (gitignore).
2. Układa pod `data/kjv/1769/{book}/{chapter}.mp3`.
3. Wyrównuje słowa lokalnie (faster-whisper) → `{chapter}.words.json`.

## Wymagania

```bash
export PATH="$HOME/.local/share/mise/installs/python/3.12.15/bin:$PATH"
python3 -m pip install -r tools/audio-kjv/requirements.txt
# + ffmpeg, zaimportowany tekst w data/kjv/1769/
```

## Kroki

```bash
# 1) PD z Earnestly Contending (~1189 rozdziałów, ~2–3 GB)
python3 tools/audio-kjv/fetch_scourby.py
# opcjonalnie stary mirror: --source archive

# 2) Layout
python3 tools/audio-kjv/install_layout.py --link

# 3) Align
python3 tools/audio-kjv/align_whisper.py --book 01-gen --chapter 1 --model base.en
python3 tools/audio-kjv/align_whisper.py --all --model base.en
```

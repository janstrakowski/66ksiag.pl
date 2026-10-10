# KJV audio (Alexander Scourby) — lokalny pipeline

Tekst KJV jest w domenie publicznej. **Oryginalna narracja Scourby’ego** traktujemy jako **public domain**.

Główne źródło PD (rozdziały MP3):

- [Earnestly Contending for the Faith — Listen to the KJV](https://earnestlycontendingforthefaith.com/ListenToTheKingJamesBible.html)

Nowoczesne **remastery** (np. scourby.com) mogą mieć osobne prawa do masteringu — ich nie bundlujemy.

**Aplikacja nie bundluje MP3.** PWA streamuje z internetu; użytkownik może „Pobierz audio” (Cache Storage).

Ten katalog:

1. `build_catalog.py` → `web/audio-catalog.json` (URL-e, commitowane).
2. Opcjonalnie lokalny fetch/align do wyrównania słów (`.words.json` w `data/`, bez MP3 w `dist/`).

## Katalog (wymagane do PWA)

```bash
python3 tools/audio-kjv/build_catalog.py
```

## Opcjonalnie: lokalne MP3 + align (dev)

```bash
export PATH="$HOME/.local/share/mise/installs/python/3.12.15/bin:$PATH"
python3 -m pip install -r tools/audio-kjv/requirements.txt
python3 tools/audio-kjv/fetch_scourby.py
python3 tools/audio-kjv/install_layout.py --link
python3 tools/audio-kjv/align_whisper.py --book 01-gen --chapter 1 --model base.en
```

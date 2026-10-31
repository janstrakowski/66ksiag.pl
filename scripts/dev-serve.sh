#!/usr/bin/env bash
# Lokalny serwer: web/ + data/ (tekst + self-hosted Scourby MP3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8787}"

if [[ ! -f "$ROOT/data/bg/1879/books.json" || ! -f "$ROOT/data/kjv/1769/books.json" ]]; then
  echo "Brak data/bg lub data/kjv — git submodule update --init --checkout, potem import z sources/ (patrz README)." >&2
  exit 1
fi

cd "$ROOT"
python3 - <<PY
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import urllib.parse

ROOT = Path("${ROOT}").resolve()
WEB = ROOT / "web"
DATA = ROOT / "data"
PORT = ${PORT}
EDITIONS = {"bg": "1879", "kjv": "1769"}

def _strip_tags(text):
    out = []
    inside = False
    for ch in text or "":
        if ch == "<":
            inside = True
        elif ch == ">":
            inside = False
        elif not inside:
            out.append(ch)
    return "".join(out)

def _load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

def _words_for(root, book, chapter, doc):
    words = doc.get("words") if isinstance(doc, dict) else None
    if isinstance(words, list) and words:
        return words
    payload = _load_json(root / book / f"{chapter}.words.json")
    if isinstance(payload, dict) and isinstance(payload.get("words"), list):
        return payload["words"]
    return []

def _verse_span(words, verse):
    mine = [
        w for w in words
        if isinstance(w, dict) and w.get("v") == verse
        and isinstance(w.get("s"), (int, float)) and isinstance(w.get("e"), (int, float)) and w["e"] >= w["s"]
    ]
    if not mine:
        return None
    start = min(w["s"] for w in mine)
    end = max(w["e"] for w in mine)
    later = [
        w["s"] for w in words
        if isinstance(w, dict) and isinstance(w.get("v"), int) and w["v"] > verse and isinstance(w.get("s"), (int, float))
    ]
    padded = end + 0.08
    if later:
        padded = min(padded, min(later))
    if padded <= start:
        padded = end
    return (start, padded) if padded > start else None

def _slice_mp3(blob, start_sec, end_sec):
    if not (end_sec > start_sec) or start_sec < 0:
        return None
    data = bytes(blob)
    bitrate_v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    bitrate_v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
    sample_v1 = [44100, 48000, 32000]
    sample_v2 = [22050, 24000, 16000]
    sample_v25 = [11025, 12000, 8000]

    def frame_info(offset):
        if offset + 4 > len(data) or data[offset] != 0xFF or (data[offset + 1] & 0xE0) != 0xE0:
            return None
        b1, b2 = data[offset + 1], data[offset + 2]
        version_bits = (b1 >> 3) & 0x3
        layer_bits = (b1 >> 1) & 0x3
        if version_bits == 1 or layer_bits != 1:
            return None
        version = 1 if version_bits == 3 else 2 if version_bits == 2 else 25
        bitrate_index = (b2 >> 4) & 0xF
        sample_index = (b2 >> 2) & 0x3
        padding = (b2 >> 1) & 0x1
        if bitrate_index in (0, 15) or sample_index == 3:
            return None
        bitrate = (bitrate_v1 if version == 1 else bitrate_v2)[bitrate_index]
        sample_rate = (sample_v1 if version == 1 else sample_v2 if version == 2 else sample_v25)[sample_index]
        if not bitrate or not sample_rate:
            return None
        samples = 1152 if version == 1 else 576
        size = int(((144 if version == 1 else 72) * bitrate * 1000) / sample_rate) + padding
        if size < 5:
            return None
        return size, samples / sample_rate

    offset = 0
    if len(data) >= 10 and data[:3] == b"ID3":
        size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | ((data[8] & 0x7F) << 7) | (data[9] & 0x7F)
        offset = min(len(data), 10 + size + (10 if data[5] & 0x10 else 0))
    parts = []
    clock = 0.0
    scanned = 0
    while offset + 4 <= len(data):
        info = frame_info(offset)
        if info is None or offset + info[0] > len(data):
            offset += 1
            scanned += 1
            if parts or scanned > 4096:
                break
            continue
        scanned = 0
        size, duration = info
        frame_start = clock
        frame_end = clock + duration
        if frame_end > start_sec and frame_start < end_sec:
            parts.append(data[offset:offset + size])
        clock = frame_end
        offset += size
        if frame_start >= end_sec:
            break
    if not parts:
        return None
    return b"".join(parts)

class Handler(SimpleHTTPRequestHandler):
    def _data_candidate(self, parsed):
        if parsed.startswith("/bg/") or parsed.startswith("/kjv/"):
            return DATA / parsed.lstrip("/")
        if parsed == "/translations.json":
            return DATA / "translations.json"
        return None

    def translate_path(self, path):
        parsed = urllib.parse.urlparse(path).path
        data = self._data_candidate(parsed)
        if data is not None:
            if data.is_file():
                return str(data.resolve())
            return str(DATA / "__missing__")
        rel = parsed.lstrip("/") or "index.html"
        candidate = WEB / rel
        if candidate.is_file():
            return str(candidate)
        return str(WEB / "index.html")

    def send_head(self):
        parsed = urllib.parse.urlparse(self.path).path
        data = self._data_candidate(parsed)
        if data is not None and not data.is_file():
            self.send_error(404, "File not found")
            return None
        return super().send_head()

    def end_headers(self):
        if getattr(self, "_bible_headers", False):
            return super().end_headers()
        parsed = urllib.parse.urlparse(self.path).path
        if parsed.endswith(".mp3"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("Content-Type", "audio/mpeg")
        elif parsed.startswith("/bg/") or parsed.startswith("/kjv/") or parsed.endswith(".woff2"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _bible_bytes(self, status, body, content_type):
        raw = body if isinstance(body, (bytes, bytearray)) else body.encode("utf-8")
        self._bible_headers = True
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "public, max-age=86400" if status == 200 else "no-store")
        self.end_headers()
        if raw and self.command != "HEAD":
            self.wfile.write(raw)

    def _bible(self):
        path = urllib.parse.urlparse(self.path).path.rstrip("/") or "/"
        matched = re.fullmatch(r"/api/(bg|kjv)(?:/(.*))?", path)
        if not matched:
            self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
            return
        tr, rest = matched.group(1), matched.group(2) or ""
        root = DATA / tr / EDITIONS[tr]
        if rest in ("books.json", "manifest.json"):
            file = root / rest
            if not file.is_file():
                self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
                return
            self._bible_bytes(200, file.read_bytes(), "application/json; charset=utf-8")
            return
        chapter_match = re.fullmatch(
            r"(\d{2}-[a-z0-9-]+)/([0-9]+)(?:\.([A-Za-z0-9]+)|/([0-9]+)(?:\.([A-Za-z0-9]+))?)?",
            rest,
        )
        if not chapter_match:
            self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
            return
        book, chapter_raw, chapter_ext, verse_raw, verse_ext = chapter_match.groups()

        def positive(raw):
            return raw if raw and re.fullmatch(r"[1-9][0-9]*", raw) else None

        chapter = positive(chapter_raw)
        verse = positive(verse_raw) if verse_raw else None
        ext = ((verse_ext if verse_raw else chapter_ext) or "").lower()
        if chapter is None or (verse_raw and verse is None) or ext not in ("", "json", "txt"):
            self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
            return
        doc_path = root / book / f"{int(chapter)}.json"
        doc = _load_json(doc_path) if doc_path.is_file() else None
        if not isinstance(doc, dict) or not isinstance(doc.get("verses"), list):
            self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
            return
        if verse is None and ext == "json":
            self._bible_bytes(200, doc_path.read_bytes(), "application/json; charset=utf-8")
            return
        if verse is None and ext == "txt":
            lines = [f"# {doc.get('translation')}/{doc.get('edition')} {doc.get('book')} {doc.get('chapter')}"]
            for item in doc["verses"]:
                lines.append(f"{item.get('n')} {_strip_tags(item.get('t') or '')}")
            self._bible_bytes(200, ("\n".join(lines) + "\n").encode("utf-8"), "text/plain; charset=utf-8")
            return
        if verse is None and ext == "":
            audio = root / book / f"{int(chapter)}.mp3"
            if tr != "kjv" or not audio.is_file():
                self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
                return
            self._bible_bytes(200, audio.read_bytes(), "audio/mpeg")
            return
        found = next((item for item in doc["verses"] if item.get("n") == int(verse)), None)
        if not found:
            self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
            return
        if ext == "json":
            body = {
                "translation": doc.get("translation"),
                "edition": doc.get("edition"),
                "book": doc.get("book"),
                "chapter": doc.get("chapter"),
                "verse": found["n"],
                "t": found.get("t") or "",
            }
            self._bible_bytes(200, (json.dumps(body, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), "application/json; charset=utf-8")
            return
        if ext == "txt":
            text = (
                f"# {doc.get('translation')}/{doc.get('edition')} {doc.get('book')} {doc.get('chapter')}:{found.get('n')}\n"
                f"{_strip_tags(found.get('t') or '')}\n"
            )
            self._bible_bytes(200, text.encode("utf-8"), "text/plain; charset=utf-8")
            return
        if tr != "kjv":
            self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
            return
        span = _verse_span(_words_for(root, book, int(chapter), doc), int(verse))
        audio = root / book / f"{int(chapter)}.mp3"
        if span is None or not audio.is_file():
            self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
            return
        sliced = _slice_mp3(audio.read_bytes(), span[0], span[1])
        if sliced is None:
            self._bible_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
            return
        self._bible_bytes(200, sliced, "audio/mpeg")

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/bg") or path.startswith("/api/kjv"):
            self._bible()
            return
        return super().do_GET()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

print(f"66ksiąg → http://127.0.0.1:{PORT}/  (Ctrl+C)")
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY

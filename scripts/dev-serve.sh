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
import urllib.parse

ROOT = Path("${ROOT}").resolve()
WEB = ROOT / "web"
DATA = ROOT / "data"
PORT = ${PORT}

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
        parsed = urllib.parse.urlparse(self.path).path
        if parsed.endswith(".mp3"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("Content-Type", "audio/mpeg")
        elif parsed.startswith("/bg/") or parsed.startswith("/kjv/") or parsed.endswith(".woff2"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

print(f"66ksiąg → http://127.0.0.1:{PORT}/  (Ctrl+C)")
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY

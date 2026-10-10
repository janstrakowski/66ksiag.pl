#!/usr/bin/env bash
# Lokalny serwer: web/ + data/ pod /bg (bez buildu dist).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8787}"

if [[ ! -f "$ROOT/data/bg/1879/books.json" ]]; then
  echo "Brak data/ — uruchom import." >&2
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
    def translate_path(self, path):
        parsed = urllib.parse.urlparse(path).path
        # API / static data
        if parsed.startswith("/bg/"):
            rel = parsed[len("/bg/"):]
            candidate = DATA / "bg" / rel
            if candidate.is_file():
                return str(candidate)
            if candidate.is_dir():
                return str(candidate)
        # app shell
        rel = parsed.lstrip("/") or "index.html"
        candidate = WEB / rel
        if candidate.is_file():
            return str(candidate)
        # SPA fallback
        return str(WEB / "index.html")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

print(f"66ksiąg → http://127.0.0.1:{PORT}/  (Ctrl+C)")
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY

#!/usr/bin/env bash
# Lokalny serwer: web/ + data/ + proxy audio Scourby (bez bundlowania MP3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8787}"

if [[ ! -f "$ROOT/data/bg/1879/books.json" || ! -f "$ROOT/data/kjv/1769/books.json" ]]; then
  echo "Brak data/bg lub data/kjv — uruchom oba importy." >&2
  exit 1
fi

cd "$ROOT"
python3 - <<PY
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path("${ROOT}").resolve()
WEB = ROOT / "web"
DATA = ROOT / "data"
PORT = ${PORT}
CATALOG_PATH = WEB / "audio-catalog.json"
_catalog = None

def load_catalog():
    global _catalog
    if _catalog is None:
        _catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return _catalog

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
                return str(data)
            return str(DATA / "__missing__")
        rel = parsed.lstrip("/") or "index.html"
        candidate = WEB / rel
        if candidate.is_file():
            return str(candidate)
        return str(WEB / "index.html")

    def send_head(self):
        parsed = urllib.parse.urlparse(self.path).path
        if re.match(r"^/audio/proxy/[^/]+/\d+/?$", parsed):
            return self._proxy_audio(parsed, head_only=True)
        data = self._data_candidate(parsed)
        if data is not None and not data.is_file():
            self.send_error(404, "File not found")
            return None
        return super().send_head()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path).path
        if re.match(r"^/audio/proxy/[^/]+/\d+/?$", parsed):
            self._proxy_audio(parsed, head_only=False)
            return
        return super().do_GET()

    def do_OPTIONS(self):
        parsed = urllib.parse.urlparse(self.path).path
        if parsed.startswith("/audio/proxy/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.end_headers()
            return
        self.send_error(404)

    def _proxy_audio(self, parsed, head_only=False):
        m = re.match(r"^/audio/proxy/([^/]+)/(\d+)/?$", parsed)
        if not m:
            self.send_error(400)
            return None
        book_id, chapter = m.group(1), int(m.group(2))
        try:
            cat = load_catalog()
        except Exception:
            self.send_error(500, "catalog")
            return None
        entry = next(
            (c for c in cat.get("chapters", []) if c["book"] == book_id and int(c["chapter"]) == chapter),
            None,
        )
        if not entry:
            self.send_error(404, "Not found")
            return None
        try:
            req = urllib.request.Request(
                entry["url"],
                headers={"User-Agent": "66ksiag-dev-audio-proxy/1.0"},
                method="HEAD" if head_only else "GET",
            )
            with urllib.request.urlopen(req, timeout=180) as upstream:
                data = b"" if head_only else upstream.read()
                ctype = upstream.headers.get("Content-Type", "audio/mpeg")
                clen = upstream.headers.get("Content-Length")
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                if clen:
                    self.send_header("Content-Length", clen)
                elif data:
                    self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if not head_only and data:
                    self.wfile.write(data)
                return None
        except Exception as e:
            self.send_error(502, str(e))
            return None

    def end_headers(self):
        parsed = urllib.parse.urlparse(self.path).path
        if not parsed.startswith("/audio/proxy/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

print(f"66ksiąg → http://127.0.0.1:{PORT}/  (Ctrl+C)")
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY

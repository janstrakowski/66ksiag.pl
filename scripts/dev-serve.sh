#!/usr/bin/env bash
# Lokalny serwer: web/ + data/ (tekst + self-hosted Scourby MP3).
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
import csv
import re
import threading
import urllib.parse

ROOT = Path("${ROOT}").resolve()
WEB = ROOT / "web"
DATA = ROOT / "data"
PORT = ${PORT}
SYNC_FILE = ROOT / ".local" / "sync.csv"
SYNC_LOCK = threading.Lock()
SYNC_MAX = 64
SYNC_MIN = 29

def load_slots():
    slots = {}
    if not SYNC_FILE.is_file():
        return slots
    with SYNC_FILE.open(newline="") as handle:
        for row in csv.reader(handle):
            if len(row) < 2 or row[0] == "id":
                continue
            try:
                blob = bytes.fromhex(row[1])
            except ValueError:
                continue
            if SYNC_MIN <= len(blob) <= SYNC_MAX:
                slots[row[0].lower()] = blob
    return slots

def save_slots(slots):
    SYNC_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SYNC_FILE.with_suffix(".csv.tmp")
    with tmp.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["id", "blob"])
        for ident, blob in sorted(slots.items()):
            writer.writerow([ident, blob.hex()])
    tmp.replace(SYNC_FILE)

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

    def _sync_id(self):
        path = urllib.parse.urlparse(self.path).path.rstrip("/")
        parts = [p for p in path.split("/") if p]
        if len(parts) < 2 or parts[0] != "api" or parts[1] != "sync":
            return None
        if len(parts) != 3 or not re.fullmatch(r"[0-9a-fA-F]{32}", parts[2]):
            return ""
        return parts[2].lower()

    def _read_sync_body(self):
        declared = self.headers.get("Content-Length")
        if declared is not None and int(declared) > SYNC_MAX:
            return None
        n = int(declared or 0)
        body = self.rfile.read(n) if n else b""
        if len(body) > SYNC_MAX or len(body) < SYNC_MIN:
            return None
        return body

    def do_GET(self):
        ident = self._sync_id()
        if ident is None:
            return super().do_GET()
        if ident == "":
            self.send_response(400)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        with SYNC_LOCK:
            data = load_slots().get(ident)
        if data is None:
            self.send_response(404)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_PUT(self):
        ident = self._sync_id()
        if ident is None:
            self.send_response(404)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if ident == "":
            self.send_response(400)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        declared = self.headers.get("Content-Length")
        too_big = declared is not None and int(declared) > SYNC_MAX
        body = b"" if too_big else self._read_sync_body()
        if too_big:
            if declared is not None:
                rest = int(declared)
                while rest > 0:
                    chunk = self.rfile.read(min(rest, 65536))
                    if not chunk:
                        break
                    rest -= len(chunk)
            self.send_response(413)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if body is None:
            self.send_response(400)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        with SYNC_LOCK:
            slots = load_slots()
            slots[ident] = body
            save_slots(slots)
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

print(f"66ksiąg → http://127.0.0.1:{PORT}/  (Ctrl+C)")
print(f"synchronizacja → {SYNC_FILE}")
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY

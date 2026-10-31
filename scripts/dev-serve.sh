#!/usr/bin/env bash
# Lokalny serwer: web/ + data/ (tekst + self-hosted Scourby MP3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8787}"

if [[ ! -f "$ROOT/data/bg/1879/books.json" || ! -f "$ROOT/data/kjv/1769/books.json" ]]; then
  echo "Brak data/bg lub data/kjv — git submodule update --init, potem import z sources/ (patrz README)." >&2
  exit 1
fi

cd "$ROOT"
python3 - <<PY
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import csv
import hmac
import re
import sys
import threading
import time
import urllib.parse

ROOT = Path("${ROOT}").resolve()
WEB = ROOT / "web"
DATA = ROOT / "data"
PORT = ${PORT}
sys.path.insert(0, str(ROOT / "scripts"))
from sync_ed25519 import verify as verify_sync_sig

SYNC_FILE = ROOT / ".local" / "sync.csv"
SYNC_LOCK = threading.Lock()
SYNC_MAX = 64
SYNC_MIN = 29
SIGN_SKEW = 15 * 60

def load_slots():
    slots = {}
    pubs = {}
    if not SYNC_FILE.is_file():
        return slots, pubs
    with SYNC_FILE.open(newline="") as handle:
        for row in csv.reader(handle):
            if len(row) < 2 or row[0] == "id":
                continue
            ident = row[0].lower()
            try:
                blob = bytes.fromhex(row[1])
            except ValueError:
                continue
            if SYNC_MIN <= len(blob) <= SYNC_MAX:
                slots[ident] = blob
            if len(row) >= 3 and row[2]:
                try:
                    pub = bytes.fromhex(row[2])
                except ValueError:
                    pub = b""
                if len(pub) == 32:
                    pubs[ident] = pub
    return slots, pubs

def save_slots(slots, pubs):
    SYNC_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SYNC_FILE.with_suffix(".csv.tmp")
    with tmp.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["id", "blob", "pub"])
        for ident in sorted(slots):
            pub = pubs.get(ident, b"")
            writer.writerow([ident, slots[ident].hex(), pub.hex()])
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

    def _sync_status(self, status, body=b"", content_type=None):
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        if content_type:
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _sync_auth(self, method, ident, body):
        """Podpis obejmuje metodę, numer slotu, czas, klucz publiczny i ciało."""
        time_s = self.headers.get("x-sync-time") or ""
        pub_hex = (self.headers.get("x-sync-pub") or "").lower()
        sig_hex = (self.headers.get("x-sync-sign") or "").lower()
        if not re.fullmatch(r"\d{1,12}", time_s):
            return None
        if abs(int(time.time()) - int(time_s)) > SIGN_SKEW:
            return None
        if not re.fullmatch(r"[0-9a-f]{64}", pub_hex) or not re.fullmatch(r"[0-9a-f]{128}", sig_hex):
            return None
        pub = bytes.fromhex(pub_hex)
        sig = bytes.fromhex(sig_hex)
        message = f"{method}\n{ident}\n{time_s}\n{pub_hex}\n".encode() + body
        with SYNC_LOCK:
            _slots, pubs = load_slots()
            stored = pubs.get(ident)
        if stored is not None:
            if not hmac.compare_digest(stored, pub):
                return None
            if not verify_sync_sig(stored, sig, message):
                return None
            return pub, False
        if not verify_sync_sig(pub, sig, message):
            return None
        return pub, True

    def do_GET(self):
        ident = self._sync_id()
        if ident is None:
            return super().do_GET()
        if ident == "":
            self._sync_status(400)
            return
        auth = self._sync_auth("GET", ident, b"")
        if auth is None:
            self._sync_status(401)
            return
        with SYNC_LOCK:
            data = load_slots()[0].get(ident)
        if data is None:
            self._sync_status(404)
            return
        self._sync_status(200, data, "application/octet-stream")

    def do_PUT(self):
        ident = self._sync_id()
        if ident is None:
            self._sync_status(404)
            return
        if ident == "":
            self._sync_status(400)
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
            self._sync_status(413)
            return
        if body is None:
            self._sync_status(400)
            return
        auth = self._sync_auth("PUT", ident, body)
        if auth is None:
            self._sync_status(401)
            return
        pub, _fresh = auth
        with SYNC_LOCK:
            slots, pubs = load_slots()
            current = pubs.get(ident)
            if current is None:
                pubs[ident] = pub
            elif not hmac.compare_digest(current, pub):
                self._sync_status(401)
                return
            slots[ident] = body
            save_slots(slots, pubs)
        self._sync_status(204)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

print(f"66ksiąg → http://127.0.0.1:{PORT}/  (Ctrl+C)")
print(f"synchronizacja → {SYNC_FILE}")
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY

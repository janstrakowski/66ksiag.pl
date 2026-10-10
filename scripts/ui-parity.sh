#!/usr/bin/env bash
# Zrzut PWA (Chromium, 1 CSS px = 1 px) i zrzut Compose (Paparazzi, mdpi).
# Kończy się błędem, gdy choć jeden piksel się różni.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.parity"
PORT="${PARITY_PORT:-8791}"
mkdir -p "$OUT/chrome"
cd "$ROOT"

python3 - "$PORT" "$ROOT" <<'PY' &
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import urllib.parse

port = int(sys.argv[1])
root = Path(sys.argv[2])
web = root / "web"

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urllib.parse.urlparse(path).path
        rel = parsed.lstrip("/") or "index.html"
        candidate = web / rel
        if candidate.is_file():
            return str(candidate)
        return str(web / "__missing__")

    def log_message(self, fmt, *args):
        return

ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
PY
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT
sleep 0.3

shot() {
  local name="$1" query="$2"
  chromium --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 \
    --font-render-hinting=none \
    --disable-lcd-text \
    --user-data-dir="$OUT/chrome" \
    --window-size=360,800 \
    --virtual-time-budget=8000 \
    --screenshot="$OUT/pwa-${name}.png" \
    "http://127.0.0.1:${PORT}/?parity=${query}"
}

shot pick pick
shot home home

export KSIAG_PARITY=1
if [[ ! -x /tmp/jdk-21/bin/java ]]; then
  echo "Brak JDK 21 w /tmp/jdk-21 — Paparazzi 2 go wymaga." >&2
  exit 1
fi
export JAVA_HOME=/tmp/jdk-21
(cd "$ROOT/android" && ./gradlew :app:recordPaparazziDebug)

python3 - "$ROOT" "$OUT" <<'PY'
import sys
from pathlib import Path
root, out = Path(sys.argv[1]), Path(sys.argv[2])
snaps = list((root / "android/app/src/test/snapshots").rglob("*.png"))
if not snaps:
    snaps = list((root / "android/app/build").rglob("*ParityShotTest*.png"))
print("native:", *snaps, sep="\n  ")
names = {"pick": None, "home": None}
for p in snaps:
    for name in names:
        if p.stem.endswith(name) or f"_{name}" in p.stem:
            names[name] = p
missing = [k for k, v in names.items() if v is None]
if missing:
    raise SystemExit(f"brak zrzutu native: {missing}")
import subprocess
failed = False

def load(path):
    raw = subprocess.check_output(["magick", str(path), "-depth", "8", "ppm:-"])
    rest = raw.split(b"\n", 1)[1]
    wh, rest = rest.split(b"\n", 1)
    w, h = map(int, wh.split())
    _maxv, body = rest.split(b"\n", 1)
    return w, h, body

for name, native in names.items():
    pwa = out / f"pwa-{name}.png"
    w, h, a = load(pwa)
    w2, h2, b = load(native)
    if (w, h) != (w2, h2):
        print(f"{name}: rozmiar {w}x{h} vs {w2}x{h2}")
        failed = True
        continue
    diff = 0
    for i in range(0, len(a), 3):
        if a[i] != b[i] or a[i + 1] != b[i + 1] or a[i + 2] != b[i + 2]:
            diff += 1
    print(f"{name}: różniących się pikseli = {diff} z {w * h}")
    if diff:
        failed = True
if failed:
    raise SystemExit(1)
print("zrzuty są identyczne")
PY

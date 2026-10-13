#!/usr/bin/env bash
# Start the local ticket harness (dashboard + dev preview).
# Opens http://127.0.0.1:3900 in the browser unless HARNESS_NO_OPEN=1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HARNESS_PORT="${HARNESS_PORT:-3900}"
URL="http://127.0.0.1:${HARNESS_PORT}/"

if ! command -v agent >/dev/null 2>&1; then
  echo "Cursor 'agent' CLI not found on PATH." >&2
  echo "Install Cursor CLI and ensure \`agent\` works (agent status / login)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required." >&2
  exit 1
fi

# Soft auth check — don't block if offline; agent will fail per-prompt instead.
if ! agent status >/dev/null 2>&1; then
  echo "Warning: \`agent status\` failed — log in (agent login) or set CURSOR_API_KEY." >&2
fi

mkdir -p .harness
chmod +x harness/bin/register-preview 2>/dev/null || true

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting harness on ${URL}"
node harness/server/index.mjs &
SERVER_PID=$!

# Wait until the server accepts connections
for i in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:${HARNESS_PORT}/api/status" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Harness server exited early." >&2
    exit 1
  fi
  sleep 0.1
done

if [[ "${HARNESS_NO_OPEN:-0}" != "1" ]]; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || true
  fi
fi

echo "Harness ready: ${URL}"
echo "Dev preview:   http://127.0.0.1:${HARNESS_DEV_PORT:-3901}/"
echo "Ctrl-C to stop."
wait "$SERVER_PID"

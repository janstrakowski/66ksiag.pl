#!/usr/bin/env bash
# Deploy current worktree to Cloudflare Workers (production).
# Intended to run on the Pi from the deploy worktree after main updates.
set -euo pipefail

# Non-interactive hooks do not load ~/.bashrc — pull in nvm if present.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="${DEPLOY_ROOT:-$ROOT}"
cd "$ROOT"

STATE_DIR="${HARNESS_CI_STATE:-$HOME/66ksiag-ci-state}"
mkdir -p "$STATE_DIR"

if [[ ! -f "$ROOT/data/bg/1879/books.json" || ! -f "$ROOT/data/kjv/1769/books.json" ]]; then
  echo "Missing data/ beside deploy root — cannot build." >&2
  exit 1
fi

echo "[ci] building at $(git rev-parse --short HEAD) in $ROOT"
# wrangler lives in devDependencies — need a full install for deploy.
# --legacy-peer-deps: npm arborist on arm64 Node 22 crashes on vitest optional peers (edgesOut).
npm ci --legacy-peer-deps
npm run build

if [[ -f "$STATE_DIR/current-version.txt" ]]; then
  cp "$STATE_DIR/current-version.txt" "$STATE_DIR/previous-version.txt"
fi

echo "[ci] wrangler deploy"
DEPLOY_LOG="$(mktemp)"
trap 'rm -f "$DEPLOY_LOG"' EXIT
npx wrangler deploy | tee "$DEPLOY_LOG"

VER="$(grep -Eo '[Vv]ersion [Ii][Dd][: ]+[a-f0-9-]+' "$DEPLOY_LOG" | grep -Eo '[a-f0-9-]{8,}' | tail -1 || true)"
if [[ -n "$VER" ]]; then
  echo "$VER" > "$STATE_DIR/current-version.txt"
  echo "[ci] saved version $VER"
else
  echo "[ci] warning: could not parse Worker version id from wrangler output"
fi
echo "[ci] deploy done"

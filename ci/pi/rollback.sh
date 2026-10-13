#!/usr/bin/env bash
# Roll Cloudflare production back to the previous Worker version recorded by deploy.sh.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi

STATE_DIR="${HARNESS_CI_STATE:-$HOME/66ksiag-ci-state}"
PREV_FILE="$STATE_DIR/previous-version.txt"
DEPLOY_ROOT="${DEPLOY_ROOT:-$HOME/66ksiag-deploy}"

if [[ ! -f "$PREV_FILE" ]]; then
  echo "No previous version recorded at $PREV_FILE" >&2
  exit 1
fi

VER="$(tr -d '[:space:]' < "$PREV_FILE")"
if [[ -z "$VER" ]]; then
  echo "previous-version.txt is empty" >&2
  exit 1
fi

cd "$DEPLOY_ROOT"
echo "[ci] rolling back to version $VER"
npx wrangler rollback "$VER" || npx wrangler versions deploy "$VER"

# Swap current/previous markers
CUR="$STATE_DIR/current-version.txt"
if [[ -f "$CUR" ]]; then
  cp "$CUR" "$STATE_DIR/rolled-from-version.txt"
fi
echo "$VER" > "$CUR"
echo "[ci] rollback done → $VER"

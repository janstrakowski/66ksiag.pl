#!/usr/bin/env bash
# Pi setup for the LFS store and for replacing the old deploy hook.
# Cloudflare production deploy is Origin CI (push main), not this machine.
# Run from a checkout of this repo on the Pi, or pass BARE_REPO / DEPLOY_ROOT.
set -euo pipefail

BARE_REPO="${BARE_REPO:-$HOME/git/66ksiag-project.git}"
# Prefer external drive — SD card is too small for LFS audio checkout.
DEPLOY_ROOT="${DEPLOY_ROOT:-/mnt/pi-data/66ksiag-deploy}"
LFS_STORE="${LFS_STORE:-/mnt/pi-data/git-lfs/66ksiag}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -d "$BARE_REPO" ]]; then
  echo "Bare repo not found: $BARE_REPO" >&2
  echo "Set BARE_REPO to the path of origin on this machine." >&2
  exit 1
fi

if ! command -v git-lfs >/dev/null 2>&1; then
  echo "git-lfs is required on the Pi (apt install git-lfs)." >&2
  exit 1
fi

if [[ ! -d /mnt/pi-data ]]; then
  echo "Missing /mnt/pi-data — mount the pi-data volume (see ci/pi/README.md)." >&2
  exit 1
fi

mkdir -p "$HOME/66ksiag-ci-state" "$LFS_STORE/objects"

git -C "$BARE_REPO" lfs install --local
git -C "$BARE_REPO" config lfs.storage "$LFS_STORE"

if [[ ! -d "$DEPLOY_ROOT/.git" ]]; then
  echo "Cloning bare repo → $DEPLOY_ROOT"
  git clone "$BARE_REPO" "$DEPLOY_ROOT"
fi

git -C "$DEPLOY_ROOT" lfs install --local
git -C "$DEPLOY_ROOT" config lfs.storage "$LFS_STORE"

HOOK="$BARE_REPO/hooks/post-receive"
cp "$SCRIPT_DIR/post-receive" "$HOOK"
chmod +x "$HOOK" "$SCRIPT_DIR/rollback.sh"

echo "Replaced post-receive → $HOOK (does not deploy)"
echo "Checkout for rollback: $DEPLOY_ROOT"
echo "LFS store: $LFS_STORE"
echo
echo "Production deploy is a push of main to Origin (ci/production-deploy.sh)."
echo "This hook no longer runs wrangler."
echo
echo "Harness rollback still uses: bash $DEPLOY_ROOT/ci/pi/rollback.sh"

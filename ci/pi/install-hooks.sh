#!/usr/bin/env bash
# One-time setup on the Pi that hosts origin (drukarka).
# Run from a checkout of this repo on the Pi, or pass BARE_REPO / DEPLOY_ROOT.
set -euo pipefail

BARE_REPO="${BARE_REPO:-$HOME/git/66ksiag-project.git}"
DEPLOY_ROOT="${DEPLOY_ROOT:-$HOME/66ksiag-deploy}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -d "$BARE_REPO" ]]; then
  echo "Bare repo not found: $BARE_REPO" >&2
  echo "Set BARE_REPO to the path of origin on this machine." >&2
  exit 1
fi

mkdir -p "$HOME/66ksiag-ci-state"

if [[ ! -d "$DEPLOY_ROOT/.git" ]]; then
  echo "Cloning bare repo → $DEPLOY_ROOT"
  git clone "$BARE_REPO" "$DEPLOY_ROOT"
fi

HOOK="$BARE_REPO/hooks/post-receive"
cp "$SCRIPT_DIR/post-receive" "$HOOK"
chmod +x "$HOOK" "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/rollback.sh"

# Keep a copy of ci scripts in deploy root (comes with the clone once pushed).
echo "Installed post-receive → $HOOK"
echo "Deploy worktree: $DEPLOY_ROOT"
echo
echo "Required before first deploy:"
echo "  1. Populate $DEPLOY_ROOT/data/ (BG + KJV) — same as laptop deploy."
echo "  2. Cloudflare auth for wrangler (wrangler login or CLOUDFLARE_API_TOKEN)."
echo "  3. Push main from a laptop: harness Merge dev → main, or git push origin main."
echo
echo "Rollback: bash $DEPLOY_ROOT/ci/pi/rollback.sh"
echo "Or from harness dashboard: Rollback production (ssh $USER@$(hostname -s))."

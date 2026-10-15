#!/usr/bin/env bash
# Push to Pi origin: rsync LFS objects to external-drive store, then git push
# (skips LFS HTTP upload — bare SSH has no LFS endpoint).
# Usage: bash scripts/push-origin.sh [git push args…]
# Default: GIT_LFS_SKIP_PUSH=1 git push origin main
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash "$ROOT/scripts/lfs-rsync-to-origin.sh"

if [[ $# -eq 0 ]]; then
  set -- origin main
fi
echo "[lfs] git push $* (LFS upload skipped — objects already on Pi store)"
GIT_LFS_SKIP_PUSH=1 git push "$@"

#!/usr/bin/env bash
# Sync local Git LFS objects to the Pi external-drive store (origin has no HTTP LFS).
# Usage: bash scripts/lfs-rsync-to-origin.sh
# Then: GIT_LFS_SKIP_PUSH=1 git push origin <ref>   # or use scripts/push-origin.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_HOST="${LFS_ORIGIN_HOST:-drukarka}"
REMOTE_STORE="${LFS_ORIGIN_STORE:-/mnt/pi-data/git-lfs/66ksiag/objects}"
LOCAL_OBJECTS="${ROOT}/.git/lfs/objects"

if [[ ! -d "$LOCAL_OBJECTS" ]]; then
  echo "No local LFS objects at $LOCAL_OBJECTS" >&2
  exit 1
fi

echo "[lfs] rsync → ${REMOTE_HOST}:${REMOTE_STORE}"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_STORE'"
rsync -a --info=progress2 "$LOCAL_OBJECTS/" "${REMOTE_HOST}:${REMOTE_STORE}/"
echo "[lfs] done"

#!/usr/bin/env bash
# Origin CI entrypoint. Push to dev → Workers Preview. Push to main → production.
# Neither path calls the Raspberry Pi.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/ci/publish-ref.sh"
publish_detect_ref

if publish_is_main && publish_is_dev; then
  echo "publish: ref is both main and dev (HEAD=${PUBLISH_BRANCH} ref=${PUBLISH_REF:-unset}). Refusing." >&2
  exit 1
fi

if publish_is_main; then
  exec bash "$ROOT/ci/production-deploy.sh"
fi

if publish_is_dev; then
  exec bash "$ROOT/ci/preview-deploy.sh"
fi

echo "publish: skip (HEAD=${PUBLISH_BRANCH} ref=${PUBLISH_REF:-unset}). Only main and dev publish."
exit 0

#!/usr/bin/env bash
# Publish the long-lived `dev` branch at https://devpreview.66ksiag.pl.
# Deploys wrangler env `devpreview` (worker ksiag-devpreview) only.
# Never deploys the top-level worker `ksiag` and never attaches
# 66ksiag.pl or www.66ksiag.pl.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/ci/publish-ref.sh"
publish_detect_ref

if publish_is_main || [[ "$PUBLISH_BRANCH" == "master" || "$PUBLISH_REF" == "master" ]]; then
  echo "preview-deploy: refusing ${PUBLISH_REF:-$PUBLISH_BRANCH}." >&2
  echo "preview-deploy: main is ci/production-deploy.sh (wrangler deploy to 66ksiag.pl)." >&2
  exit 1
fi

if ! publish_is_dev; then
  echo "preview-deploy: only branch dev is published (HEAD=${PUBLISH_BRANCH} ref=${PUBLISH_REF:-unset})." >&2
  exit 1
fi

python3 "$ROOT/ci/route-guard.py" preview wrangler.toml

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "preview-deploy: missing Cloudflare credentials in the environment." >&2
  echo "  CLOUDFLARE_API_TOKEN   Origin CI secret(\"CLOUDFLARE_API_TOKEN\"). Do not commit the value." >&2
  echo "  CLOUDFLARE_ACCOUNT_ID  set in origin.ci.ts for this repository." >&2
  exit 1
fi

# Exact argv. --env devpreview is a different worker. A bare deploy would
# publish the production routes, so any other argument is refused.
cmd=(npx wrangler deploy --env devpreview)
if [[ ${#cmd[@]} -ne 5 \
  || "${cmd[0]}" != "npx" \
  || "${cmd[1]}" != "wrangler" \
  || "${cmd[2]}" != "deploy" \
  || "${cmd[3]}" != "--env" \
  || "${cmd[4]}" != "devpreview" ]]; then
  echo "preview-deploy: refusing unexpected wrangler command: ${cmd[*]}" >&2
  exit 1
fi

export GIT_LFS_SKIP_SMUDGE=1

echo "preview-deploy: node $(node -v), branch ${PUBLISH_REF:-$PUBLISH_BRANCH}"
npm ci --legacy-peer-deps

if [[ -f .gitmodules ]]; then
  git submodule update --init --recursive || echo "preview-deploy: submodule init failed; continuing" >&2
fi

if [[ -f data/bg/1879/books.json && -f data/kjv/1769/books.json ]]; then
  npm run build
else
  echo "preview-deploy: edition text is not in this checkout." >&2
  echo "preview-deploy: publishing the site shell. Chapter JSON 404s until data/ is present." >&2
  PREVIEW_ALLOW_MISSING_DATA=1 npm run build
fi

# This checkout often has Git LFS pointers (audio, icons) instead of bytes.
# Uploading those pointers would serve broken files. Real assets are larger
# than a pointer and are kept.
python3 - <<'PY'
import pathlib
root = pathlib.Path("dist")
marker = b"version https://git-lfs.github.com/spec/v1"
removed = 0
for path in root.rglob("*"):
    if not path.is_file() or path.stat().st_size > 512:
        continue
    if path.read_bytes()[:80].startswith(marker):
        path.unlink()
        removed += 1
print(f"preview-deploy: removed {removed} Git LFS pointers from dist")
PY

if [[ ! -f dist/index.html ]]; then
  echo "preview-deploy: dist/index.html missing after build." >&2
  exit 1
fi

echo "preview-deploy: wrangler deploy --env devpreview → https://devpreview.66ksiag.pl"
set +e
output="$("${cmd[@]}" 2>&1)"
status=$?
set -e
printf '%s\n' "$output"
if [[ "$status" -ne 0 ]]; then
  echo "preview-deploy: wrangler exited ${status}." >&2
  exit "$status"
fi

printf '%s\n' "$output" | python3 "$ROOT/ci/route-guard.py" preview-output -
echo "preview-deploy: url https://devpreview.66ksiag.pl"

#!/usr/bin/env bash
# Publish the long-lived `dev` branch as a Cloudflare Workers Preview.
# This script never runs `wrangler deploy` and never updates 66ksiag.pl.
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

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "preview-deploy: missing Cloudflare credentials in the environment." >&2
  echo "Add these secrets on the Origin repository (do not commit the values):" >&2
  echo "  CLOUDFLARE_API_TOKEN   API token with Workers Scripts: Edit and Workers Routes: Edit on zone 66ksiag.pl" >&2
  echo "  CLOUDFLARE_ACCOUNT_ID  Cloudflare account id" >&2
  exit 1
fi

# Fixed argv. `deploy` and `versions` are rejected so this cannot promote production.
cmd=(npx wrangler preview --name dev --json)
for arg in "${cmd[@]}"; do
  if [[ "$arg" == "deploy" || "$arg" == "versions" ]]; then
    echo "preview-deploy: refusing a production-capable wrangler command." >&2
    exit 1
  fi
done

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

echo "preview-deploy: wrangler preview --name dev (not deploy)"
output="$("${cmd[@]}")"
printf '%s\n' "$output"

preview_url="$(
  printf '%s' "$output" | python3 -c '
import json, sys
raw = sys.stdin.read()
start = raw.find("{")
end = raw.rfind("}")
if start < 0 or end < start:
    sys.exit(2)
data = json.loads(raw[start : end + 1])
urls = []

def take(value):
    if isinstance(value, str) and "workers.dev" in value:
        urls.append(value)
    elif isinstance(value, list):
        for item in value:
            take(item)
    elif isinstance(value, dict):
        for key in ("url", "preview_url", "href"):
            take(value.get(key))
        take(value.get("urls"))

preview = data.get("preview")
take(preview if preview is not None else data)
if not urls:
    sys.exit(3)
print(urls[0])
'
)" || {
  echo "preview-deploy: wrangler succeeded but no workers.dev URL was found in the JSON." >&2
  exit 1
}

if [[ "$preview_url" == *66ksiag.pl* ]]; then
  echo "preview-deploy: refusing preview URL on the production host: ${preview_url}" >&2
  exit 1
fi

echo "preview-deploy: url ${preview_url}"
echo "preview-deploy: stable pattern https://dev-ksiag.<account-subdomain>.workers.dev"

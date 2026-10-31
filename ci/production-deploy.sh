#!/usr/bin/env bash
# Deploy main to the production Worker (66ksiag.pl) from Origin CI.
# This script never calls the Pi and never runs `wrangler preview`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/ci/publish-ref.sh"
publish_detect_ref

if publish_is_dev; then
  echo "production-deploy: refusing dev. That branch publishes a Workers Preview only." >&2
  exit 1
fi

if ! publish_is_main; then
  echo "production-deploy: only main is published to 66ksiag.pl (HEAD=${PUBLISH_BRANCH} ref=${PUBLISH_REF:-unset})." >&2
  exit 1
fi

# A feature-branch checkout must not deploy even if a caller sets the ref to main.
if [[ "$PUBLISH_BRANCH" != "main" && "$PUBLISH_BRANCH" != "HEAD" ]]; then
  echo "production-deploy: checkout is ${PUBLISH_BRANCH}, not main. Refusing." >&2
  exit 1
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "production-deploy: missing Cloudflare credentials in the environment." >&2
  echo "Add these secrets on the Origin repository (do not commit the values):" >&2
  echo "  CLOUDFLARE_API_TOKEN   API token with Workers Scripts: Edit and Workers Routes: Edit on zone 66ksiag.pl" >&2
  echo "  CLOUDFLARE_ACCOUNT_ID  Cloudflare account id" >&2
  exit 1
fi

if ! grep -q 'pattern = "66ksiag.pl/\*"' wrangler.toml || ! grep -q 'zone_name = "66ksiag.pl"' wrangler.toml; then
  echo "production-deploy: wrangler.toml is missing the 66ksiag.pl route. Refusing." >&2
  exit 1
fi

# Fixed argv. preview would not attach the production routes.
cmd=(npx wrangler deploy)
for arg in "${cmd[@]}"; do
  if [[ "$arg" == "preview" || "$arg" == "--env" ]]; then
    echo "production-deploy: refusing a non-production wrangler command." >&2
    exit 1
  fi
done

export GIT_LFS_SKIP_SMUDGE=1

if [[ -f .gitmodules ]]; then
  git submodule update --init --recursive || echo "production-deploy: submodule init failed; continuing" >&2
fi

if [[ ! -f data/bg/1879/books.json || ! -f data/kjv/1769/books.json ]]; then
  echo "production-deploy: edition text is not in this checkout (data/bg/1879 and data/kjv/1769)." >&2
  echo "production-deploy: refusing to replace 66ksiag.pl with a shell." >&2
  exit 1
fi

echo "production-deploy: node $(node -v), branch ${PUBLISH_REF:-$PUBLISH_BRANCH}"
npm ci --legacy-peer-deps
npm run build

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
print(f"production-deploy: removed {removed} Git LFS pointers from dist")
PY

if [[ ! -f dist/index.html ]]; then
  echo "production-deploy: dist/index.html missing after build." >&2
  exit 1
fi

echo "production-deploy: wrangler deploy (routes 66ksiag.pl and www.66ksiag.pl)"
"${cmd[@]}"
echo "production-deploy: done"

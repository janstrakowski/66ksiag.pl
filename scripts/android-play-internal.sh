#!/usr/bin/env bash
# Build a signed release AAB with a strictly increasing versionCode and upload
# it to the Google Play Internal Testing track ("internal").
#
# Never uploads to production, alpha, or beta tracks.
# When invoked with --if-dev-branch (e.g. from scripts/build-dist.sh in
# Cloudflare Workers Builds), runs only on the `dev` branch and skips cleanly
# when Play / Android signing secrets are not configured in the environment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IF_DEV_BRANCH=0
for arg in "$@"; do
  case "$arg" in
    --if-dev-branch) IF_DEV_BRANCH=1 ;;
  esac
done

detect_branch() {
  local ref="${CF_PAGES_BRANCH:-${WORKERS_CI_BRANCH:-${ORIGIN_REF_NAME:-${GITHUB_REF_NAME:-${CI_COMMIT_REF_NAME:-${BUILDKITE_BRANCH:-}}}}}}"
  if [[ -z "$ref" ]]; then
    local raw="${ORIGIN_REF:-${GITHUB_REF:-${CI_COMMIT_REF:-}}}"
    case "$raw" in
      refs/heads/*) ref="${raw#refs/heads/}" ;;
    esac
  fi
  if [[ -z "$ref" ]]; then
    ref="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
  fi
  if [[ "$ref" == "HEAD" ]]; then
    if git show-ref --verify --quiet refs/remotes/origin/dev && [[ "$(git rev-parse HEAD)" == "$(git rev-parse refs/remotes/origin/dev)" ]]; then
      if ! git show-ref --verify --quiet refs/remotes/origin/main || [[ "$(git rev-parse HEAD)" != "$(git rev-parse refs/remotes/origin/main)" ]]; then
        ref="dev"
      fi
    fi
  fi
  printf '%s' "$ref"
}

CURRENT_BRANCH="$(detect_branch)"

if [[ "$IF_DEV_BRANCH" == "1" ]]; then
  if [[ "$CURRENT_BRANCH" != "dev" ]]; then
    exit 0
  fi
  # On branch `dev` inside Workers Builds, check if secrets are present.
  # Load local android/secrets/keystore.env if present.
  # shellcheck disable=SC1091
  source "$ROOT/scripts/android-env.sh"
  if [[ -z "${PLAY_SERVICE_ACCOUNT_JSON:-}" ]]; then
    echo "[play-internal] Branch is dev, but PLAY_SERVICE_ACCOUNT_JSON is not set; skipping Google Play Internal Testing upload."
    exit 0
  fi
  if [[ ! -f "$ROOT/android/android.keystore" && -z "${ANDROID_KEYSTORE_BASE64:-}" ]]; then
    echo "[play-internal] Branch is dev, but ANDROID_KEYSTORE_BASE64 is not set; skipping Google Play Internal Testing upload."
    exit 0
  fi
fi

if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  if [[ "${ALLOW_PLAY_INTERNAL_FROM_ANY_BRANCH:-0}" != "1" ]]; then
    echo "[play-internal] Refusing to run on branch '${CURRENT_BRANCH}'. Only 'dev' publishes to Google Play Internal Testing." >&2
    exit 1
  fi
fi

# Load keystore env / helper functions.
# shellcheck disable=SC1091
source "$ROOT/scripts/android-env.sh"

if [[ -z "${PLAY_SERVICE_ACCOUNT_JSON:-}" ]]; then
  echo "[play-internal] Missing PLAY_SERVICE_ACCOUNT_JSON." >&2
  echo "  Set PLAY_SERVICE_ACCOUNT_JSON, ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD." >&2
  exit 1
fi

if [[ ! -f "$ROOT/android/android.keystore" && -z "${ANDROID_KEYSTORE_BASE64:-}" ]]; then
  echo "[play-internal] Missing Android upload keystore (set ANDROID_KEYSTORE_BASE64 or place android/android.keystore)." >&2
  exit 1
fi

if [[ -z "${ANDROID_KEYSTORE_PASSWORD:-}" ]]; then
  echo "[play-internal] Missing ANDROID_KEYSTORE_PASSWORD (or KEYSTORE_PASSWORD)." >&2
  exit 1
fi

# Verify service account JSON before starting the Gradle build.
node "$ROOT/scripts/play-upload-internal.mjs" --verify-credentials

# Compute strictly increasing versionCode (queries Google Play Internal track max versionCode + epoch seconds).
NEXT_VERSION_CODE="$(node "$ROOT/scripts/play-upload-internal.mjs" --next-version-code)"
SHORT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
export KSIAG_VERSION_CODE="$NEXT_VERSION_CODE"
export KSIAG_VERSION_NAME="${KSIAG_VERSION_NAME:-2.0.${NEXT_VERSION_CODE}-dev.${SHORT_SHA}}"

echo "[play-internal] Building signed release AAB (package=com.jastrakowski.sixsixksiag, versionCode=${KSIAG_VERSION_CODE}, versionName=${KSIAG_VERSION_NAME})…"
bash "$ROOT/scripts/android-build.sh"

AAB_PATH="$ROOT/android/app-release-bundle.aab"
if [[ ! -f "$AAB_PATH" ]]; then
  echo "[play-internal] Expected AAB not found at $AAB_PATH" >&2
  exit 1
fi

RELEASE_NAME="${PLAY_RELEASE_NAME:-${KSIAG_VERSION_NAME}}"
COMMIT_SUBJECT="$(git log -1 --pretty=%s 2>/dev/null || echo "dev build")"
export PLAY_RELEASE_NOTES_PL="${PLAY_RELEASE_NOTES_PL:-Build z gałęzi dev (${SHORT_SHA}): ${COMMIT_SUBJECT}}"
export PLAY_RELEASE_NOTES_EN="${PLAY_RELEASE_NOTES_EN:-Dev branch build (${SHORT_SHA}): ${COMMIT_SUBJECT}}"

echo "[play-internal] Uploading $AAB_PATH to Google Play track 'internal'…"
node "$ROOT/scripts/play-upload-internal.mjs" \
  --aab "$AAB_PATH" \
  --package "com.jastrakowski.sixsixksiag" \
  --track "internal" \
  --release-name "$RELEASE_NAME"

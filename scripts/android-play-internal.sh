#!/usr/bin/env bash
# Build a signed release AAB and upload it to Google Play Internal App Sharing
# for every branch other than `prod`.
#
# `main` is latest development and does upload. `prod` is production and never
# uploads. Does not create a Google Play testing-track release.
# GitHub Actions runs this on each non-prod push
# (.github/workflows/android-internal-sharing.yml). The install link is the
# commit status `play/internal-sharing` and the `android-preview.json` artifact.
# Locally, the same JSON is written to `dist/android-preview.json`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IF_PREVIEW_BRANCH=0
for arg in "$@"; do
  case "$arg" in
    --if-non-prod-branch|--if-non-main-branch|--if-dev-branch) IF_PREVIEW_BRANCH=1 ;;
    --internal-sharing) ;;
    --track-internal)
      echo "[play-internal] Refusing to create a Google Play internal testing release. Branch builds upload only to Internal App Sharing." >&2
      exit 1
      ;;
    *)
      echo "[play-internal] Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${PLAY_UPLOAD_MODE:-}" && "${PLAY_UPLOAD_MODE}" != "internal-sharing" ]]; then
  echo "[play-internal] Refusing PLAY_UPLOAD_MODE=${PLAY_UPLOAD_MODE}. Branch builds upload only to Internal App Sharing." >&2
  exit 1
fi

detect_branch() {
  local ref="${WORKERS_CI_BRANCH:-${CF_PAGES_BRANCH:-${ORIGIN_REF_NAME:-${GITHUB_REF_NAME:-${CI_COMMIT_REF_NAME:-${BUILDKITE_BRANCH:-}}}}}}"
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
    local head_sha
    head_sha="$(git rev-parse HEAD 2>/dev/null || echo "")"
    if [[ -n "$head_sha" ]]; then
      # Prefer `prod` when the commit is also on another branch, so a
      # production checkout is never classified as a preview.
      if git show-ref --verify --quiet refs/remotes/origin/prod && [[ "$head_sha" == "$(git rev-parse refs/remotes/origin/prod)" ]]; then
        ref="prod"
      else
        local remote_match
        remote_match="$(git for-each-ref --format='%(objectname) %(refname:lstrip=3)' refs/remotes/origin | awk -v sha="$head_sha" '$1 == sha && $2 != "HEAD" && $2 != "prod" { print $2; exit }')"
        if [[ -n "$remote_match" ]]; then
          ref="$remote_match"
        fi
      fi
    fi
  fi
  printf '%s' "$ref"
}

CURRENT_BRANCH="$(detect_branch)"
METADATA_OUT="${PLAY_PREVIEW_METADATA_OUT:-$ROOT/dist/android-preview.json}"
FULL_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

if [[ "$IF_PREVIEW_BRANCH" == "1" ]]; then
  if [[ -z "$CURRENT_BRANCH" || "$CURRENT_BRANCH" == "prod" || "$CURRENT_BRANCH" == "HEAD" ]]; then
    exit 0
  fi
  if [[ -f "$METADATA_OUT" ]] && grep -q "\"commit\": \"${FULL_SHA}\"" "$METADATA_OUT" 2>/dev/null; then
    echo "[play-internal] Android preview metadata already built for commit ${FULL_SHA}; skipping duplicate upload."
    exit 0
  fi
  # Load local android/secrets/keystore.env if present.
  # shellcheck disable=SC1091
  source "$ROOT/scripts/android-env.sh"
  if [[ -z "${PLAY_SERVICE_ACCOUNT_JSON:-}" ]]; then
    echo "[play-internal] Branch is '${CURRENT_BRANCH}', but PLAY_SERVICE_ACCOUNT_JSON is not set; skipping Google Play Internal App Sharing upload."
    exit 0
  fi
  if [[ ! -f "$ROOT/android/android.keystore" && -z "${ANDROID_KEYSTORE_BASE64:-}" ]]; then
    echo "[play-internal] Branch is '${CURRENT_BRANCH}', but ANDROID_KEYSTORE_BASE64 is not set; skipping Google Play Internal App Sharing upload."
    exit 0
  fi
fi

if [[ "$CURRENT_BRANCH" == "prod" ]]; then
  if [[ "${ALLOW_PLAY_INTERNAL_FROM_ANY_BRANCH:-0}" != "1" ]]; then
    echo "[play-internal] Refusing to run on production branch 'prod'. main and every other branch upload to Google Play Internal App Sharing." >&2
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

NEXT_VERSION_CODE="$(node "$ROOT/scripts/play-upload-internal.mjs" --next-version-code)"
SHORT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
SAFE_BRANCH="$(printf '%s' "${CURRENT_BRANCH:-dev}" | tr -c 'A-Za-z0-9._-' '-')"
SAFE_BRANCH="${SAFE_BRANCH#-}"
SAFE_BRANCH="${SAFE_BRANCH%-}"
export KSIAG_VERSION_CODE="$NEXT_VERSION_CODE"
export KSIAG_VERSION_NAME="${KSIAG_VERSION_NAME:-2.0.${NEXT_VERSION_CODE}-${SAFE_BRANCH}.${SHORT_SHA}}"

echo "[play-internal] Building signed release AAB (branch=${CURRENT_BRANCH}, package=com.jastrakowski.sixsixksiag, versionCode=${KSIAG_VERSION_CODE}, versionName=${KSIAG_VERSION_NAME})…"
KSIAG_BUNDLE_ONLY=1 bash "$ROOT/scripts/android-build.sh" --bundle-only

AAB_PATH="$ROOT/android/app-release-bundle.aab"
if [[ ! -f "$AAB_PATH" ]]; then
  echo "[play-internal] Expected AAB not found at $AAB_PATH" >&2
  exit 1
fi

echo "[play-internal] Uploading $AAB_PATH to Google Play Internal App Sharing…"
node "$ROOT/scripts/play-upload-internal.mjs" \
  --internal-sharing \
  --aab "$AAB_PATH" \
  --package "com.jastrakowski.sixsixksiag" \
  --branch "$CURRENT_BRANCH" \
  --commit "$FULL_SHA" \
  --version-name "$KSIAG_VERSION_NAME" \
  --version-code "$KSIAG_VERSION_CODE" \
  --metadata-out "$METADATA_OUT"

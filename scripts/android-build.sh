#!/usr/bin/env bash
# Natywny klient (Compose). Nie uruchamiaj Bubblewrap — nadpisze android/.
set -euo pipefail
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${KSIAG_ROOT:-$SCRIPT_ROOT}"
# shellcheck disable=SC1091
# Prefer env helpers from the script's repo (harness main tree), not a stale worktree copy.
source "$SCRIPT_ROOT/scripts/android-env.sh"

BUNDLE_ONLY="${KSIAG_BUNDLE_ONLY:-0}"
for arg in "$@"; do
  case "$arg" in
    --bundle-only) BUNDLE_ONLY=1 ;;
  esac
done

# Ensure Bible JSON in data/ exists before Gradle syncBibleAssets runs.
if [[ ! -f "$ROOT/data/bg/1879/books.json" || ! -f "$ROOT/data/kjv/1769/books.json" ]]; then
  echo "Generowanie tekstu wydań z submodułów w sources/…"
  node "$ROOT/scripts/import-editions.mjs" --web-only
fi

# Ensure Android non-audio binary assets (icons, fonts) are materialized if Git LFS pointers remain.
if head -c 45 "$ROOT/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" 2>/dev/null | grep -q 'git-lfs.github.com/spec/v1'; then
  git -C "$ROOT" lfs pull --include="android/**,store/**" --exclude="" || true
fi

# Decode ANDROID_KEYSTORE_BASE64 if android/android.keystore is not on disk.
CREATED_TEMP_KEYSTORE=0
if [[ ! -f "$ROOT/android/android.keystore" && -n "${ANDROID_KEYSTORE_BASE64:-}" ]]; then
  ksiag_decode_keystore "$ROOT/android/android.keystore"
  CREATED_TEMP_KEYSTORE=1
fi
cleanup_keystore() {
  if [[ "$CREATED_TEMP_KEYSTORE" == "1" ]]; then
    rm -f "$ROOT/android/android.keystore"
  fi
}
trap cleanup_keystore EXIT

ksiag_ensure_android_sdk

if [[ "$BUNDLE_ONLY" == "1" ]]; then
  GRADLE_ARGS=(bundleRelease)
else
  GRADLE_ARGS=(assembleRelease bundleRelease)
fi

if [[ "${WORKERS_CI:-0}" == "1" || "${CI:-}" == "1" || "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  GRADLE_ARGS+=(
    "--no-daemon"
    "-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m"
    "-Dkotlin.daemon.jvmargs=-Xmx1024m"
  )
fi

if [[ -n "${KSIAG_VERSION_CODE:-${ANDROID_VERSION_CODE:-}}" ]]; then
  GRADLE_ARGS+=("-PksiagVersionCode=${KSIAG_VERSION_CODE:-${ANDROID_VERSION_CODE}}")
fi
if [[ -n "${KSIAG_VERSION_NAME:-${ANDROID_VERSION_NAME:-}}" ]]; then
  GRADLE_ARGS+=("-PksiagVersionName=${KSIAG_VERSION_NAME:-${ANDROID_VERSION_NAME}}")
fi

cd "$ROOT/android"
./gradlew "${GRADLE_ARGS[@]}"
AAB="app/build/outputs/bundle/release/app-release.aab"
if ! "$JAVA_HOME/bin/jarsigner" -verify "$AAB" >/dev/null 2>&1; then
  echo "AAB nie jest podpisany." >&2
  exit 1
fi
cp "$AAB" "$ROOT/android/app-release-bundle.aab"

if [[ "$BUNDLE_ONLY" == "1" ]]; then
  ls -lh "$ROOT/android/app-release-bundle.aab"
  echo "AAB (Play): $ROOT/android/app-release-bundle.aab"
else
  APK="app/build/outputs/apk/release/app-release.apk"
  APKSIGNER="$ANDROID_HOME/build-tools/36.1.0/apksigner"
  if ! "$APKSIGNER" verify "$APK" >/dev/null 2>&1; then
    echo "APK nie jest podpisany. W android/secrets/keystore.env lub zmiennych CI ustaw ANDROID_KEYSTORE_PASSWORD / KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD / KEY_PASSWORD i ANDROID_KEY_ALIAS / KEY_ALIAS (alias: android)." >&2
    exit 1
  fi
  cp "$APK" "$ROOT/android/app-release-signed.apk"
  ls -lh "$ROOT/android/app-release-signed.apk" "$ROOT/android/app-release-bundle.aab"
  echo "APK: $ROOT/android/app-release-signed.apk"
  echo "AAB (Play): $ROOT/android/app-release-bundle.aab"
fi

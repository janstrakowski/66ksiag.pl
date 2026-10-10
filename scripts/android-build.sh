#!/usr/bin/env bash
# Natywny klient (Compose). Nie uruchamiaj Bubblewrap — nadpisze android/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/android-env.sh"
cd "$ROOT/android"
./gradlew assembleRelease bundleRelease
APK="app/build/outputs/apk/release/app-release.apk"
AAB="app/build/outputs/bundle/release/app-release.aab"
APKSIGNER="$ANDROID_HOME/build-tools/36.1.0/apksigner"
if ! "$APKSIGNER" verify "$APK" >/dev/null 2>&1; then
  echo "APK nie jest podpisany. W android/secrets/keystore.env ustaw KEYSTORE_PASSWORD, KEY_PASSWORD i KEY_ALIAS (alias z twa-manifest: android)." >&2
  exit 1
fi
cp "$APK" "$ROOT/android/app-release-signed.apk"
cp "$AAB" "$ROOT/android/app-release-bundle.aab"
ls -lh "$ROOT/android/app-release-signed.apk" "$ROOT/android/app-release-bundle.aab"
echo "APK: $ROOT/android/app-release-signed.apk"
echo "AAB (Play): $ROOT/android/app-release-bundle.aab"

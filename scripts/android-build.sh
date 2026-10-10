#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/android-env.sh"
cd "$ROOT/android"
test -f twa-manifest.json || { echo "Brak android/twa-manifest.json" >&2; exit 1; }
test -f android.keystore || { echo "Brak android/android.keystore (secrets)" >&2; exit 1; }
printf 'n\n' | npx --yes @bubblewrap/cli build --skipPwaValidation
ls -lh app-release-signed.apk app-release-bundle.aab
echo "APK: $ROOT/android/app-release-signed.apk"
echo "AAB (Play): $ROOT/android/app-release-bundle.aab"

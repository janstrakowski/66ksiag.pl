#!/usr/bin/env bash
# Instalacja APK na podłączonym telefonie (USB debugging, bez roota).
set -euo pipefail
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${KSIAG_ROOT:-$SCRIPT_ROOT}"
# shellcheck disable=SC1091
source "$SCRIPT_ROOT/scripts/android-env.sh"
APK="${1:-$ROOT/android/app-release-signed.apk}"
test -f "$APK" || { echo "Brak APK: $APK — najpierw: bash scripts/android-build.sh" >&2; exit 1; }

echo "Szukam urządzenia (adb)…"
adb start-server >/dev/null
# Czekaj do 60s na urządzenie „device” (nie unauthorized)
for i in $(seq 1 30); do
  if adb devices | awk 'NR>1 && $2=="device"{ok=1} END{exit !ok}'; then
    break
  fi
  if adb devices | awk 'NR>1 && $2=="unauthorized"{found=1} END{exit !found}'; then
    echo "Telefon widoczny, ale unauthorized — zaakceptuj okno „Zezwolić na debugowanie USB?” na S24." >&2
  elif ! lsusb 2>/dev/null | grep -qiE '04e8|Samsung'; then
    echo "Brak Samsunga w USB. Na S24: Opcje deweloperskie → Debugowanie USB → ON; tryb USB = Transfer plików (MTP). ($i/30)" >&2
  else
    echo "USB OK, czekam na adb… ($i/30)" >&2
  fi
  sleep 2
done

if ! adb devices | awk 'NR>1 && $2=="device"{ok=1} END{exit !ok}'; then
  echo "--- adb devices ---" >&2
  adb devices -l >&2
  echo "Nie ma autoryzowanego urządzenia. Włącz debugowanie USB i potwierdź RSA na telefonie." >&2
  exit 1
fi

adb devices -l
echo "Instaluję $APK …"
adb install -r "$APK"
echo "Gotowe. Uruchom: adb shell monkey -p pl.ksiag.app -c android.intent.category.LAUNCHER 1"

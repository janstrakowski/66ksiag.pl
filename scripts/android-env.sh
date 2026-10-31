# shellcheck shell=bash
# Wspólne env dla build/install TWA (źródłuj: source scripts/android-env.sh)
# KSIAG_ROOT: harness worktree override (build that checkout, use caller's scripts).
ROOT="${KSIAG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
if [[ -f "$ROOT/android/secrets/keystore.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT/android/secrets/keystore.env"
  set +a
fi
# Bubblewrap historically used BUBBLEWRAP_* names; Gradle and CI accept ANDROID_* or KEYSTORE_*.
export KEYSTORE_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-${KEYSTORE_PASSWORD:-${BUBBLEWRAP_KEYSTORE_PASSWORD:-}}}"
export KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-${KEY_PASSWORD:-${BUBBLEWRAP_KEY_PASSWORD:-${KEYSTORE_PASSWORD:-}}}}"
export KEY_ALIAS="${ANDROID_KEY_ALIAS:-${KEY_ALIAS:-android}}"
export ANDROID_KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD"
export ANDROID_KEY_PASSWORD="$KEY_PASSWORD"
export ANDROID_KEY_ALIAS="$KEY_ALIAS"

ksiag_decode_keystore() {
  local target="${1:-$ROOT/android/android.keystore}"
  if [[ -f "$target" ]]; then
    return 0
  fi
  if [[ -z "${ANDROID_KEYSTORE_BASE64:-}" ]]; then
    return 1
  fi
  mkdir -p "$(dirname "$target")"
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | tr -d '[:space:]' | base64 -d > "$target"
  chmod 600 "$target"
}

ksiag_ensure_android_sdk() {
  if [[ -f "$ANDROID_HOME/platforms/android-36/android.jar" && -x "$ANDROID_HOME/build-tools/36.1.0/apksigner" ]]; then
    return 0
  fi
  echo "Brak Android SDK (platforms;android-36, build-tools;36.1.0) w $ANDROID_HOME — pobieranie cmdline-tools…"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  if [[ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
    local zip_tmp
    zip_tmp="$(mktemp /tmp/cmdline-tools-XXXXXX.zip)"
    local unpack_tmp
    unpack_tmp="$(mktemp -d /tmp/cmdline-tools-unpack-XXXXXX)"
    curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" -o "$zip_tmp"
    unzip -q "$zip_tmp" -d "$unpack_tmp"
    rm -rf "$ANDROID_HOME/cmdline-tools/latest"
    mv "$unpack_tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    rm -rf "$zip_tmp" "$unpack_tmp"
  fi
  yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" \
    "platform-tools" \
    "platforms;android-36" \
    "build-tools;36.1.0"
}

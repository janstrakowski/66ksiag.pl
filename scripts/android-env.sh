# shellcheck shell=bash
# Wspólne env dla build/install TWA (źródłuj: source scripts/android-env.sh)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

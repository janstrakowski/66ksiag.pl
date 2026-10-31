# shellcheck shell=bash
# Wspólne env dla build/install Androida (źródłuj: source scripts/android-env.sh)
# KSIAG_ROOT: harness worktree override (build that checkout, use caller's scripts).
ROOT="${KSIAG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

ksiag_valid_jdk_home() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" != "." && -x "$dir/bin/java" && -x "$dir/bin/javac" ]] || return 1
  local ver
  ver="$("$dir/bin/javac" -version 2>&1 | awk '{print $2}' | cut -d. -f1)"
  [[ "$ver" =~ ^[0-9]+$ && "$ver" -ge 17 ]]
}

ksiag_find_existing_jdk() {
  local candidate
  local cache_root="${KSIAG_JDK_CACHE_DIR:-${HOME:-/tmp}/.cache/ksiag-jdk}"

  if [[ "${KSIAG_FORCE_DOWNLOAD_JDK:-0}" != "1" ]]; then
    if ksiag_valid_jdk_home "${JAVA_HOME:-}"; then
      printf '%s' "$JAVA_HOME"
      return 0
    fi

    if command -v javac >/dev/null 2>&1; then
      local javac_path
      javac_path="$(readlink -f "$(command -v javac)" 2>/dev/null || true)"
      if [[ -n "$javac_path" ]]; then
        candidate="$(dirname "$(dirname "$javac_path")")"
        if ksiag_valid_jdk_home "$candidate"; then
          printf '%s' "$candidate"
          return 0
        fi
      fi
    fi

    if command -v java >/dev/null 2>&1; then
      local java_path
      java_path="$(readlink -f "$(command -v java)" 2>/dev/null || true)"
      if [[ -n "$java_path" ]]; then
        candidate="$(dirname "$(dirname "$java_path")")"
        if ksiag_valid_jdk_home "$candidate"; then
          printf '%s' "$candidate"
          return 0
        fi
      fi
    fi

    for candidate in \
      /usr/lib/jvm/java-21-openjdk-* \
      /usr/lib/jvm/java-17-openjdk-* \
      /usr/lib/jvm/temurin-21* \
      /usr/lib/jvm/temurin-17* \
      /usr/lib/jvm/default-java \
      "$HOME"/.local/share/mise/installs/java/*; do
      if ksiag_valid_jdk_home "$candidate"; then
        printf '%s' "$candidate"
        return 0
      fi
    done
  fi

  for candidate in "$cache_root"/*; do
    if ksiag_valid_jdk_home "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

if resolved_jdk="$(ksiag_find_existing_jdk)"; then
  export JAVA_HOME="$resolved_jdk"
  export PATH="$JAVA_HOME/bin:$PATH"
else
  unset JAVA_HOME
fi

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

ksiag_ensure_jdk() {
  local jdk_home
  if jdk_home="$(ksiag_find_existing_jdk)"; then
    export JAVA_HOME="$jdk_home"
    export PATH="$JAVA_HOME/bin:$PATH"
    return 0
  fi

  local cache_root="${KSIAG_JDK_CACHE_DIR:-${HOME:-/tmp}/.cache/ksiag-jdk}"
  echo "Brak JDK >= 17 na maszynie — pobieranie Eclipse Temurin JDK 21 do $cache_root…"
  mkdir -p "$cache_root"
  local tar_tmp
  tar_tmp="$(mktemp /tmp/temurin-jdk21-XXXXXX.tar.gz)"
  local unpack_tmp
  unpack_tmp="$(mktemp -d /tmp/temurin-jdk21-unpack-XXXXXX)"
  curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" -o "$tar_tmp"
  tar -xzf "$tar_tmp" -C "$unpack_tmp"
  rm -f "$tar_tmp"

  local extracted_dir
  extracted_dir="$(find "$unpack_tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "$extracted_dir" ]] || ! ksiag_valid_jdk_home "$extracted_dir"; then
    rm -rf "$unpack_tmp"
    echo "Pobrany pakiet JDK 21 nie zawiera prawidłowego bin/javac." >&2
    return 1
  fi

  local dest_dir="$cache_root/$(basename "$extracted_dir")"
  rm -rf "$dest_dir"
  mv "$extracted_dir" "$dest_dir"
  rm -rf "$unpack_tmp"

  export JAVA_HOME="$dest_dir"
  export PATH="$JAVA_HOME/bin:$PATH"
  echo "Zainstalowano JDK: $JAVA_HOME ($("$JAVA_HOME/bin/java" -version 2>&1 | head -n 1))"
}

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
  ksiag_ensure_jdk
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

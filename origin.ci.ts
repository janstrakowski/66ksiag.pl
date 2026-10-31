// Origin CI configuration for uploading non-production branches to Google Play
// Internal App Sharing.
//
// `main` never runs this upload (`scripts/android-play-internal.sh --if-non-main-branch`
// exits 0 on `main`). Every other branch builds a signed `.aab`, uploads it to
// Google Play Internal App Sharing, logs the `downloadUrl`, and writes
// `dist/android-preview.json` (served at `https://<branch>.66ksiag.pl/android-preview.json`).

const playInternalEnv = {
  ANDROID_KEYSTORE_BASE64: secret("ANDROID_KEYSTORE_BASE64"),
  ANDROID_KEYSTORE_PASSWORD: secret("ANDROID_KEYSTORE_PASSWORD"),
  ANDROID_KEY_ALIAS: secret("ANDROID_KEY_ALIAS"),
  ANDROID_KEY_PASSWORD: secret("ANDROID_KEY_PASSWORD"),
  PLAY_SERVICE_ACCOUNT_JSON: secret("PLAY_SERVICE_ACCOUNT_JSON"),
  GIT_LFS_SKIP_SMUDGE: "1",
};

export default {
  on: {
    push: {
      branches: ["*"],
    },
  },
  jobs: {
    playInternal: {
      inputs: ["android/**", "scripts/**", "store/**", "web/audio-catalog.json", ".gitmodules"],
      platform: { disk: "16Gi" },
      env: playInternalEnv,
      steps: [
        {
          run: "bash scripts/android-play-internal.sh --if-non-main-branch",
          env: playInternalEnv,
        },
      ],
    },
  },
};

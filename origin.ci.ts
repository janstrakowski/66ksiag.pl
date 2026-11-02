// Origin CI configuration for uploading non-production branches to Google Play
// Internal App Sharing.
//
// `prod` never runs this upload (`scripts/android-play-internal.sh --if-non-prod-branch`
// exits 0 on `prod`). `main` and every other branch build a signed `.aab`, upload
// it to Google Play Internal App Sharing, log the `downloadUrl`, and write
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
          run: "bash scripts/android-play-internal.sh --if-non-prod-branch",
          env: playInternalEnv,
        },
      ],
    },
  },
};

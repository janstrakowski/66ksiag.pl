// Origin CI configuration for pushing `dev` to the Google Play Internal Testing track.
//
// Only branch `dev` triggers this job, and `scripts/android-play-internal.sh`
// exclusively targets the Google Play `internal` track (never production).
//
// Important note on secrets in this project:
// Origin does not currently expose a user-accessible `origin secret` CLI/UI.
// Primary CI with secret env vars is Cloudflare Workers Builds (connected to
// Origin), where `npm run build` (`scripts/build-dist.sh`) invokes
// `scripts/android-play-internal.sh --if-dev-branch` whenever `dev` is pushed
// and the Play/Keystore secrets are set in Workers Builds Settings → Variables
// and Secrets.
//
// If Origin CI injects these secrets, this job also runs directly on `dev` pushes:
//   - ANDROID_KEYSTORE_BASE64
//   - ANDROID_KEYSTORE_PASSWORD
//   - ANDROID_KEY_ALIAS
//   - ANDROID_KEY_PASSWORD
//   - PLAY_SERVICE_ACCOUNT_JSON

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
      branches: ["dev"],
    },
  },
  jobs: {
    playInternal: {
      inputs: ["android/**", "scripts/**", "store/**", "web/audio-catalog.json", ".gitmodules"],
      platform: { disk: "16Gi" },
      env: playInternalEnv,
      steps: [
        {
          run: "bash scripts/android-play-internal.sh --if-dev-branch",
          env: playInternalEnv,
        },
      ],
    },
  },
};

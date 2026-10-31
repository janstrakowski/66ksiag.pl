// Origin CI reads this file from the commit that was pushed.
// Production (main → 66ksiag.pl via ci/pi) is not a trigger.
//
// `secret` and the event filter are Origin CI helpers. Add these repository
// secrets in Origin (names only; never commit values):
//   CLOUDFLARE_API_TOKEN
//   CLOUDFLARE_ACCOUNT_ID
const cloudflareEnv = {
  CLOUDFLARE_API_TOKEN: secret("CLOUDFLARE_API_TOKEN"),
  CLOUDFLARE_ACCOUNT_ID: secret("CLOUDFLARE_ACCOUNT_ID"),
  GIT_LFS_SKIP_SMUDGE: "1",
};

export default {
  on: {
    push: {
      branches: ["dev"],
    },
  },
  jobs: {
    preview: {
      inputs: ["**"],
      platform: { disk: "16Gi" },
      env: cloudflareEnv,
      steps: [
        {
          run: "bash ci/preview-deploy.sh",
          env: cloudflareEnv,
        },
      ],
    },
  },
};

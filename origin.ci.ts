// Origin CI reads this file from the commit that was pushed.
//   push dev  → Workers Preview (does not take 66ksiag.pl)
//   push main → wrangler deploy of the production routes in wrangler.toml
// The Raspberry Pi is not on either path.
//
// `secret` is an Origin CI helper. Add these repository secrets in Origin
// (names only; never commit values):
//   CLOUDFLARE_API_TOKEN   Workers Scripts: Edit, and Workers Routes: Edit
//                          on the zone 66ksiag.pl (routes, not a separate secret)
//   CLOUDFLARE_ACCOUNT_ID  Cloudflare account id
const cloudflareEnv = {
  CLOUDFLARE_API_TOKEN: secret("CLOUDFLARE_API_TOKEN"),
  CLOUDFLARE_ACCOUNT_ID: secret("CLOUDFLARE_ACCOUNT_ID"),
  GIT_LFS_SKIP_SMUDGE: "1",
};

export default {
  on: {
    push: {
      branches: ["dev", "main"],
    },
  },
  jobs: {
    publish: {
      inputs: ["**"],
      platform: { disk: "16Gi" },
      env: cloudflareEnv,
      steps: [
        {
          run: "bash ci/publish.sh",
          env: cloudflareEnv,
        },
      ],
    },
  },
};

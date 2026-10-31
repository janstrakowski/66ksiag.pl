// Origin CI reads this file from the commit that was pushed.
//   push dev  → wrangler deploy --env devpreview → https://devpreview.66ksiag.pl
//   push main → wrangler deploy of the production routes in wrangler.toml
// The preview worker is ksiag-devpreview. It does not take 66ksiag.pl or www.
// The Raspberry Pi is not on either path.
//
// CLOUDFLARE_ACCOUNT_ID is the account id supplied for this repo. It is not
// an API token. The token stays out of git. Origin release notes document
// glob(), exists(), and ecrLogin as CI helpers. They do not document a
// secret store. secret("CLOUDFLARE_API_TOKEN") is still the only hook that
// can inject the token without committing it. A live deploy stays blocked
// until that helper resolves to the token the user created (Edit Cloudflare
// Workers). Do not paste the token into this file.
const cloudflareEnv = {
  CLOUDFLARE_API_TOKEN: secret("CLOUDFLARE_API_TOKEN"),
  CLOUDFLARE_ACCOUNT_ID: "86e0b7dbeec0ebfff2333c8e8c4087fb",
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

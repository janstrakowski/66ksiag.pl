# Pi — not the Cloudflare deploy path

Production deploy is Origin CI. A push to `main` runs `ci/production-deploy.sh` (`npx wrangler deploy`) and publishes the routes in `wrangler.toml` (`66ksiag.pl` and `www.66ksiag.pl`). A push to `dev` runs `ci/preview-deploy.sh` (`npx wrangler preview --name dev`) and does not take those hostnames.

`post-receive` in this directory does not deploy. `install-hooks.sh` copies it over `hooks/post-receive` in the bare repo so an older hook that called `deploy.sh` stops deploying. The copy already installed on the Pi keeps the old behavior until you run:

```bash
bash ci/pi/install-hooks.sh
```

`deploy.sh` is gone. Nothing in this repo calls it.

## What still uses the Pi

The harness rollback button SSHs to the Pi and runs `ci/pi/rollback.sh` (`HARNESS_PI_HOST`, default `drukarka`; override the command with `HARNESS_PI_ROLLBACK`). That script is still here because `harness/server/merge.mjs` references it. It rolls the Worker back with Wrangler on the Pi checkout. It is not how a push deploys.

`scripts/push-origin.sh` still rsyncs Git LFS objects to `/mnt/pi-data/git-lfs/66ksiag`. That is audio storage, not the Cloudflare deploy.

`install-hooks.sh` still prepares that LFS store and the deploy checkout rollback uses.

## Rollback

On the Pi, or over SSH:

```bash
bash ~/66ksiag-deploy/ci/pi/rollback.sh
ssh drukarka 'bash "$HOME/66ksiag-deploy/ci/pi/rollback.sh"'
```

Versions are recorded under `~/66ksiag-ci-state/` only when this script is what last deployed. Origin CI does not write those files.

# Pi CI — deploy `main` to production

The laptop harness merges `dev` → `main` and pushes `origin` (`drukarka:git/66ksiag-project.git`).  
This directory is the **Pi-side** hook that builds and deploys on every update to `main`, plus rollback.

## One-time install (on the Pi)

```bash
# From a clone on the Pi that contains this repo:
bash ci/pi/install-hooks.sh
# Or:
#   BARE_REPO=$HOME/git/66ksiag-project.git DEPLOY_ROOT=$HOME/66ksiag-deploy bash ci/pi/install-hooks.sh
```

Then:

1. Put `data/` (BG + KJV) next to the deploy checkout (`~/66ksiag-deploy/data/`), same as a laptop deploy.
2. Authenticate Wrangler (`wrangler login` or copy `~/.config/.wrangler/` from a logged-in machine, or set `CLOUDFLARE_API_TOKEN`).
3. Install Node 22+ on the Pi (nvm is fine). Deploy/rollback scripts source `$HOME/.nvm/nvm.sh` so git hooks work without an interactive shell.
4. Push `main` once to verify: check `~/66ksiag-ci-state/deploy.log`.

## Rollback

On the Pi:

```bash
bash ~/66ksiag-deploy/ci/pi/rollback.sh
```

From the harness dashboard: **Rollback production** (SSH to `drukarka`, override with `HARNESS_PI_HOST` / `HARNESS_PI_ROLLBACK`).

Versions are recorded under `~/66ksiag-ci-state/` (`current-version.txt`, `previous-version.txt`).

## Env

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEPLOY_ROOT` | `$HOME/66ksiag-deploy` | Non-bare checkout used to build |
| `BARE_REPO` | `$HOME/git/66ksiag-project.git` | Origin bare repo |
| `HARNESS_CI_STATE` | `$HOME/66ksiag-ci-state` | Version id files |
| `HARNESS_CI_LOG` | `$HOME/66ksiag-ci-state/deploy.log` | Deploy log |

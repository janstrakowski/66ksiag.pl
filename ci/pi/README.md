# Pi CI — deploy `main` to production

The laptop pushes `origin` `main` (after merging a feature worktree; `drukarka:git/66ksiag-project.git`).  
This directory is the **Pi-side** hook that builds and deploys on every update to `main`, plus rollback.

## Storage layout

| Path | Role |
| --- | --- |
| `~/git/66ksiag-project.git` | Bare origin (git objects + pointers) |
| `/mnt/pi-data` | External ext4 volume (`pi-data`, fstab `nofail`) |
| `/mnt/pi-data/git-lfs/66ksiag` | Shared Git LFS object store (`lfs.storage`) |
| `~/66ksiag-deploy` | Non-bare checkout used to build/deploy |

LFS objects are **not** uploaded over an HTTP LFS API. The laptop rsyncs them with `scripts/lfs-rsync-to-origin.sh` (wrapped by `scripts/push-origin.sh`), then pushes git refs with `GIT_LFS_SKIP_PUSH=1`.

### Mount + fstab (one-time)

```bash
sudo mkdir -p /mnt/pi-data
# UUID from: sudo blkid /dev/sda2
echo 'UUID=63609aaa-c3a0-4de9-ada2-08610279773a /mnt/pi-data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount /mnt/pi-data
sudo chown "$USER:$USER" /mnt/pi-data
sudo apt-get install -y git-lfs
```

## One-time install (on the Pi)

```bash
# From a clone on the Pi that contains this repo:
bash ci/pi/install-hooks.sh
# Or:
#   BARE_REPO=$HOME/git/66ksiag-project.git DEPLOY_ROOT=$HOME/66ksiag-deploy bash ci/pi/install-hooks.sh
```

Then:

1. Populate `$DEPLOY_ROOT/data/` with **edition text** (BG + KJV chapter/verse JSON, `books.json`, …). KJV `*.mp3` / `*.words.json` are checked out from Git LFS into the same tree.
2. Authenticate Wrangler (`wrangler login` or copy `~/.config/.wrangler/` from a logged-in machine, or set `CLOUDFLARE_API_TOKEN`).
3. Install Node 22+ on the Pi (nvm is fine). Deploy/rollback scripts source `$HOME/.nvm/nvm.sh` so git hooks work without an interactive shell.
4. From the laptop: `bash scripts/push-origin.sh` and check `~/66ksiag-ci-state/deploy.log`.

## Rollback

On the Pi:

```bash
bash ~/66ksiag-deploy/ci/pi/rollback.sh
```

Rollback from the Pi, or SSH: `ssh drukarka 'bash "$HOME/66ksiag-deploy/ci/pi/rollback.sh"'`.

Versions are recorded under `~/66ksiag-ci-state/` (`current-version.txt`, `previous-version.txt`).

## Env

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEPLOY_ROOT` | `$HOME/66ksiag-deploy` | Non-bare checkout used to build |
| `BARE_REPO` | `$HOME/git/66ksiag-project.git` | Origin bare repo |
| `LFS_STORE` | `/mnt/pi-data/git-lfs/66ksiag` | Shared Git LFS object store |
| `HARNESS_CI_STATE` | `$HOME/66ksiag-ci-state` | Version id files |
| `HARNESS_CI_LOG` | `$HOME/66ksiag-ci-state/deploy.log` | Deploy log |

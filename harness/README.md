# Local ticket harness

Start:

```bash
npm run harness
# or: bash scripts/start-harness.sh
```

Opens `http://127.0.0.1:3900/` (set `HARNESS_NO_OPEN=1` to skip). Main preview: `http://127.0.0.1:3901/`.

Run it from a checkout of `main`. `main` is the latest development. `prod` is production. There is no `dev` branch.

## What it does

| Area | Behavior |
| --- | --- |
| Tickets | Open/closed list; id = `^[a-z0-9]+(-[a-z0-9]+)*$` |
| Worktrees | `.harness/worktrees/<id>` branched from `main`; `data/` + android secrets symlinked from the main checkout. `.harness/prod` is the `prod` checkout used for release |
| Chat | `agent -p --resume <chatId> --workspace <worktree>` streamed to the UI; Stop kills the process |
| Preview | Agent (or **Request preview**) starts `dev-serve.sh` and registers the port. The dashboard preview serves `main` |
| Files | Read-only explorer + text viewer |
| Android | **Test on Android (USB)** runs `android-build.sh` + `android-install.sh` |
| Merge | Ticket → `main` (conflicts stay open for chat); dashboard **Merge main → prod** (ff-only, then push `origin/main` and `origin/prod`). The push of `prod` deploys via Workers Builds |

Runtime state is gitignored under `.harness/`.

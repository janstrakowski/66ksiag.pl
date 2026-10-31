# Local ticket harness

Start:

```bash
npm run harness
# or: bash scripts/start-harness.sh
```

Opens `http://127.0.0.1:3900/` (set `HARNESS_NO_OPEN=1` to skip). Dev preview: `http://127.0.0.1:3901/`.

## What it does

| Area | Behavior |
| --- | --- |
| Tickets | Open/closed list; id = `^[a-z0-9]+(-[a-z0-9]+)*$` |
| Worktrees | `.harness/worktrees/<id>` branched from `dev`; `data/` + android secrets symlinked from main checkout |
| Chat | `agent -p --resume <chatId> --workspace <worktree>` streamed to the UI; Stop kills the process |
| Preview | Agent (or **Request preview**) starts `dev-serve.sh` and registers the port |
| Files | Read-only explorer + text viewer |
| Android | **Test on Android (USB)** runs `android-build.sh` + `android-install.sh` |
| Merge | Ticket → `dev` (conflicts stay open for chat); dashboard **Merge dev → main** (ff-only + push). The push of `main` deploys via Origin CI |

Runtime state is gitignored under `.harness/`.

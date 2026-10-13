import { spawnSync } from "node:child_process";
import {
  REPO_ROOT,
  DEV_WORKTREE,
  worktreePath,
  appendChat,
} from "./paths.mjs";
import {
  git,
  ensureDevWorktree,
  isDirty,
  currentSha,
} from "./git.mjs";
import { assertOpen, closeTicket, updateTicketMeta } from "./tickets.mjs";
import { startDevPreview, stopPreview } from "./preview.mjs";

/**
 * Merge ticket branch into local `dev`. On conflict, leave ticket open with
 * conflict state in the ticket worktree for the agent to resolve.
 */
export function mergeTicketToDev(id) {
  const meta = assertOpen(id);
  const wt = worktreePath(id);

  if (isDirty(wt)) {
    throw new Error("Ticket worktree has uncommitted changes — commit or discard before merge");
  }

  ensureDevWorktree();

  try {
    git(["checkout", "dev"], { cwd: DEV_WORKTREE });
    git(["merge", "--no-ff", "-m", `Merge ticket '${id}' into dev`, id], {
      cwd: DEV_WORKTREE,
    });
  } catch (err) {
    git(["merge", "--abort"], { cwd: DEV_WORKTREE, allowFail: true });

    try {
      git(["merge", "dev", "-m", `Merge dev into '${id}' to resolve`], {
        cwd: wt,
        allowFail: true,
      });
    } catch {
      /* ignore */
    }

    const msg = err.message || String(err);
    updateTicketMeta(id, { mergeError: msg });
    appendChat(id, {
      type: "system",
      ts: new Date().toISOString(),
      text: `Merge into dev failed:\n${msg}\n\nResolve conflicts in the worktree, commit, then approve merge again.`,
    });
    const e = new Error(`Merge into dev failed — continue in chat to resolve.\n${msg}`);
    e.mergeFailed = true;
    throw e;
  }

  updateTicketMeta(id, { mergeError: null });
  stopPreview(id);
  stopPreview("dev");
  startDevPreview();
  closeTicket(id, "merged-to-dev");
  return {
    ok: true,
    devSha: currentSha(DEV_WORKTREE),
  };
}

/**
 * Fast-forward main from local dev and push origin main immediately.
 */
export function mergeDevToMain() {
  ensureDevWorktree();

  if (isDirty(DEV_WORKTREE)) {
    throw new Error("dev worktree is dirty — commit or clean before promoting to main");
  }

  const onMain = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout === "main";
  if (!onMain) {
    git(["checkout", "main"]);
  }

  try {
    git(["merge", "--ff-only", "dev"]);
  } catch (err) {
    throw new Error(
      `ff-only merge of dev into main failed (main must only move via dev):\n${err.message}`,
    );
  }

  const push = git(["push", "origin", "main"]);
  return {
    ok: true,
    mainSha: currentSha(REPO_ROOT),
    pushStdout: push.stdout,
    pushStderr: push.stderr,
  };
}

export function rollbackViaSsh() {
  const host = process.env.HARNESS_PI_HOST || "drukarka";
  const remoteCmd =
    process.env.HARNESS_PI_ROLLBACK ||
    'bash "$HOME/66ksiag-deploy/ci/pi/rollback.sh"';
  const r = spawnSync("ssh", [host, remoteCmd], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "ssh rollback failed").trim());
  }
  return {
    ok: true,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

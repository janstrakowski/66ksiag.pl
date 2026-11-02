import {
  REPO_ROOT,
  PROD_WORKTREE,
  worktreePath,
  appendChat,
} from "./paths.mjs";
import {
  git,
  ensureMainCheckout,
  ensureProdWorktree,
  isDirty,
  currentSha,
} from "./git.mjs";
import { assertOpen, closeTicket, updateTicketMeta } from "./tickets.mjs";
import { startMainPreview, stopPreview } from "./preview.mjs";

/**
 * Merge ticket branch into local `main`. On conflict, leave ticket open with
 * conflict state in the ticket worktree for the agent to resolve.
 */
export function mergeTicketToMain(id) {
  const meta = assertOpen(id);
  const wt = worktreePath(id);

  if (isDirty(wt)) {
    throw new Error("Ticket worktree has uncommitted changes — commit or discard before merge");
  }

  ensureMainCheckout();
  if (isDirty(REPO_ROOT)) {
    throw new Error("main checkout is dirty — commit or clean before merging the ticket");
  }

  try {
    git(["merge", "--no-ff", "-m", `Merge ticket '${id}' into main`, id], {
      cwd: REPO_ROOT,
    });
  } catch (err) {
    git(["merge", "--abort"], { cwd: REPO_ROOT, allowFail: true });

    try {
      git(["merge", "main", "-m", `Merge main into '${id}' to resolve`], {
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
      text: `Merge into main failed:\n${msg}\n\nResolve conflicts in the worktree, commit, then approve merge again.`,
    });
    const e = new Error(`Merge into main failed — continue in chat to resolve.\n${msg}`);
    e.mergeFailed = true;
    throw e;
  }

  updateTicketMeta(id, { mergeError: null });
  stopPreview(id);
  stopPreview("main");
  startMainPreview();
  closeTicket(id, "merged-to-main");
  return {
    ok: true,
    mainSha: currentSha(REPO_ROOT),
  };
}

/**
 * Fast-forward prod from local main, then push origin/main and origin/prod.
 * Workers Builds deploys production from `prod`.
 */
export function mergeMainToProd() {
  ensureMainCheckout();

  if (isDirty(REPO_ROOT)) {
    throw new Error("main checkout is dirty — commit or clean before promoting to prod");
  }

  ensureProdWorktree();

  if (isDirty(PROD_WORKTREE)) {
    throw new Error("prod worktree is dirty — commit or clean before promoting to prod");
  }

  try {
    git(["merge", "--ff-only", "main"], { cwd: PROD_WORKTREE });
  } catch (err) {
    throw new Error(
      `ff-only merge of main into prod failed (prod must only move via main):\n${err.message}`,
    );
  }

  const pushMain = git(["push", "-u", "origin", "main"]);
  const pushProd = git(["push", "-u", "origin", "prod"]);
  return {
    ok: true,
    mainSha: currentSha(REPO_ROOT),
    prodSha: currentSha(PROD_WORKTREE),
    pushStdout: [pushMain.stdout, pushProd.stdout].filter(Boolean).join("\n"),
    pushStderr: [pushMain.stderr, pushProd.stderr].filter(Boolean).join("\n"),
  };
}

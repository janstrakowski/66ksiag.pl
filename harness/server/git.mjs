import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, DEV_WORKTREE } from "./paths.mjs";

export function git(args, opts = {}) {
  const cwd = opts.cwd || REPO_ROOT;
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.status !== 0 && !opts.allowFail) {
    const msg = (r.stderr || r.stdout || "").trim() || `git ${args.join(" ")} failed`;
    const err = new Error(msg);
    err.code = r.status;
    err.stdout = r.stdout;
    err.stderr = r.stderr;
    throw err;
  }
  return {
    status: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

export function gitAsync(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd || REPO_ROOT,
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      opts.onStdout?.(d.toString());
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      opts.onStderr?.(d.toString());
    });
    child.on("close", (code) => {
      if (code !== 0 && !opts.allowFail) {
        const err = new Error((stderr || stdout || "").trim() || `git ${args.join(" ")} failed`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ status: code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** Symlink main checkout data/ (and android secrets if present) into a worktree. */
export function linkSharedAssets(wt) {
  const dataSrc = path.join(REPO_ROOT, "data");
  const dataDst = path.join(wt, "data");
  if (fs.existsSync(dataSrc) && !fs.existsSync(dataDst)) {
    fs.symlinkSync(dataSrc, dataDst, "dir");
  }

  const secretsSrc = path.join(REPO_ROOT, "android", "secrets");
  const secretsDst = path.join(wt, "android", "secrets");
  if (fs.existsSync(secretsSrc) && fs.existsSync(path.join(wt, "android")) && !fs.existsSync(secretsDst)) {
    fs.symlinkSync(secretsSrc, secretsDst, "dir");
  }

  const keystoreSrc = path.join(REPO_ROOT, "android", "android.keystore");
  const keystoreDst = path.join(wt, "android", "android.keystore");
  if (fs.existsSync(keystoreSrc) && fs.existsSync(path.join(wt, "android")) && !fs.existsSync(keystoreDst)) {
    fs.symlinkSync(keystoreSrc, keystoreDst);
  }
}

export function branchExists(name) {
  const r = git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { allowFail: true });
  return r.status === 0;
}

export function ensureDevBranch() {
  if (!branchExists("dev")) {
    if (!branchExists("main")) {
      throw new Error("Neither local branch 'dev' nor 'main' exists");
    }
    git(["branch", "dev", "main"]);
  }
}

export function ensureDevWorktree() {
  ensureDevBranch();
  if (!fs.existsSync(DEV_WORKTREE)) {
    git(["worktree", "add", DEV_WORKTREE, "dev"]);
  } else {
    git(["checkout", "dev"], { cwd: DEV_WORKTREE, allowFail: true });
  }
  linkSharedAssets(DEV_WORKTREE);
}

export function addTicketWorktree(id, baseRef = "dev") {
  const dest = path.join(REPO_ROOT, ".harness", "worktrees", id);
  if (fs.existsSync(dest)) {
    throw new Error(`Worktree already exists: ${dest}`);
  }
  ensureDevBranch();
  git(["worktree", "add", "-b", id, dest, baseRef]);
  linkSharedAssets(dest);
  return dest;
}

export function removeTicketWorktree(id) {
  const dest = path.join(REPO_ROOT, ".harness", "worktrees", id);
  if (fs.existsSync(dest)) {
    git(["worktree", "remove", "--force", dest], { allowFail: true });
  }
  // Drop local branch if it still exists and is not checked out elsewhere
  if (branchExists(id)) {
    git(["branch", "-D", id], { allowFail: true });
  }
  git(["worktree", "prune"], { allowFail: true });
}

export function isDirty(cwd) {
  const r = git(["status", "--porcelain"], { cwd });
  return r.stdout.length > 0;
}

export function currentSha(cwd = REPO_ROOT) {
  return git(["rev-parse", "HEAD"], { cwd }).stdout;
}

import { spawn } from "node:child_process";
import path from "node:path";
import { REPO_ROOT, DEV_WORKTREE, worktreePath } from "./paths.mjs";
import { linkSharedAssets } from "./git.mjs";

/** @type {{ child: import('node:child_process').ChildProcess, scope: string, ticketId?: string } | null} */
let job = null;
/** @type {Set<Function>} */
const listeners = new Set();

export function androidStatus() {
  if (!job) return { running: false };
  return { running: true, scope: job.scope, ticketId: job.ticketId || null };
}

export function subscribeAndroid(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(ev) {
  for (const fn of listeners) {
    try {
      fn(ev);
    } catch {
      /* ignore */
    }
  }
}

function resolveCwd(scope, ticketId) {
  if (scope === "dev") return DEV_WORKTREE;
  if (scope === "ticket") {
    if (!ticketId) throw new Error("ticket id required");
    return worktreePath(ticketId);
  }
  throw new Error("scope must be 'dev' or 'ticket'");
}

/**
 * Build release APK/AAB then adb install -r on a USB device.
 */
export function startAndroidTest({ scope, ticketId } = {}) {
  if (job?.child) throw new Error("Android test already running");

  const cwd = resolveCwd(scope, ticketId);
  linkSharedAssets(cwd);

  // Scripts from the harness checkout (latest fixes); KSIAG_ROOT = worktree to build.
  const build = path.join(REPO_ROOT, "scripts", "android-build.sh");
  const install = path.join(REPO_ROOT, "scripts", "android-install.sh");
  const script = `set -euo pipefail; bash "${build}"; bash "${install}"`;
  const child = spawn("bash", ["-c", script], {
    cwd,
    env: { ...process.env, KSIAG_ROOT: cwd },
    stdio: ["ignore", "pipe", "pipe"],
  });

  job = { child, scope, ticketId };
  emit({ type: "android_start", ts: new Date().toISOString(), scope, ticketId });

  child.stdout.on("data", (d) => {
    emit({ type: "android_log", stream: "stdout", text: d.toString() });
  });
  child.stderr.on("data", (d) => {
    emit({ type: "android_log", stream: "stderr", text: d.toString() });
  });
  child.on("close", (code, signal) => {
    emit({ type: "android_end", ts: new Date().toISOString(), code, signal });
    job = null;
  });

  return { pid: child.pid };
}

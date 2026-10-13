import { spawn } from "node:child_process";
import path from "node:path";
import { REPO_ROOT, DEV_WORKTREE, DEV_PREVIEW_PORT, TICKET_PORT_START, TICKET_PORT_END, readIndex, writeIndex } from "./paths.mjs";

/** @type {Map<string, { pid: number, port: number, child: import('node:child_process').ChildProcess }>} */
const running = new Map();

export function listPreviews() {
  const out = {};
  for (const [key, v] of running) {
    out[key] = { port: v.port, pid: v.pid, url: `http://127.0.0.1:${v.port}/` };
  }
  return out;
}

export function getPreview(key) {
  const v = running.get(key);
  if (!v) return null;
  return { port: v.port, pid: v.pid, url: `http://127.0.0.1:${v.port}/` };
}

function allocatePort() {
  const index = readIndex();
  let port = index.nextPort || TICKET_PORT_START;
  const used = new Set([...running.values()].map((v) => v.port));
  used.add(DEV_PREVIEW_PORT);
  while (used.has(port) || port < TICKET_PORT_START) {
    port += 1;
    if (port > TICKET_PORT_END) port = TICKET_PORT_START;
  }
  index.nextPort = port + 1 > TICKET_PORT_END ? TICKET_PORT_START : port + 1;
  writeIndex(index);
  return port;
}

function startServe(key, cwd, port) {
  stopPreview(key);
  const script = path.join(REPO_ROOT, "scripts", "dev-serve.sh");
  const child = spawn("bash", [script], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.unref();
  running.set(key, { pid: child.pid, port, child });
  child.on("exit", () => {
    const cur = running.get(key);
    if (cur && cur.pid === child.pid) running.delete(key);
  });
  return getPreview(key);
}

export function startDevPreview() {
  return startServe("dev", DEV_WORKTREE, DEV_PREVIEW_PORT);
}

export function startTicketPreview(ticketId, port) {
  const wt = path.join(REPO_ROOT, ".harness", "worktrees", ticketId);
  const p = port || allocatePort();
  return startServe(ticketId, wt, p);
}

export function registerTicketPreview(ticketId, port) {
  // Agent already started the server; just record the port (pid unknown).
  stopPreview(ticketId);
  running.set(ticketId, { pid: 0, port, child: null });
  return getPreview(ticketId);
}

export function stopPreview(key) {
  const cur = running.get(key);
  if (!cur) return;
  running.delete(key);
  if (cur.child && !cur.child.killed) {
    try {
      process.kill(-cur.pid, "SIGTERM");
    } catch {
      try {
        process.kill(cur.pid, "SIGTERM");
      } catch {
        /* ignore */
      }
    }
  } else if (cur.pid) {
    try {
      process.kill(cur.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

export function stopAllPreviews() {
  for (const key of [...running.keys()]) stopPreview(key);
}

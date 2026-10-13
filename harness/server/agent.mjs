import { spawn } from "node:child_process";
import {
  appendChat,
  readMeta,
  writeMeta,
  worktreePath,
} from "./paths.mjs";
import { assertOpen } from "./tickets.mjs";

/** @type {Map<string, { child: import('node:child_process').ChildProcess, listeners: Set<Function> }>} */
const runs = new Map();

export function isRunning(id) {
  return runs.has(id);
}

export function subscribe(id, fn) {
  let entry = runs.get(id);
  if (!entry) {
    entry = { child: null, listeners: new Set() };
    runs.set(id, entry);
  }
  entry.listeners.add(fn);
  return () => entry.listeners.delete(fn);
}

function emit(id, event) {
  const entry = runs.get(id);
  if (!entry) return;
  for (const fn of entry.listeners) {
    try {
      fn(event);
    } catch {
      /* ignore */
    }
  }
}

export function stopAgent(id) {
  const entry = runs.get(id);
  if (!entry?.child) return false;
  const child = entry.child;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  return true;
}

/**
 * Send a prompt to the ticket's Cursor agent chat. Streams NDJSON events.
 */
export function sendPrompt(id, prompt, { system = false } = {}) {
  const meta = assertOpen(id);
  if (runs.get(id)?.child) {
    throw new Error("Agent is already running for this ticket — stop it first");
  }

  const ts = new Date().toISOString();
  const userEvent = {
    type: system ? "system" : "user",
    ts,
    text: prompt,
  };
  appendChat(id, userEvent);

  const wt = worktreePath(id);
  const args = [
    "-p",
    "--force",
    "--trust",
    "--workspace",
    wt,
    "--resume",
    meta.chatId,
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    prompt,
  ];

  const child = spawn("agent", args, {
    cwd: wt,
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let entry = runs.get(id);
  if (!entry) {
    entry = { child: null, listeners: new Set() };
    runs.set(id, entry);
  }
  entry.child = child;

  emit(id, { type: "run_start", ts });
  appendChat(id, { type: "run_start", ts });

  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        parsed = { type: "raw", text: line };
      }
      const ev = { type: "agent", ts: new Date().toISOString(), data: parsed };
      appendChat(id, ev);
      emit(id, ev);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    const ev = { type: "agent_stderr", ts: new Date().toISOString(), text };
    appendChat(id, ev);
    emit(id, ev);
  });

  child.on("close", (code, signal) => {
    const doneTs = new Date().toISOString();
    const ev = { type: "run_end", ts: doneTs, code, signal };
    appendChat(id, ev);
    emit(id, ev);
    if (entry) entry.child = null;
    // Drop empty listener-only entries
    if (entry && entry.listeners.size === 0) runs.delete(id);
    writeMeta(id, { ...readMeta(id), updatedAt: doneTs });
  });

  return { pid: child.pid };
}

export const REQUEST_PREVIEW_PROMPT = `Start a local web preview for this ticket worktree so it can be opened from the harness.

1. Pick a free port in 3910–3999 (or use one the harness assigned).
2. From the worktree root run: PORT=<port> bash scripts/dev-serve.sh
   Run it in the background so it keeps serving.
3. Register it with the harness (harness must be running):
   bash harness/bin/register-preview --ticket <TICKET_ID> --port <port>
   (or: curl -sS -X POST "http://127.0.0.1:3900/api/tickets/<TICKET_ID>/preview" -H 'content-type: application/json' -d '{"port":<port>}')
4. Reply with the preview URL http://127.0.0.1:<port>/

If a preview is already registered and healthy, say so and do not start a second one.`;

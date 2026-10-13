import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  TICKET_ID_RE,
  ensureHarnessLayout,
  readIndex,
  writeIndex,
  writeMeta,
  readMeta,
  readChat,
  appendChat,
  ticketDir,
  worktreePath,
} from "./paths.mjs";
import { addTicketWorktree, removeTicketWorktree, ensureDevBranch } from "./git.mjs";
import { stopPreview } from "./preview.mjs";

function createAgentChat() {
  const r = spawnSync("agent", ["create-chat"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "agent create-chat failed").trim());
  }
  const id = (r.stdout || "").trim();
  if (!id) throw new Error("agent create-chat returned empty chat id");
  return id;
}

export function listTickets() {
  ensureHarnessLayout();
  const index = readIndex();
  const open = [];
  const closed = [];
  for (const id of Object.keys(index.tickets).sort()) {
    try {
      const meta = readMeta(id);
      if (meta.status === "open") open.push(meta);
      else closed.push(meta);
    } catch {
      /* skip broken */
    }
  }
  return { open, closed };
}

export function getTicket(id) {
  const meta = readMeta(id);
  return { ...meta, chat: readChat(id) };
}

export function createTicket(rawId, title = "") {
  const id = String(rawId || "").trim().toLowerCase();
  if (!TICKET_ID_RE.test(id)) {
    throw new Error("Ticket id must be lowercase letters, digits, and dashes (e.g. fix-audio-button)");
  }
  ensureHarnessLayout();
  ensureDevBranch();
  const index = readIndex();
  if (index.tickets[id]) {
    throw new Error(`Ticket '${id}' already exists`);
  }
  if (fs.existsSync(worktreePath(id))) {
    throw new Error(`Worktree for '${id}' already exists`);
  }

  const chatId = createAgentChat();
  const wt = addTicketWorktree(id, "dev");
  const now = new Date().toISOString();
  const meta = {
    id,
    title: title || id,
    status: "open",
    chatId,
    worktree: wt,
    previewUrl: null,
    previewPort: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    mergeError: null,
  };
  writeMeta(id, meta);
  index.tickets[id] = { status: "open" };
  writeIndex(index);
  appendChat(id, {
    type: "system",
    ts: now,
    text: `Ticket opened. Worktree: ${wt}. Chat: ${chatId}`,
  });
  return meta;
}

export function closeTicket(id, reason = "merged") {
  const meta = readMeta(id);
  if (meta.status !== "open") return meta;
  stopPreview(id);
  removeTicketWorktree(id);
  meta.status = "closed";
  meta.closedAt = new Date().toISOString();
  meta.updatedAt = meta.closedAt;
  meta.closeReason = reason;
  meta.previewUrl = null;
  meta.previewPort = null;
  writeMeta(id, meta);
  const index = readIndex();
  if (index.tickets[id]) {
    index.tickets[id].status = "closed";
    writeIndex(index);
  }
  appendChat(id, {
    type: "system",
    ts: meta.closedAt,
    text: `Ticket closed (${reason}). Worktree removed.`,
  });
  return meta;
}

export function updateTicketMeta(id, patch) {
  const meta = readMeta(id);
  Object.assign(meta, patch, { updatedAt: new Date().toISOString() });
  writeMeta(id, meta);
  return meta;
}

export function ticketExists(id) {
  try {
    readMeta(id);
    return true;
  } catch {
    return false;
  }
}

export function assertOpen(id) {
  const meta = readMeta(id);
  if (meta.status !== "open") throw new Error(`Ticket '${id}' is closed`);
  return meta;
}

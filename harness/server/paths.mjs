import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (checkout that contains harness/). */
export const REPO_ROOT = path.resolve(__dirname, "../..");

/** Runtime state — gitignored. */
export const HARNESS_DIR = path.join(REPO_ROOT, ".harness");

export const TICKETS_DIR = path.join(HARNESS_DIR, "tickets");
export const WORKTREES_DIR = path.join(HARNESS_DIR, "worktrees");
/** Checkout of `prod` used only to fast-forward and push production. */
export const PROD_WORKTREE = path.join(HARNESS_DIR, "prod");
export const INDEX_PATH = path.join(HARNESS_DIR, "index.json");

export const HARNESS_PORT = Number(process.env.HARNESS_PORT || 3900);
/** Local preview of `main` (latest development). `HARNESS_DEV_PORT` remains accepted. */
export const MAIN_PREVIEW_PORT = Number(
  process.env.HARNESS_MAIN_PORT || process.env.HARNESS_DEV_PORT || 3901,
);
export const TICKET_PORT_START = Number(process.env.HARNESS_TICKET_PORT_START || 3910);
export const TICKET_PORT_END = Number(process.env.HARNESS_TICKET_PORT_END || 3999);

export const TICKET_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function ensureHarnessLayout() {
  for (const dir of [HARNESS_DIR, TICKETS_DIR, WORKTREES_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(INDEX_PATH)) {
    fs.writeFileSync(
      INDEX_PATH,
      JSON.stringify({ tickets: {}, nextPort: TICKET_PORT_START }, null, 2) + "\n",
    );
  }
}

export function ticketDir(id) {
  return path.join(TICKETS_DIR, id);
}

export function ticketMetaPath(id) {
  return path.join(ticketDir(id), "meta.json");
}

export function ticketChatPath(id) {
  return path.join(ticketDir(id), "chat.jsonl");
}

export function worktreePath(id) {
  return path.join(WORKTREES_DIR, id);
}

export function readIndex() {
  ensureHarnessLayout();
  return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
}

export function writeIndex(index) {
  ensureHarnessLayout();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
}

export function readMeta(id) {
  return JSON.parse(fs.readFileSync(ticketMetaPath(id), "utf8"));
}

export function writeMeta(id, meta) {
  fs.mkdirSync(ticketDir(id), { recursive: true });
  fs.writeFileSync(ticketMetaPath(id), JSON.stringify(meta, null, 2) + "\n");
}

export function appendChat(id, event) {
  fs.mkdirSync(ticketDir(id), { recursive: true });
  fs.appendFileSync(ticketChatPath(id), JSON.stringify(event) + "\n");
}

export function readChat(id) {
  const p = ticketChatPath(id);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

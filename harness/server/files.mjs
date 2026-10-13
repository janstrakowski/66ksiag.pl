import fs from "node:fs";
import path from "node:path";
import { worktreePath, DEV_WORKTREE } from "./paths.mjs";

const TEXT_EXT = new Set([
  ".txt",
  ".md",
  ".json",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".html",
  ".htm",
  ".svg",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".sh",
  ".rs",
  ".kt",
  ".kts",
  ".gradle",
  ".properties",
  ".gitignore",
  ".env",
  ".csv",
  ".sql",
  ".py",
  ".rb",
  ".go",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cmake",
  ".dockerfile",
  ".editorconfig",
  ".lock",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "data",
  "target",
  "dist",
  "vendor",
  ".gradle",
  "build",
  ".harness",
  "__pycache__",
  "coverage",
  "test-results",
  "playwright-report",
]);

const MAX_TEXT_BYTES = 512 * 1024;

function resolveRoot(scope, ticketId) {
  if (scope === "dev") return DEV_WORKTREE;
  if (scope === "ticket") {
    if (!ticketId) throw new Error("ticket id required");
    return worktreePath(ticketId);
  }
  throw new Error("scope must be 'dev' or 'ticket'");
}

function safeResolve(root, rel) {
  const cleaned = path.normalize(rel || ".").replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.resolve(root, cleaned);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Path escapes worktree");
  }
  return abs;
}

export function listDir(scope, ticketId, rel = ".") {
  const root = resolveRoot(scope, ticketId);
  const abs = safeResolve(root, rel);
  if (!fs.existsSync(abs)) throw new Error("Not found");
  const st = fs.statSync(abs);
  if (!st.isDirectory()) throw new Error("Not a directory");

  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const items = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".") && ent.name !== ".gitignore") continue;
    if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;
    const child = path.join(abs, ent.name);
    let size = 0;
    try {
      size = ent.isFile() ? fs.statSync(child).size : 0;
    } catch {
      /* ignore */
    }
    items.push({
      name: ent.name,
      type: ent.isDirectory() ? "dir" : "file",
      size,
      path: path.relative(root, child).split(path.sep).join("/"),
    });
  }
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { root: path.relative(root, abs) || ".", items };
}

export function readFile(scope, ticketId, rel) {
  const root = resolveRoot(scope, ticketId);
  const abs = safeResolve(root, rel);
  if (!fs.existsSync(abs)) throw new Error("Not found");
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error("Not a file");
  if (st.size > MAX_TEXT_BYTES) {
    throw new Error(`File too large to view (>${MAX_TEXT_BYTES} bytes)`);
  }
  const ext = path.extname(abs).toLowerCase();
  const base = path.basename(abs).toLowerCase();
  const looksText =
    TEXT_EXT.has(ext) ||
    !ext ||
    base === "dockerfile" ||
    base === "makefile" ||
    base === "license";
  if (!looksText) {
    throw new Error("Binary or unsupported file type");
  }
  const buf = fs.readFileSync(abs);
  // Reject obvious binary
  if (buf.includes(0)) throw new Error("Binary file");
  return {
    path: path.relative(root, abs).split(path.sep).join("/"),
    size: st.size,
    content: buf.toString("utf8"),
  };
}

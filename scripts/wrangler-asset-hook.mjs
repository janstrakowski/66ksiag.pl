/**
 * Workers Builds cannot batch-download Git LFS (the git-proxy returns an error
 * on /info/lfs/objects/batch). Chapter MP3s stay in LFS. This hook lets wrangler
 * publish them as Static Assets:
 *
 * - While hashing, a small LFS pointer uses the committed Blake3 asset hash and
 *   the real byte size from data/kjv/1769/audio-assets-manifest.json.
 * - Cloudflare then asks only for hashes it does not already have.
 * - Those chapters are materialized for the upload (git lfs pull locally, or
 *   the public-domain ECFTF host in CI) and removed from disk afterwards.
 *
 * scripts/patch-wrangler-assets.mjs wires the three globals into wrangler 4.149.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, "data/kjv/1769/audio-assets-manifest.json");
const BOOKS_PATH = join(ROOT, "data/kjv/1769/books.json");
const ECFTF_INDEX = "https://earnestlycontendingforthefaith.com/ListenToTheKingJamesBible.html";
const ECFTF_BASE = "https://earnestlycontendingforthefaith.com/";
const FETCH_CONCURRENCY = positiveInt(process.env.ASSET_FETCH_CONCURRENCY, 8);
const LFS_BATCH = positiveInt(process.env.LFS_PULL_BATCH, 40);

const savedPointers = new Map();
let urlMapPromise = null;

function positiveInt(value, fallback) {
  const n = Number.parseInt(value || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function assetKey(filepath) {
  const norm = String(filepath).replace(/\\/g, "/");
  const idx = norm.indexOf("/kjv/1769/");
  if (idx < 0) return null;
  const key = norm.slice(idx);
  return key.endsWith(".mp3") ? key : null;
}

export function assetOverride(filepath, diskSize, manifestFiles) {
  if (!(diskSize < 1024)) return null;
  const key = assetKey(filepath);
  if (!key) return null;
  const entry = manifestFiles[key];
  if (!entry || typeof entry.assetHash !== "string" || !Number.isFinite(entry.size)) return null;
  return { hash: entry.assetHash, size: entry.size };
}

export function mapEcftfUrls(html, books) {
  const seen = new Set();
  const ordered = [];
  for (const match of html.matchAll(/href=["']([^"']+\.mp3)["']/gi)) {
    const href = match[1];
    if (seen.has(href)) continue;
    seen.add(href);
    ordered.push(href);
  }
  const out = {};
  let i = 0;
  for (const book of books) {
    const chapters = Number(book.chapters);
    for (let ch = 1; ch <= chapters; ch += 1) {
      if (i >= ordered.length) return out;
      out[`/kjv/1769/${book.id}/${ch}.mp3`] = new URL(ordered[i], ECFTF_BASE).href;
      i += 1;
    }
  }
  return out;
}

function loadManifestFiles() {
  const parsed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  return parsed.files || {};
}

function readPointer(absPath) {
  let size;
  try {
    size = statSync(absPath).size;
  } catch {
    return null;
  }
  if (size > 1024) return null;
  const text = readFileSync(absPath, "utf8");
  if (!text.startsWith("version https://git-lfs.github.com/spec/v1")) return null;
  return text;
}

function shaMatches(buf, entry) {
  return buf.length === entry.size && createHash("sha256").update(buf).digest("hex") === entry.oid;
}

function copyIfMatches(repoPath, destPath, entry) {
  let buf;
  try {
    buf = readFileSync(repoPath);
  } catch {
    return false;
  }
  if (!shaMatches(buf, entry)) return false;
  writeFileSync(destPath, buf);
  return true;
}

async function pruneLfs() {
  try {
    await execFileAsync("git", ["lfs", "prune", "-f"], { cwd: ROOT });
  } catch {
    // A missing object cache is fine. The upload already has the bytes it needs.
  }
}

async function mapPool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function fetchBytes(url) {
  let last = "fetch failed";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "66ksiag-audio-fetch/1.0" },
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(`${url}: ${last}`);
}

function loadUrlMap() {
  if (!urlMapPromise) {
    urlMapPromise = (async () => {
      const books = JSON.parse(readFileSync(BOOKS_PATH, "utf8")).books;
      const html = (await fetchBytes(ECFTF_INDEX)).toString("utf8");
      return mapEcftfUrls(html, books);
    })().catch((err) => {
      urlMapPromise = null;
      throw err;
    });
  }
  return urlMapPromise;
}

async function pullLfs(repoPaths) {
  for (let start = 0; start < repoPaths.length; start += LFS_BATCH) {
    const batch = repoPaths.slice(start, start + LFS_BATCH);
    try {
      await execFileAsync("git", ["lfs", "pull", `--include=${batch.join(",")}`, "--exclude="], {
        cwd: ROOT,
        env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "0" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[audio-assets] git lfs pull failed (${message}). Using the public-domain chapter host.`);
      return;
    }
  }
}

async function prepareBucket(pairs, manifestFiles) {
  const pending = [];
  for (const [absPath, meta] of pairs) {
    const key = assetKey(absPath);
    const entry = key ? manifestFiles[key] : null;
    if (!entry) continue;
    if (meta?.hash && meta.hash !== entry.assetHash) continue;
    const pointer = readPointer(absPath);
    if (!pointer) continue;
    savedPointers.set(absPath, pointer);
    pending.push({ absPath, key, entry, pointer });
  }
  if (pending.length === 0) return;

  console.log(`[audio-assets] Materializing ${pending.length} chapter MP3(s) Cloudflare does not have yet.`);
  await pullLfs(pending.map((item) => `data${item.key}`));
  const still = [];
  for (const item of pending) {
    const repoPath = join(ROOT, "data" + item.key);
    const ok = copyIfMatches(repoPath, item.absPath, item.entry);
    if (!readPointer(repoPath)) writeFileSync(repoPath, item.pointer);
    if (!ok) still.push(item);
  }
  await pruneLfs();
  if (still.length === 0) return;

  const urls = await loadUrlMap();
  await mapPool(still, FETCH_CONCURRENCY, async (item) => {
    const r2Worker = (process.env.LFS_R2_WORKER_URL || "").trim().replace(/\/+$/, "");
    if (r2Worker) {
      try {
        const buf = await fetchBytes(`${r2Worker}/objects/${item.entry.oid}`);
        if (shaMatches(buf, item.entry)) {
          writeFileSync(item.absPath, buf);
          return;
        }
      } catch {
        // Fall through to the public-domain chapter host.
      }
    }
    const url = urls[item.key];
    if (!url) throw new Error(`No public-domain URL for ${item.key}`);
    const buf = await fetchBytes(url);
    if (!shaMatches(buf, item.entry)) {
      throw new Error(`Downloaded audio for ${item.key} did not match Git LFS oid ${item.entry.oid}`);
    }
    writeFileSync(item.absPath, buf);
  });
}

async function releaseAssets(paths) {
  let restored = 0;
  for (const absPath of paths) {
    const pointer = savedPointers.get(absPath);
    if (!pointer) continue;
    writeFileSync(absPath, pointer);
    savedPointers.delete(absPath);
    restored += 1;
  }
  if (restored > 0) await pruneLfs();
}

export function install() {
  const manifestFiles = loadManifestFiles();
  globalThis.__ksiagAssetOverride = (filepath, diskSize) => assetOverride(filepath, diskSize, manifestFiles);
  globalThis.__ksiagPrepareBucket = (pairs) => prepareBucket(pairs, manifestFiles);
  globalThis.__ksiagReleaseAssets = (paths) => releaseAssets(paths);
}

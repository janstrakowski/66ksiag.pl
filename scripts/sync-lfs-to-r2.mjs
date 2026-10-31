#!/usr/bin/env node
/**
 * Dev-only Git LFS -> Cloudflare R2 sync/seed utility (`66ksiag-audio`).
 *
 * Completely independent of the production `66ksiag` Worker and `66ksiag.pl`.
 *
 * It inspects Git LFS pointer files in the repository (`git lfs ls-files -l` or
 * `data/kjv/1769/audio-assets-manifest.json`), checks which `objects/<oid>` keys
 * are missing in R2, materializes them in small batches (from `.git/lfs/objects`,
 * `git lfs pull`, or the public-domain Scourby chapter host), uploads them to R2,
 * and restores the working tree to clean LFS pointers.
 *
 * Examples:
 *   npm run lfs:sync-r2 -- --dry-run
 *   npm run lfs:sync-r2 -- --include=demos/
 *   LFS_UPLOAD_TOKEN=... npm run lfs:sync-r2
 *   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... npm run lfs:sync-r2
 *   LFS_R2_BACKEND=wrangler npm run lfs:sync-r2 -- --limit=5
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createStorageAdapter, resolveBackendConfig, sha256Hex } from "./git-lfs-r2.mjs";
import { mapEcftfUrls } from "./wrangler-asset-hook.mjs";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, "data/kjv/1769/audio-assets-manifest.json");
const BOOKS_PATH = join(ROOT, "data/kjv/1769/books.json");
const ECFTF_INDEX = "https://earnestlycontendingforthefaith.com/ListenToTheKingJamesBible.html";

/**
 * Parses `version https://git-lfs.github.com/spec/v1\noid sha256:<oid>\nsize <size>\n`
 */
export function parseLfsPointer(text) {
  if (typeof text !== "string" || !text.startsWith("version https://git-lfs.github.com/spec/v1")) {
    return null;
  }
  const oidMatch = text.match(/^oid sha256:([0-9a-f]{64})$/m);
  const sizeMatch = text.match(/^size (\d+)$/m);
  if (!oidMatch || !sizeMatch) return null;
  const size = Number(sizeMatch[1]);
  if (!Number.isSafeInteger(size) || size < 0) return null;
  return { oid: oidMatch[1], size };
}

export function collectRepoLfsEntries(rootDir = ROOT, { includePrefix = "" } = {}) {
  const entries = [];
  const seenPaths = new Set();

  if (existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    for (const [assetPath, info] of Object.entries(manifest.files || {})) {
      const repoPath = `data${assetPath}`;
      if (includePrefix && !repoPath.startsWith(includePrefix)) continue;
      seenPaths.add(repoPath);
      entries.push({
        repoPath,
        oid: info.oid,
        size: info.size,
        assetKey: assetPath,
      });
    }
  }

  return { entries, seenPaths };
}

export async function listAllRepoLfsEntries(rootDir = ROOT, { includePrefix = "" } = {}) {
  const { entries, seenPaths } = collectRepoLfsEntries(rootDir, { includePrefix });
  try {
    const { stdout } = await execFileAsync("git", ["lfs", "ls-files", "-l"], { cwd: rootDir });
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^([0-9a-f]{64})\s+[-*]\s+(.+)$/);
      if (!match) continue;
      const [, oid, repoPath] = match;
      if (includePrefix && !repoPath.startsWith(includePrefix)) continue;
      if (seenPaths.has(repoPath)) continue;
      const absPath = join(rootDir, repoPath);
      let size = null;
      if (existsSync(absPath)) {
        const st = statSync(absPath);
        if (st.size < 1024) {
          const parsed = parseLfsPointer(readFileSync(absPath, "utf8"));
          if (parsed) size = parsed.size;
        } else {
          size = st.size;
        }
      }
      seenPaths.add(repoPath);
      entries.push({ repoPath, oid, size, assetKey: null });
    }
  } catch {
    // Fallback to manifest entries if git-lfs is unavailable.
  }
  return entries;
}

export function localLfsCachePath(rootDir, oid) {
  return join(rootDir, ".git/lfs/objects", oid.slice(0, 2), oid.slice(2, 4), oid);
}

export function parseCliArgs(argv) {
  const opts = {
    dryRun: false,
    skipExisting: true,
    batchSize: 20,
    concurrency: 6,
    limit: 0,
    includePrefix: "",
  };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--force") opts.skipExisting = false;
    else if (arg.startsWith("--batch-size=")) opts.batchSize = Math.max(1, Number(arg.split("=")[1]) || 20);
    else if (arg.startsWith("--concurrency=")) opts.concurrency = Math.max(1, Number(arg.split("=")[1]) || 6);
    else if (arg.startsWith("--limit=")) opts.limit = Math.max(0, Number(arg.split("=")[1]) || 0);
    else if (arg.startsWith("--include=")) opts.includePrefix = arg.slice("--include=".length).trim();
  }
  return opts;
}

async function mapPool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

let ecftfMapMemo = null;
async function getEcftfMap() {
  if (!ecftfMapMemo) {
    const books = JSON.parse(readFileSync(BOOKS_PATH, "utf8")).books;
    const res = await fetch(ECFTF_INDEX, {
      headers: { "user-agent": "66ksiag-lfs-r2-sync/1.0" },
    });
    if (!res.ok) throw new Error(`Failed to fetch ECFTF index (${res.status})`);
    const html = await res.text();
    ecftfMapMemo = mapEcftfUrls(html, books);
  }
  return ecftfMapMemo;
}

export async function syncLfsToR2({
  rootDir = ROOT,
  adapter = createStorageAdapter(),
  entries: providedEntries = null,
  dryRun = false,
  skipExisting = true,
  batchSize = 20,
  concurrency = 6,
  limit = 0,
  includePrefix = "",
  logger = console,
} = {}) {
  let allEntries = providedEntries ?? (await listAllRepoLfsEntries(rootDir, { includePrefix }));
  if (limit > 0) {
    allEntries = allEntries.slice(0, limit);
  }

  let skipped = 0;
  let uploaded = 0;
  const toUpload = [];

  if (skipExisting) {
    await mapPool(allEntries, concurrency, async (item) => {
      const exists = await adapter.hasObject(item.oid, item.size ?? undefined);
      if (exists) {
        skipped += 1;
      } else {
        toUpload.push(item);
      }
    });
  } else {
    toUpload.push(...allEntries);
  }

  logger.log(
    `[lfs-r2] Checked ${allEntries.length} LFS object(s) via '${adapter.name}': ${skipped} already in R2, ${toUpload.length} to upload.`
  );

  if (dryRun || toUpload.length === 0) {
    return {
      total: allEntries.length,
      skipped,
      uploaded: 0,
      pending: toUpload.length,
    };
  }

  const tempDir = resolve(rootDir, ".git/lfs/tmp/r2-sync");
  mkdirSync(tempDir, { recursive: true });

  try {
    for (let start = 0; start < toUpload.length; start += batchSize) {
      const batch = toUpload.slice(start, start + batchSize);
      const savedPointers = new Map();

      for (const item of batch) {
        const absPath = join(rootDir, item.repoPath);
        if (existsSync(absPath) && statSync(absPath).size < 1024) {
          savedPointers.set(absPath, readFileSync(absPath, "utf8"));
        }
      }

      const needPull = batch.filter((item) => {
        const cacheFile = localLfsCachePath(rootDir, item.oid);
        if (existsSync(cacheFile) && sha256Hex(readFileSync(cacheFile)) === item.oid) return false;
        const absPath = join(rootDir, item.repoPath);
        if (existsSync(absPath) && statSync(absPath).size > 1024 && sha256Hex(readFileSync(absPath)) === item.oid) {
          return false;
        }
        return true;
      });

      if (needPull.length > 0) {
        try {
          await execFileAsync(
            "git",
            ["lfs", "pull", `--include=${needPull.map((i) => i.repoPath).join(",")}`, "--exclude="],
            {
              cwd: rootDir,
              env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "0" },
            }
          );
        } catch {
          // Will fall back to public-domain chapter host for KJV MP3s if git lfs pull fails.
        }
      }

      await mapPool(batch, concurrency, async (item) => {
        const absPath = join(rootDir, item.repoPath);
        const cacheFile = localLfsCachePath(rootDir, item.oid);
        let sourceFile = null;
        let tempFile = null;

        if (existsSync(cacheFile) && sha256Hex(readFileSync(cacheFile)) === item.oid) {
          sourceFile = cacheFile;
        } else if (existsSync(absPath) && statSync(absPath).size > 1024 && sha256Hex(readFileSync(absPath)) === item.oid) {
          sourceFile = absPath;
        } else if (item.assetKey) {
          const urls = await getEcftfMap();
          const url = urls[item.assetKey];
          if (!url) throw new Error(`No fallback URL for ${item.assetKey}`);
          const res = await fetch(url, { headers: { "user-agent": "66ksiag-lfs-r2-sync/1.0" } });
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (sha256Hex(buf) !== item.oid) {
            throw new Error(`SHA-256 mismatch downloading fallback for ${item.repoPath}`);
          }
          tempFile = join(tempDir, `${item.oid}.bin`);
          mkdirSync(dirname(tempFile), { recursive: true });
          writeFileSync(tempFile, buf);
          sourceFile = tempFile;
        } else {
          throw new Error(`Could not materialize LFS object ${item.oid} (${item.repoPath})`);
        }

        await adapter.putObject(item.oid, sourceFile);
        uploaded += 1;
        if (tempFile) {
          rmSync(tempFile, { force: true });
        }
      });

      for (const [absPath, pointerText] of savedPointers.entries()) {
        writeFileSync(absPath, pointerText);
      }

      await execFileAsync("git", ["lfs", "prune", "-f"], { cwd: rootDir }).catch(() => {});
      logger.log(`[lfs-r2] Progress: ${uploaded}/${toUpload.length} uploaded.`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    total: allEntries.length,
    skipped,
    uploaded,
    pending: 0,
  };
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const opts = parseCliArgs(process.argv.slice(2));
  const config = resolveBackendConfig();
  const adapter = createStorageAdapter(config);
  syncLfsToR2({
    adapter,
    ...opts,
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Build data/kjv/1769/audio-assets-manifest.json mapping each KJV chapter MP3's
 * Git LFS sha256 (oid) to its byte size and Cloudflare Workers Static Assets
 * Blake3 hash: blake3(base64(contents) + "mp3").slice(0, 32).
 *
 * Pulls LFS MP3s in batches of N (default 150) and prunes each batch from disk
 * so local/CI disk never overflows.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(ROOT, "node_modules/wrangler/wrangler-dist/cli.js"));
const blake3Wasm = require("blake3-wasm");

const MANIFEST_PATH = join(ROOT, "data/kjv/1769/audio-assets-manifest.json");
const BATCH_SIZE = Number.parseInt(process.env.LFS_HASH_BATCH_SIZE || "150", 10);

function computeAssetHash(buf, ext = "mp3") {
  return blake3Wasm.hash(buf.toString("base64") + ext).toString("hex").slice(0, 32);
}

function parsePointer(text) {
  if (!text.startsWith("version https://git-lfs.github.com/spec/v1")) return null;
  const oidMatch = text.match(/^oid sha256:([0-9a-f]{64})$/m);
  const sizeMatch = text.match(/^size (\d+)$/m);
  if (!oidMatch || !sizeMatch) return null;
  return { oid: oidMatch[1], size: Number.parseInt(sizeMatch[1], 10) };
}

function loadExistingManifest() {
  if (!existsSync(MANIFEST_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    return parsed.files || {};
  } catch {
    return {};
  }
}

function collectMp3Files() {
  const kjvRoot = join(ROOT, "data/kjv/1769");
  const books = readdirSync(kjvRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const list = [];
  for (const book of books) {
    const bookDir = join(kjvRoot, book);
    const files = readdirSync(bookDir)
      .filter((f) => f.endsWith(".mp3"))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    for (const file of files) {
      const absPath = join(bookDir, file);
      const relRepoPath = relative(ROOT, absPath).replace(/\\/g, "/");
      const assetPath = `/kjv/1769/${book}/${file}`;
      const st = statSync(absPath);
      let pointer = null;
      let rawText = null;
      if (st.size < 512) {
        rawText = readFileSync(absPath, "utf8");
        pointer = parsePointer(rawText);
      }
      list.push({
        assetPath,
        relRepoPath,
        absPath,
        isPointer: Boolean(pointer),
        pointerText: rawText,
        oid: pointer ? pointer.oid : null,
        size: pointer ? pointer.size : st.size,
      });
    }
  }
  return list;
}

const existing = loadExistingManifest();
const entries = collectMp3Files();
const outFiles = {};
const toCompute = [];

for (const e of entries) {
  const prev = existing[e.assetPath];
  if (e.oid && prev && prev.oid === e.oid && prev.size === e.size && prev.assetHash) {
    outFiles[e.assetPath] = prev;
  } else {
    toCompute.push(e);
  }
}

console.log(
  `Found ${entries.length} MP3 entries (${Object.keys(outFiles).length} cached, ${toCompute.length} to hash in batches of ${BATCH_SIZE}).`
);

for (let start = 0; start < toCompute.length; start += BATCH_SIZE) {
  const batch = toCompute.slice(start, start + BATCH_SIZE);
  const batchNum = Math.floor(start / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(toCompute.length / BATCH_SIZE);
  const pointers = batch.filter((b) => b.isPointer).map((b) => b.relRepoPath);

  if (pointers.length > 0) {
    console.log(`Batch ${batchNum}/${totalBatches}: pulling ${pointers.length} MP3(s) from Git LFS...`);
    execFileSync(
      "git",
      ["lfs", "pull", `--include=${pointers.join(",")}`, "--exclude="],
      { cwd: ROOT, stdio: "inherit", env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "0" } }
    );
  }

  for (const item of batch) {
    const buf = readFileSync(item.absPath);
    const oid = item.oid || createHash("sha256").update(buf).digest("hex");
    const size = buf.byteLength;
    const assetHash = computeAssetHash(buf, "mp3");
    outFiles[item.assetPath] = { oid, size, assetHash };
    if (item.isPointer && item.pointerText) {
      writeFileSync(item.absPath, item.pointerText);
    }
  }

  if (pointers.length > 0) {
    execFileSync("git", ["lfs", "prune", "-f"], { cwd: ROOT, stdio: "ignore" });
  }
  console.log(`Batch ${batchNum}/${totalBatches}: hashed ${ Math.min(start + BATCH_SIZE, toCompute.length) }/${toCompute.length}`);
}

const sortedKeys = Object.keys(outFiles).sort();
const sortedFiles = {};
for (const k of sortedKeys) sortedFiles[k] = outFiles[k];

writeFileSync(
  MANIFEST_PATH,
  `${JSON.stringify(
    {
      version: 1,
      algorithm: "blake3(base64+ext)[0..32]",
      count: sortedKeys.length,
      files: sortedFiles,
    },
    null,
    2
  )}\n`
);
console.log(`Wrote ${MANIFEST_PATH} (${sortedKeys.length} entries).`);

#!/usr/bin/env node
/**
 * Sync KJV audio (*.mp3) from Git LFS to the Cloudflare R2 bucket (66ksiag-audio)
 * in batches of N files at a time so CI disk never overflows.
 *
 * How it works:
 * 1. Scans data/kjv/1769/<book>/<ch>.mp3 in the repo (either LFS pointers or real files)
 *    to build the expected map: key -> { oid (sha256), size }.
 * 2. Ensures the R2 bucket exists (creates it if missing) and reads a single manifest
 *    object `_meta/lfs-manifest.json` from the bucket.
 * 3. Diffs the repo's LFS sha256s against `_meta/lfs-manifest.json` to find only new
 *    or changed MP3s. (On normal commits where no audio changed, diff is 0 files.)
 * 4. Processes changed/missing MP3s in batches of N (default 40):
 *    - `git lfs pull --include=...` for those N files
 *    - Uploads them concurrently (default 8 parallel PUTs) to R2
 *    - Restores those N files back to 130-byte LFS pointers on disk and runs `git lfs prune`
 *    - Updates `_meta/lfs-manifest.json` after each batch so interrupted runs resume cleanly.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "86e0b7dbeec0ebfff2333c8e8c4087fb";
const BUCKET = process.env.R2_AUDIO_BUCKET || "66ksiag-audio";
const MANIFEST_KEY = "_meta/lfs-manifest.json";
const BATCH_SIZE = Number.parseInt(process.env.LFS_BATCH_SIZE || "40", 10);
const UPLOAD_CONCURRENCY = Number.parseInt(process.env.R2_UPLOAD_CONCURRENCY || "8", 10);

function resolveApiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return { type: "bearer", token: process.env.CLOUDFLARE_API_TOKEN.trim() };
  }
  const candidates = [
    process.env.XDG_CONFIG_HOME && join(process.env.XDG_CONFIG_HOME, ".wrangler/config/default.toml"),
    join(homedir(), ".config/.wrangler/config/default.toml"),
    join(homedir(), ".wrangler/config/default.toml"),
  ].filter(Boolean);
  for (const cfg of candidates) {
    if (existsSync(cfg)) {
      const raw = readFileSync(cfg, "utf8");
      const m = raw.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return { type: "bearer", token: m[1] };
    }
  }
  return null;
}

function parseLfsOrFile(absPath) {
  const st = statSync(absPath);
  if (st.size < 512) {
    const text = readFileSync(absPath, "utf8");
    if (text.startsWith("version https://git-lfs.github.com/spec/v1")) {
      const oidMatch = text.match(/^oid sha256:([0-9a-f]{64})$/m);
      const sizeMatch = text.match(/^size (\d+)$/m);
      if (oidMatch && sizeMatch) {
        return {
          oid: oidMatch[1],
          size: Number.parseInt(sizeMatch[1], 10),
          isPointer: true,
          pointerText: text,
        };
      }
    }
  }
  const buf = readFileSync(absPath);
  const oid = createHash("sha256").update(buf).digest("hex");
  return {
    oid,
    size: buf.byteLength,
    isPointer: false,
    pointerText: `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${buf.byteLength}\n`,
  };
}

function collectAudioEntries() {
  const kjvRoot = join(ROOT, "data/kjv/1769");
  if (!existsSync(kjvRoot)) return [];
  const entries = [];
  const books = readdirSync(kjvRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const book of books) {
    const bookDir = join(kjvRoot, book);
    const files = readdirSync(bookDir)
      .filter((f) => f.endsWith(".mp3"))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    for (const file of files) {
      const absPath = join(bookDir, file);
      const relRepoPath = relative(ROOT, absPath).replace(/\\/g, "/");
      const r2Key = `kjv/1769/${book}/${file}`;
      const info = parseLfsOrFile(absPath);
      entries.push({ r2Key, relRepoPath, absPath, ...info });
    }
  }
  return entries;
}

async function cfFetch(auth, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${auth.token}`);
  const url = `https://api.cloudflare.com/client/v4${path}`;
  return fetch(url, { ...init, headers });
}

async function ensureBucket(auth) {
  const check = await cfFetch(auth, `/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}`, {
    method: "GET",
  });
  if (check.ok) return true;
  if (check.status === 404) {
    console.log(`[r2-audio] Creating R2 bucket "${BUCKET}"...`);
    const create = await cfFetch(auth, `/accounts/${ACCOUNT_ID}/r2/buckets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: BUCKET }),
    });
    if (create.ok) return true;
    const body = await create.text().catch(() => "");
    console.warn(`[r2-audio] Could not create R2 bucket "${BUCKET}" (${create.status}): ${body}`);
    return false;
  }
  const body = await check.text().catch(() => "");
  console.warn(`[r2-audio] Could not check R2 bucket "${BUCKET}" (${check.status}): ${body}`);
  return false;
}

async function fetchRemoteManifest(auth) {
  const res = await cfFetch(
    auth,
    `/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURI(MANIFEST_KEY)}`,
    { method: "GET" }
  );
  if (res.status === 404) return { files: {} };
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to read ${MANIFEST_KEY} from R2 (${res.status}): ${text}`);
  }
  try {
    const data = await res.json();
    return data && typeof data.files === "object" ? data : { files: {} };
  } catch {
    return { files: {} };
  }
}

async function putRemoteManifest(auth, manifest) {
  const body = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const res = await cfFetch(
    auth,
    `/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURI(MANIFEST_KEY)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(body.byteLength),
      },
      body,
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to write ${MANIFEST_KEY} to R2 (${res.status}): ${text}`);
  }
}

async function putAudioObject(auth, entry) {
  const buf = readFileSync(entry.absPath);
  if (buf.byteLength < 512 && buf.toString("utf8", 0, 40).includes("git-lfs.github.com")) {
    throw new Error(`Refusing to upload LFS pointer for ${entry.relRepoPath}`);
  }
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await cfFetch(
      auth,
      `/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURI(entry.r2Key)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": String(buf.byteLength),
        },
        body: buf,
      }
    );
    if (res.ok) return;
    const text = await res.text().catch(() => "");
    if (attempt === maxAttempts) {
      throw new Error(`Failed to upload ${entry.r2Key} (${res.status}): ${text}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 1500));
  }
}

async function runPool(items, concurrency, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const current = items[idx++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const auth = resolveApiToken();
  if (!auth) {
    console.log("[r2-audio] No Cloudflare API token in environment; skipping R2 audio sync.");
    return;
  }

  const entries = collectAudioEntries();
  if (entries.length === 0) {
    console.log("[r2-audio] No MP3 entries found in data/kjv/1769.");
    return;
  }

  const bucketReady = await ensureBucket(auth);
  if (!bucketReady) {
    console.warn("[r2-audio] R2 bucket is not accessible yet; skipping audio upload for this run.");
    return;
  }

  const manifest = await fetchRemoteManifest(auth);
  const changed = entries.filter((e) => {
    const prev = manifest.files[e.r2Key];
    return !prev || prev.oid !== e.oid || prev.size !== e.size;
  });

  if (changed.length === 0) {
    console.log(
      `[r2-audio] All ${entries.length} MP3 files in R2 bucket "${BUCKET}" match Git LFS sha256s. Nothing to upload.`
    );
    return;
  }

  console.log(
    `[r2-audio] ${changed.length} of ${entries.length} MP3 file(s) need updating in R2 bucket "${BUCKET}" (batch size ${BATCH_SIZE}).`
  );

  for (let start = 0; start < changed.length; start += BATCH_SIZE) {
    const batch = changed.slice(start, start + BATCH_SIZE);
    const batchNum = Math.floor(start / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(changed.length / BATCH_SIZE);

    const pointersToPull = batch.filter((e) => e.isPointer).map((e) => e.relRepoPath);
    if (pointersToPull.length > 0) {
      console.log(
        `[r2-audio] Batch ${batchNum}/${totalBatches}: pulling ${pointersToPull.length} MP3(s) from Git LFS...`
      );
      try {
        execFileSync(
          "git",
          ["lfs", "pull", `--include=${pointersToPull.join(",")}`, "--exclude="],
          { cwd: ROOT, stdio: "inherit" }
        );
      } catch (err) {
        console.warn(
          `[r2-audio] git lfs pull failed (git-proxy may not forward LFS batch API): ${err.message}. Skipping remaining R2 audio uploads for this build.`
        );
        return;
      }
    }

    console.log(
      `[r2-audio] Batch ${batchNum}/${totalBatches}: uploading ${batch.length} MP3(s) to R2 (concurrency ${UPLOAD_CONCURRENCY})...`
    );
    await runPool(batch, UPLOAD_CONCURRENCY, async (entry) => {
      await putAudioObject(auth, entry);
      manifest.files[entry.r2Key] = { oid: entry.oid, size: entry.size };
    });

    await putRemoteManifest(auth, manifest);

    // Free disk space immediately when running in CI or when files started as pointers
    if (pointersToPull.length > 0) {
      for (const entry of batch) {
        if (entry.isPointer) {
          writeFileSync(entry.absPath, entry.pointerText);
        }
      }
      try {
        execFileSync("git", ["lfs", "prune", "-f"], { cwd: ROOT, stdio: "ignore" });
      } catch {
        // git lfs prune is best-effort
      }
    }
  }

  console.log(`[r2-audio] Synced ${changed.length} MP3 file(s) to R2 bucket "${BUCKET}".`);
}

main().catch((err) => {
  console.error("[r2-audio] Error:", err);
  process.exit(1);
});

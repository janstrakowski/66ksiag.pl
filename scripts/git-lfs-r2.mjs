#!/usr/bin/env node
/**
 * Dev-only Git LFS custom standalone transfer agent (`r2`) + CLI helper
 * for storing and retrieving Git LFS objects in the Cloudflare R2 bucket
 * `66ksiag-audio` under `objects/<sha256-oid>`.
 *
 * This script is completely decoupled from the production `66ksiag` Worker
 * and does not use `66ksiag.pl`.
 *
 * Supported backends (selected automatically or via `LFS_R2_BACKEND`):
 *   1. `worker` — HTTP requests to `LFS_R2_WORKER_URL`
 *                 (default: `https://66ksiag-lfs.janstrakowski.workers.dev`)
 *   2. `s3`     — Direct S3-compatible requests to Cloudflare R2 using SigV4
 *                 (`R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`, optional `R2_ACCOUNT_ID`)
 *   3. `wrangler` — `npx wrangler r2 object get/put` CLI using local Cloudflare login
 *   4. `dir`    — Local directory (`LFS_R2_LOCAL_DIR`, useful for offline dev & tests)
 *
 * Usage as a Git LFS custom standalone transfer agent:
 *   node scripts/git-lfs-r2.mjs --install-git-config
 *   # Configures in local .git/config:
 *   #   lfs.customtransfer.r2.path = node
 *   #   lfs.customtransfer.r2.args = scripts/git-lfs-r2.mjs
 *   #   lfs.standalonetransferagent = r2
 */

import { execFile } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_ACCOUNT_ID = "86e0b7dbeec0ebfff2333c8e8c4087fb";
export const DEFAULT_BUCKET = "66ksiag-audio";
export const DEFAULT_WORKER_URL = "https://66ksiag-lfs.janstrakowski.workers.dev";
const OID_RE = /^[0-9a-f]{64}$/;

export function r2ObjectKey(oid) {
  if (!OID_RE.test(oid)) {
    throw new Error(`Invalid Git LFS SHA-256 oid: ${oid}`);
  }
  return `objects/${oid}`;
}

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * Builds AWS Signature Version 4 headers for a Cloudflare R2 S3-compatible request.
 */
export function signR2S3Request({
  method,
  accountId = DEFAULT_ACCOUNT_ID,
  bucket = DEFAULT_BUCKET,
  key,
  accessKeyId,
  secretAccessKey,
  payloadHash = "UNSIGNED-PAYLOAD",
  contentLength,
  contentType,
  now = new Date(),
}) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const canonicalUri = `/${encodeURIComponent(bucket)}/${encodedKey}`;
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = iso.slice(0, 8);
  const region = "auto";
  const service = "s3";

  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": iso,
  };
  if (contentLength != null) {
    headers["content-length"] = String(contentLength);
  }
  if (contentType) {
    headers["content-type"] = contentType;
  }

  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    iso,
    credentialScope,
    sha256Hex(Buffer.from(canonicalRequest, "utf8")),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      ...headers,
      Authorization: authorization,
    },
  };
}

export function resolveBackendConfig(env = process.env) {
  const explicit = (env.LFS_R2_BACKEND || "").trim().toLowerCase();
  const accountId = (env.R2_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID).trim();
  const bucket = (env.LFS_R2_BUCKET || DEFAULT_BUCKET).trim();
  const workerUrl = (env.LFS_R2_WORKER_URL || DEFAULT_WORKER_URL).trim().replace(/\/+$/, "");
  const uploadToken = (env.LFS_UPLOAD_TOKEN || "").trim();
  const accessKeyId = (env.R2_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (env.R2_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || "").trim();
  const localDir = (env.LFS_R2_LOCAL_DIR || "").trim();

  let backend = explicit;
  if (!backend) {
    if (localDir) backend = "dir";
    else if (accessKeyId && secretAccessKey) backend = "s3";
    else if (env.LFS_R2_WORKER_URL || uploadToken) backend = "worker";
    else backend = "worker";
  }

  return {
    backend,
    accountId,
    bucket,
    workerUrl,
    uploadToken,
    accessKeyId,
    secretAccessKey,
    localDir,
  };
}

export function createStorageAdapter(config = resolveBackendConfig()) {
  if (config.backend === "dir") {
    if (!config.localDir) {
      throw new Error("LFS_R2_LOCAL_DIR is required when LFS_R2_BACKEND=dir");
    }
    const baseDir = resolve(config.localDir);
    return {
      name: "dir",
      async hasObject(oid, expectedSize) {
        const p = join(baseDir, r2ObjectKey(oid));
        if (!existsSync(p)) return false;
        const st = statSync(p);
        return expectedSize == null ? true : st.size === expectedSize;
      },
      async putObject(oid, srcPath) {
        const buf = readFileSync(srcPath);
        const actual = sha256Hex(buf);
        if (actual !== oid) {
          throw new Error(`SHA-256 mismatch for ${oid}: got ${actual}`);
        }
        const dest = join(baseDir, r2ObjectKey(oid));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, buf);
      },
      async getObject(oid, destPath) {
        const src = join(baseDir, r2ObjectKey(oid));
        if (!existsSync(src)) {
          throw new Error(`Object ${oid} not found in ${baseDir}`);
        }
        const buf = readFileSync(src);
        const actual = sha256Hex(buf);
        if (actual !== oid) {
          throw new Error(`Corrupt object ${oid} in ${baseDir}: sha256=${actual}`);
        }
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, buf);
        return buf.length;
      },
    };
  }

  if (config.backend === "s3") {
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error("R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required for s3 backend");
    }
    return {
      name: "s3",
      async hasObject(oid, expectedSize) {
        const signed = signR2S3Request({
          method: "HEAD",
          accountId: config.accountId,
          bucket: config.bucket,
          key: r2ObjectKey(oid),
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        });
        const res = await fetch(signed.url, { method: "HEAD", headers: signed.headers });
        if (res.status === 404) return false;
        if (!res.ok) throw new Error(`R2 HEAD failed (${res.status})`);
        if (expectedSize != null) {
          const len = Number(res.headers.get("content-length") || "-1");
          if (len >= 0 && len !== expectedSize) return false;
        }
        return true;
      },
      async putObject(oid, srcPath) {
        const buf = readFileSync(srcPath);
        const actual = sha256Hex(buf);
        if (actual !== oid) {
          throw new Error(`SHA-256 mismatch for ${oid}: got ${actual}`);
        }
        const signed = signR2S3Request({
          method: "PUT",
          accountId: config.accountId,
          bucket: config.bucket,
          key: r2ObjectKey(oid),
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          payloadHash: actual,
          contentLength: buf.length,
          contentType: "application/octet-stream",
        });
        const res = await fetch(signed.url, {
          method: "PUT",
          headers: signed.headers,
          body: buf,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`R2 PUT failed (${res.status}): ${text}`);
        }
      },
      async getObject(oid, destPath) {
        const signed = signR2S3Request({
          method: "GET",
          accountId: config.accountId,
          bucket: config.bucket,
          key: r2ObjectKey(oid),
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        });
        const res = await fetch(signed.url, { method: "GET", headers: signed.headers });
        if (!res.ok) {
          throw new Error(`R2 GET failed (${res.status}) for ${oid}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const actual = sha256Hex(buf);
        if (actual !== oid) {
          throw new Error(`Downloaded R2 object ${oid} failed SHA-256 verification (got ${actual})`);
        }
        mkdirSync(dirname(destPath), { recursive: true });
        writeFileSync(destPath, buf);
        return buf.length;
      },
    };
  }

  if (config.backend === "wrangler") {
    return {
      name: "wrangler",
      async hasObject() {
        return false;
      },
      async putObject(oid, srcPath) {
        const buf = readFileSync(srcPath);
        const actual = sha256Hex(buf);
        if (actual !== oid) {
          throw new Error(`SHA-256 mismatch for ${oid}: got ${actual}`);
        }
        await execFileAsync(
          "npx",
          [
            "wrangler",
            "r2",
            "object",
            "put",
            `${config.bucket}/${r2ObjectKey(oid)}`,
            `--file=${srcPath}`,
            "--content-type=application/octet-stream",
            "--remote",
          ],
          {
            env: {
              ...process.env,
              CLOUDFLARE_ACCOUNT_ID: config.accountId,
            },
          }
        );
      },
      async getObject(oid, destPath) {
        mkdirSync(dirname(destPath), { recursive: true });
        await execFileAsync(
          "npx",
          [
            "wrangler",
            "r2",
            "object",
            "get",
            `${config.bucket}/${r2ObjectKey(oid)}`,
            `--file=${destPath}`,
            "--remote",
          ],
          {
            env: {
              ...process.env,
              CLOUDFLARE_ACCOUNT_ID: config.accountId,
            },
          }
        );
        const buf = readFileSync(destPath);
        const actual = sha256Hex(buf);
        if (actual !== oid) {
          throw new Error(`Downloaded R2 object ${oid} failed SHA-256 verification (got ${actual})`);
        }
        return buf.length;
      },
    };
  }

  // Default: "worker" (talks to standalone dev Worker `66ksiag-lfs.janstrakowski.workers.dev`)
  return {
    name: "worker",
    async hasObject(oid, expectedSize) {
      const res = await fetch(`${config.workerUrl}/objects/${oid}`, { method: "HEAD" });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`Worker HEAD failed (${res.status})`);
      if (expectedSize != null) {
        const len = Number(res.headers.get("content-length") || "-1");
        if (len >= 0 && len !== expectedSize) return false;
      }
      return true;
    },
    async putObject(oid, srcPath) {
      const buf = readFileSync(srcPath);
      const actual = sha256Hex(buf);
      if (actual !== oid) {
        throw new Error(`SHA-256 mismatch for ${oid}: got ${actual}`);
      }
      const headers = {
        "content-type": "application/octet-stream",
        "content-length": String(buf.length),
      };
      if (config.uploadToken) {
        headers.Authorization = `Bearer ${config.uploadToken}`;
      }
      const res = await fetch(`${config.workerUrl}/objects/${oid}`, {
        method: "PUT",
        headers,
        body: buf,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Worker PUT failed (${res.status}): ${text}`);
      }
    },
    async getObject(oid, destPath) {
      const res = await fetch(`${config.workerUrl}/objects/${oid}`, { method: "GET" });
      if (!res.ok) {
        throw new Error(`Worker GET failed (${res.status}) for ${oid}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const actual = sha256Hex(buf);
      if (actual !== oid) {
        throw new Error(`Downloaded object ${oid} failed SHA-256 verification (got ${actual})`);
      }
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, buf);
      return buf.length;
    },
  };
}

/**
 * Processes a single Git LFS custom transfer protocol message (line-delimited JSON)
 * and returns an array of response objects to write back as JSON lines.
 */
export async function handleTransferMessage(msg, adapter, tempDir) {
  if (!msg || typeof msg !== "object") return [];

  if (msg.event === "init") {
    return [{}];
  }

  if (msg.event === "terminate") {
    return [];
  }

  if (msg.event === "upload") {
    const { oid, size, path: srcPath } = msg;
    try {
      const alreadyExists = await adapter.hasObject(oid, size);
      if (!alreadyExists) {
        await adapter.putObject(oid, srcPath);
      }
      return [
        {
          event: "progress",
          oid,
          bytesSoFar: size,
          bytesSinceLast: size,
        },
        {
          event: "complete",
          oid,
        },
      ];
    } catch (err) {
      return [
        {
          event: "complete",
          oid,
          error: {
            code: 1,
            message: err instanceof Error ? err.message : String(err),
          },
        },
      ];
    }
  }

  if (msg.event === "download") {
    const { oid, size } = msg;
    const destPath = join(tempDir, `lfs-r2-${oid}-${process.pid}-${Date.now()}`);
    try {
      const written = await adapter.getObject(oid, destPath);
      return [
        {
          event: "progress",
          oid,
          bytesSoFar: written,
          bytesSinceLast: written,
        },
        {
          event: "complete",
          oid,
          path: destPath,
        },
      ];
    } catch (err) {
      return [
        {
          event: "complete",
          oid,
          error: {
            code: 1,
            message: err instanceof Error ? err.message : String(err),
          },
        },
      ];
    }
  }

  return [
    {
      event: "complete",
      oid: msg.oid || "",
      error: { code: 1, message: `Unsupported event: ${String(msg.event)}` },
    },
  ];
}

async function installGitConfig(cwd, { useWorkerUrl = false, workerUrl = DEFAULT_WORKER_URL } = {}) {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "git-lfs-r2.mjs");
  await execFileAsync("git", ["config", "--local", "lfs.customtransfer.r2.path", process.execPath], { cwd });
  await execFileAsync("git", ["config", "--local", "lfs.customtransfer.r2.args", scriptPath], { cwd });
  await execFileAsync("git", ["config", "--local", "lfs.customtransfer.r2.concurrent", "true"], { cwd });

  if (useWorkerUrl) {
    await execFileAsync("git", ["config", "--local", "lfs.url", workerUrl], { cwd });
    await execFileAsync("git", ["config", "--local", "--unset-all", "lfs.standalonetransferagent"], { cwd }).catch(
      () => {}
    );
    console.log(`Configured local git LFS endpoint -> ${workerUrl}`);
  } else {
    await execFileAsync("git", ["config", "--local", "lfs.standalonetransferagent", "r2"], { cwd });
    console.log(`Configured local git LFS standalone transfer agent 'r2' -> ${scriptPath}`);
  }
}

async function runProtocolLoop() {
  const adapter = createStorageAdapter();
  const tempDir = resolve(process.cwd(), ".git/lfs/tmp");
  mkdirSync(tempDir, { recursive: true });

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (msg.event === "terminate") {
      break;
    }
    const responses = await handleTransferMessage(msg, adapter, tempDir);
    for (const res of responses) {
      process.stdout.write(JSON.stringify(res) + "\n");
    }
  }
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const args = process.argv.slice(2);
  if (args.includes("--install-git-config")) {
    const useWorkerUrl = args.includes("--worker-url");
    installGitConfig(process.cwd(), { useWorkerUrl }).catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
  } else {
    runProtocolLoop().catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
  }
}

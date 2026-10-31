import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createStorageAdapter,
  handleTransferMessage,
  r2ObjectKey,
  resolveBackendConfig,
  sha256Hex,
  signR2S3Request,
} from "../../scripts/git-lfs-r2.mjs";
import { parseCliArgs, parseLfsPointer, syncLfsToR2 } from "../../scripts/sync-lfs-to-r2.mjs";
import { handleLfsRequest } from "../../tools/lfs-r2-worker/src/index.ts";

function fakeR2Bucket() {
  const store = new Map();
  return {
    store,
    async head(key) {
      const item = store.get(key);
      if (!item) return null;
      return { size: item.byteLength, etag: key };
    },
    async get(key) {
      const item = store.get(key);
      if (!item) return null;
      return {
        size: item.byteLength,
        etag: key,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(item);
            controller.close();
          },
        }),
        async arrayBuffer() {
          return item.buffer.slice(item.byteOffset, item.byteOffset + item.byteLength);
        },
      };
    },
    async put(key, value) {
      let bytes;
      if (ArrayBuffer.isView(value)) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      } else if (value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
      } else {
        bytes = new TextEncoder().encode(String(value));
      }
      store.set(key, bytes);
      return { size: bytes.byteLength, etag: key };
    },
  };
}

describe("Git LFS R2 standalone dev worker (`66ksiag-lfs`)", () => {
  const sampleBytes = new TextEncoder().encode("In the beginning God created the heaven and the earth.");
  const sampleOid = createHash("sha256").update(sampleBytes).digest("hex");
  const sampleSize = sampleBytes.byteLength;
  const workerBase = "https://66ksiag-lfs.janstrakowski.workers.dev";

  it("keeps the production 66ksiag Worker and wrangler.toml free of R2 bindings and LFS routes", () => {
    const prodWrangler = readFileSync("wrangler.toml", "utf8");
    const prodWorker = readFileSync("worker/src/index.ts", "utf8");
    expect(prodWrangler).not.toContain("r2_buckets");
    expect(prodWrangler).not.toContain("LFS_BUCKET");
    expect(prodWorker).not.toContain("LFS_BUCKET");
    expect(prodWorker).not.toContain("/api/lfs");

    const devLfsWrangler = readFileSync("tools/lfs-r2-worker/wrangler.toml", "utf8");
    expect(devLfsWrangler).toContain('name = "66ksiag-lfs"');
    expect(devLfsWrangler).toContain('bucket_name = "66ksiag-audio"');
    expect(devLfsWrangler).not.toMatch(/^\s*pattern\s*=\s*"66ksiag\.pl"/m);
  });

  it("handles download batch requests for existing and missing objects", async () => {
    const bucket = fakeR2Bucket();
    await bucket.put(r2ObjectKey(sampleOid), sampleBytes);
    const missingOid = "0".repeat(64);

    const req = new Request(`${workerBase}/objects/batch`, {
      method: "POST",
      headers: { "content-type": "application/vnd.git-lfs+json" },
      body: JSON.stringify({
        operation: "download",
        transfers: ["basic"],
        objects: [
          { oid: sampleOid, size: sampleSize },
          { oid: missingOid, size: 123 },
        ],
      }),
    });

    const res = await handleLfsRequest(req, { LFS_BUCKET: bucket });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/vnd.git-lfs+json");

    const data = await res.json();
    expect(data.transfer).toBe("basic");
    expect(data.objects).toHaveLength(2);
    expect(data.objects[0]).toEqual({
      oid: sampleOid,
      size: sampleSize,
      authenticated: true,
      actions: {
        download: {
          href: `${workerBase}/objects/${sampleOid}`,
          expires_in: 3600,
        },
      },
    });
    expect(data.objects[1]).toEqual({
      oid: missingOid,
      size: 123,
      error: {
        code: 404,
        message: "Object does not exist",
      },
    });
  });

  it("requires authentication on upload batch and PUT, and verifies SHA-256 on upload", async () => {
    const bucket = fakeR2Bucket();
    const env = { LFS_BUCKET: bucket, LFS_UPLOAD_TOKEN: "dev-secret-token" };

    const unauthBatch = await handleLfsRequest(
      new Request(`${workerBase}/info/lfs/objects/batch`, {
        method: "POST",
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: sampleOid, size: sampleSize }],
        }),
      }),
      env
    );
    expect(unauthBatch.status).toBe(401);

    const basicHeader = `Basic ${Buffer.from(`git:${env.LFS_UPLOAD_TOKEN}`).toString("base64")}`;
    const authBatch = await handleLfsRequest(
      new Request(`${workerBase}/info/lfs/objects/batch`, {
        method: "POST",
        headers: { authorization: basicHeader },
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: sampleOid, size: sampleSize }],
        }),
      }),
      env
    );
    expect(authBatch.status).toBe(200);
    const batchBody = await authBatch.json();
    expect(batchBody.objects[0].actions.upload.href).toBe(`${workerBase}/objects/${sampleOid}`);
    expect(batchBody.objects[0].actions.upload.header.Authorization).toBe(basicHeader);

    // Reject corrupt payload whose SHA-256 does not match oid
    const badPut = await handleLfsRequest(
      new Request(`${workerBase}/objects/${sampleOid}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${env.LFS_UPLOAD_TOKEN}` },
        body: new TextEncoder().encode("wrong bytes"),
      }),
      env
    );
    expect(badPut.status).toBe(422);

    // Accept valid payload
    const goodPut = await handleLfsRequest(
      new Request(`${workerBase}/objects/${sampleOid}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${env.LFS_UPLOAD_TOKEN}` },
        body: sampleBytes,
      }),
      env
    );
    expect(goodPut.status).toBe(200);

    // Verify endpoint
    const verifyRes = await handleLfsRequest(
      new Request(`${workerBase}/objects/${sampleOid}/verify`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.LFS_UPLOAD_TOKEN}` },
        body: JSON.stringify({ oid: sampleOid, size: sampleSize }),
      }),
      env
    );
    expect(verifyRes.status).toBe(200);

    // Subsequent upload batch omits actions since object is already in R2
    const repeatBatch = await handleLfsRequest(
      new Request(`${workerBase}/objects/batch`, {
        method: "POST",
        headers: { authorization: basicHeader },
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: sampleOid, size: sampleSize }],
        }),
      }),
      env
    );
    const repeatData = await repeatBatch.json();
    expect(repeatData.objects[0].actions).toBeUndefined();

    // Stream download via GET and HEAD
    const headRes = await handleLfsRequest(new Request(`${workerBase}/objects/${sampleOid}`, { method: "HEAD" }), env);
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("content-length")).toBe(String(sampleSize));

    const getRes = await handleLfsRequest(new Request(`${workerBase}/objects/${sampleOid}`, { method: "GET" }), env);
    expect(getRes.status).toBe(200);
    expect(Array.from(new Uint8Array(await getRes.arrayBuffer()))).toEqual(Array.from(sampleBytes));
  });
});

describe("Git LFS R2 custom transfer agent and sync script", () => {
  it("parses LFS pointers and CLI flags", () => {
    const pointer =
      "version https://git-lfs.github.com/spec/v1\n" +
      "oid sha256:d1a95181330513ee89bf62a6fe9cbd7d345530012d870ea19205e3785ea12a94\n" +
      "size 2149841\n";
    expect(parseLfsPointer(pointer)).toEqual({
      oid: "d1a95181330513ee89bf62a6fe9cbd7d345530012d870ea19205e3785ea12a94",
      size: 2149841,
    });
    expect(parseLfsPointer("not a pointer")).toBeNull();

    const opts = parseCliArgs(["--dry-run", "--force", "--limit=10", "--batch-size=5", "--include=demos/"]);
    expect(opts).toEqual({
      dryRun: true,
      skipExisting: false,
      batchSize: 5,
      concurrency: 6,
      limit: 10,
      includePrefix: "demos/",
    });
  });

  it("signs S3-compatible Cloudflare R2 requests with SigV4", () => {
    const oid = "d1a95181330513ee89bf62a6fe9cbd7d345530012d870ea19205e3785ea12a94";
    const signed = signR2S3Request({
      method: "PUT",
      accountId: "86e0b7dbeec0ebfff2333c8e8c4087fb",
      bucket: "66ksiag-audio",
      key: r2ObjectKey(oid),
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      payloadHash: oid,
      contentLength: 2149841,
      contentType: "application/octet-stream",
      now: new Date("2026-10-31T12:00:00.000Z"),
    });
    expect(signed.url).toBe(
      `https://86e0b7dbeec0ebfff2333c8e8c4087fb.r2.cloudflarestorage.com/66ksiag-audio/objects/${oid}`
    );
    expect(signed.headers.Authorization).toContain(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261031/auto/s3/aws4_request"
    );
  });

  it("round-trips upload, download, and sync over the custom transfer protocol", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ksiag-lfs-r2-"));
    try {
      const bucketDir = join(tmp, "r2-bucket");
      const workDir = join(tmp, "work");
      const config = resolveBackendConfig({ LFS_R2_LOCAL_DIR: bucketDir });
      expect(config.backend).toBe("dir");
      const adapter = createStorageAdapter(config);

      const content = Buffer.from("Psalm 119 audio frame payload");
      const oid = sha256Hex(content);
      const srcFile = join(tmp, "source.mp3");
      writeFileSync(srcFile, content);

      const initRes = await handleTransferMessage({ event: "init", operation: "upload" }, adapter, workDir);
      expect(initRes).toEqual([{}]);

      const upRes = await handleTransferMessage(
        { event: "upload", oid, size: content.length, path: srcFile },
        adapter,
        workDir
      );
      expect(upRes).toEqual([
        { event: "progress", oid, bytesSoFar: content.length, bytesSinceLast: content.length },
        { event: "complete", oid },
      ]);

      const downRes = await handleTransferMessage(
        { event: "download", oid, size: content.length },
        adapter,
        workDir
      );
      expect(downRes[0]).toEqual({
        event: "progress",
        oid,
        bytesSoFar: content.length,
        bytesSinceLast: content.length,
      });
      expect(downRes[1].event).toBe("complete");
      expect(readFileSync(downRes[1].path)).toEqual(content);

      const syncSummary = await syncLfsToR2({
        rootDir: tmp,
        adapter,
        entries: [{ repoPath: "source.mp3", oid, size: content.length, assetKey: null }],
        logger: { log() {} },
      });
      expect(syncSummary).toEqual({ total: 1, skipped: 1, uploaded: 0, pending: 0 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

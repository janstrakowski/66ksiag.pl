/**
 * Standalone dev/tooling Git LFS Batch + Object Storage Worker (`66ksiag-lfs`)
 * backed by Cloudflare R2 (`env.LFS_BUCKET` → `66ksiag-audio`).
 *
 * Intentionally decoupled from the production `66ksiag` website Worker and
 * `66ksiag.pl` domain: serves on `https://66ksiag-lfs.janstrakowski.workers.dev`
 * (or locally via `npx wrangler dev -c tools/lfs-r2-worker/wrangler.toml`).
 *
 * Supported paths (both root `/objects/...` and `/info/lfs/objects/...`):
 *   POST     /objects/batch          or /info/lfs/objects/batch
 *   GET|HEAD /objects/{oid}          or /info/lfs/objects/{oid}
 *   PUT      /objects/{oid}          or /info/lfs/objects/{oid}
 *   POST     /objects/{oid}/verify   or /info/lfs/objects/{oid}/verify
 */

export interface R2ObjectMeta {
  size: number;
  etag?: string;
}

export interface R2ObjectBody extends R2ObjectMeta {
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface LfsR2Bucket {
  head(key: string): Promise<R2ObjectMeta | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      sha256?: ArrayBuffer | string;
    }
  ): Promise<R2ObjectMeta | null>;
}

export interface LfsEnv {
  LFS_BUCKET?: LfsR2Bucket;
  LFS_UPLOAD_TOKEN?: string;
}

const LFS_MEDIA_TYPE = "application/vnd.git-lfs+json; charset=utf-8";
const OID_RE = /^[0-9a-f]{64}$/;
const BATCH_ROUTE_RE = /^(?:\/info\/lfs|\/api\/lfs)?\/objects\/batch$/;
const OBJECT_ROUTE_RE = /^(?:\/info\/lfs|\/api\/lfs)?\/objects\/([0-9a-f]{64})(?:\/(verify))?$/;
const DEFAULT_EXPIRES_IN = 3600;

export function r2ObjectKey(oid: string): string {
  return `objects/${oid}`;
}

function lfsJsonResponse(status: number, payload: unknown, extraHeaders?: Record<string, string>): Response {
  const body = JSON.stringify(payload) + "\n";
  const headers = new Headers({
    "content-type": LFS_MEDIA_TYPE,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  return new Response(body, { status, headers });
}

function lfsError(status: number, message: string, extraHeaders?: Record<string, string>): Response {
  return lfsJsonResponse(status, { message }, extraHeaders);
}

/**
 * Extracts a token from `Authorization: Bearer <token>` or `Authorization: Basic <base64>`
 * (Git LFS HTTP Basic sends `username:password`, `:token`, or `token:`).
 */
export function extractAuthToken(request: Request): string | null {
  const raw = request.headers.get("authorization");
  if (!raw) return null;
  const trimmed = raw.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx < 0) return null;
  const scheme = trimmed.slice(0, spaceIdx).toLowerCase();
  const value = trimmed.slice(spaceIdx + 1).trim();
  if (!value) return null;

  if (scheme === "bearer" || scheme === "token") {
    return value;
  }
  if (scheme === "basic") {
    try {
      const decoded = atob(value);
      const colonIdx = decoded.indexOf(":");
      if (colonIdx < 0) return decoded;
      const user = decoded.slice(0, colonIdx);
      const pass = decoded.slice(colonIdx + 1);
      return pass || user || null;
    } catch {
      return null;
    }
  }
  return null;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i += 1) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

export function checkUploadAuth(
  request: Request,
  env: LfsEnv
): { ok: true; token: string } | { ok: false; response: Response } {
  const configured = (env.LFS_UPLOAD_TOKEN || "").trim();
  if (!configured) {
    return {
      ok: false,
      response: lfsError(403, "Git LFS uploads are disabled: LFS_UPLOAD_TOKEN is not configured on the Worker"),
    };
  }
  const provided = extractAuthToken(request);
  if (!provided || !timingSafeEqualString(provided, configured)) {
    return {
      ok: false,
      response: lfsError(401, "Authentication required for Git LFS upload", {
        "LFS-Authenticate": 'Basic realm="Git LFS"',
        "WWW-Authenticate": 'Bearer realm="Git LFS", Basic realm="Git LFS"',
      }),
    };
  }
  return { ok: true, token: configured };
}

type BatchObjectInput = {
  oid: string;
  size: number;
};

function parseBatchObject(item: unknown): BatchObjectInput | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  if (typeof rec.oid !== "string" || !OID_RE.test(rec.oid)) return null;
  if (typeof rec.size !== "number" || !Number.isSafeInteger(rec.size) || rec.size < 0) return null;
  return { oid: rec.oid, size: rec.size };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < arr.length; i += 1) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}

async function handleBatch(request: Request, env: LfsEnv, origin: string): Promise<Response> {
  if (request.method !== "POST") {
    return lfsError(405, "Method Not Allowed", { allow: "POST" });
  }
  if (!env.LFS_BUCKET) {
    return lfsError(503, "LFS_BUCKET R2 binding is not configured");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return lfsError(422, "Invalid JSON in Git LFS batch request");
  }
  if (!body || typeof body !== "object") {
    return lfsError(422, "Invalid Git LFS batch request body");
  }

  const reqObj = body as Record<string, unknown>;
  const operation = reqObj.operation;
  if (operation !== "download" && operation !== "upload") {
    return lfsError(422, `Unsupported Git LFS batch operation: ${String(operation)}`);
  }

  const transfers = reqObj.transfers;
  if (Array.isArray(transfers) && transfers.length > 0 && !transfers.includes("basic")) {
    return lfsError(422, "Only the 'basic' Git LFS transfer adapter is supported");
  }

  if (!Array.isArray(reqObj.objects)) {
    return lfsError(422, "Missing 'objects' array in Git LFS batch request");
  }

  let uploadAuthHeader: Record<string, string> | undefined;
  if (operation === "upload") {
    const auth = checkUploadAuth(request, env);
    if (!auth.ok) return auth.response;
    const inboundAuth = request.headers.get("authorization");
    uploadAuthHeader = {
      Authorization: inboundAuth ? inboundAuth.trim() : `Bearer ${auth.token}`,
    };
  }

  const rawObjects = reqObj.objects;
  const parsed: (BatchObjectInput | null)[] = rawObjects.map(parseBatchObject);
  if (parsed.some((p) => p === null)) {
    return lfsError(422, "Every object in 'objects' must have a 64-char hex 'oid' and non-negative integer 'size'");
  }

  const bucket = env.LFS_BUCKET;
  const results = await Promise.all(
    (parsed as BatchObjectInput[]).map(async ({ oid, size }) => {
      const head = await bucket.head(r2ObjectKey(oid));
      const objectUrl = `${origin}/objects/${oid}`;

      if (operation === "download") {
        if (!head) {
          return {
            oid,
            size,
            error: {
              code: 404,
              message: "Object does not exist",
            },
          };
        }
        if (head.size !== size) {
          return {
            oid,
            size,
            error: {
              code: 422,
              message: `Object size mismatch (expected ${size}, stored ${head.size})`,
            },
          };
        }
        return {
          oid,
          size: head.size,
          authenticated: true,
          actions: {
            download: {
              href: objectUrl,
              expires_in: DEFAULT_EXPIRES_IN,
            },
          },
        };
      }

      if (head && head.size === size) {
        return {
          oid,
          size,
          authenticated: true,
        };
      }

      return {
        oid,
        size,
        authenticated: true,
        actions: {
          upload: {
            href: objectUrl,
            header: uploadAuthHeader,
            expires_in: DEFAULT_EXPIRES_IN,
          },
          verify: {
            href: `${objectUrl}/verify`,
            header: uploadAuthHeader,
            expires_in: DEFAULT_EXPIRES_IN,
          },
        },
      };
    })
  );

  return lfsJsonResponse(200, {
    transfer: "basic",
    objects: results,
  });
}

async function handleObjectDownload(request: Request, env: LfsEnv, oid: string): Promise<Response> {
  if (!env.LFS_BUCKET) {
    return lfsError(503, "LFS_BUCKET R2 binding is not configured");
  }

  if (request.method === "HEAD") {
    const head = await env.LFS_BUCKET.head(r2ObjectKey(oid));
    if (!head) return lfsError(404, "Object does not exist");
    return new Response(null, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(head.size),
        etag: `"${oid}"`,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const obj = await env.LFS_BUCKET.get(r2ObjectKey(oid));
  if (!obj) return lfsError(404, "Object does not exist");

  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(obj.size),
      etag: `"${oid}"`,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}

async function handleObjectUpload(request: Request, env: LfsEnv, oid: string): Promise<Response> {
  if (!env.LFS_BUCKET) {
    return lfsError(503, "LFS_BUCKET R2 binding is not configured");
  }

  const auth = checkUploadAuth(request, env);
  if (!auth.ok) return auth.response;

  const bytes = new Uint8Array(await request.arrayBuffer());
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader != null && /^\d+$/.test(contentLengthHeader.trim())) {
    const expectedLen = Number(contentLengthHeader.trim());
    if (Number.isSafeInteger(expectedLen) && bytes.byteLength !== expectedLen) {
      return lfsError(400, `Content-Length mismatch: header=${expectedLen}, body=${bytes.byteLength}`);
    }
  }

  const computedOid = await sha256Hex(bytes);
  if (computedOid !== oid) {
    return lfsError(422, `SHA-256 mismatch: expected ${oid}, got ${computedOid}`);
  }

  await env.LFS_BUCKET.put(r2ObjectKey(oid), bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { oid, size: String(bytes.byteLength) },
  });

  return new Response(null, {
    status: 200,
    headers: {
      etag: `"${oid}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function handleObjectVerify(request: Request, env: LfsEnv, oid: string): Promise<Response> {
  if (request.method !== "POST") {
    return lfsError(405, "Method Not Allowed", { allow: "POST" });
  }
  if (!env.LFS_BUCKET) {
    return lfsError(503, "LFS_BUCKET R2 binding is not configured");
  }

  const auth = checkUploadAuth(request, env);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return lfsError(422, "Invalid JSON in Git LFS verify request");
  }
  const parsed = parseBatchObject(body);
  if (!parsed || parsed.oid !== oid) {
    return lfsError(422, "Verify payload must match URL oid and include a valid size");
  }

  const head = await env.LFS_BUCKET.head(r2ObjectKey(oid));
  if (!head) {
    return lfsError(404, "Object does not exist in R2");
  }
  if (head.size !== parsed.size) {
    return lfsError(422, `Object size mismatch in R2: expected ${parsed.size}, got ${head.size}`);
  }

  return new Response(null, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleLfsRequest(request: Request, env: LfsEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (BATCH_ROUTE_RE.test(path)) {
    return handleBatch(request, env, url.origin);
  }

  const match = path.match(OBJECT_ROUTE_RE);
  if (match) {
    const [, oid, action] = match;
    if (action === "verify") {
      return handleObjectVerify(request, env, oid);
    }
    if (request.method === "GET" || request.method === "HEAD") {
      return handleObjectDownload(request, env, oid);
    }
    if (request.method === "PUT") {
      return handleObjectUpload(request, env, oid);
    }
    return lfsError(405, "Method Not Allowed", { allow: "GET, HEAD, PUT" });
  }

  return lfsError(404, "Git LFS endpoint not found");
}

export default {
  async fetch(request: Request, env: LfsEnv): Promise<Response> {
    return handleLfsRequest(request, env);
  },
};

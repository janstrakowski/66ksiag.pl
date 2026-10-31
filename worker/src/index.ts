/**
 * Cloudflare Worker: krótkie aliasy → UI, SPA assets.
 * Audio Scourby jest self-hosted pod /kjv/1769/{book}/{chapter}.mp3.
 */

interface SyncKv {
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  put(key: string, value: ArrayBuffer): Promise<void>;
}

interface Env {
  ASSETS: Fetcher;
  SYNC?: SyncKv;
}

const SYNC_MAX = 64;
const SYNC_MIN = 29;
const SIGN_SKEW_SEC = 15 * 60;

function syncHeaders(extra?: Record<string, string>): Headers {
  return new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  });
}

async function readSyncBody(request: Request): Promise<Uint8Array | Response> {
  const declared = request.headers.get("content-length");
  if (declared != null && Number(declared) > SYNC_MAX) {
    return new Response(null, { status: 413, headers: syncHeaders() });
  }
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers: syncHeaders() });
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > SYNC_MAX) {
      await reader.cancel();
      return new Response(null, { status: 413, headers: syncHeaders() });
    }
    chunks.push(value);
  }
  if (total < SYNC_MIN) return new Response(null, { status: 400, headers: syncHeaders() });
  const body = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    body.set(chunk, off);
    off += chunk.byteLength;
  }
  return body;
}

function unauthorized(): Response {
  return new Response(null, { status: 401, headers: syncHeaders() });
}

function fromHex(hex: string, bytes: number): Uint8Array | null {
  if (!new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "i").test(hex)) return null;
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function ctEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** metoda, numer slotu, czas, klucz publiczny, ciało — to samo co w web/cloud.js. */
function syncMessage(method: string, idHex: string, time: string, pubHex: string, body: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(`${method}\n${idHex}\n${time}\n${pubHex}\n`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

interface SyncAuth {
  pub: Uint8Array;
  pubHex: string;
  sig: Uint8Array;
  time: string;
}

function readAuth(request: Request): SyncAuth | Response {
  const time = request.headers.get("x-sync-time") || "";
  const pubHex = (request.headers.get("x-sync-pub") || "").toLowerCase();
  const sigHex = (request.headers.get("x-sync-sign") || "").toLowerCase();
  if (!/^\d{1,12}$/.test(time)) return unauthorized();
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(time));
  if (skew > SIGN_SKEW_SEC) return unauthorized();
  const pub = fromHex(pubHex, 32);
  const sig = fromHex(sigHex, 64);
  if (!pub || !sig) return unauthorized();
  return { pub, pubHex, sig, time };
}

async function verifyEd25519(pub: Uint8Array, sig: Uint8Array, message: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, sig, message);
  } catch {
    return false;
  }
}

/**
 * Jeden slot na identyfikator. Ciało to szyfrogram, 29–64 B.
 * Klucz publiczny pod pub:{id} pochodzi z tego samego sekretu co AES.
 * GET i PUT bez ważnego podpisu żądania są odrzucane. Sam numer slotu nic nie zmienia.
 */
export async function handleSync(
  request: Request,
  env: Env,
  parts: string[]
): Promise<Response | null> {
  if (parts[0] !== "api" || parts[1] !== "sync") return null;
  if (parts.length !== 3 || !/^[0-9a-f]{32}$/.test(parts[2].toLowerCase())) {
    return new Response(null, { status: 400, headers: syncHeaders() });
  }
  if (request.method !== "GET" && request.method !== "PUT") {
    return new Response(null, { status: 405, headers: syncHeaders({ allow: "GET, PUT" }) });
  }
  if (!env.SYNC) return new Response(null, { status: 503, headers: syncHeaders() });
  const id = parts[2].toLowerCase();

  let body = new Uint8Array();
  if (request.method === "PUT") {
    const read = await readSyncBody(request);
    if (read instanceof Response) return read;
    body = read;
  }

  const auth = readAuth(request);
  if (auth instanceof Response) return auth;
  const message = syncMessage(request.method, id, auth.time, auth.pubHex, body);
  const storedBuf = await env.SYNC.get(`pub:${id}`, "arrayBuffer");
  const stored = storedBuf && storedBuf.byteLength === 32 ? new Uint8Array(storedBuf) : null;
  if (stored) {
    if (!ctEq(stored, auth.pub) || !(await verifyEd25519(stored, auth.sig, message))) return unauthorized();
  } else if (!(await verifyEd25519(auth.pub, auth.sig, message))) {
    return unauthorized();
  }

  if (request.method === "GET") {
    const buf = await env.SYNC.get(id, "arrayBuffer");
    if (!buf) return new Response(null, { status: 404, headers: syncHeaders() });
    return new Response(buf, {
      status: 200,
      headers: syncHeaders({ "content-type": "application/octet-stream" }),
    });
  }

  if (!stored) await env.SYNC.put(`pub:${id}`, copyBuffer(auth.pub));
  await env.SYNC.put(id, copyBuffer(body));
  return new Response(null, { status: 204, headers: syncHeaders() });
}

type Book = {
  id: string;
  aliases: string[];
  short: string;
};

let booksMemo: Book[] | null = null;

async function loadBooks(env: Env, origin: string): Promise<Book[]> {
  if (booksMemo) return booksMemo;
  const res = await env.ASSETS.fetch(new Request(`${origin}/bg/1879/books.json`));
  if (!res.ok) return [];
  const data = (await res.json()) as { books: Book[] };
  booksMemo = data.books;
  return booksMemo;
}

function resolveBook(books: Book[], key: string): Book | undefined {
  const k = key.toLowerCase();
  return books.find(
    (b) =>
      b.id === key ||
      b.id.toLowerCase() === k ||
      b.short.toLowerCase() === k ||
      (b.aliases || []).some((a) => a.toLowerCase() === k)
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);

    const sync = await handleSync(request, env, parts);
    if (sync) return sync;

    // Krótki alias: /{alias}/{chapter}[/{verse}]
    if (
      parts.length >= 2 &&
      parts[0] !== "bg" &&
      parts[0] !== "kjv" &&
      parts[0] !== "czytaj" &&
      parts[0] !== "ksiegi" &&
      parts[0] !== "porcja" &&
      parts[0] !== "portion" &&
      parts[0] !== "synchronizacja" &&
      parts[0] !== "sync" &&
      parts[0] !== "assets" &&
      parts[0] !== "audio" &&
      parts[0] !== "api" &&
      /^\d+$/.test(parts[1])
    ) {
      const books = await loadBooks(env, url.origin);
      const book = resolveBook(books, parts[0]);
      if (book) {
        const chapter = parts[1];
        const verse = parts[2] && /^\d+$/.test(parts[2]) ? parts[2] : null;
        const dest = verse
          ? `/czytaj/${book.id}/${chapter}/${verse}`
          : `/czytaj/${book.id}/${chapter}`;
        return Response.redirect(new URL(dest, url.origin).toString(), 302);
      }
    }

    const retired = retiredAsset(request);
    if (retired) return retired;

    return env.ASSETS.fetch(request);
  },
};

/**
 * Strona nie rejestruje service workera. Stare instalacje i tak odpytują
 * `/sw.js` przy aktualizacji — SPA zwróciłoby index.html i zostawiło starą
 * powłokę. Ten skrypt kasuje cache powłoki (`ksiag-vN`) i pobrane audio, potem
 * się wyrejestrowuje.
 */
const RETIRED_SW = `self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => /^ksiag-v\\d+$/.test(key) || key === "ksiag-scourby-mp3-v1")
        .map((key) => caches.delete(key))
    );
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: "window" });
    await Promise.all(windows.map((client) => client.navigate(client.url)));
  })());
});
`;

export function retiredAsset(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  if (path === "/sw.js") {
    return new Response(request.method === "HEAD" ? null : RETIRED_SW, {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }
  if (path === "/manifest.webmanifest") {
    return new Response(null, { status: 404, headers: { "cache-control": "no-cache" } });
  }
  return null;
}

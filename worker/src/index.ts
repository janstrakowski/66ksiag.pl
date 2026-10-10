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

/** Jeden slot na identyfikator. Ciało to szyfrogram, 29–64 B. Brak listy i większych zapisów. */
export async function handleSync(
  request: Request,
  env: Env,
  parts: string[]
): Promise<Response | null> {
  if (parts[0] !== "api" || parts[1] !== "sync") return null;
  if (parts.length !== 3 || !/^[0-9a-f]{32}$/.test(parts[2].toLowerCase())) {
    return new Response(null, { status: 400, headers: syncHeaders() });
  }
  if (!env.SYNC) return new Response(null, { status: 503, headers: syncHeaders() });
  const id = parts[2].toLowerCase();

  if (request.method === "GET") {
    const buf = await env.SYNC.get(id, "arrayBuffer");
    if (!buf) return new Response(null, { status: 404, headers: syncHeaders() });
    return new Response(buf, {
      status: 200,
      headers: syncHeaders({ "content-type": "application/octet-stream" }),
    });
  }

  if (request.method === "PUT") {
    const body = await readSyncBody(request);
    if (body instanceof Response) return body;
    await env.SYNC.put(id, body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    return new Response(null, { status: 204, headers: syncHeaders() });
  }

  return new Response(null, { status: 405, headers: syncHeaders({ allow: "GET, PUT" }) });
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

    return env.ASSETS.fetch(request);
  },
};

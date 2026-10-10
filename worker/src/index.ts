/**
 * Cloudflare Worker: krótkie aliasy → UI, proxy audio Scourby (CORS), SPA assets.
 */

interface Env {
  ASSETS: Fetcher;
}

type Book = {
  id: string;
  aliases: string[];
  short: string;
};

type CatalogChapter = { book: string; chapter: number; url: string };
type Catalog = { chapters: CatalogChapter[] };

let booksMemo: Book[] | null = null;
let catalogMemo: Catalog | null = null;

async function loadBooks(env: Env, origin: string): Promise<Book[]> {
  if (booksMemo) return booksMemo;
  const res = await env.ASSETS.fetch(new Request(`${origin}/bg/1879/books.json`));
  if (!res.ok) return [];
  const data = (await res.json()) as { books: Book[] };
  booksMemo = data.books;
  return booksMemo;
}

async function loadCatalog(env: Env, origin: string): Promise<Catalog | null> {
  if (catalogMemo) return catalogMemo;
  const res = await env.ASSETS.fetch(new Request(`${origin}/audio-catalog.json`));
  if (!res.ok) return null;
  catalogMemo = (await res.json()) as Catalog;
  return catalogMemo;
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

function corsHeaders(extra: HeadersInit = {}): Headers {
  const h = new Headers(extra);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  h.set("Access-Control-Allow-Headers", "*");
  return h;
}

async function proxyAudio(
  env: Env,
  origin: string,
  bookId: string,
  chapter: number,
  request: Request
): Promise<Response> {
  const catalog = await loadCatalog(env, origin);
  const entry = catalog?.chapters.find(
    (c) => c.book === bookId && Number(c.chapter) === chapter
  );
  if (!entry?.url) {
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  }

  const upstream = await fetch(entry.url, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: {
      Range: request.headers.get("Range") || "",
      "User-Agent": "66ksiag-audio-proxy/1.0",
    },
  });

  const headers = corsHeaders({
    "Content-Type": upstream.headers.get("Content-Type") || "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  const len = upstream.headers.get("Content-Length");
  if (len) headers.set("Content-Length", len);
  const ar = upstream.headers.get("Accept-Ranges");
  if (ar) headers.set("Accept-Ranges", ar);
  const cr = upstream.headers.get("Content-Range");
  if (cr) headers.set("Content-Range", cr);

  if (request.method === "HEAD") {
    return new Response(null, { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);

    if (parts[0] === "audio" && parts[1] === "proxy" && parts.length === 4) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      const bookId = parts[2];
      const chapter = Number(parts[3]);
      if (!bookId || !Number.isFinite(chapter)) {
        return new Response("Bad request", { status: 400, headers: corsHeaders() });
      }
      return proxyAudio(env, url.origin, bookId, chapter, request);
    }

    // Krótki alias: /{alias}/{chapter}[/{verse}]
    if (
      parts.length >= 2 &&
      parts[0] !== "bg" &&
      parts[0] !== "kjv" &&
      parts[0] !== "czytaj" &&
      parts[0] !== "ksiegi" &&
      parts[0] !== "assets" &&
      parts[0] !== "audio" &&
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

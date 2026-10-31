import { handleBibleApi } from "./bible.ts";

/**
 * Cloudflare Worker: aliasy czytnika, /api/{bg|kjv} i SPA.
 * MP3 rozdziału zostaje Static Asset pod /kjv/1769/{book}/{chapter}.mp3.
 * /api/kjv/{book}/{chapter} oddaje ten sam plik; audio wersetu jest z niego wycięte.
 */

interface Env {
  ASSETS: Fetcher;
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

    // Krótki alias: /{alias}/{chapter}[/{verse}]
    if (
      parts.length >= 2 &&
      parts[0] !== "bg" &&
      parts[0] !== "kjv" &&
      parts[0] !== "czytaj" &&
      parts[0] !== "ksiegi" &&
      parts[0] !== "books" &&
      parts[0] !== "wybor" &&
      parts[0] !== "choose" &&
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

    const bible = await handleBibleApi(request, env);
    if (bible) return bible;

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

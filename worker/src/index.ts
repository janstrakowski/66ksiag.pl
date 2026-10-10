/**
 * Cloudflare Worker: krótkie aliasy → kanoniczne ścieżki UI
 * oraz SPA fallback (Static Assets obsługują pliki).
 *
 * /j/3/16  → 302 /czytaj/43-joh/3/16
 * /bg/...  → serwowane jako assety z data/
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
      parts[0] !== "czytaj" &&
      parts[0] !== "ksiegi" &&
      parts[0] !== "assets" &&
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

    // Assety + SPA (not_found_handling w wrangler)
    return env.ASSETS.fetch(request);
  },
};

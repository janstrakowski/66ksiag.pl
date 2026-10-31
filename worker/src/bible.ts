/**
 * Publiczne API Biblii. Upload zostaje taki jak na main: JSON rozdziału,
 * .words.json i MP3 rozdziału pod /bg/1879 i /kjv/1769 (bez plików per-werset).
 * Worker liczy tekst i wycina audio wersetu z MP3.
 *
 *   GET/HEAD /api/{bg|kjv}/books.json
 *   GET/HEAD /api/{bg|kjv}/manifest.json
 *   GET/HEAD /api/{bg|kjv}/{book}/{chapter}.json
 *   GET/HEAD /api/{bg|kjv}/{book}/{chapter}.txt
 *   GET/HEAD /api/{bg|kjv}/{book}/{chapter}            zapisany MP3 rozdziału
 *   GET/HEAD /api/{bg|kjv}/{book}/{chapter}/{verse}.json
 *   GET/HEAD /api/{bg|kjv}/{book}/{chapter}/{verse}.txt
 *   GET/HEAD /api/{bg|kjv}/{book}/{chapter}/{verse}    audio wersetu, wycięte
 */

export interface BibleEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const EDITION: Record<string, string> = { bg: "1879", kjv: "1769" };

const API_PATH =
  /^\/api\/(bg|kjv)\/(?:(books|manifest)\.json|(\d{2}-[a-z0-9-]+)\/(\d+)(?:\.([a-z0-9]+)|\/(\d+)(?:\.([a-z0-9]+))?)?)$/;

type ChapterVerse = { n: number; t: string };

type ChapterDoc = {
  translation: string;
  edition: string;
  book: string;
  chapter: number;
  verses: ChapterVerse[];
};

type TimedWord = { v: number; s: number; e: number };

const BITRATE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_V1 = [44100, 48000, 32000];
const SAMPLE_V2 = [22050, 24000, 16000];
const SAMPLE_V25 = [11025, 12000, 8000];

/** Ścieżka pliku w Static Assets. MP3 musi zawierać /kjv/1769/, żeby hash LFS zadziałał. */
export function editionAsset(tr: string, ...parts: string[]): string {
  return `/${tr}/${EDITION[tr]}/${parts.join("/")}`;
}

function canonicalPositive(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function stripTags(s: string): string {
  let out = "";
  let inTag = false;
  for (const c of s) {
    if (c === "<") inTag = true;
    else if (c === ">") inTag = false;
    else if (!inTag) out += c;
  }
  return out;
}

function textResponse(request: Request, status: number, body: string, contentType: string): Response {
  const bytes = new TextEncoder().encode(body);
  const headers = new Headers({
    "content-type": contentType,
    "content-length": String(bytes.byteLength),
    "x-content-type-options": "nosniff",
    "cache-control": status === 200 ? "public, max-age=86400" : "no-store",
  });
  return new Response(request.method === "HEAD" ? null : bytes, { status, headers });
}

function notFound(request: Request): Response {
  return textResponse(request, 404, "Not found\n", "text/plain; charset=utf-8");
}

function methodNotAllowed(request: Request): Response {
  if (request.method === "GET" || request.method === "HEAD") return notFound(request);
  return new Response(null, {
    status: 405,
    headers: {
      allow: "GET, HEAD",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function asChapter(data: unknown, tr: string, book: string, chapter: number): ChapterDoc | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const edition = EDITION[tr];
  if (row.translation !== tr || String(row.edition) !== edition || row.book !== book) return null;
  if (row.chapter !== chapter || !Array.isArray(row.verses)) return null;
  const verses: ChapterVerse[] = [];
  for (const item of row.verses) {
    if (!item || typeof item !== "object") return null;
    const verse = item as Record<string, unknown>;
    if (typeof verse.n !== "number" || !Number.isInteger(verse.n) || verse.n < 1) return null;
    if (typeof verse.t !== "string") return null;
    verses.push({ n: verse.n, t: verse.t });
  }
  return { translation: tr, edition, book, chapter, verses };
}

function readWords(data: unknown): TimedWord[] {
  if (!data || typeof data !== "object") return [];
  const words = (data as { words?: unknown }).words;
  if (!Array.isArray(words)) return [];
  const out: TimedWord[] = [];
  for (const item of words) {
    if (!item || typeof item !== "object") continue;
    const word = item as Record<string, unknown>;
    if (typeof word.v !== "number" || typeof word.s !== "number" || typeof word.e !== "number") continue;
    if (!Number.isFinite(word.s) || !Number.isFinite(word.e) || word.e < word.s) continue;
    out.push({ v: word.v, s: word.s, e: word.e });
  }
  return out;
}

/** Koniec ostatniego słowa wersetu, ścięty na starcie następnego. */
export function verseSpan(words: TimedWord[], verse: number): { start: number; end: number } | null {
  const mine = words.filter((word) => word.v === verse);
  if (!mine.length) return null;
  const start = Math.min(...mine.map((word) => word.s));
  let end = Math.max(...mine.map((word) => word.e));
  const later = words.filter((word) => word.v > verse).map((word) => word.s);
  const nextStart = later.length ? Math.min(...later) : null;
  const padded = end + 0.08;
  end = nextStart == null ? padded : Math.min(padded, nextStart);
  if (!(end > start)) end = Math.max(...mine.map((word) => word.e));
  return end > start ? { start, end } : null;
}

function id3End(buf: Uint8Array): number {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0;
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const footer = buf[5] & 0x10 ? 10 : 0;
  return Math.min(buf.length, 10 + size + footer);
}

function frameInfo(buf: Uint8Array, offset: number): { size: number; duration: number } | null {
  if (offset + 4 > buf.length) return null;
  if (buf[offset] !== 0xff || (buf[offset + 1] & 0xe0) !== 0xe0) return null;
  const b1 = buf[offset + 1];
  const b2 = buf[offset + 2];
  const versionBits = (b1 >> 3) & 0x3;
  const layerBits = (b1 >> 1) & 0x3;
  if (versionBits === 1 || layerBits !== 1) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
  const bitrateIndex = (b2 >> 4) & 0xf;
  const sampleIndex = (b2 >> 2) & 0x3;
  const padding = (b2 >> 1) & 0x1;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return null;
  const bitrate = (version === 1 ? BITRATE_V1_L3 : BITRATE_V2_L3)[bitrateIndex];
  const sampleRate = (version === 1 ? SAMPLE_V1 : version === 2 ? SAMPLE_V2 : SAMPLE_V25)[sampleIndex];
  if (!bitrate || !sampleRate) return null;
  const samples = version === 1 ? 1152 : 576;
  const size = Math.floor(((version === 1 ? 144 : 72) * bitrate * 1000) / sampleRate) + padding;
  if (size < 5) return null;
  return { size, duration: samples / sampleRate };
}

/** Klatki MPEG Layer III, których czas nachodzi na [startSec, endSec). */
export function sliceMp3(mp3: Uint8Array, startSec: number, endSec: number): Uint8Array | null {
  if (!(endSec > startSec) || startSec < 0) return null;
  let offset = id3End(mp3);
  const parts: Uint8Array[] = [];
  let time = 0;
  let scanned = 0;
  while (offset + 4 <= mp3.length) {
    const info = frameInfo(mp3, offset);
    if (!info || offset + info.size > mp3.length) {
      offset += 1;
      scanned += 1;
      if (parts.length || scanned > 4096) break;
      continue;
    }
    scanned = 0;
    const frameStart = time;
    const frameEnd = time + info.duration;
    if (frameEnd > startSec && frameStart < endSec) {
      parts.push(mp3.subarray(offset, offset + info.size));
    }
    time = frameEnd;
    offset += info.size;
    if (frameStart >= endSec) break;
  }
  if (!parts.length) return null;
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function chapterTxt(doc: ChapterDoc): string {
  let txt = `# ${doc.translation}/${doc.edition} ${doc.book} ${doc.chapter}\n`;
  for (const verse of doc.verses) txt += `${verse.n} ${stripTags(verse.t)}\n`;
  return txt;
}

function verseTxt(doc: ChapterDoc, verse: ChapterVerse): string {
  return `# ${doc.translation}/${doc.edition} ${doc.book} ${doc.chapter}:${verse.n}\n${stripTags(verse.t)}\n`;
}

function verseJson(doc: ChapterDoc, verse: ChapterVerse): string {
  return (
    JSON.stringify(
      {
        translation: doc.translation,
        edition: doc.edition,
        book: doc.book,
        chapter: doc.chapter,
        verse: verse.n,
        t: verse.t,
      },
      null,
      2
    ) + "\n"
  );
}

async function fetchAsset(env: BibleEnv, url: string, request?: Request): Promise<Response | null> {
  try {
    const headers = new Headers();
    if (request) {
      const range = request.headers.get("range");
      if (range) headers.set("range", range);
    }
    const res = await env.ASSETS.fetch(new Request(url, { method: "GET", headers }));
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || type.includes("html")) return null;
    return res;
  } catch {
    return null;
  }
}

async function readChapter(
  env: BibleEnv,
  origin: string,
  tr: string,
  book: string,
  chapter: number
): Promise<{ bytes: Uint8Array; doc: ChapterDoc; words: TimedWord[] } | null> {
  const asset = await fetchAsset(env, `${origin}${editionAsset(tr, book, `${chapter}.json`)}`);
  if (!asset) return null;
  const bytes = new Uint8Array(await asset.arrayBuffer());
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const doc = asChapter(data, tr, book, chapter);
  if (!doc) return null;
  let words = readWords(data);
  if (!words.length) words = await readWordsFile(env, origin, tr, book, chapter);
  return { bytes, doc, words };
}

async function readWordsFile(
  env: BibleEnv,
  origin: string,
  tr: string,
  book: string,
  chapter: number
): Promise<TimedWord[]> {
  const asset = await fetchAsset(env, `${origin}${editionAsset(tr, book, `${chapter}.words.json`)}`);
  if (!asset) return [];
  try {
    return readWords(JSON.parse(new TextDecoder().decode(await asset.arrayBuffer())));
  } catch {
    return [];
  }
}

function audioResponse(request: Request, bytes: Uint8Array): Response {
  const headers = new Headers({
    "content-type": "audio/mpeg",
    "content-length": String(bytes.byteLength),
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "cache-control": "public, max-age=86400",
  });
  return new Response(request.method === "HEAD" ? null : bytes, { status: 200, headers });
}

export async function handleBibleApi(request: Request, env: BibleEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/bg" || path === "/api/kjv") return notFound(request);
  const match = path.match(API_PATH);
  if (!match) return null;
  const [, tr, catalog, book, chapterRaw, chapterExt, verseRaw, verseExt] = match;
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(request);

  if (catalog) {
    const asset = await fetchAsset(env, `${url.origin}${editionAsset(tr, `${catalog}.json`)}`);
    if (!asset) return notFound(request);
    if (request.method === "HEAD") return new Response(null, { status: asset.status, headers: asset.headers });
    return asset;
  }

  const chapter = canonicalPositive(chapterRaw);
  const verse = verseRaw ? canonicalPositive(verseRaw) : null;
  if (chapter == null || (verseRaw != null && verse == null)) return notFound(request);
  const ext = verseRaw ? verseExt : chapterExt;
  if (ext && ext !== "json" && ext !== "txt") return notFound(request);

  const loaded = await readChapter(env, url.origin, tr, book, chapter);
  if (!loaded) return notFound(request);

  if (verse == null && ext === "json") {
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "content-length": String(loaded.bytes.byteLength),
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=86400",
    });
    return new Response(request.method === "HEAD" ? null : loaded.bytes, { status: 200, headers });
  }

  if (verse == null && ext === "txt") {
    return textResponse(request, 200, chapterTxt(loaded.doc), "text/plain; charset=utf-8");
  }

  if (verse == null && !ext) {
    if (tr !== "kjv") return notFound(request);
    const audio = await fetchAsset(
      env,
      `${url.origin}${editionAsset(tr, book, `${chapter}.mp3`)}`,
      request
    );
    if (!audio) return notFound(request);
    const type = (audio.headers.get("content-type") || "").toLowerCase();
    if (type && !type.includes("audio") && !type.includes("mpeg") && !type.includes("octet-stream")) {
      return notFound(request);
    }
    if (request.method === "HEAD") return new Response(null, { status: audio.status, headers: audio.headers });
    return audio;
  }

  const found = loaded.doc.verses.find((item) => item.n === verse);
  if (!found || verse == null) return notFound(request);
  if (ext === "json") return textResponse(request, 200, verseJson(loaded.doc, found), "application/json; charset=utf-8");
  if (ext === "txt") return textResponse(request, 200, verseTxt(loaded.doc, found), "text/plain; charset=utf-8");

  if (tr !== "kjv") return notFound(request);
  const span = verseSpan(loaded.words, verse);
  if (!span) return notFound(request);
  const audio = await fetchAsset(env, `${url.origin}${editionAsset(tr, book, `${chapter}.mp3`)}`);
  if (!audio) return notFound(request);
  const sliced = sliceMp3(new Uint8Array(await audio.arrayBuffer()), span.start, span.end);
  if (!sliced) return notFound(request);
  return audioResponse(request, sliced);
}

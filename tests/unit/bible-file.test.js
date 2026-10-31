import { describe, expect, it } from "vitest";
import worker from "../../worker/src/index.ts";
import { handleBibleApi, sliceMp3, verseSpan } from "../../worker/src/bible.ts";

const bgChapter = {
  translation: "bg",
  edition: "1879",
  book: "43-joh",
  chapter: 3,
  verses: [
    { n: 16, t: "Albowiem tak <i>Bóg</i> umiłował świat" },
    { n: 17, t: "Bo nie posłał Bóg Syna swego" },
  ],
};

const kjvWords = [
  { v: 16, i: 0, t: "For", s: 0.03, e: 0.04 },
  { v: 16, i: 1, t: "God", s: 0.04, e: 0.05 },
  { v: 17, i: 0, t: "For", s: 0.12, e: 0.18 },
];

const kjvChapter = {
  translation: "kjv",
  edition: "1769",
  book: "43-joh",
  chapter: 3,
  verses: [
    { n: 16, t: "For God so loved the world" },
    { n: 17, t: "For God sent not his Son" },
  ],
};

/** MPEG1 Layer III, 128 kbps, 44100 Hz, bez paddingu: 417 B, ~26.1 ms. */
function mp3Frame(mark) {
  const frame = new Uint8Array(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x00;
  frame[4] = mark;
  return frame;
}

function chapterMp3(frames) {
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set(mp3Frame(i + 1), i * 417);
  return out;
}

function assetsFrom(files) {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const hit = files[path];
      if (!hit) {
        return new Response("<!doctype html><html><body>spa</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const body = typeof hit === "string" ? hit : hit.body;
      const type = typeof hit === "string" ? "application/json" : hit.type;
      return new Response(body, { status: 200, headers: { "content-type": type } });
    },
  };
}

function env() {
  return {
    ASSETS: assetsFrom({
      "/bg/1879/43-joh/3.json": JSON.stringify(bgChapter),
      "/kjv/1769/43-joh/3.json": JSON.stringify(kjvChapter),
      "/kjv/1769/43-joh/3.words.json": JSON.stringify({ words: kjvWords }),
      "/bg/1879/books.json": JSON.stringify({ translation: "bg", books: [] }),
      "/kjv/1769/43-joh/3.mp3": { body: chapterMp3(8), type: "audio/mpeg" },
    }),
  };
}

describe("bible api routes", () => {
  it("serves chapter json and builds chapter txt", async () => {
    const json = await worker.fetch(new Request("https://66ksiag.pl/api/bg/43-joh/3.json"), env());
    expect(json.status).toBe(200);
    expect(json.headers.get("content-type")).toContain("application/json");
    expect(await json.json()).toMatchObject({ book: "43-joh", chapter: 3 });

    const txt = await worker.fetch(new Request("https://66ksiag.pl/api/bg/43-joh/3.txt"), env());
    expect(txt.status).toBe(200);
    expect(await txt.text()).toBe(
      "# bg/1879 43-joh 3\n16 Albowiem tak Bóg umiłował świat\n17 Bo nie posłał Bóg Syna swego\n"
    );
  });

  it("builds verse json and txt from the chapter", async () => {
    const json = await worker.fetch(new Request("https://66ksiag.pl/api/bg/43-joh/3/16.json"), env());
    expect(json.status).toBe(200);
    expect(await json.text()).toBe(
      '{\n  "translation": "bg",\n  "edition": "1879",\n  "book": "43-joh",\n  "chapter": 3,\n  "verse": 16,\n  "t": "Albowiem tak <i>Bóg</i> umiłował świat"\n}\n'
    );
    const txt = await worker.fetch(new Request("https://66ksiag.pl/api/kjv/43-joh/3/16.txt"), env());
    expect(await txt.text()).toBe("# kjv/1769 43-joh 3:16\nFor God so loved the world\n");
  });

  it("streams the stored chapter audio and cuts a verse out of it", async () => {
    const chapter = await worker.fetch(new Request("https://66ksiag.pl/api/kjv/43-joh/3"), env());
    expect(chapter.status).toBe(200);
    expect(chapter.headers.get("content-type")).toContain("audio");
    const whole = new Uint8Array(await chapter.arrayBuffer());
    expect(whole.byteLength).toBe(417 * 8);
    expect(whole[0]).toBe(0xff);

    const verse = await worker.fetch(new Request("https://66ksiag.pl/api/kjv/43-joh/3/16"), env());
    expect(verse.status).toBe(200);
    expect(verse.headers.get("content-type")).toBe("audio/mpeg");
    const cut = new Uint8Array(await verse.arrayBuffer());
    expect(cut.byteLength).toBeGreaterThan(0);
    expect(cut.byteLength).toBeLessThan(whole.byteLength);
    expect(cut[0]).toBe(0xff);
    expect(cut[1]).toBe(0xfb);

    const bg = await worker.fetch(new Request("https://66ksiag.pl/api/bg/43-joh/3"), env());
    expect(bg.status).toBe(404);
    expect(await bg.text()).toBe("Not found\n");
  });

  it("leaves the static chapter MP3 on /kjv/1769", async () => {
    const mp3 = await worker.fetch(new Request("https://66ksiag.pl/kjv/1769/43-joh/3.mp3"), env());
    expect(mp3.status).toBe(200);
    expect(mp3.headers.get("content-type")).toContain("audio");
    expect((await mp3.arrayBuffer()).byteLength).toBe(417 * 8);
  });

  it("returns a real 404 for a missing verse, chapter, or book", async () => {
    const cases = [
      "https://66ksiag.pl/api/bg/43-joh/3/99.txt",
      "https://66ksiag.pl/api/kjv/43-joh/99.txt",
      "https://66ksiag.pl/api/bg/99-nope/3/16.json",
      "https://66ksiag.pl/api/bg/43-joh/03/16.txt",
      "https://66ksiag.pl/api/kjv/43-joh/3/99",
    ];
    for (const url of cases) {
      const res = await worker.fetch(new Request(url), env());
      expect(res.status, url).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const body = await res.text();
      expect(body).toBe("Not found\n");
      expect(body).not.toContain("<html");
    }
  });

  it("serves books.json and does not claim /api/sync", async () => {
    const books = await worker.fetch(new Request("https://66ksiag.pl/api/bg/books.json"), env());
    expect(books.status).toBe(200);
    expect(await books.json()).toEqual({ translation: "bg", books: [] });
    expect(await handleBibleApi(new Request("https://66ksiag.pl/api/sync/" + "ab".repeat(16)), env())).toBeNull();
  });

  it("refuses other methods instead of the SPA shell", async () => {
    const res = await worker.fetch(
      new Request("https://66ksiag.pl/api/bg/43-joh/3/16.txt", { method: "POST" }),
      env()
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("slices MP3 frames that overlap the verse span", () => {
    const mp3 = chapterMp3(8);
    const span = verseSpan(kjvWords, 16);
    expect(span.start).toBeCloseTo(0.03, 5);
    expect(span.end).toBeCloseTo(0.12, 5);
    const cut = sliceMp3(mp3, span.start, span.end);
    expect(cut).not.toBeNull();
    expect(cut.length % 417).toBe(0);
    expect(cut.length).toBeLessThan(mp3.length);
    expect(sliceMp3(mp3, 100, 101)).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function loadJson(rel) {
  return JSON.parse(readFileSync(resolve(root, rel), "utf8"));
}

describe("audio-catalog.json contract", () => {
  const catalog = loadJson("web/audio-catalog.json");
  const books = loadJson("data/kjv/1769/books.json").books;

  it("has version 2, self-hosted source, and 1189 chapters", () => {
    expect(catalog.version).toBe(2);
    expect(catalog.source).toBe("self-hosted");
    expect(catalog.base).toBe("/kjv/1769");
    expect(catalog.count).toBe(1189);
    expect(catalog.chapters).toHaveLength(1189);
  });

  it("matches books.json with same-origin mp3 urls", () => {
    let i = 0;
    for (const b of books) {
      for (let ch = 1; ch <= b.chapters; ch++) {
        const row = catalog.chapters[i++];
        expect(row.book).toBe(b.id);
        expect(row.chapter).toBe(ch);
        expect(row.url).toBe(`/kjv/1769/${b.id}/${ch}.mp3`);
      }
    }
    expect(i).toBe(1189);
  });

  it("starts at Genesis 1 and ends at Revelation 22", () => {
    expect(catalog.chapters[0]).toMatchObject({ book: "01-gen", chapter: 1 });
    expect(catalog.chapters.at(-1)).toMatchObject({ book: "66-apo", chapter: 22 });
  });

  it("has unique book/chapter pairs", () => {
    const keys = new Set(catalog.chapters.map((c) => `${c.book}/${c.chapter}`));
    expect(keys.size).toBe(catalog.chapters.length);
  });
});

describe("data contracts", () => {
  it("BG and KJV books share ids and chapter counts", () => {
    const bg = loadJson("data/bg/1879/books.json").books;
    const kjv = loadJson("data/kjv/1769/books.json").books;
    expect(bg).toHaveLength(66);
    expect(kjv).toHaveLength(66);
    for (let i = 0; i < 66; i++) {
      expect(bg[i].id).toBe(kjv[i].id);
      expect(bg[i].chapters).toBe(kjv[i].chapters);
    }
  });

  it("Genesis 1 JSON has verses for both editions", () => {
    const bg = loadJson("data/bg/1879/01-gen/1.json");
    const kjv = loadJson("data/kjv/1769/01-gen/1.json");
    expect(bg.verses.length).toBeGreaterThan(20);
    expect(kjv.verses.length).toBe(bg.verses.length);
    expect(kjv.verses[0].n).toBe(1);
    expect(kjv.verses[0].t).toMatch(/beginning/i);
  });
});

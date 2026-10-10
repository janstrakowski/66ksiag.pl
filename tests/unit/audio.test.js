import { describe, expect, it } from "vitest";
import {
  catalogEntry,
  etaFromBytes,
  etaFromProgress,
  proxyPath,
  verseHtmlWithWords,
  wordsUrl,
} from "../../web/audio.js";

describe("audio helpers", () => {
  it("proxyPath and wordsUrl", () => {
    expect(proxyPath("01-gen", 12)).toBe("/audio/proxy/01-gen/12");
    expect(wordsUrl("/kjv/1769", "01-gen", 1)).toBe("/kjv/1769/01-gen/1.words.json");
  });

  it("catalogEntry finds chapter", () => {
    const cat = {
      chapters: [
        { book: "01-gen", chapter: 1, url: "https://x/1.mp3" },
        { book: "01-gen", chapter: 2, url: "https://x/2.mp3" },
      ],
    };
    expect(catalogEntry(cat, "01-gen", 2)?.url).toContain("2.mp3");
    expect(catalogEntry(cat, "01-gen", 9)).toBeNull();
  });

  it("verseHtmlWithWords wraps tokens and keeps italics", () => {
    const html = verseHtmlWithWords("And <i>God</i> said light", 1);
    expect(html).toContain('<span class="w" data-i="0">And</span>');
    expect(html).toContain("<i>");
    expect(html).toContain('data-i="1">God');
    expect(html).toContain('data-i="2">said');
  });

  it("etaFromProgress returns null early, then seconds", () => {
    const t0 = Date.now() - 10_000;
    expect(etaFromProgress(0, 100, t0)).toBeNull();
    expect(etaFromProgress(50, 100, Date.now() - 500)).toBeNull();
    const eta = etaFromProgress(50, 100, t0);
    expect(eta).toBeGreaterThan(0);
    expect(etaFromProgress(100, 100, t0)).toBe(0);
  });

  it("etaFromBytes estimates remaining time", () => {
    const t0 = Date.now() - 10_000;
    expect(etaFromBytes(100, 1_000_000, t0)).toBeNull(); // too little data
    const eta = etaFromBytes(500_000, 1_000_000, t0);
    expect(eta).toBeGreaterThan(0);
    expect(etaFromBytes(1_000_000, 1_000_000, t0)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  catalogEntry,
  audioPath,
  proxyPath,
  verseHtmlWithWords,
  wordsUrl,
} from "../../web/audio.js";

describe("audio helpers", () => {
  it("audioPath and wordsUrl", () => {
    expect(audioPath("01-gen", 12)).toBe("/kjv/1769/01-gen/12.mp3");
    expect(proxyPath("01-gen", 12)).toBe("/kjv/1769/01-gen/12.mp3");
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

});

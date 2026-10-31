import { beforeEach, describe, expect, it } from "vitest";
import {
  estimateMinutesFromVerses,
  loadPlace,
  loadPlaces,
  nextChapterInBible,
  rememberPlace,
  savePlaces,
} from "../../web/place.js";
import { miniBooks } from "../fixtures/books.js";

beforeEach(() => {
  localStorage.clear();
});

describe("reading place", () => {
  it("remembers and loads place per edition", () => {
    expect(loadPlace("bg-1879")).toBeNull();
    rememberPlace("bg-1879", "01-gen", 4);
    rememberPlace("kjv-1769", "40-mat", 2);
    expect(loadPlace("bg-1879")).toEqual({ book: "01-gen", chapter: 4 });
    expect(loadPlace("kjv-1769")).toEqual({ book: "40-mat", chapter: 2 });
    expect(loadPlaces()).toEqual({
      "bg-1879": { book: "01-gen", chapter: 4 },
      "kjv-1769": { book: "40-mat", chapter: 2 },
    });
  });

  it("savePlaces normalizes entries", () => {
    savePlaces({ "bg-1879": { book: "01-gen", chapter: "3" }, "kjv-1769": { book: "x", chapter: 0 } });
    expect(loadPlace("bg-1879")).toEqual({ book: "01-gen", chapter: 3 });
    expect(loadPlace("kjv-1769")).toBeNull();
  });
});

describe("estimateMinutesFromVerses", () => {
  it("returns at least 1 minute for short text", () => {
    const est = estimateMinutesFromVerses([{ t: "In the beginning." }]);
    expect(est.minutes).toBe(1);
    expect(est.words).toBeGreaterThan(0);
  });

  it("strips tags when counting words", () => {
    const est = estimateMinutesFromVerses([{ t: "And <i>God</i> said light." }]);
    expect(est.words).toBe(4);
  });
});

describe("nextChapterInBible", () => {
  const books = miniBooks();

  it("walks books and ends at last", () => {
    expect(nextChapterInBible(books, "01-gen", 1)).toEqual({ book: "01-gen", chapter: 2 });
    expect(nextChapterInBible(books, "01-gen", 3)).toEqual({ book: "02-exo", chapter: 1 });
    expect(nextChapterInBible(books, "66-apo", 2)).toBeNull();
    expect(nextChapterInBible(books, "nope", 1)).toBeNull();
  });
});

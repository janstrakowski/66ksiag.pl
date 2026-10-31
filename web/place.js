/** Ostatni rozdział zwykłego czytania i pomocnicze funkcje czytnika. */

const STORAGE_KEY = "ksiag-place-v1";
const EDITIONS = ["bg-1879", "kjv-1769"];
const WPM = 160; // spokojne czytanie PL

function empty() {
  return { "bg-1879": null, "kjv-1769": null };
}

function normalize(place) {
  if (!place?.book || !place.chapter) return null;
  const chapter = Number(place.chapter);
  if (!Number.isFinite(chapter) || chapter < 1) return null;
  return { book: String(place.book), chapter };
}

export function loadPlaces() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const out = empty();
    for (const id of EDITIONS) out[id] = normalize(raw[id]);
    return out;
  } catch {
    return empty();
  }
}

export function loadPlace(editionId) {
  return loadPlaces()[editionId] || null;
}

export function rememberPlace(editionId, bookId, chapter) {
  if (!EDITIONS.includes(editionId)) return;
  const all = loadPlaces();
  all[editionId] = normalize({ book: bookId, chapter });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function savePlaces(places) {
  const all = empty();
  for (const id of EDITIONS) all[id] = normalize(places?.[id]);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Szacunek czasu czytania — w górę, co najmniej 1 min, gdy jest co czytać. */
export function estimateMinutesFromVerses(verses) {
  const text = verses.map((v) => String(v.t || "").replace(/<[^>]+>/g, "")).join(" ");
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (!words) return { minutes: 1, words: 0 };
  return { minutes: Math.max(1, Math.ceil(words / WPM)), words };
}

/** Następny rozdział w całej Biblii (kolejność books.json), lub null na końcu. */
export function nextChapterInBible(books, bookId, chapter) {
  const i = books.findIndex((b) => b.id === bookId);
  if (i < 0) return null;
  const book = books[i];
  if (chapter < book.chapters) {
    return { book: bookId, chapter: chapter + 1 };
  }
  if (i + 1 >= books.length) return null;
  return { book: books[i + 1].id, chapter: 1 };
}

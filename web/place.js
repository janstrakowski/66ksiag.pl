/** Ostatni rozdział zwykłego czytania, osobno dla każdej wersji. */

const STORAGE_KEY = "ksiag-place-v1";
const EDITIONS = ["bg-1879", "kjv-1769"];

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

/** Wybór tłumaczenia / wydania — wspólna numeracja KJV. */

export const EDITIONS = [
  {
    id: "bg-1879",
    translation: "bg",
    edition: "1879",
    language: "pl",
    title: "Biblia Gdańska",
    titleEn: "Gdańsk Bible",
    short: "BG 1879",
    path: "/bg/1879",
    theme: "theme-bg",
  },
  {
    id: "kjv-1769",
    translation: "kjv",
    edition: "1769",
    language: "en",
    title: "King James Version",
    titleEn: "King James Version",
    short: "KJV",
    path: "/kjv/1769",
    theme: "theme-kjv",
  },
];

const STORAGE_KEY = "ksiag-edition-v1";

export function loadEditionChoice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return EDITIONS.find((e) => e.id === saved.id) || null;
  } catch {
    return null;
  }
}

export function saveEditionChoice(edition) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: edition.id }));
}

export function clearEditionChoice() {
  localStorage.removeItem(STORAGE_KEY);
}

export function findEdition(id) {
  return EDITIONS.find((e) => e.id === id) || null;
}

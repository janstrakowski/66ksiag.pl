/** Minimal books list for plan/audio unit tests (shared KJV grid). */

export function miniBooks() {
  return [
    { id: "01-gen", short: "Gen", name: "Genesis", chapters: 3, testament: "st" },
    { id: "02-exo", short: "Exo", name: "Exodus", chapters: 2, testament: "st" },
    { id: "40-mat", short: "Mat", name: "Matthew", chapters: 2, testament: "nt" },
    { id: "66-apo", short: "Rev", name: "Revelation", chapters: 2, testament: "nt" },
  ];
}

export function toRoman(n) {
  const map = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let x = n;
  let out = "";
  for (const [v, s] of map) {
    while (x >= v) {
      out += s;
      x -= v;
    }
  }
  return out || String(n);
}

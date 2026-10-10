/** Dzienny plan czytania — localStorage. */

const STORAGE_KEY = "ksiag-plan-v1";
const WPM = 160; // spokojne czytanie PL
const AVG_CHAPTER_MIN = 3; // do zaokrąglenia limitu czasowego → rozdziały

export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function chapKey(bookId, chapter) {
  return `${bookId}/${chapter}`;
}

export function defaultPlan() {
  return {
    enabled: false,
    goal: "bible", // bible | st | nt | range
    fromBook: "01-gen",
    fromChapter: 1,
    toBook: "66-apo",
    toChapter: 22,
    mode: "chapters", // chapters | time
    chaptersPerDay: 3,
    minutesPerDay: 15,
    notifications: false,
    // postęp
    day: todayKey(),
    readToday: [],
    cursor: 0, // indeks w liście rozdziałów celu
    startNotifiedDay: null, // dzień, w którym wysłano „Zacznij czytać…”
  };
}

export function loadPlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPlan();
    const p = { ...defaultPlan(), ...JSON.parse(raw) };
    if (p.day !== todayKey()) {
      p.day = todayKey();
      p.readToday = [];
    }
    return p;
  } catch {
    return defaultPlan();
  }
}

export function savePlan(plan) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

/** Zeruje postęp (dziś + kursor), zostawia cel i ustawienia. */
export function resetPlanProgress(plan) {
  const next = {
    ...plan,
    day: todayKey(),
    readToday: [],
    cursor: 0,
    startNotifiedDay: null,
  };
  savePlan(next);
  return next;
}

/** Przywraca domyślne ustawienia planu. */
export function resetPlanAll() {
  const next = defaultPlan();
  savePlan(next);
  return next;
}

export function dailyQuota(plan) {
  if (plan.mode === "time") {
    return Math.max(1, Math.round(Number(plan.minutesPerDay) / AVG_CHAPTER_MIN));
  }
  return Math.max(1, Math.round(Number(plan.chaptersPerDay) || 1));
}

export function estimateMinutesFromVerses(verses) {
  const text = verses.map((v) => String(v.t || "").replace(/<[^>]+>/g, "")).join(" ");
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const mins = words / WPM;
  if (mins < 0.75) return { minutes: 1, label: "ok. 1 min", words };
  if (mins < 1.5) return { minutes: 1, label: "ok. 1 min", words };
  const rounded = Math.round(mins);
  return { minutes: rounded, label: `ok. ${rounded} min`, words };
}

function goalBounds(books, plan) {
  if (plan.goal === "st") {
    const st = books.filter((b) => b.testament === "st");
    return {
      fromId: st[0].id,
      toId: st[st.length - 1].id,
      fromCh: 1,
      toCh: st[st.length - 1].chapters,
    };
  }
  if (plan.goal === "nt") {
    const nt = books.filter((b) => b.testament === "nt");
    return {
      fromId: nt[0].id,
      toId: nt[nt.length - 1].id,
      fromCh: 1,
      toCh: nt[nt.length - 1].chapters,
    };
  }
  if (plan.goal === "range") {
    return {
      fromId: plan.fromBook,
      toId: plan.toBook,
      fromCh: Number(plan.fromChapter) || 1,
      toCh: Number(plan.toChapter) || 1,
    };
  }
  // bible
  return {
    fromId: books[0].id,
    toId: books[books.length - 1].id,
    fromCh: 1,
    toCh: books[books.length - 1].chapters,
  };
}

/** Płaska lista kluczy rozdziałów w zakresie. */
export function buildChapterList(books, plan) {
  const { fromId, toId, fromCh, toCh } = goalBounds(books, plan);
  const fromIdx = books.findIndex((b) => b.id === fromId);
  const toIdx = books.findIndex((b) => b.id === toId);
  if (fromIdx < 0 || toIdx < 0) return [];

  const list = [];
  for (let i = fromIdx; i <= toIdx; i++) {
    const b = books[i];
    const start = i === fromIdx ? fromCh : 1;
    const end = i === toIdx ? Math.min(toCh, b.chapters) : b.chapters;
    for (let c = start; c <= end; c++) {
      list.push(chapKey(b.id, c));
    }
  }
  return list;
}

export function isDailyPlanComplete(plan) {
  if (!plan.enabled) return false;
  return plan.readToday.length >= dailyQuota(plan);
}

export function progressPct(plan) {
  if (!plan.enabled) return null;
  const q = dailyQuota(plan);
  const n = plan.readToday.length;
  return Math.min(100, Math.round((n / q) * 100));
}

/**
 * Zalicz rozdział. Zwraca { plan, kind: "plan" | "extra" | "already" | "off" }.
 * Po wypełnieniu quoty kolejne zaliczenia są ponadprogramowe (nie podnoszą % ponad 100).
 */
export function markChapterRead(plan, bookId, chapter) {
  const key = chapKey(bookId, chapter);
  if (!plan.enabled) return { plan, kind: "off" };
  if (plan.day !== todayKey()) {
    plan.day = todayKey();
    plan.readToday = [];
  }
  if (plan.readToday.includes(key)) {
    return { plan, kind: "already" };
  }
  const kind = isDailyPlanComplete(plan) ? "extra" : "plan";
  plan.readToday.push(key);
  savePlan(plan);
  return { plan, kind };
}

export function isChapterReadToday(plan, bookId, chapter) {
  return plan.readToday.includes(chapKey(bookId, chapter));
}

/** Czy zaliczenie tego rozdziału jest poza dzisiejszą quotą (kolejność w readToday). */
export function isExtraCredit(plan, bookId, chapter) {
  const key = chapKey(bookId, chapter);
  const idx = plan.readToday.indexOf(key);
  if (idx < 0) return false;
  return idx >= dailyQuota(plan);
}

export function nextUnreadInGoal(books, plan) {
  const list = buildChapterList(books, plan);
  if (!list.length) return null;
  // preferuj pierwszy z dzisiejszej puli jeszcze nieprzeczytany, od kursora
  const start = Math.min(plan.cursor || 0, list.length - 1);
  for (let i = start; i < list.length; i++) {
    if (!plan.readToday.includes(list[i])) {
      const [book, ch] = list[i].split("/");
      return { book, chapter: Number(ch), index: i };
    }
  }
  for (let i = 0; i < start; i++) {
    if (!plan.readToday.includes(list[i])) {
      const [book, ch] = list[i].split("/");
      return { book, chapter: Number(ch), index: i };
    }
  }
  // cel dzienny zrobiony — następny w celu
  const idx = Math.min((plan.cursor || 0) + dailyQuota(plan), list.length - 1);
  const [book, ch] = list[idx].split("/");
  return { book, chapter: Number(ch), index: idx };
}

export function advanceCursor(plan, books) {
  const list = buildChapterList(books, plan);
  let cursor = plan.cursor || 0;
  while (cursor < list.length && plan.readToday.includes(list[cursor])) {
    cursor += 1;
  }
  plan.cursor = cursor;
  savePlan(plan);
  return plan;
}

export function quotaPreview(plan) {
  const q = dailyQuota(plan);
  if (plan.mode === "time") {
    return `${plan.minutesPerDay} min ≈ ${q} rozdz. / dzień`;
  }
  return `${q} rozdz. / dzień`;
}

function refLabel(books, key, toRoman) {
  const [id, ch] = key.split("/");
  const b = books.find((x) => x.id === id);
  const n = Number(ch);
  const roman = toRoman ? toRoman(n) : String(n);
  return `${b?.short || id} ${roman}`;
}

/**
 * Dzisiejsza porcja planu: pozostałe rozdziały do quoty, czas i zakres.
 * toRoman — opcjonalna fn (n) => "III"
 */
export function todayAssignment(books, plan, toRoman) {
  if (!plan.enabled) return null;
  const list = buildChapterList(books, plan);
  if (!list.length) return null;

  const quota = dailyQuota(plan);
  const done = plan.readToday.length;
  if (done >= quota) {
    return { done: true, minutes: 0, range: null, href: null, started: true };
  }

  const remaining = quota - done;
  const next = nextUnreadInGoal(books, plan);
  if (!next) return null;

  const slice = list.slice(next.index, next.index + remaining);
  if (!slice.length) return null;

  const start = refLabel(books, slice[0], toRoman);
  const end = refLabel(books, slice[slice.length - 1], toRoman);
  const range = start === end ? start : `${start}–${end}`;

  let minutes;
  if (plan.mode === "time") {
    const per = Number(plan.minutesPerDay) / quota;
    minutes = Math.max(1, Math.round(per * remaining));
  } else {
    minutes = Math.max(1, Math.round(remaining * AVG_CHAPTER_MIN));
  }

  const [book, chapter] = slice[0].split("/");
  return {
    done: false,
    started: done > 0,
    minutes,
    range,
    chapters: slice.length,
    href: `/czytaj/${book}/${chapter}`,
  };
}

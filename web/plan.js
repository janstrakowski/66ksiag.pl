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
    owed: null, // ile rozdziałów zostało w dzisiejszej porcji (z zaległościami)
    pile: null, // wielkość tej porcji po doliczeniu nowego dnia
    beyond: false, // czytanie po skończonej porcji, tego samego dnia
    doneToday: 0,
    startNotifiedDay: null, // dzień, w którym wysłano „Zacznij czytać…”
  };
}

export function daysBetween(fromKey, toKey) {
  const parse = (key) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const a = parse(fromKey);
  const b = parse(toKey);
  if (a == null || b == null) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Dolicza zaległe dni. Nieprzeczytana reszta zostaje, każdy nowy dzień dokłada jedną porcję. */
export function accruePlan(plan, today = todayKey()) {
  if (!plan?.enabled) {
    if (!plan || plan.day === today) return plan;
    return { ...plan, day: today, readToday: [], beyond: false, doneToday: 0 };
  }
  const quota = dailyQuota(plan);
  let owed = plan.owed;
  if (owed == null) {
    const done = Math.min((plan.readToday || []).length, quota);
    owed = Math.max(0, quota - done);
  }
  if (plan.day === today) {
    const done = (plan.readToday || []).length;
    return {
      ...plan,
      owed,
      pile: plan.pile || owed + Math.min(done, quota),
    };
  }
  const days = daysBetween(plan.day, today);
  owed = Math.min(1189, owed + quota * days);
  return {
    ...plan,
    owed,
    pile: owed,
    beyond: false,
    readToday: [],
    doneToday: 0,
    day: today,
  };
}

export function loadPlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPlan();
    const p = { ...defaultPlan(), ...JSON.parse(raw) };
    const accrued = accruePlan(p);
    if (
      accrued !== p &&
      (accrued.day !== p.day || accrued.owed !== p.owed || accrued.beyond !== p.beyond)
    ) {
      savePlan(accrued, { silent: true });
    }
    return accrued;
  } catch {
    return defaultPlan();
  }
}

let planSaveHook = null;

/** Wywołanie po lokalnym zapisie (nie przy cichym nadpisaniu z chmury). */
export function onPlanSaved(fn) {
  planSaveHook = fn;
}

export function savePlan(plan, opts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  if (!opts?.silent) planSaveHook?.(plan);
}

/** Nowy zapis formularza: kursor na początku, dzisiejsza porcja od nowa. */
export function armFreshPlan(plan) {
  const next = {
    ...plan,
    day: todayKey(),
    readToday: [],
    cursor: 0,
    beyond: false,
    doneToday: 0,
  };
  if (next.enabled) {
    const q = dailyQuota(next);
    next.owed = q;
    next.pile = q;
  } else {
    next.owed = null;
    next.pile = null;
  }
  return next;
}

/** Jedno zaliczenie w czytniku porcji. Zaległość maleje tylko, gdy jeszcze jest. */
export function notePortionChapter(plan) {
  if (!plan || plan.owed == null || plan.owed <= 0) return plan;
  plan.owed -= 1;
  plan.doneToday = (plan.doneToday || 0) + 1;
  savePlan(plan);
  return plan;
}

export function resetPlanProgress(plan) {
  const quota = dailyQuota(plan);
  const next = {
    ...plan,
    day: todayKey(),
    readToday: [],
    cursor: 0,
    owed: plan.enabled ? quota : null,
    pile: plan.enabled ? quota : null,
    beyond: false,
    doneToday: 0,
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

/** Szacunek czasu czytania — w górę, co najmniej 1 min, gdy jest co czytać. */
export function estimateMinutesFromVerses(verses) {
  const text = verses.map((v) => String(v.t || "").replace(/<[^>]+>/g, "")).join(" ");
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (!words) return { minutes: 1, words: 0 };
  return { minutes: Math.max(1, Math.ceil(words / WPM)), words };
}

/** Minuty porcji. `null`, gdy nie ma już nic do czytania — bez „0 min”. */
export function readingMinutes(chapters, plan) {
  const n = Number(chapters) || 0;
  if (n <= 0) return null;
  const quota = dailyQuota(plan);
  const raw =
    plan.mode === "time"
      ? (Number(plan.minutesPerDay) / quota) * n
      : n * AVG_CHAPTER_MIN;
  return Math.max(1, Math.ceil(raw));
}

export function pileStatus(plan) {
  const quota = dailyQuota(plan);
  const owed = plan.owed == null ? Math.max(0, quota - (plan.readToday || []).length) : plan.owed;
  const pile = plan.pile || Math.max(quota, owed);
  const done = Math.max(0, pile - owed);
  const behind = Math.max(0, pile - quota);
  return { quota, owed, pile, done, behind };
}

/** Dzień domknięcia celu, licząc od dziś. Ułamek dnia to cały dzień. */
export function planFinishDate(books, plan, today = new Date()) {
  const list = buildChapterList(books, plan);
  const remaining = Math.max(0, list.length - (plan.cursor || 0));
  if (!remaining) return null;
  const days = Math.max(1, Math.ceil(remaining / dailyQuota(plan)));
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() + days - 1);
  return d;
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
  if (plan.owed != null) return plan.owed <= 0;
  return plan.readToday.length >= dailyQuota(plan);
}

export function progressPct(plan) {
  if (!plan.enabled) return null;
  if (plan.owed != null && plan.pile) {
    const done = Math.max(0, plan.pile - plan.owed);
    return Math.min(100, Math.round((done / plan.pile) * 100));
  }
  const q = dailyQuota(plan);
  const n = plan.readToday.length;
  return Math.min(100, Math.round((n / q) * 100));
}

/**
 * Zalicz rozdział. Zwraca { plan, kind: "plan" | "extra" | "already" | "off" | "skip" }.
 * Z `books` — tylko następny rozdział po ostatnim zaliczonym (albo start celu, gdy pusto).
 */
export function markChapterRead(plan, bookId, chapter, books = null) {
  const key = chapKey(bookId, chapter);
  if (!plan.enabled) return { plan, kind: "off" };
  if (plan.day !== todayKey()) {
    plan.day = todayKey();
    plan.readToday = [];
  }
  if (plan.readToday.includes(key)) {
    return { plan, kind: "already" };
  }
  if (books && !canMarkChapter(books, plan, bookId, chapter)) {
    return { plan, kind: "skip" };
  }
  if (isDailyPlanComplete(plan)) {
    if (!books) return { plan, kind: "skip" };
    plan.readToday.push(key);
    savePlan(plan);
    return { plan, kind: "extra" };
  }
  plan.readToday.push(key);
  savePlan(plan);
  return { plan, kind: "plan" };
}

export function isChapterReadToday(plan, bookId, chapter) {
  return plan.readToday.includes(chapKey(bookId, chapter));
}

/** Czy rozdział leży w zakresie celu planu. */
export function isInGoalRange(books, plan, bookId, chapter) {
  if (!plan?.enabled || !books?.length) return false;
  return buildChapterList(books, plan).includes(chapKey(bookId, chapter));
}

/**
 * Czy rozdział w celu jest już zaliczony (kursor z poprzednich dni lub dziś).
 * Poza zakresem — zawsze false.
 */
export function isChapterCredited(books, plan, bookId, chapter) {
  const list = buildChapterList(books, plan);
  const key = chapKey(bookId, chapter);
  const idx = list.indexOf(key);
  if (idx < 0) return false;
  if (idx < (plan.cursor || 0)) return true;
  return (plan.readToday || []).includes(key);
}

/** Czy zaliczenie tego rozdziału jest poza dzisiejszą quotą (kolejność w readToday). */
export function isExtraCredit(plan, bookId, chapter) {
  const key = chapKey(bookId, chapter);
  const idx = plan.readToday.indexOf(key);
  if (idx < 0) return false;
  const pile = plan.pile || dailyQuota(plan);
  return idx >= pile;
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

/** Najdalej w kanonie wśród dzisiejszych zaliczeń (nie kolejność kliknięć). */
export function furthestCredited(books, plan) {
  let bestScore = -1;
  let best = null;
  for (const key of plan.readToday || []) {
    const [bookId, ch] = key.split("/");
    const bi = books.findIndex((b) => b.id === bookId);
    if (bi < 0) continue;
    const score = bi * 100_000 + Number(ch);
    if (score > bestScore) {
      bestScore = score;
      best = { book: bookId, chapter: Number(ch) };
    }
  }
  return best;
}

/**
 * Jedyny rozdział do zaliczenia w zakresie celu:
 * następny po dzisiejszym najdalej zaliczonym, albo pozycja kursora (gdy dziś pusto).
 */
export function nextMarkTarget(books, plan) {
  if (!plan?.enabled || !books?.length) return null;
  const list = buildChapterList(books, plan);
  if (!list.length) return null;

  const last = furthestCredited(books, plan);
  if (last) {
    const next = nextChapterInBible(books, last.book, last.chapter);
    if (next && isInGoalRange(books, plan, next.book, next.chapter)) return next;
    return null;
  }

  const idx = plan.cursor || 0;
  if (idx >= list.length) return null;
  const [book, ch] = list[idx].split("/");
  return { book, chapter: Number(ch) };
}

export function canMarkChapter(books, plan, bookId, chapter) {
  const next = nextMarkTarget(books, plan);
  return !!(next && next.book === bookId && next.chapter === Number(chapter));
}

/** Jak `nextMarkTarget`, ale tylko gdy dzienna quota jest już pełna. */
export function nextBeyondPlanTarget(books, plan) {
  if (!plan?.enabled || !isDailyPlanComplete(plan)) return null;
  return nextMarkTarget(books, plan);
}

export function canMarkBeyondPlan(books, plan, bookId, chapter) {
  return isDailyPlanComplete(plan) && canMarkChapter(books, plan, bookId, chapter);
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

/** Podgląd quoty — `copy` z `planCopy` / `t` (quotaTime / quotaChapters). */
export function quotaPreview(plan, copy) {
  const q = dailyQuota(plan);
  if (plan.mode === "time") {
    return copy.quotaTime(Number(plan.minutesPerDay), q);
  }
  return copy.quotaChapters(q);
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

  const status = pileStatus(plan);
  if (status.owed <= 0) {
    return { done: true, minutes: null, range: null, href: null, started: true };
  }

  const remaining = status.owed;
  const target = nextMarkTarget(books, plan);
  if (!target) return null;

  const startKey = chapKey(target.book, target.chapter);
  const startIdx = list.indexOf(startKey);
  if (startIdx < 0) return null;

  const slice = list.slice(startIdx, startIdx + remaining);
  if (!slice.length) return null;

  const start = refLabel(books, slice[0], toRoman);
  const end = refLabel(books, slice[slice.length - 1], toRoman);
  const range = start === end ? start : `${start}–${end}`;

  return {
    done: false,
    started: status.done > 0,
    minutes: readingMinutes(slice.length, plan),
    range,
    chapters: slice.length,
    href: `/porcja/${target.book}/${target.chapter}`,
    behind: status.behind,
    owed: status.owed,
    pile: status.pile,
  };
}

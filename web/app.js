import {
  loadPlan,
  savePlan,
  estimateMinutesFromVerses,
  progressPct,
  markChapterRead,
  isChapterCredited,
  isInGoalRange,
  isExtraCredit,
  nextMarkTarget,
  nextChapterInBible,
  canMarkChapter,
  advanceCursor,
  quotaPreview,
  todayAssignment,
  isDailyPlanComplete,
  todayKey,
  onPlanSaved,
  armFreshPlan,
  notePortionChapter,
  pileStatus,
  readingMinutes,
  planFinishDate,
} from "./plan.js";
import { loadPlace, rememberPlace } from "./place.js";
import * as cloud from "./cloud.js";
import {
  ensureNotifyPermission,
  effectiveNotifyPermission,
  notifyStartReading,
  notifyProgress,
  notifyEnabledConfirm,
} from "./notify.js";
import { isDevHost } from "./dev-host.js";
import {
  loadEditionChoice,
  saveEditionChoice,
  clearEditionChoice,
  findEdition,
} from "./editions.js";
import { t, planCopy } from "./i18n.js";

/** Lazy — BG nie ładuje audio.js (~16 KB) ani katalogu (~193 KB). */
let audioMod = null;
let audioPlayer = null;
let verseHtmlWithWordsFn = null;

const AUDIO_SESSION_KEY = "ksiag-audio-v1";

function loadAudioSession() {
  try {
    const raw = localStorage.getItem(AUDIO_SESSION_KEY);
    if (!raw) {
      return { mode: "idle", offerContinue: false, nextBook: null, nextChapter: null };
    }
    return {
      mode: "idle",
      offerContinue: false,
      nextBook: null,
      nextChapter: null,
      ...JSON.parse(raw),
    };
  } catch {
    return { mode: "idle", offerContinue: false, nextBook: null, nextChapter: null };
  }
}

function saveAudioSession(session) {
  localStorage.setItem(AUDIO_SESSION_KEY, JSON.stringify(session));
}

async function ensureAudioModule() {
  if (audioMod) return audioMod;
  audioMod = await import("./audio.js");
  verseHtmlWithWordsFn = audioMod.verseHtmlWithWords;
  audioPlayer = audioMod.createAudioController({
    audioEl,
    hooks: {
      onChapterEnded: handleAudioChapterEnded,
      onState: syncAudioChrome,
    },
  });
  return audioMod;
}

const DEFAULT_READ = { book: "01-gen", chapter: 1, verse: 1 };
let edition = loadEditionChoice();
let pendingAudioAutoplay = false;
let audioMode = "idle"; // idle | plan | portion | beyond | single
let readerMode = null; // "read" | "portion" | null

const audioEl = document.getElementById("scourby-audio");
const audioBar = document.getElementById("audio-bar");
const audioBarLabel = document.getElementById("audio-bar-label");
const audioBarToggle = document.getElementById("audio-bar-toggle");
/** Live query — folio czytnika jest podmieniane w całości. */
const audioControls = () => document.getElementById("audio-controls");
const audioPlayBtn = () => document.getElementById("audio-play-btn");
const audioStopBtn = () => document.getElementById("audio-stop-btn");

function editionPath() {
  return edition?.path || "/bg/1879";
}

function editionLabel() {
  return edition?.short || "BG 1879";
}

function applyTheme() {
  document.body.classList.remove("theme-bg", "theme-kjv");
  if (!edition) return;
  document.body.classList.add(edition.theme);
  const copy = t(edition);
  document.documentElement.lang = copy.htmlLang;
  document.title = copy.docTitle;
}

const screens = [...document.querySelectorAll(".screen")];
const shell = document.getElementById("shell");
const toastEl = document.getElementById("toast");
const canonical = document.getElementById("canonical");
const planBanner = document.getElementById("plan-banner");

let booksCache = null;
let selectedVerse = null;
let toastTimer;
let plan = loadPlan();
/** Generacja ładowania czytnika — odrzuca przestarzałe odpowiedzi przy szybkim przewijaniu. */
let readerLoadGen = 0;
/** Cache JSON rozdziałów (nawigacja wstecz / prefetch). */
const chapterCache = new Map();
const CHAPTER_CACHE_MAX = 48;

function flash(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2200);
}

function show(id, { scroll = true } = {}) {
  screens.forEach((s) => s.classList.toggle("is-on", s.id === id));
  shell.classList.toggle("is-reader", id === "reader");
  if (scroll) window.scrollTo(0, 0);
}

function toRoman(n) {
  const map = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let x = n;
  let out = "";
  for (const [v, s] of map) {
    while (x >= v) {
      out += s;
      x -= v;
    }
  }
  return out;
}

function chapterLabel(n) {
  return t(edition).chapterAbbrev(toRoman(n));
}

async function loadBooks() {
  const key = editionPath();
  if (booksCache?.__path === key) return booksCache.books;
  const res = await fetch(`${key}/books.json`);
  if (!res.ok) throw new Error("books.json");
  const data = await res.json();
  booksCache = { __path: key, books: data.books };
  return booksCache.books;
}

function rememberChapter(url, data) {
  chapterCache.set(url, data);
  if (chapterCache.size > CHAPTER_CACHE_MAX) {
    const oldest = chapterCache.keys().next().value;
    chapterCache.delete(oldest);
  }
}

async function fetchChapterJson(canonPath) {
  const url = `${canonPath}.json`;
  if (chapterCache.has(url)) return chapterCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error("chapter");
  const data = await res.json();
  rememberChapter(url, data);
  return data;
}

function prefetchChapter(canonPath) {
  const url = `${canonPath}.json`;
  if (chapterCache.has(url)) return;
  const run = () => {
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) rememberChapter(url, data);
      })
      .catch(() => {});
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1200 });
  else setTimeout(run, 0);
}

function resolveBook(books, key) {
  const k = key.toLowerCase();
  return books.find(
    (b) =>
      b.id === key ||
      b.id.toLowerCase() === k ||
      b.short.toLowerCase() === k ||
      (b.aliases || []).some((a) => a.toLowerCase() === k)
  );
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "");
}

function verseHtml(raw, withWords = false) {
  const escaped = String(raw)
    .split(/(<\/?i>)/i)
    .map((part) => {
      if (/^<\/?i>$/i.test(part)) return part.toLowerCase();
      return part
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    })
    .join("");
  return withWords && verseHtmlWithWordsFn ? verseHtmlWithWordsFn(escaped, 0) : escaped;
}

function editionSupportsAudio() {
  // Tylko KJV (editions.js: audio: true) — nigdy BG / Gdańska
  return !!edition?.audio;
}

function syncAudioChrome(state) {
  const controls = audioControls();
  const playBtn = audioPlayBtn();
  const stopBtn = audioStopBtn();
  if (!editionSupportsAudio()) {
    audioBar.hidden = true;
    if (controls) controls.hidden = true;
    document.body.classList.remove("has-audio-bar");
    return;
  }
  const copy = t(edition);
  const playing = !!state?.playing;
  const cur = audioPlayer?.current?.();
  if (playing || cur?.bookId) {
    audioBar.hidden = false;
    document.body.classList.add("has-audio-bar");
    audioBarLabel.textContent = playing ? copy.audioBarListening : copy.audioBarPaused;
    audioBarToggle.textContent = playing ? copy.audioPause : copy.audioResume;
    if (stopBtn) stopBtn.hidden = false;
    if (playBtn) playBtn.textContent = playing ? copy.audioPause : copy.audioListen;
  } else {
    audioBar.hidden = true;
    document.body.classList.remove("has-audio-bar");
    if (stopBtn) stopBtn.hidden = true;
    if (playBtn) playBtn.textContent = copy.audioListen;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function creditChapterFromAudio(bookId, chapter) {
  plan = loadPlan();
  if (!plan.enabled) return { kind: "off" };
  const ctxBooks = window.__reader?.books;
  const result = markChapterRead(plan, bookId, chapter, ctxBooks);
  plan = result.plan;
  if (result.kind === "already" || result.kind === "off" || result.kind === "skip") {
    return result;
  }
  if (ctxBooks) plan = advanceCursor(plan, ctxBooks);
  refreshPlanBanner();
  const pct = progressPct(plan);
  const copy = t(edition);
  if (result.kind === "extra") {
    flash(copy.beyondPlan);
  } else if (pct >= 100) {
    flash(copy.planFinished);
    if (notificationsWanted(plan)) await notifyProgress(pct, copy);
  } else {
    flash(copy.planPct(pct));
    if (notificationsWanted(plan)) await notifyProgress(pct, copy);
  }
  return result;
}

async function playChapterAudio(bookId, chapter, mode) {
  if (!editionSupportsAudio()) {
    flash(t(edition).audioOnlyKjv);
    return;
  }
  const mod = await ensureAudioModule();
  const ok = await mod.chapterHasAudio(bookId, chapter);
  if (!ok) {
    flash(t(edition).audioUnavailable);
    return;
  }
  audioMode = mode || audioMode || "beyond";
  const sess = loadAudioSession();
  sess.mode = audioMode;
  sess.offerContinue = false;
  saveAudioSession(sess);
  await audioPlayer.load(editionPath(), bookId, chapter);
}

function navigateToChapter(bookId, chapter, { autoplay = false, portion = false } = {}) {
  pendingAudioAutoplay = autoplay;
  const inPortion = portion || audioMode === "plan" || audioMode === "portion";
  const path = inPortion ? `/porcja/${bookId}/${chapter}` : `/czytaj/${bookId}/${chapter}`;
  history.pushState(null, "", path);
  route();
}

async function handleAudioChapterEnded({ bookId, chapter }) {
  if (!bookId || !chapter) return;
  if (audioMode === "single") {
    audioMode = "idle";
    audioPlayer?.stop();
    return;
  }

  await creditChapterFromAudio(bookId, chapter);

  const books = window.__reader?.books || (await loadBooks());
  const copy = t(edition);
  plan = loadPlan();
  if (audioMode === "plan" || audioMode === "portion") plan = notePortionChapter(plan);

  if (audioMode === "portion" && plan.enabled) {
    const next = nextMarkTarget(books, plan);
    if (next) {
      navigateToChapter(next.book, next.chapter, { autoplay: true, portion: true });
      return;
    }
  }

  if (audioMode === "plan" && plan.enabled) {
    if (isDailyPlanComplete(plan)) {
      const next = nextChapterInBible(books, bookId, chapter);
      saveAudioSession({
        mode: "idle",
        offerContinue: !!next,
        nextBook: next?.book || null,
        nextChapter: next?.chapter || null,
      });
      audioMode = "idle";
      audioPlayer?.stop();
      flash(copy.audioSessionEnded);
      return;
    }
    const next = nextMarkTarget(books, plan);
    if (next) {
      navigateToChapter(next.book, next.chapter, { autoplay: true });
      return;
    }
  }

  if (audioMode === "beyond" || (audioMode === "plan" && !plan.enabled)) {
    const next = nextChapterInBible(books, bookId, chapter);
    if (next) {
      navigateToChapter(next.book, next.chapter, { autoplay: true });
      return;
    }
    saveAudioSession({ mode: "idle", offerContinue: false, nextBook: null, nextChapter: null });
    audioMode = "idle";
    audioPlayer?.stop();
    flash(copy.audioBibleEnded);
    return;
  }

  audioPlayer?.stop();
}

function setCanonical(path) {
  canonical.setAttribute("href", `${location.origin}${path}`);
}

function portionStatusLine(books, current = plan) {
  const copy = t(edition);
  const finish = books ? planFinishDate(books, current) : null;
  const finishText = finish ? copy.planFinish(finish) : "";
  if (current.beyond) return [copy.beyondPlan, finishText].filter(Boolean).join(" · ");
  const st = pileStatus(current);
  if (st.owed <= 0) return "";
  const mins = readingMinutes(st.owed, current);
  return [
    copy.pileProgress(st.done, st.pile),
    st.behind > 0 ? copy.behindToday(st.behind, st.quota) : "",
    mins ? copy.etaMinutes(mins) : "",
    finishText,
  ].filter(Boolean).join(" · ");
}

function refreshPlanBanner() {
  plan = loadPlan();
  const onPortion =
    readerMode === "portion" && document.getElementById("reader").classList.contains("is-on");
  if (!plan.enabled || !onPortion) {
    planBanner.hidden = true;
    document.body.classList.remove("has-plan-banner");
    return;
  }
  const text = portionStatusLine(window.__reader?.books, plan);
  planBanner.textContent = text;
  planBanner.hidden = !text;
  document.body.classList.toggle("has-plan-banner", !!text);
}

function parseRoute(pathname) {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);

  if (parts[0] === "wybor" || parts[0] === "choose") return { name: "pick" };
  if (parts.length === 0) return { name: edition ? "home" : "pick" };
  if (parts[0] === "ksiegi" || parts[0] === "books") return { name: "books" };
  if (parts[0] === "plan") return { name: "plan" };
  if (parts[0] === "synchronizacja" || parts[0] === "sync") return { name: "sync" };
  if (parts[0] === "porcja" || parts[0] === "portion") {
    return {
      name: "portion",
      bookKey: parts[1] || null,
      chapter: parts[2] ? Number(parts[2]) : null,
    };
  }

  if (parts[0] === "czytaj" && parts[1]) {
    return {
      name: "reader",
      bookKey: parts[1],
      chapter: Number(parts[2] || 1),
      verse: parts[3] ? Number(parts[3]) : null,
    };
  }

  if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
    return {
      name: "reader",
      bookKey: parts[0],
      chapter: Number(parts[1]),
      verse: parts[2] && /^\d+$/.test(parts[2]) ? Number(parts[2]) : null,
      short: true,
    };
  }

  return { name: "home" };
}

async function renderBooks() {
  if (!edition) return renderPick();
  const copy = t(edition);
  let listHtml;
  try {
    const books = await loadBooks();
    const st = books.filter((b) => b.testament === "st");
    const nt = books.filter((b) => b.testament === "nt");
    listHtml = sectionList(copy.testamentOt, st) + sectionList(copy.testamentNt, nt);
  } catch (e) {
    listHtml = `<p class="error-box">${e.message}</p>`;
  }
  // Najpierw pełny DOM, potem ujawnienie ekranu
  document.querySelector("#books .topbar strong").textContent = copy.index;
  document.querySelector("#books .topbar .linkish").textContent = copy.titleCard;
  document.querySelector("#books .index-head .label").textContent = copy.booksHeading;
  document.getElementById("book-list-root").innerHTML = listHtml;
  setCanonical("/ksiegi");
  show("books");
}

function sectionList(label, books) {
  const items = books
    .map((b) => {
      const num = toRoman(Number(b.id.slice(0, 2)));
      return `<li>
        <a href="/czytaj/${b.id}/1">
          <span class="num">${num}</span>
          <span>${b.name}</span>
          <span class="abbr">${b.short}</span>
        </a>
      </li>`;
    })
    .join("");
  return `<p class="testament-label">${label}</p><ul class="book-list">${items}</ul>`;
}

function computeMarkReadUi(bookId, chapter, books) {
  const copy = t(edition);
  if (!plan.enabled || !books) {
    return { hidden: true, classes: [], text: copy.markRead };
  }
  if (!isInGoalRange(books, plan, bookId, chapter)) {
    return { hidden: true, classes: [], text: copy.markRead };
  }
  if (isChapterCredited(books, plan, bookId, chapter)) {
    const classes = ["is-done"];
    if (isExtraCredit(plan, bookId, chapter)) classes.push("is-extra");
    return { hidden: false, classes, text: copy.markedPlan };
  }
  if (!canMarkChapter(books, plan, bookId, chapter)) {
    return { hidden: true, classes: [], text: copy.markRead };
  }
  if (isDailyPlanComplete(plan)) {
    return { hidden: false, classes: ["is-extra-action"], text: copy.markExtra };
  }
  return { hidden: false, classes: [], text: copy.markRead };
}

function applyMarkReadUi(state) {
  const wrap = document.getElementById("chapter-done");
  const btn = document.getElementById("mark-read-btn");
  wrap.classList.remove("is-done", "is-extra", "is-extra-action");
  for (const c of state.classes) wrap.classList.add(c);
  wrap.hidden = state.hidden;
  btn.textContent = state.text;
}

function updateMarkReadUi(bookId, chapter, books = window.__reader?.books) {
  applyMarkReadUi(computeMarkReadUi(bookId, chapter, books));
}

/** Buduje całe folio jako jeden HTML, potem jedna podmiana — bez pustego layoutu. */
function paintReaderFolio({ book, chapter, data, books, verse, hasAudio, copy, portion = false }) {
  const est = estimateMinutesFromVerses(data.verses);
  const wrapWords = editionSupportsAudio();
  const versesHtml = data.verses
    .map((v) => {
      const sel = verse === v.n ? " is-sel" : "";
      return `<li data-v="${v.n}" class="${sel.trim()}"><span class="n">${v.n}</span>${verseHtml(v.t, wrapWords)}</li>`;
    })
    .join("");
  const prev = portion
    ? ""
    : chapter > 1
      ? `<a class="tablet ital" href="/czytaj/${book.id}/${chapter - 1}">← Cap. ${toRoman(chapter - 1)}</a>`
      : `<span></span>`;
  const next = portion
    ? ""
    : chapter < book.chapters
      ? `<a class="tablet ital" href="/czytaj/${book.id}/${chapter + 1}">Cap. ${toRoman(chapter + 1)} →</a>`
      : nextBookLink(books, book);
  const mark = portion
    ? { hidden: false, classes: [], text: copy.chapterDone }
    : { hidden: true, classes: [], text: copy.markRead };
  const markClass = ["chapter-done", ...mark.classes].join(" ");
  const showAudio = editionSupportsAudio() && hasAudio;
  const stopHidden = audioPlayer?.current?.()?.playing ? "" : " hidden";
  const heading = `${copy.chapterWord} ${toRoman(chapter)}`;
  const timeText = `${copy.readingEta} · ${copy.etaMinutes(est.minutes)}`;

  const html = `
          <div class="running" id="running">
            <span>${escapeHtml(chapterLabel(chapter))}</span>
            <span>${escapeHtml(book.short)}</span>
            <span>${escapeHtml(editionLabel())}</span>
          </div>
          <header class="chap-title">
            <h1 id="chap-heading">${escapeHtml(heading)}</h1>
            <p id="chap-book">${escapeHtml(book.name)}</p>
            <p class="read-time" id="read-time">${escapeHtml(timeText)}</p>
            <div class="audio-controls" id="audio-controls"${showAudio ? "" : " hidden"}>
              <button type="button" class="tablet" id="audio-play-btn">${escapeHtml(copy.audioListen)}</button>
              <button type="button" class="tablet ital" id="audio-stop-btn"${stopHidden}>${escapeHtml(copy.audioStop)}</button>
            </div>
          </header>
          <ol class="verses" id="verses">${versesHtml}</ol>
          <div class="${markClass}" id="chapter-done"${mark.hidden ? " hidden" : ""}>
            <button type="button" class="tablet" id="mark-read-btn">${escapeHtml(mark.text)}</button>
          </div>
          <div class="folio-nav" id="folio-nav"${portion ? " hidden" : ""}>${prev}${next}</div>`;

  document.querySelector("#reader .moulding-inner.reader").innerHTML = html;
  selectedVerse = verse;
  window.__reader = { book, chapter, data, books };
  return { showAudio };
}

async function askContinuePortion() {
  const copy = t(edition);
  return askConfirm(copy.portionDoneTitle, copy.portionDoneBody, {
    ok: copy.portionContinue,
    cancel: copy.portionHome,
  });
}

async function renderReader(route, { portion = false } = {}) {
  if (!edition) return renderPick();
  const gen = ++readerLoadGen;
  readerMode = portion ? "portion" : "read";
  const copy = t(edition);
  const folio = document.querySelector("#reader .moulding-inner.reader");
  document.getElementById("reader").classList.toggle("is-plan", portion);

  try {
    // Równolegle: books + domysł rozdziału (gdy bookKey == id)
    const guessUrl = `${editionPath()}/${route.bookKey}/${route.chapter}.json`;
    const earlyChapterP = chapterCache.has(guessUrl)
      ? Promise.resolve(chapterCache.get(guessUrl))
      : fetch(guessUrl)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);

    const booksP = loadBooks();
    const audioPrepP = editionSupportsAudio()
      ? ensureAudioModule().then(() => true)
      : Promise.resolve(false);

    const [books, earlyData, hasAudio] = await Promise.all([booksP, earlyChapterP, audioPrepP]);
    if (gen !== readerLoadGen) return;

    plan = loadPlan();
    let book;
    let chapter;
    if (portion) {
      if (!plan.enabled) {
        history.replaceState(null, "", "/");
        readerMode = null;
        return renderHome();
      }
      const finished = plan.owed != null && plan.owed <= 0 && !plan.beyond;
      const target = nextMarkTarget(books, plan);
      if (!target) {
        history.replaceState(null, "", "/");
        readerMode = null;
        return renderHome();
      }
      if (finished) {
        const stay = await askContinuePortion();
        if (gen !== readerLoadGen) return;
        if (!stay) {
          history.replaceState(null, "", "/");
          readerMode = null;
          return renderHome();
        }
        plan.beyond = true;
        savePlan(plan);
      }
      book = resolveBook(books, target.book);
      chapter = target.chapter;
    } else {
      book = resolveBook(books, route.bookKey);
      chapter = route.chapter;
    }
    if (!book) throw new Error(copy.unknownBook(route.bookKey || ""));
    if (!chapter || chapter < 1 || chapter > book.chapters) {
      throw new Error(copy.missingChapter(chapter));
    }

    const canonPath = `${editionPath()}/${book.id}/${chapter}`;
    const nice = portion
      ? `/porcja/${book.id}/${chapter}`
      : `/czytaj/${book.id}/${chapter}${route.verse ? `/${route.verse}` : ""}`;

    let data = earlyData;
    if (data && book.id === route.bookKey && chapter === Number(route.chapter)) {
      rememberChapter(`${canonPath}.json`, data);
    } else {
      try {
        data = await fetchChapterJson(canonPath);
      } catch {
        throw new Error(copy.loadFailed);
      }
    }
    if (gen !== readerLoadGen) return;

    if (!hasAudio) {
      pendingAudioAutoplay = false;
      if (audioPlayer?.current?.()?.bookId) audioPlayer.stop();
    }

    // Poprzedni ekran zostaje widoczny, aż tu jest komplet — potem jeden reveal
    const back = document.getElementById("reader-back");
    back.href = portion ? "/" : "/ksiegi";
    back.textContent = portion ? copy.backTitle : copy.backBooks;
    document.getElementById("share-btn").textContent = copy.share;
    document.querySelector('#reader a[href="/plan"]').textContent = copy.plan;
    setCanonical(portion ? canonPath : route.verse ? `${canonPath}/${route.verse}` : canonPath);
    if (location.pathname !== nice) {
      history.replaceState(null, "", nice);
    }

    const { showAudio } = paintReaderFolio({
      book,
      chapter,
      data,
      books,
      verse: portion ? null : route.verse,
      hasAudio,
      copy,
      portion,
    });
    if (!portion) rememberPlace(edition.id, book.id, chapter);
    show("reader");
    refreshPlanBanner();

    // Prefetch sąsiadów — kolejna nawigacja z cache
    if (chapter > 1) prefetchChapter(`${editionPath()}/${book.id}/${chapter - 1}`);
    const nxt = nextChapterInBible(books, book.id, chapter);
    if (nxt) prefetchChapter(`${editionPath()}/${nxt.book}/${nxt.chapter}`);

    if (pendingAudioAutoplay && showAudio) {
      pendingAudioAutoplay = false;
      let mode = audioMode;
      if (mode !== "plan" && mode !== "beyond" && mode !== "portion") {
        mode = portion ? (plan.beyond ? "portion" : "plan") : "single";
      }
      playChapterAudio(book.id, chapter, mode).catch(() => flash(t(edition).audioUnavailable));
    } else {
      pendingAudioAutoplay = false;
    }

    if (!portion && route.verse) {
      const el = document.querySelector(`#verses li[data-v="${route.verse}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  } catch (e) {
    if (gen !== readerLoadGen) return;
    if (folio) {
      folio.innerHTML = `<p class="error-box" style="padding:1rem">${escapeHtml(e.message)}</p>`;
    }
    show("reader");
  }
}

function nextBookLink(books, book) {
  const i = books.findIndex((b) => b.id === book.id);
  if (i < 0 || i >= books.length - 1) return `<span></span>`;
  const n = books[i + 1];
  return `<a class="tablet ital" href="/czytaj/${n.id}/1">${n.short} →</a>`;
}

function setStartCta(el, assignment) {
  const copy = t(edition);
  if (!assignment || assignment.done) {
    el.href = `/czytaj/${DEFAULT_READ.book}/${DEFAULT_READ.chapter}`;
    el.innerHTML = `<span class="cta-main">${copy.startRead}</span><span class="cta-sub">${copy.startGenesis}</span>`;
    return;
  }
  el.href = assignment.href;
  const verb = assignment.started ? copy.continueRead : copy.startRead;
  el.innerHTML = `<span class="cta-main">${verb}</span><span class="cta-sub">${copy.minutesWithRange(
    assignment.minutes,
    assignment.range
  )}</span>`;
}

function renderPick() {
  show("pick");
  setCanonical("/wybor");
  applyTheme();
}

function selectEdition(id) {
  const next = findEdition(id);
  if (!next) return;
  edition = next;
  saveEditionChoice(edition);
  booksCache = null;
  applyTheme();
  history.replaceState(null, "", "/");
  route();
}

function notificationsWanted(p = plan) {
  return !!(p.enabled && p.notifications);
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent || "");
}

function isInstalledDisplay() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    (typeof navigator !== "undefined" && navigator.standalone === true) ||
    (document.referrer || "").startsWith("android-app://")
  );
}

/** Deep linki do Activity w APK (TWA nie otwiera surowych intent:settings). */
function ksiagIntentHref(host) {
  return `intent://${host}#Intent;scheme=ksiag;package=pl.ksiag.app;end`;
}

function wireKsiagLink(el, host, label) {
  if (!el) return;
  el.hidden = false;
  if (label) el.textContent = label;
  el.href = ksiagIntentHref(host);
  el.setAttribute("rel", "noopener");
}

function hideNotifyHelpLinks() {
  for (const id of ["notify-android-settings", "notify-site-settings", "notify-recheck"]) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
}

function isTwaLike() {
  return isAndroidDevice() && isInstalledDisplay();
}

async function syncNotifyPermissionUi() {
  const blocked = document.getElementById("notify-blocked");
  const hint = document.getElementById("notify-hint");
  const androidLink = document.getElementById("notify-android-settings");
  const siteLink = document.getElementById("notify-site-settings");
  const recheckBtn = document.getElementById("notify-recheck");
  const wanted = document.getElementById("plan-notify-on").checked;
  const pc = planCopy(edition);
  if (!("Notification" in window)) {
    blocked.hidden = true;
    hideNotifyHelpLinks();
    hint.textContent = pc.notifyUnsupported;
    return;
  }

  // TWA: „managed by app” — nie ufaj samym permission===denied; sprawdź dostawę
  let blockedByBrowser = wanted && Notification.permission === "denied";
  if (blockedByBrowser && isTwaLike()) {
    const eff = await effectiveNotifyPermission({ allowDelegatedProbe: true });
    if (eff === "granted") blockedByBrowser = false;
  }

  if (blockedByBrowser) {
    blocked.hidden = false;
    hint.textContent = pc.notifyBlockedWanted;
    const titleEl = document.querySelector("[data-i18n-blocked-title]");
    const extraEl = document.querySelector("[data-i18n-blocked-extra]");
    const stepsEl = document.querySelector("[data-i18n-blocked-steps]");
    if (isAndroidDevice()) {
      if (titleEl) titleEl.textContent = pc.blockedTitleApp || pc.blockedTitle;
      if (extraEl) extraEl.textContent = pc.blockedExtraApp || pc.blockedExtra;
      if (stepsEl && pc.blockedStepsApp) {
        stepsEl.innerHTML = pc.blockedStepsApp.map((s) => `<li>${s}</li>`).join("");
      }
      // Priorytet: ustawienia Androida (delegacja TWA)
      wireKsiagLink(androidLink, "notification-settings", pc.blockedAndroidLink);
      wireKsiagLink(siteLink, "site-settings", pc.blockedSiteLink);
      if (recheckBtn) {
        recheckBtn.hidden = false;
        recheckBtn.textContent = pc.notifyRecheck || "Sprawdź ponownie";
      }
    } else {
      if (titleEl) titleEl.textContent = pc.blockedTitle;
      if (extraEl) extraEl.textContent = pc.blockedExtra;
      if (stepsEl && pc.blockedSteps) {
        stepsEl.innerHTML = pc.blockedSteps.map((s) => `<li>${s}</li>`).join("");
      }
      hideNotifyHelpLinks();
    }
  } else {
    blocked.hidden = true;
    hideNotifyHelpLinks();
    hint.textContent = pc.notifyHint;
  }
}

async function recheckNotifyPermission() {
  const pc = planCopy(edition);
  const perm = await effectiveNotifyPermission({ allowDelegatedProbe: isTwaLike() });
  await syncNotifyPermissionUi();
  if (perm === "granted") {
    const shown = await notifyEnabledConfirm(t(edition));
    flash(shown ? pc.notifyEnabledFlash : pc.notifyFailedFlash);
    try {
      const books = await loadBooks();
      await maybeNotifyStart(books, { force: true });
    } catch {
      /* ignore */
    }
  } else if (perm === "denied") {
    flash(pc.notifyDeniedFlash);
  }
}

async function maybeNotifyStart(books, { force = false } = {}) {
  plan = loadPlan();
  if (!notificationsWanted(plan)) return false;
  if (!force && plan.startNotifiedDay === todayKey()) return false;
  if (isDailyPlanComplete(plan)) return false;
  if (!("Notification" in window)) return false;
  const perm = await effectiveNotifyPermission({ allowDelegatedProbe: isTwaLike() });
  if (perm !== "granted") return false;
  const asg = todayAssignment(books, plan, toRoman);
  // force: po włączeniu w ustawieniach — także gdy już zaczął czytać (continue)
  if (!asg || asg.done) return false;
  if (!force && asg.started) return false;
  const ok = await notifyStartReading(asg, t(edition));
  if (ok) {
    plan.startNotifiedDay = todayKey();
    savePlan(plan);
  }
  return ok;
}

function paintHomeColophon(copy) {
  const el = document.getElementById("home-colophon");
  el.replaceChildren();
  if (!copy.homeSourceUrl) {
    el.textContent = copy.homeColophon;
    return;
  }
  el.append(document.createTextNode(`${copy.homeColophon} · `));
  const a = document.createElement("a");
  a.href = copy.homeSourceUrl;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = copy.homeSourceName;
  el.append(a);
}

function paintOrdinaryRead(el, books) {
  const copy = t(edition);
  const place = loadPlace(edition.id);
  const book = place && books?.find((b) => b.id === place.book);
  if (place && book) {
    el.href = `/czytaj/${place.book}/${place.chapter}`;
    el.innerHTML = `<span class="cta-main">${copy.continueRead}</span><span class="cta-sub">${escapeHtml(book.name)} ${toRoman(place.chapter)}</span>`;
    return;
  }
  el.href = `/czytaj/${DEFAULT_READ.book}/${DEFAULT_READ.chapter}`;
  el.innerHTML = `<span class="cta-main">${copy.startRead}</span><span class="cta-sub">${copy.startGenesis}</span>`;
}

function paintPortionCta(el, books) {
  const copy = t(edition);
  if (!plan.enabled) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const asg = todayAssignment(books, plan, toRoman);
  const finish = planFinishDate(books, plan);
  const finishText = finish ? copy.planFinish(finish) : "";
  if (!asg || asg.done) {
    el.href = "/porcja";
    el.dataset.finished = plan.beyond ? "" : "1";
    el.innerHTML = `<span class="cta-main">${copy.homePlanDone}</span><span class="cta-sub">${escapeHtml(finishText || copy.portionContinue)}</span>`;
    return;
  }
  el.dataset.finished = "";
  el.href = asg.href;
  const today = asg.pile - asg.behind;
  const sub = [
    asg.behind > 0 ? copy.behindToday(asg.behind, today) : "",
    asg.minutes ? copy.etaMinutes(asg.minutes) : "",
    asg.range || "",
    finishText,
  ].filter(Boolean).join(" · ");
  el.innerHTML = `<span class="cta-main">${copy.homePlan}</span><span class="cta-sub">${escapeHtml(sub)}</span>`;
}

async function renderHome() {
  if (!edition) return renderPick();
  applyTheme();
  const copy = t(edition);
  const cta = document.getElementById("home-read-cta");
  const portionCta = document.getElementById("home-plan-cta");

  try {
    const books = await loadBooks();
    plan = loadPlan();
    paintOrdinaryRead(cta, books);
    paintPortionCta(portionCta, books);
    if (plan.enabled) await maybeNotifyStart(books);
  } catch {
    paintOrdinaryRead(cta, null);
    if (portionCta) portionCta.hidden = true;
  }

  document.getElementById("home-eyebrow").textContent = copy.homeEyebrow;
  document.getElementById("home-title").textContent = copy.homeTitle;
  document.getElementById("home-sub").innerHTML = copy.homeSub;
  document.getElementById("home-meta").textContent = copy.homeMeta;
  paintHomeColophon(copy);
  document.getElementById("home-books").textContent = copy.booksLink;
  document.getElementById("home-plan").textContent = copy.planLink;
  document.getElementById("home-sync").textContent = copy.syncLink;
  document.getElementById("home-change-edition").textContent = copy.changeEdition;

  const continueBtn = document.getElementById("home-audio-continue");
  const audioSess = loadAudioSession();
  const showContinue =
    editionSupportsAudio() &&
    audioSess.offerContinue &&
    audioSess.nextBook &&
    audioSess.nextChapter;
  continueBtn.hidden = !showContinue;
  if (showContinue) {
    document.getElementById("home-audio-continue-main").textContent = copy.audioContinueMain;
    document.getElementById("home-audio-continue-sub").textContent = copy.audioContinueSub;
  }

  setCanonical("/");
  show("home");
}

function fillBookSelects(books) {
  // Krótsze etykiety — długie nazwy ksiąg nie rozpychają ramki planu
  const from = document.getElementById("plan-from-book");
  const to = document.getElementById("plan-to-book");
  const opts = books
    .map(
      (b) =>
        `<option value="${b.id}" title="${escapeHtml(b.name)}">${escapeHtml(b.short)}</option>`
    )
    .join("");
  from.innerHTML = opts;
  to.innerHTML = opts;
}

function syncPlanFormUi() {
  const goal = document.querySelector('input[name="goal"]:checked')?.value;
  const mode = document.querySelector('input[name="mode"]:checked')?.value;
  document.getElementById("plan-range").hidden = goal !== "range";
  document.getElementById("field-chapters").hidden = mode !== "chapters";
  document.getElementById("field-time").hidden = mode !== "time";

  const draft = {
    mode,
    chaptersPerDay: Number(document.getElementById("plan-chapters").value) || 3,
    minutesPerDay: Number(document.getElementById("plan-minutes").value) || 15,
  };
  document.getElementById("plan-preview").textContent = quotaPreview(draft, planCopy(edition));
  syncNotifyPermissionUi();
}

async function renderPlan() {
  if (!edition) return renderPick();
  const books = await loadBooks();
  plan = loadPlan();
  const pc = planCopy(edition);
  const cont = document.getElementById("plan-continue");

  fillBookSelects(books);
  document.querySelector("#plan .topbar strong").textContent = pc.planNav;
  document.querySelector("#plan .topbar .linkish").textContent = t(edition).titleCard;
  document.querySelector("#plan .index-head .label").textContent = pc.dailyPlan;
  document.querySelectorAll("#plan [data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (pc[key] != null) el.textContent = pc[key];
  });
  const blockedTitle = document.querySelector("[data-i18n-blocked-title]");
  if (blockedTitle) blockedTitle.textContent = pc.blockedTitle;
  const blockedExtra = document.querySelector("[data-i18n-blocked-extra]");
  if (blockedExtra) blockedExtra.textContent = pc.blockedExtra;
  const steps = document.querySelector("[data-i18n-blocked-steps]");
  if (steps && pc.blockedSteps) {
    steps.innerHTML = pc.blockedSteps.map((s) => `<li>${s}</li>`).join("");
  }

  document.getElementById("plan-setup").hidden = !!plan.enabled;
  document.getElementById("plan-active").hidden = !plan.enabled;
  document.querySelector(`input[name="goal"][value="${plan.goal}"]`).checked = true;
  document.querySelector(`input[name="mode"][value="${plan.mode}"]`).checked = true;
  document.getElementById("plan-from-book").value = plan.fromBook;
  document.getElementById("plan-to-book").value = plan.toBook;
  document.getElementById("plan-from-ch").value = plan.fromChapter;
  document.getElementById("plan-to-ch").value = plan.toChapter;
  document.getElementById("plan-chapters").value = plan.chaptersPerDay;
  document.getElementById("plan-minutes").value = plan.minutesPerDay;
  paintNotifyRadios(!!plan.notifications);
  syncPlanFormUi();

  const eta = document.getElementById("plan-eta");
  const summary = document.getElementById("plan-active-summary");
  if (plan.enabled) {
    summary.textContent = planAppointmentSummary(books, plan, pc);
    const line = portionStatusLine(books, plan);
    eta.hidden = !line;
    eta.textContent = line;
    const asg = todayAssignment(books, plan, toRoman);
    const next = nextMarkTarget(books, plan);
    cont.hidden = !next;
    if (next) {
      cont.href = asg && !asg.done ? asg.href : "/porcja";
      const sub = asg && !asg.done
        ? [asg.minutes ? pc.etaMinutes(asg.minutes) : "", asg.range || ""].filter(Boolean).join(" · ")
        : pc.portionContinue;
      const main = asg && !asg.done ? (asg.started ? pc.continueRead : pc.startRead) : pc.homePlanDone;
      cont.innerHTML = `<span class="cta-main">${main}</span><span class="cta-sub">${escapeHtml(sub)}</span>`;
    }
  } else {
    eta.hidden = true;
    setStartCta(cont, null);
    cont.hidden = false;
  }

  setCanonical("/plan");
  show("plan");
}

async function renderSync() {
  if (!edition) return renderPick();
  const pc = planCopy(edition);
  document.querySelector("#sync .topbar strong").textContent = pc.syncNav;
  document.querySelector("#sync .topbar .linkish").textContent = t(edition).titleCard;
  document.querySelector("#sync .index-head .label").textContent = pc.cloudTitle;
  document.querySelectorAll("#sync [data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (typeof pc[key] === "string") el.textContent = pc[key];
  });
  setCanonical("/synchronizacja");
  show("sync");
  await renderCloudPanel();
}

let pendingCloud = null;
let lastCloudPull = 0;
let cloudQrGen = 0;
let scanStream = null;
let scanTimer = null;
let lastCloudToast = "";

function cloudStatusText(code) {
  const pc = planCopy(edition);
  return (
    {
      saved: pc.cloudStatusSaved,
      joined: pc.cloudStatusJoined,
      uploaded: pc.cloudStatusUploaded,
      offline: pc.cloudStatusOffline,
      bad: pc.cloudStatusBad,
      error: pc.cloudStatusError,
    }[code] || ""
  );
}

async function renderCloudPanel() {
  const gen = ++cloudQrGen;
  const state = cloud.loadCloud();
  const box = document.getElementById("cloud-enabled");
  const panel = document.getElementById("cloud-panel");
  if (!box || !panel) return;
  if (box.checked !== !!state.enabled) box.checked = !!state.enabled;
  const show = !!(state.enabled && state.token);
  panel.hidden = !show;
  const scanBtn = document.getElementById("cloud-scan");
  if (scanBtn) scanBtn.hidden = !("BarcodeDetector" in window);
  if (!show) return;
  document.getElementById("cloud-code").textContent = cloud.formatToken(state.token);
  const status = document.getElementById("cloud-status");
  if (status) status.textContent = cloudStatusText(cloud.lastSyncStatus());
  const host = document.getElementById("cloud-qr");
  host.setAttribute("aria-label", planCopy(edition).cloudQr);
  try {
    const svg = await cloud.qrSvg(cloud.pairingUrl(state.token));
    if (gen !== cloudQrGen) return;
    host.innerHTML = svg;
  } catch {
    if (gen === cloudQrGen) host.replaceChildren();
  }
}

async function joinCloud(raw) {
  const books = await loadBooks();
  const status = await cloud.joinToken(raw, books);
  plan = loadPlan();
  const text = cloudStatusText(status);
  if (text) flash(text);
  return status;
}

async function consumeCloudHash() {
  const fromHash = cloud.tokenFromHash(location.hash);
  if (fromHash) history.replaceState(null, "", location.pathname + location.search);
  const token = fromHash || pendingCloud;
  if (!token) return false;
  if (!edition) {
    pendingCloud = token;
    return false;
  }
  pendingCloud = null;
  await joinCloud(token);
  return true;
}

async function refreshCloud({ force = false } = {}) {
  if (!edition || !cloud.isEnabled()) return "off";
  const now = Date.now();
  if (!force && now - lastCloudPull < 15000) return "skip";
  lastCloudPull = now;
  try {
    const books = await loadBooks();
    const status = await cloud.pull(books);
    if (status === "remote") plan = loadPlan();
    return status;
  } catch {
    lastCloudPull = 0;
    return "error";
  }
}

function stopCloudScan() {
  clearTimeout(scanTimer);
  scanTimer = null;
  if (scanStream) {
    for (const track of scanStream.getTracks()) track.stop();
    scanStream = null;
  }
  const video = document.getElementById("cloud-scan-video");
  if (video) video.srcObject = null;
  const overlay = document.getElementById("cloud-scan-overlay");
  if (overlay) overlay.hidden = true;
}

async function startCloudScan() {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    flash(planCopy(edition).cloudScanUnavailable);
    return;
  }
  const overlay = document.getElementById("cloud-scan-overlay");
  const video = document.getElementById("cloud-scan-video");
  const title = document.getElementById("cloud-scan-title");
  const pc = planCopy(edition);
  if (title) title.textContent = pc.cloudScan;
  const closeBtn = document.getElementById("cloud-scan-close");
  if (closeBtn) closeBtn.textContent = pc.cloudScanClose;
  overlay.hidden = false;
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
  } catch {
    stopCloudScan();
    flash(pc.cloudScanUnavailable);
    return;
  }
  video.srcObject = scanStream;
  await video.play();
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const tick = async () => {
    if (overlay.hidden) return;
    try {
      const codes = await detector.detect(video);
      const raw = codes[0]?.rawValue;
      if (raw && cloud.parseToken(raw)) {
        stopCloudScan();
        const status = await joinCloud(raw);
        if (status === "joined" || status === "uploaded") {
          refreshPlanBanner();
          await renderSync();
        }
        return;
      }
    } catch {
      /* klatka jeszcze niegotowa */
    }
    scanTimer = setTimeout(tick, 280);
  };
  tick();
}

async function route() {
  await consumeCloudHash();
  const r = parseRoute(location.pathname);
  await refreshCloud({ force: r.name === "plan" || r.name === "sync" });
  plan = loadPlan();
  readerMode = r.name === "portion" ? "portion" : r.name === "reader" ? "read" : null;
  refreshPlanBanner();
  if (!edition && r.name !== "pick") return renderPick();
  if (r.name === "pick") return renderPick();
  if (r.name === "books") return renderBooks();
  if (r.name === "reader") return renderReader(r);
  if (r.name === "portion") return renderReader(r, { portion: true });
  if (r.name === "plan") return renderPlan();
  if (r.name === "sync") return renderSync();
  return renderHome();
}

document.getElementById("reader").addEventListener("click", async (e) => {
  const li = e.target.closest("#verses li[data-v]");
  if (li) {
    const ctx = window.__reader;
    if (!ctx) return;
    const n = Number(li.dataset.v);
    selectedVerse = n;
    document.querySelectorAll("#verses li").forEach((x) => x.classList.remove("is-sel"));
    li.classList.add("is-sel");
    const path = readerMode === "portion"
      ? `/porcja/${ctx.book.id}/${ctx.chapter}`
      : `/czytaj/${ctx.book.id}/${ctx.chapter}/${n}`;
    history.replaceState(null, "", path);
    setCanonical(
      readerMode === "portion"
        ? `${editionPath()}/${ctx.book.id}/${ctx.chapter}`
        : `${editionPath()}/${ctx.book.id}/${ctx.chapter}/${n}`
    );
    return;
  }

  if (e.target.closest("#mark-read-btn")) {
    const ctx = window.__reader;
    if (!ctx || readerMode !== "portion" || !plan.enabled) return;
    const result = markChapterRead(plan, ctx.book.id, ctx.chapter, ctx.books);
    plan = result.plan;
    if (result.kind === "already" || result.kind === "off" || result.kind === "skip") return;
    plan = advanceCursor(plan, ctx.books);
    plan = notePortionChapter(plan);
    refreshPlanBanner();
    const pct = progressPct(plan);
    if (result.kind !== "extra" && notificationsWanted(plan) && pct != null) {
      await notifyProgress(pct, t(edition));
    }
    if (plan.owed != null && plan.owed <= 0 && !plan.beyond) {
      const stay = await askContinuePortion();
      if (!stay) {
        history.pushState(null, "", "/");
        readerMode = null;
        refreshPlanBanner();
        return renderHome();
      }
      plan.beyond = true;
      savePlan(plan);
    }
    const next = nextMarkTarget(ctx.books, plan);
    if (!next) {
      history.pushState(null, "", "/");
      readerMode = null;
      return renderHome();
    }
    history.pushState(null, "", `/porcja/${next.book}/${next.chapter}`);
    return renderReader({ name: "portion", bookKey: next.book, chapter: next.chapter }, { portion: true });
  }

  if (e.target.closest("#audio-play-btn")) {
    if (!editionSupportsAudio()) return;
    const ctx = window.__reader;
    if (!ctx) return;
    await ensureAudioModule();
    if (audioPlayer.isPlaying() && audioPlayer.current().bookId === ctx.book.id && audioPlayer.current().chapter === ctx.chapter) {
      audioPlayer.pause();
      return;
    }
    if (
      !audioPlayer.isPlaying() &&
      audioPlayer.current().bookId === ctx.book.id &&
      audioPlayer.current().chapter === ctx.chapter &&
      audioEl.src
    ) {
      await audioPlayer.resume();
      return;
    }
    plan = loadPlan();
    const mode = readerMode === "portion"
      ? (plan.beyond || isDailyPlanComplete(plan) ? "portion" : "plan")
      : "single";
    try {
      await playChapterAudio(ctx.book.id, ctx.chapter, mode);
    } catch {
      flash(t(edition).audioUnavailable);
    }
    return;
  }

  if (e.target.closest("#audio-stop-btn")) {
    audioMode = "idle";
    audioPlayer?.stop();
  }
});

document.getElementById("share-btn").addEventListener("click", async () => {
  const ctx = window.__reader;
  if (!ctx) return;
  const n =
    selectedVerse ||
    Number(document.querySelector("#verses li.is-sel")?.dataset.v) ||
    DEFAULT_READ.verse;
  const verse = ctx.data.verses.find((v) => v.n === n);
  if (!verse) return;
  const shortAlias = (ctx.book.aliases && ctx.book.aliases[0]) || ctx.book.short.toLowerCase();
  const shortUrl = `${location.origin}/${shortAlias}/${ctx.chapter}/${n}`;
  const text = `${ctx.book.short} ${ctx.chapter},${n} (${editionLabel()})\n${stripTags(verse.t)}\n${shortUrl}`;

  try {
    if (navigator.share) {
      await navigator.share({
        title: `${ctx.book.short} ${ctx.chapter},${n}`,
        text: stripTags(verse.t),
        url: shortUrl,
      });
    } else {
      await navigator.clipboard.writeText(text);
      flash(t(edition).copied(`/${shortAlias}/${ctx.chapter}/${n}`));
    }
  } catch {
    flash(t(edition).cancelled);
  }
});

function planAppointmentSummary(books, current, pc) {
  let goal = pc.wholeBible;
  if (current.goal === "st") goal = pc.oldTestament;
  else if (current.goal === "nt") goal = pc.newTestament;
  else if (current.goal === "range") {
    const short = (id) => books.find((b) => b.id === id)?.short || "";
    goal = `${pc.from} ${short(current.fromBook)} ${current.fromChapter} · ${pc.to} ${short(current.toBook)} ${current.toChapter}`;
  }
  return `${goal} · ${quotaPreview(current, pc)}`;
}

let paintingNotify = false;
let notifyGen = 0;

function paintNotifyRadios(on) {
  paintingNotify = true;
  document.getElementById(on ? "plan-notify-on" : "plan-notify-off").checked = true;
  paintingNotify = false;
}

/** Wspólna ścieżka uprawnień dla przełącznika i pytania przy Ustaw. */
async function permissionForNotifications(wantOn) {
  if (!wantOn) return { on: false, perm: "off" };
  const perm = await ensureNotifyPermission();
  if (perm === "unsupported") return { on: false, perm };
  return { on: true, perm };
}

async function announceNotifications(perm, { announce }) {
  const pc = planCopy(edition);
  if (perm === "unsupported") {
    flash(pc.notifyUnsupportedFlash);
    return;
  }
  if (perm === "denied") {
    flash(pc.notifyDeniedFlash);
    return;
  }
  if (perm !== "granted") return;
  if (announce) {
    const shown = await notifyEnabledConfirm(t(edition));
    flash(shown ? pc.notifyEnabledFlash : pc.notifyFailedFlash);
  }
  if (!loadPlan().enabled) return;
  try {
    const books = await loadBooks();
    await maybeNotifyStart(books, { force: true });
  } catch {
    /* ignore */
  }
}

async function applyNotificationPreference(wantOn) {
  const wasOn = !!loadPlan().notifications;
  if (wantOn === wasOn) return;
  const gen = ++notifyGen;
  const { on, perm } = await permissionForNotifications(wantOn);
  if (gen !== notifyGen) return;
  plan = loadPlan();
  plan.notifications = on;
  if (on && perm === "granted") plan.startNotifiedDay = null;
  savePlan(plan);
  paintNotifyRadios(on);
  await syncNotifyPermissionUi();
  await announceNotifications(perm, { announce: on && perm === "granted" && !wasOn });
}

const planForm = document.getElementById("plan-form");
planForm.addEventListener("change", syncPlanFormUi);
planForm.addEventListener("input", syncPlanFormUi);
document.getElementById("notify-recheck")?.addEventListener("click", () => {
  recheckNotifyPermission().catch(() => {});
});
for (const id of ["plan-notify-on", "plan-notify-off"]) {
  document.getElementById(id).addEventListener("change", () => {
    if (paintingNotify) return;
    applyNotificationPreference(document.getElementById("plan-notify-on").checked).catch(() => {});
  });
}
planForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(planForm);
  const pc = planCopy(edition);
  const wasOn = !!loadPlan().notifications;
  let wantNotify = wasOn;
  if (!wasOn) {
    wantNotify = await askConfirm(pc.notifyOfferTitle, pc.notifyOfferBody, {
      ok: pc.notifyOfferYes,
      cancel: pc.notifyOfferNo,
    });
  }
  const { on, perm } = await permissionForNotifications(wantNotify);
  plan = loadPlan();
  plan.enabled = true;
  plan.goal = fd.get("goal") || "bible";
  plan.mode = fd.get("mode") || "chapters";
  plan.fromBook = fd.get("fromBook") || "01-gen";
  plan.toBook = fd.get("toBook") || "66-apo";
  plan.fromChapter = Number(fd.get("fromChapter")) || 1;
  plan.toChapter = Number(fd.get("toChapter")) || 1;
  plan.chaptersPerDay = Number(fd.get("chaptersPerDay")) || 3;
  plan.minutesPerDay = Number(fd.get("minutesPerDay")) || 15;
  plan.notifications = on;
  plan = armFreshPlan(plan);
  if (on && perm === "granted") plan.startNotifiedDay = null;
  savePlan(plan);
  refreshPlanBanner();
  if (perm === "denied" || perm === "unsupported") {
    await announceNotifications(perm, { announce: false });
  } else if (on && perm === "granted" && !wasOn) {
    await announceNotifications(perm, { announce: true });
  } else {
    flash(pc.planSaved(quotaPreview(plan, pc)));
    if (on && perm === "granted") {
      try {
        const books = await loadBooks();
        await maybeNotifyStart(books, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  renderPlan();
});

document.getElementById("plan-abandon").addEventListener("click", async () => {
  const pc = planCopy(edition);
  const ok = await askConfirm(pc.abandonTitle, pc.abandonBody, { ok: pc.abandonPlan });
  if (!ok) return;
  plan = loadPlan();
  plan.enabled = false;
  plan = armFreshPlan(plan);
  savePlan(plan);
  refreshPlanBanner();
  flash(pc.planDisabled);
  renderPlan();
});

function askConfirm(title, body, labels = {}) {
  const overlay = document.getElementById("confirm-overlay");
  const titleEl = document.getElementById("confirm-title");
  const bodyEl = document.getElementById("confirm-body");
  const okBtn = document.getElementById("confirm-ok");
  const cancelBtn = document.getElementById("confirm-cancel");
  const copy = t(edition);
  titleEl.textContent = title;
  bodyEl.textContent = body;
  okBtn.textContent = labels.ok || copy.confirmOk;
  cancelBtn.textContent = labels.cancel || copy.confirmCancel;
  overlay.hidden = false;
  okBtn.focus();

  return new Promise((resolve) => {
    const finish = (value) => {
      overlay.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (e) => {
      if (e.target === overlay) finish(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

document.getElementById("cloud-enabled").addEventListener("change", async () => {
  const on = document.getElementById("cloud-enabled").checked;
  if (!on) {
    cloud.disableCloud();
    await renderCloudPanel();
    return;
  }
  const had = !!cloud.loadCloud().token;
  await cloud.enableCloud();
  if (had) {
    const books = await loadBooks();
    const pulled = await cloud.pull(books);
    if (pulled === "remote") {
      plan = loadPlan();
      refreshPlanBanner();
      await renderSync();
      return;
    }
  }
  await renderCloudPanel();
});

document.getElementById("cloud-copy").addEventListener("click", async () => {
  const state = cloud.loadCloud();
  if (!state.token) return;
  try {
    await navigator.clipboard.writeText(cloud.formatToken(state.token));
    flash(planCopy(edition).cloudCopied);
  } catch {
    flash(planCopy(edition).cloudStatusError);
  }
});

document.getElementById("cloud-join").addEventListener("click", async () => {
  const input = document.getElementById("cloud-join-input");
  const status = await joinCloud(input.value);
  if (status === "joined" || status === "uploaded") {
    input.value = "";
    refreshPlanBanner();
    await renderSync();
  }
});

document.getElementById("cloud-new").addEventListener("click", async () => {
  const pc = planCopy(edition);
  const ok = await askConfirm(pc.cloudNewTitle, pc.cloudNewBody);
  if (!ok) return;
  await cloud.rotateToken();
  await renderCloudPanel();
});

document.getElementById("cloud-scan").addEventListener("click", () => {
  startCloudScan().catch(() => flash(planCopy(edition).cloudScanUnavailable));
});

document.getElementById("cloud-scan-close").addEventListener("click", stopCloudScan);
document.getElementById("cloud-scan-overlay").addEventListener("click", (e) => {
  if (e.target.id === "cloud-scan-overlay") stopCloudScan();
});

document.getElementById("pick-choices").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pick]");
  if (!btn) return;
  selectEdition(btn.getAttribute("data-pick"));
});

document.getElementById("home-plan-cta").addEventListener("click", async (e) => {
  if (e.currentTarget.dataset.finished !== "1") return;
  e.preventDefault();
  e.stopPropagation();
  const stay = await askContinuePortion();
  if (!stay) return;
  plan = loadPlan();
  plan.beyond = true;
  savePlan(plan);
  history.pushState(null, "", "/porcja");
  route();
});

document.getElementById("home-change-edition").addEventListener("click", () => {
  clearEditionChoice();
  edition = null;
  booksCache = null;
  chapterCache.clear();
  applyTheme();
  history.pushState(null, "", "/wybor");
  route();
});

document.getElementById("home-audio-continue").addEventListener("click", () => {
  const sess = loadAudioSession();
  if (!sess.nextBook || !sess.nextChapter) return;
  sess.offerContinue = false;
  sess.mode = "beyond";
  saveAudioSession(sess);
  audioMode = "beyond";
  navigateToChapter(sess.nextBook, sess.nextChapter, { autoplay: true });
});

audioBarToggle.addEventListener("click", async () => {
  if (!audioPlayer) return;
  if (audioPlayer.isPlaying()) audioPlayer.pause();
  else await audioPlayer.resume();
});

window.addEventListener("popstate", () => route());
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin) return;
  if (a.hasAttribute("download")) return;

  e.preventDefault();
  history.pushState(null, "", url.pathname + url.search + url.hash);
  route();
});

/** Wyrejestruj starą instalację i skasuj cache powłoki oraz pobrane audio. */
function retireInstalledApp() {
  const staleCache = (key) => /^ksiag-v\d+$/.test(key) || key === "ksiag-scourby-mp3-v1";
  const dropShell = () => {
    if (!("caches" in window)) return Promise.resolve();
    return caches.keys().then((keys) =>
      Promise.all(keys.filter(staleCache).map((key) => caches.delete(key)))
    );
  };
  const dropWorker = () => {
    if (!("serviceWorker" in navigator)) return Promise.resolve();
    return navigator.serviceWorker.getRegistrations().then((regs) =>
      Promise.all(regs.map((reg) => reg.unregister()))
    );
  };
  dropWorker()
    .then(dropShell)
    .catch(() => {});
}

retireInstalledApp();

function refreshAll() {
  plan = loadPlan();
  refreshPlanBanner();
  route();
}

if (isDevHost()) {
  window.__ksiagDev = {
    refresh: refreshAll,
    loadPlan,
  };
  import("./dev-console.js")
    .then((m) => m.mountDevConsole())
    .catch((e) => console.warn("[66ksiąg] Dev console:", e));
}

onPlanSaved(() => {
  cloud.schedulePush();
});

cloud.setStatusListener((code) => {
  const text = cloudStatusText(code);
  const el = document.getElementById("cloud-status");
  if (el && text && !document.getElementById("cloud-panel")?.hidden) el.textContent = text;
  if ((code === "offline" || code === "error") && text && code !== lastCloudToast) {
    lastCloudToast = code;
    flash(text);
  }
  if (code === "saved") lastCloudToast = "";
});

refreshPlanBanner();
route();

import {
  loadPlace,
  rememberPlace,
  estimateMinutesFromVerses,
  nextChapterInBible,
} from "./place.js";
import { isDevHost } from "./dev-host.js";
import {
  loadEditionChoice,
  saveEditionChoice,
  clearEditionChoice,
  findEdition,
} from "./editions.js";
import { t } from "./i18n.js";

/** Lazy — BG nie ładuje audio.js (~16 KB) ani katalogu (~193 KB). */
let audioMod = null;
let audioPlayer = null;
let verseHtmlWithWordsFn = null;

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

const audioEl = document.getElementById("scourby-audio");
const audioBar = document.getElementById("audio-bar");
const audioBarLabel = document.getElementById("audio-bar-label");
const audioBarToggle = document.getElementById("audio-bar-toggle");
/** Live query — folio czytnika jest podmieniane w całości. */
const audioControls = () => document.getElementById("audio-controls");
const audioPlayBtn = () => document.getElementById("audio-play-btn");
const audioStopBtn = () => document.getElementById("audio-stop-btn");

function editionPath() {
  return edition?.path || "/api/bg";
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

let booksCache = null;
let selectedVerse = null;
let toastTimer;
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

async function playChapterAudio(bookId, chapter) {
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
  await audioPlayer.load(editionPath(), bookId, chapter);
}

function navigateToChapter(bookId, chapter, { autoplay = false } = {}) {
  pendingAudioAutoplay = autoplay;
  const path = `/czytaj/${bookId}/${chapter}`;
  history.pushState(null, "", path);
  route();
}

async function handleAudioChapterEnded({ bookId, chapter }) {
  if (!bookId || !chapter) return;
  const books = window.__reader?.books || (await loadBooks());
  const next = nextChapterInBible(books, bookId, chapter);
  if (next) {
    navigateToChapter(next.book, next.chapter, { autoplay: true });
    return;
  }
  audioPlayer?.stop();
  flash(t(edition).audioBibleEnded);
}

function setCanonical(path) {
  canonical.setAttribute("href", `${location.origin}${path}`);
}

function parseRoute(pathname) {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);

  if (parts[0] === "wybor" || parts[0] === "choose") return { name: "pick" };
  if (parts.length === 0) return { name: edition ? "home" : "pick" };
  if (parts[0] === "ksiegi" || parts[0] === "books") return { name: "books" };

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

/** Buduje całe folio jako jeden HTML, potem jedna podmiana — bez pustego layoutu. */
function paintReaderFolio({ book, chapter, data, books, verse, hasAudio, copy }) {
  const est = estimateMinutesFromVerses(data.verses);
  const wrapWords = editionSupportsAudio();
  const versesHtml = data.verses
    .map((v) => {
      const sel = verse === v.n ? " is-sel" : "";
      return `<li data-v="${v.n}" class="${sel.trim()}"><span class="n">${v.n}</span>${verseHtml(v.t, wrapWords)}</li>`;
    })
    .join("");
  const prev =
    chapter > 1
      ? `<a class="tablet ital" href="/czytaj/${book.id}/${chapter - 1}">← Cap. ${toRoman(chapter - 1)}</a>`
      : `<span></span>`;
  const next =
    chapter < book.chapters
      ? `<a class="tablet ital" href="/czytaj/${book.id}/${chapter + 1}">Cap. ${toRoman(chapter + 1)} →</a>`
      : nextBookLink(books, book);
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
          <div class="folio-nav" id="folio-nav">${prev}${next}</div>`;

  document.querySelector("#reader .moulding-inner.reader").innerHTML = html;
  selectedVerse = verse;
  window.__reader = { book, chapter, data, books };
  return { showAudio };
}

async function renderReader(route) {
  if (!edition) return renderPick();
  const gen = ++readerLoadGen;
  const copy = t(edition);
  const folio = document.querySelector("#reader .moulding-inner.reader");

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

    const book = resolveBook(books, route.bookKey);
    const chapter = route.chapter;
    if (!book) throw new Error(copy.unknownBook(route.bookKey || ""));
    if (!chapter || chapter < 1 || chapter > book.chapters) {
      throw new Error(copy.missingChapter(chapter));
    }

    const canonPath = `${editionPath()}/${book.id}/${chapter}`;
    const nice = `/czytaj/${book.id}/${chapter}${route.verse ? `/${route.verse}` : ""}`;

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
    back.href = "/ksiegi";
    back.textContent = copy.backBooks;
    document.getElementById("share-btn").textContent = copy.share;
    setCanonical(route.verse ? `${canonPath}/${route.verse}.txt` : `${canonPath}.txt`);
    if (location.pathname !== nice) {
      history.replaceState(null, "", nice);
    }

    const { showAudio } = paintReaderFolio({
      book,
      chapter,
      data,
      books,
      verse: route.verse,
      hasAudio,
      copy,
    });
    rememberPlace(edition.id, book.id, chapter);
    show("reader");

    // Prefetch sąsiadów — kolejna nawigacja z cache
    if (chapter > 1) prefetchChapter(`${editionPath()}/${book.id}/${chapter - 1}`);
    const nxt = nextChapterInBible(books, book.id, chapter);
    if (nxt) prefetchChapter(`${editionPath()}/${nxt.book}/${nxt.chapter}`);

    if (pendingAudioAutoplay && showAudio) {
      pendingAudioAutoplay = false;
      playChapterAudio(book.id, chapter).catch(() => flash(t(edition).audioUnavailable));
    } else {
      pendingAudioAutoplay = false;
    }

    if (route.verse) {
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

async function renderHome() {
  if (!edition) return renderPick();
  applyTheme();
  const copy = t(edition);
  const cta = document.getElementById("home-read-cta");

  try {
    const books = await loadBooks();
    paintOrdinaryRead(cta, books);
  } catch {
    paintOrdinaryRead(cta, null);
  }

  document.getElementById("home-eyebrow").textContent = copy.homeEyebrow;
  document.getElementById("home-title").textContent = copy.homeTitle;
  document.getElementById("home-sub").innerHTML = copy.homeSub;
  document.getElementById("home-meta").textContent = copy.homeMeta;
  paintHomeColophon(copy);
  document.getElementById("home-books").textContent = copy.booksLink;
  document.getElementById("home-change-edition").textContent = copy.changeEdition;

  setCanonical("/");
  show("home");
}

async function route() {
  const r = parseRoute(location.pathname);
  if (!edition && r.name !== "pick") return renderPick();
  if (r.name === "pick") return renderPick();
  if (r.name === "books") return renderBooks();
  if (r.name === "reader") return renderReader(r);
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
    const path = `/czytaj/${ctx.book.id}/${ctx.chapter}/${n}`;
    history.replaceState(null, "", path);
    setCanonical(`${editionPath()}/${ctx.book.id}/${ctx.chapter}/${n}.txt`);
    return;
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
    try {
      await playChapterAudio(ctx.book.id, ctx.chapter);
    } catch {
      flash(t(edition).audioUnavailable);
    }
    return;
  }

  if (e.target.closest("#audio-stop-btn")) {
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

document.getElementById("pick-choices").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pick]");
  if (!btn) return;
  selectEdition(btn.getAttribute("data-pick"));
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
  route();
}

if (isDevHost()) {
  window.__ksiagDev = {
    refresh: refreshAll,
  };
  import("./dev-console.js")
    .then((m) => m.mountDevConsole())
    .catch((e) => console.warn("[66ksiąg] Dev console:", e));
}

route();

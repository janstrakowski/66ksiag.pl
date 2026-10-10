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
  resetPlanProgress,
  resetPlanAll,
} from "./plan.js";
import {
  ensureNotifyPermission,
  notifyStartReading,
  notifyProgress,
} from "./notify.js";
import { isDevHost } from "./dev-host.js";
import {
  loadEditionChoice,
  saveEditionChoice,
  clearEditionChoice,
  findEdition,
} from "./editions.js";
import { t, planCopy } from "./i18n.js";
import {
  createAudioController,
  chapterHasAudio,
  loadAudioSession,
  saveAudioSession,
  verseHtmlWithWords,
  loadAudioCatalog,
  downloadAllAudio,
  clearDownloadedAudio,
  countCachedChapters,
  abortAudioDownload,
  ensureAudioServiceWorker,
  supportsBackgroundFetch,
} from "./audio.js";

let audioDownloadAbort = null;

const DEFAULT_READ = { book: "01-gen", chapter: 1, verse: 1 };
let edition = loadEditionChoice();
let pendingAudioAutoplay = false;
let audioMode = "idle"; // idle | plan | beyond

const audioEl = document.getElementById("scourby-audio");
const audioBar = document.getElementById("audio-bar");
const audioBarLabel = document.getElementById("audio-bar-label");
const audioBarToggle = document.getElementById("audio-bar-toggle");
const audioControls = document.getElementById("audio-controls");
const audioPlayBtn = document.getElementById("audio-play-btn");
const audioStopBtn = document.getElementById("audio-stop-btn");

const audioPlayer = createAudioController({
  audioEl,
  hooks: {
    onChapterEnded: handleAudioChapterEnded,
    onState: syncAudioChrome,
  },
});

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

function flash(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2200);
}

function show(id) {
  screens.forEach((s) => s.classList.toggle("is-on", s.id === id));
  shell.classList.toggle("is-reader", id === "reader");
  window.scrollTo(0, 0);
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
  return withWords ? verseHtmlWithWords(escaped, 0) : escaped;
}

function editionSupportsAudio() {
  // Tylko KJV (editions.js: audio: true) — nigdy BG / Gdańska
  return !!edition?.audio;
}

function syncAudioChrome(state) {
  if (!editionSupportsAudio()) {
    audioBar.hidden = true;
    audioControls.hidden = true;
    document.body.classList.remove("has-audio-bar");
    return;
  }
  const copy = t(edition);
  const playing = !!state?.playing;
  if (playing || audioPlayer.current().bookId) {
    audioBar.hidden = false;
    document.body.classList.add("has-audio-bar");
    audioBarLabel.textContent = playing ? copy.audioBarListening : copy.audioBarPaused;
    audioBarToggle.textContent = playing ? copy.audioPause : copy.audioResume;
    audioStopBtn.hidden = false;
    audioPlayBtn.textContent = playing ? copy.audioPause : copy.audioListen;
  } else {
    audioBar.hidden = true;
    document.body.classList.remove("has-audio-bar");
    audioStopBtn.hidden = true;
    audioPlayBtn.textContent = copy.audioListen;
  }
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
  const ok = await chapterHasAudio(bookId, chapter);
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

function navigateToChapter(bookId, chapter, { autoplay = false } = {}) {
  pendingAudioAutoplay = autoplay;
  const path = `/czytaj/${bookId}/${chapter}`;
  history.pushState(null, "", path);
  route();
}

async function handleAudioChapterEnded({ bookId, chapter }) {
  if (!bookId || !chapter) return;
  await creditChapterFromAudio(bookId, chapter);

  const books = window.__reader?.books || (await loadBooks());
  const copy = t(edition);
  plan = loadPlan();

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
      audioPlayer.stop();
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
    audioPlayer.stop();
    flash(copy.audioBibleEnded);
    return;
  }

  audioPlayer.stop();
}

function setCanonical(path) {
  canonical.setAttribute("href", `${location.origin}${path}`);
}

function refreshPlanBanner() {
  plan = loadPlan();
  const pct = progressPct(plan);
  if (pct === null || pct >= 100) {
    planBanner.hidden = true;
    document.body.classList.remove("has-plan-banner");
    return;
  }
  const copy = t(edition);
  planBanner.innerHTML = `${copy.bannerBefore}<span id="plan-banner-pct">${pct}</span>${copy.bannerAfter}`;
  planBanner.hidden = false;
  document.body.classList.add("has-plan-banner");
}

function parseRoute(pathname) {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);

  if (parts[0] === "wybor" || parts[0] === "choose") return { name: "pick" };
  if (parts.length === 0) return { name: edition ? "home" : "pick" };
  if (parts[0] === "ksiegi" || parts[0] === "books") return { name: "books" };
  if (parts[0] === "plan") return { name: "plan" };

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
  show("books");
  setCanonical("/ksiegi");
  const copy = t(edition);
  document.querySelector("#books .topbar strong").textContent = copy.index;
  document.querySelector("#books .topbar .linkish").textContent = copy.titleCard;
  document.querySelector("#books .index-head .label").textContent = copy.booksHeading;
  const root = document.getElementById("book-list-root");
  try {
    const books = await loadBooks();
    const st = books.filter((b) => b.testament === "st");
    const nt = books.filter((b) => b.testament === "nt");
    root.innerHTML =
      sectionList(copy.testamentOt, st) + sectionList(copy.testamentNt, nt);
  } catch (e) {
    root.innerHTML = `<p class="error-box">${e.message}</p>`;
  }
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

function updateMarkReadUi(bookId, chapter, books = window.__reader?.books) {
  const wrap = document.getElementById("chapter-done");
  const btn = document.getElementById("mark-read-btn");
  const copy = t(edition);
  if (!plan.enabled || !books) {
    wrap.hidden = true;
    return;
  }
  wrap.classList.remove("is-done", "is-extra", "is-extra-action");

  // Poza zakresem celu — bez przycisku i statusu
  if (!isInGoalRange(books, plan, bookId, chapter)) {
    wrap.hidden = true;
    return;
  }

  if (isChapterCredited(books, plan, bookId, chapter)) {
    wrap.hidden = false;
    wrap.classList.add("is-done");
    if (isExtraCredit(plan, bookId, chapter)) wrap.classList.add("is-extra");
    btn.textContent = copy.markedPlan;
    return;
  }

  // Tylko następny rozdział do kontynuacji w zakresie
  if (!canMarkChapter(books, plan, bookId, chapter)) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  if (isDailyPlanComplete(plan)) {
    wrap.classList.add("is-extra-action");
    btn.textContent = copy.markExtra;
  } else {
    btn.textContent = copy.markRead;
  }
}

async function renderReader(route) {
  if (!edition) return renderPick();
  show("reader");
  const copy = t(edition);
  document.querySelector("#reader .topbar .linkish").textContent = copy.backBooks;
  document.getElementById("share-btn").textContent = copy.share;
  document.querySelector('#reader a[href="/plan"]').textContent = copy.plan;
  const versesEl = document.getElementById("verses");
  versesEl.innerHTML = `<li class="error-box">${copy.loading}</li>`;

  try {
    const books = await loadBooks();
    const book = resolveBook(books, route.bookKey);
    if (!book) throw new Error(copy.unknownBook(route.bookKey));

    const chapter = route.chapter;
    if (!chapter || chapter < 1 || chapter > book.chapters) {
      throw new Error(copy.missingChapter(chapter));
    }

    const canonPath = `${editionPath()}/${book.id}/${chapter}`;
    setCanonical(route.verse ? `${canonPath}/${route.verse}` : canonPath);

    const nice = `/czytaj/${book.id}/${chapter}${route.verse ? `/${route.verse}` : ""}`;
    if (location.pathname !== nice) {
      history.replaceState(null, "", nice);
    }

    const res = await fetch(`${canonPath}.json`);
    if (!res.ok) throw new Error(copy.loadFailed);
    const data = await res.json();

    const est = estimateMinutesFromVerses(data.verses);
    const timeEl = document.getElementById("read-time");
    timeEl.hidden = false;
    timeEl.textContent = `${copy.readingEta} · ${copy.etaMinutes(est.minutes)}`;

    document.getElementById("running").innerHTML = `
      <span>${chapterLabel(chapter)}</span>
      <span>${book.short}</span>
      <span>${editionLabel()}</span>`;
    document.getElementById("chap-heading").textContent = `${copy.chapterWord} ${toRoman(chapter)}`;
    document.getElementById("chap-book").textContent = book.name;

    selectedVerse = route.verse;
    const wrapWords = editionSupportsAudio();
    versesEl.innerHTML = data.verses
      .map((v) => {
        const sel = selectedVerse === v.n ? " is-sel" : "";
        return `<li data-v="${v.n}" class="${sel.trim()}"><span class="n">${v.n}</span>${verseHtml(v.t, wrapWords)}</li>`;
      })
      .join("");

    const nav = document.getElementById("folio-nav");
    const prev =
      chapter > 1
        ? `<a class="tablet ital" href="/czytaj/${book.id}/${chapter - 1}">← Cap. ${toRoman(chapter - 1)}</a>`
        : `<span></span>`;
    const next =
      chapter < book.chapters
        ? `<a class="tablet ital" href="/czytaj/${book.id}/${chapter + 1}">Cap. ${toRoman(chapter + 1)} →</a>`
        : nextBookLink(books, book);
    nav.innerHTML = prev + next;

    if (selectedVerse) {
      const el = versesEl.querySelector(`li[data-v="${selectedVerse}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    window.__reader = { book, chapter, data, books };
    updateMarkReadUi(book.id, chapter, books);

    audioControls.hidden = true;
    audioStopBtn.hidden = true;
    if (!editionSupportsAudio()) {
      pendingAudioAutoplay = false;
      if (audioPlayer.current().bookId) audioPlayer.stop();
    } else {
      const hasAudio = await chapterHasAudio(book.id, chapter);
      audioControls.hidden = !hasAudio;
      audioPlayBtn.textContent = t(edition).audioListen;
      audioStopBtn.textContent = t(edition).audioStop;
      audioStopBtn.hidden = !audioPlayer.current().playing;

      if (pendingAudioAutoplay && hasAudio) {
        pendingAudioAutoplay = false;
        const mode = audioMode === "plan" || audioMode === "beyond" ? audioMode : "beyond";
        playChapterAudio(book.id, chapter, mode).catch(() => flash(t(edition).audioUnavailable));
      } else {
        pendingAudioAutoplay = false;
      }
    }
  } catch (e) {
    versesEl.innerHTML = `<li class="error-box">${e.message}</li>`;
    document.getElementById("folio-nav").innerHTML = "";
    document.getElementById("read-time").hidden = true;
    document.getElementById("chapter-done").hidden = true;
    audioControls.hidden = true;
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

function syncNotifyPermissionUi() {
  const blocked = document.getElementById("notify-blocked");
  const hint = document.getElementById("notify-hint");
  const wanted = document.getElementById("plan-notify-on").checked;
  const pc = planCopy(edition);
  if (!("Notification" in window)) {
    blocked.hidden = true;
    hint.textContent = pc.notifyUnsupported;
    return;
  }
  if (wanted && Notification.permission === "denied") {
    blocked.hidden = false;
    hint.textContent = pc.notifyBlockedWanted;
  } else {
    blocked.hidden = true;
    hint.textContent = pc.notifyHint;
  }
}

async function maybeNotifyStart(books) {
  plan = loadPlan();
  if (!notificationsWanted(plan)) return;
  if (plan.startNotifiedDay === todayKey()) return;
  if (isDailyPlanComplete(plan)) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const asg = todayAssignment(books, plan, toRoman);
  if (!asg || asg.done || asg.started) return;
  const ok = await notifyStartReading(asg, t(edition));
  if (ok) {
    plan.startNotifiedDay = todayKey();
    savePlan(plan);
  }
}

async function renderHome() {
  if (!edition) return renderPick();
  applyTheme();
  show("home");
  setCanonical("/");
  const copy = t(edition);
  document.getElementById("home-eyebrow").textContent = copy.homeEyebrow;
  document.getElementById("home-title").textContent = copy.homeTitle;
  document.getElementById("home-sub").innerHTML = copy.homeSub;
  document.getElementById("home-meta").textContent = copy.homeMeta;
  document.getElementById("home-colophon").textContent = copy.homeColophon;
  document.getElementById("home-books").textContent = copy.booksLink;
  document.getElementById("home-plan").textContent = copy.planLink;
  document.getElementById("home-change-edition").textContent = copy.changeEdition;

  const cta = document.getElementById("home-read-cta");
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

  const dlWrap = document.getElementById("home-audio-download-wrap");
  const dlBtn = document.getElementById("home-audio-download");
  const dlStatus = document.getElementById("home-audio-download-status");
  if (dlWrap) {
    dlWrap.hidden = !editionSupportsAudio();
    if (editionSupportsAudio()) {
      dlBtn.textContent = copy.audioDownload;
      const clearBtn = document.getElementById("home-audio-clear");
      if (clearBtn) clearBtn.textContent = copy.audioClear;
      refreshAudioDownloadStatus(dlStatus, copy).catch(() => {});
    }
  }

  try {
    const books = await loadBooks();
    plan = loadPlan();
    if (plan.enabled) {
      await maybeNotifyStart(books);
      const asg = todayAssignment(books, plan, toRoman);
      if (asg && !asg.done) {
        setStartCta(cta, asg);
        return;
      }
      if (asg?.done) {
        const next = nextMarkTarget(books, plan);
        cta.href = next
          ? `/czytaj/${next.book}/${next.chapter}`
          : `/czytaj/${DEFAULT_READ.book}/${DEFAULT_READ.chapter}`;
        cta.innerHTML = `<span class="cta-main">${copy.planDone}</span><span class="cta-sub">${copy.readOn}</span>`;
        return;
      }
    }
  } catch {
    /* ignore */
  }
  setStartCta(cta, null);
}

function fillBookSelects(books) {
  const from = document.getElementById("plan-from-book");
  const to = document.getElementById("plan-to-book");
  const opts = books
    .map((b) => `<option value="${b.id}">${b.short} — ${b.name}</option>`)
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
  show("plan");
  setCanonical("/plan");
  const books = await loadBooks();
  fillBookSelects(books);
  plan = loadPlan();
  const pc = planCopy(edition);
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

  document.getElementById("plan-enabled").checked = !!plan.enabled;
  document.querySelector(`input[name="goal"][value="${plan.goal}"]`).checked = true;
  document.querySelector(`input[name="mode"][value="${plan.mode}"]`).checked = true;
  document.getElementById("plan-from-book").value = plan.fromBook;
  document.getElementById("plan-to-book").value = plan.toBook;
  document.getElementById("plan-from-ch").value = plan.fromChapter;
  document.getElementById("plan-to-ch").value = plan.toChapter;
  document.getElementById("plan-chapters").value = plan.chaptersPerDay;
  document.getElementById("plan-minutes").value = plan.minutesPerDay;
  if (plan.notifications) {
    document.getElementById("plan-notify-on").checked = true;
  } else {
    document.getElementById("plan-notify-off").checked = true;
  }
  syncPlanFormUi();

  const cont = document.getElementById("plan-continue");
  if (plan.enabled) {
    const asg = todayAssignment(books, plan, toRoman);
    if (asg && !asg.done) {
      setStartCta(cont, asg);
      cont.hidden = false;
    } else if (asg?.done) {
      const next = nextMarkTarget(books, plan);
      cont.hidden = !next;
      if (next) {
        cont.href = `/czytaj/${next.book}/${next.chapter}`;
        cont.innerHTML = `<span class="cta-main">${pc.planDone}</span><span class="cta-sub">${pc.readOn}</span>`;
      }
    } else {
      cont.hidden = true;
    }
  } else {
    setStartCta(cont, null);
    cont.hidden = false;
  }
}

async function route() {
  refreshPlanBanner();
  const r = parseRoute(location.pathname);
  if (!edition && r.name !== "pick") return renderPick();
  if (r.name === "pick") return renderPick();
  if (r.name === "books") return renderBooks();
  if (r.name === "reader") return renderReader(r);
  if (r.name === "plan") return renderPlan();
  return renderHome();
}

document.getElementById("verses").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-v]");
  if (!li) return;
  const ctx = window.__reader;
  if (!ctx) return;
  const n = Number(li.dataset.v);
  selectedVerse = n;
  document.querySelectorAll("#verses li").forEach((x) => x.classList.remove("is-sel"));
  li.classList.add("is-sel");
  const path = `/czytaj/${ctx.book.id}/${ctx.chapter}/${n}`;
  history.replaceState(null, "", path);
  setCanonical(`${editionPath()}/${ctx.book.id}/${ctx.chapter}/${n}`);
});

document.getElementById("mark-read-btn").addEventListener("click", async () => {
  const ctx = window.__reader;
  if (!ctx || !plan.enabled) return;
  const result = markChapterRead(plan, ctx.book.id, ctx.chapter, ctx.books);
  plan = result.plan;
  if (result.kind === "already" || result.kind === "off" || result.kind === "skip") return;
  plan = advanceCursor(plan, ctx.books);
  updateMarkReadUi(ctx.book.id, ctx.chapter, ctx.books);
  refreshPlanBanner();
  const pct = progressPct(plan);
  const copy = t(edition);
  if (result.kind === "extra") {
    flash(copy.beyondPlan);
    return;
  }
  if (notificationsWanted(plan)) await notifyProgress(pct, copy);
  if (pct >= 100) flash(copy.planFinished);
  else flash(copy.planPct(pct));
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

const planForm = document.getElementById("plan-form");
planForm.addEventListener("change", syncPlanFormUi);
planForm.addEventListener("input", syncPlanFormUi);
planForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(planForm);
  plan = loadPlan();
  plan.enabled = document.getElementById("plan-enabled").checked;
  plan.goal = fd.get("goal") || "bible";
  plan.mode = fd.get("mode") || "chapters";
  plan.fromBook = fd.get("fromBook") || "01-gen";
  plan.toBook = fd.get("toBook") || "66-apo";
  plan.fromChapter = Number(fd.get("fromChapter")) || 1;
  plan.toChapter = Number(fd.get("toChapter")) || 1;
  plan.chaptersPerDay = Number(fd.get("chaptersPerDay")) || 3;
  plan.minutesPerDay = Number(fd.get("minutesPerDay")) || 15;
  plan.notifications = fd.get("notifications") === "on";
  plan.cursor = 0;

  const pc = planCopy(edition);
  if (plan.notifications) {
    const perm = await ensureNotifyPermission();
    if (perm === "denied") {
      // Preferencja zostaje „włączone”, ale UI pokaże instrukcję odblokowania.
      flash(pc.notifyDeniedFlash);
    } else if (perm === "unsupported") {
      plan.notifications = false;
      flash(pc.notifyUnsupportedFlash);
    }
  }

  savePlan(plan);
  refreshPlanBanner();
  flash(plan.enabled ? pc.planSaved(quotaPreview(plan, pc)) : pc.planDisabled);
  renderPlan();
});

function askConfirm(title, body) {
  const overlay = document.getElementById("confirm-overlay");
  const titleEl = document.getElementById("confirm-title");
  const bodyEl = document.getElementById("confirm-body");
  const okBtn = document.getElementById("confirm-ok");
  const cancelBtn = document.getElementById("confirm-cancel");
  const copy = t(edition);
  titleEl.textContent = title;
  bodyEl.textContent = body;
  okBtn.textContent = copy.confirmOk;
  cancelBtn.textContent = copy.confirmCancel;
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

document.getElementById("plan-reset-progress").addEventListener("click", async () => {
  const pc = planCopy(edition);
  const ok = await askConfirm(pc.resetProgressTitle, pc.resetProgressBody);
  if (!ok) return;
  plan = resetPlanProgress(loadPlan());
  refreshPlanBanner();
  flash(pc.progressResetFlash);
  renderPlan();
});

document.getElementById("plan-reset-all").addEventListener("click", async () => {
  const pc = planCopy(edition);
  const ok = await askConfirm(pc.resetAllTitle, pc.resetAllBody);
  if (!ok) return;
  plan = resetPlanAll();
  refreshPlanBanner();
  flash(pc.planDefaultsFlash);
  renderPlan();
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

async function refreshAudioDownloadStatus(el, copy) {
  if (!el) return;
  try {
    const cat = await loadAudioCatalog();
    const n = await countCachedChapters(cat);
    const total = cat.count || cat.chapters.length;
    if (n <= 0) {
      el.textContent = copy.audioDownloadHint;
    } else if (n >= total) {
      el.textContent = copy.audioDownloadDone(total);
    } else {
      el.textContent = copy.audioDownloadPartial(n, total);
    }
  } catch {
    el.textContent = copy.audioDownloadHint;
  }
}

document.getElementById("home-audio-download")?.addEventListener("click", async () => {
  if (!editionSupportsAudio()) return;
  const copy = t(edition);
  const dlBtn = document.getElementById("home-audio-download");
  const dlStatus = document.getElementById("home-audio-download-status");
  const clearBtn = document.getElementById("home-audio-clear");

  if (audioDownloadAbort) {
    audioDownloadAbort.abort();
    await abortAudioDownload();
    audioDownloadAbort = null;
    dlBtn.textContent = copy.audioDownload;
    return;
  }

  audioDownloadAbort = new AbortController();
  dlBtn.textContent = copy.audioDownloadCancel;
  const meter = document.getElementById("home-audio-dl-meter");
  const fill = document.getElementById("home-audio-dl-fill");
  if (meter) meter.hidden = false;
  if (fill) fill.style.width = "0%";

  const formatEta = (etaSec) => {
    if (etaSec == null || !Number.isFinite(etaSec)) return copy.audioEtaUnknown;
    if (etaSec <= 0) return "";
    if (etaSec < 60) return copy.audioEtaSeconds(Math.max(1, Math.ceil(etaSec)));
    if (etaSec < 3600) return copy.audioEtaMinutes(Math.max(1, Math.ceil(etaSec / 60)));
    return copy.audioEtaHours(Math.max(1, Math.ceil(etaSec / 3600)));
  };

  dlStatus.textContent = supportsBackgroundFetch()
    ? copy.audioDownloadSystemHint
    : copy.audioDownloadProgress(0, "…", 0, copy.audioEtaUnknown);

  try {
    await ensureAudioServiceWorker();
    await downloadAllAudio(
      ({ done, total, pct, etaSec }) => {
        const p = pct ?? (total ? Math.round((done / total) * 100) : 0);
        if (fill) fill.style.width = `${p}%`;
        dlStatus.textContent = copy.audioDownloadProgress(
          done,
          total,
          p,
          formatEta(etaSec)
        );
      },
      {
        signal: audioDownloadAbort.signal,
        title: copy.audioDownloadNotifyTitle,
        formatEta,
      }
    );
    if (fill) fill.style.width = "100%";
    flash(copy.audioDownloadFinished);
    await refreshAudioDownloadStatus(dlStatus, copy);
  } catch (e) {
    if (e?.name === "AbortError" || e?.message === "aborted") {
      dlStatus.textContent = copy.audioDownloadHint;
    } else {
      flash(copy.audioDownloadFailed);
      console.error(e);
    }
  } finally {
    audioDownloadAbort = null;
    dlBtn.textContent = copy.audioDownload;
    if (meter) meter.hidden = true;
    if (fill) fill.style.width = "0%";
    if (clearBtn) clearBtn.hidden = false;
  }
});

document.getElementById("home-audio-clear")?.addEventListener("click", async () => {
  const copy = t(edition);
  await clearDownloadedAudio();
  flash(copy.audioCleared);
  await refreshAudioDownloadStatus(document.getElementById("home-audio-download-status"), copy);
});

audioPlayBtn.addEventListener("click", async () => {
  if (!editionSupportsAudio()) return;
  const ctx = window.__reader;
  if (!ctx) return;
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
  const mode = plan.enabled && !isDailyPlanComplete(plan) ? "plan" : "beyond";
  try {
    await playChapterAudio(ctx.book.id, ctx.chapter, mode);
  } catch {
    flash(t(edition).audioUnavailable);
  }
});

audioStopBtn.addEventListener("click", () => {
  audioMode = "idle";
  audioPlayer.stop();
});

audioBarToggle.addEventListener("click", async () => {
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

if ("serviceWorker" in navigator && !isDevHost()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

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

refreshPlanBanner();
route();

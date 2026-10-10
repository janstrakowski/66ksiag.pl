import {
  loadPlan,
  savePlan,
  estimateMinutesFromVerses,
  progressPct,
  markChapterRead,
  isChapterReadToday,
  isExtraCredit,
  nextUnreadInGoal,
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

const EDITION = "/bg/1879";
const DEFAULT_READ = { book: "01-gen", chapter: 1, verse: 1 };

const screens = [...document.querySelectorAll(".screen")];
const shell = document.getElementById("shell");
const toastEl = document.getElementById("toast");
const canonical = document.getElementById("canonical");
const planBanner = document.getElementById("plan-banner");
const planBannerPct = document.getElementById("plan-banner-pct");

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
  return `Rozd. ${toRoman(n)}`;
}

async function loadBooks() {
  if (booksCache) return booksCache;
  const res = await fetch(`${EDITION}/books.json`);
  if (!res.ok) throw new Error("Nie udało się wczytać books.json");
  const data = await res.json();
  booksCache = data.books;
  return booksCache;
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

function verseHtml(t) {
  return t
    .split(/(<\/?i>)/i)
    .map((part) => {
      if (/^<\/?i>$/i.test(part)) return part.toLowerCase();
      return part
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    })
    .join("");
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
  planBannerPct.textContent = String(pct);
  planBanner.hidden = false;
  document.body.classList.add("has-plan-banner");
}

function parseRoute(pathname) {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);

  if (parts.length === 0) return { name: "home" };
  if (parts[0] === "ksiegi") return { name: "books" };
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
  show("books");
  setCanonical("/ksiegi");
  const root = document.getElementById("book-list-root");
  try {
    const books = await loadBooks();
    const st = books.filter((b) => b.testament === "st");
    const nt = books.filter((b) => b.testament === "nt");
    root.innerHTML =
      sectionList("Starego Przymierza", st) +
      sectionList("Nowego Przymierza", nt);
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

function updateMarkReadUi(bookId, chapter) {
  const wrap = document.getElementById("chapter-done");
  const btn = document.getElementById("mark-read-btn");
  if (!plan.enabled) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  wrap.classList.remove("is-done", "is-extra", "is-extra-action");

  if (isChapterReadToday(plan, bookId, chapter)) {
    wrap.classList.add("is-done");
    if (isExtraCredit(plan, bookId, chapter)) {
      wrap.classList.add("is-extra");
      btn.textContent = "Zaliczone ponad plan";
    } else {
      btn.textContent = "Zaliczone do dziennego planu";
    }
    return;
  }

  if (isDailyPlanComplete(plan)) {
    wrap.classList.add("is-extra-action");
    btn.textContent = "Zalicz ponad plan";
  } else {
    btn.textContent = "Oznacz rozdział jako przeczytany";
  }
}

async function renderReader(route) {
  show("reader");
  const versesEl = document.getElementById("verses");
  versesEl.innerHTML = `<li class="error-box">Ładowanie…</li>`;

  try {
    const books = await loadBooks();
    const book = resolveBook(books, route.bookKey);
    if (!book) throw new Error(`Nieznana księga: ${route.bookKey}`);

    const chapter = route.chapter;
    if (!chapter || chapter < 1 || chapter > book.chapters) {
      throw new Error(`Brak rozdziału ${chapter}`);
    }

    const canonPath = `${EDITION}/${book.id}/${chapter}`;
    setCanonical(route.verse ? `${canonPath}/${route.verse}` : canonPath);

    const nice = `/czytaj/${book.id}/${chapter}${route.verse ? `/${route.verse}` : ""}`;
    if (location.pathname !== nice) {
      history.replaceState(null, "", nice);
    }

    const res = await fetch(`${canonPath}.json`);
    if (!res.ok) throw new Error("Nie udało się wczytać rozdziału");
    const data = await res.json();

    const est = estimateMinutesFromVerses(data.verses);
    const timeEl = document.getElementById("read-time");
    timeEl.hidden = false;
    timeEl.textContent = `Czytanie · ${est.label}`;

    document.getElementById("running").innerHTML = `
      <span>${chapterLabel(chapter)}</span>
      <span>${book.short}</span>
      <span>BG 1879</span>`;
    document.getElementById("chap-heading").textContent = `Rozdział ${toRoman(chapter)}`;
    document.getElementById("chap-book").textContent = book.name;

    selectedVerse = route.verse;
    versesEl.innerHTML = data.verses
      .map((v) => {
        const sel = selectedVerse === v.n ? " is-sel" : "";
        return `<li data-v="${v.n}" class="${sel.trim()}"><span class="n">${v.n}</span>${verseHtml(v.t)}</li>`;
      })
      .join("");

    const nav = document.getElementById("folio-nav");
    const prev =
      chapter > 1
        ? `<a class="tablet ital" href="/czytaj/${book.id}/${chapter - 1}">← Cap. ${toRoman(chapter - 1)}</a>`
        : `<span></span>`;
    const next =
      chapter < book.chapters
        ? `<a class="tablet ital" data-mark-prev href="/czytaj/${book.id}/${chapter + 1}">Cap. ${toRoman(chapter + 1)} →</a>`
        : nextBookLink(books, book);
    nav.innerHTML = prev + next;

    if (selectedVerse) {
      const el = versesEl.querySelector(`li[data-v="${selectedVerse}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    window.__reader = { book, chapter, data, books };
    updateMarkReadUi(book.id, chapter);
  } catch (e) {
    versesEl.innerHTML = `<li class="error-box">${e.message}</li>`;
    document.getElementById("folio-nav").innerHTML = "";
    document.getElementById("read-time").hidden = true;
    document.getElementById("chapter-done").hidden = true;
  }
}

function nextBookLink(books, book) {
  const i = books.findIndex((b) => b.id === book.id);
  if (i < 0 || i >= books.length - 1) return `<span></span>`;
  const n = books[i + 1];
  return `<a class="tablet ital" data-mark-prev href="/czytaj/${n.id}/1">${n.short} →</a>`;
}

function setStartCta(el, assignment) {
  if (!assignment || assignment.done) {
    el.href = `/czytaj/${DEFAULT_READ.book}/${DEFAULT_READ.chapter}`;
    el.innerHTML = `<span class="cta-main">Zacznij czytać</span><span class="cta-sub">Rodzaju I</span>`;
    return;
  }
  el.href = assignment.href;
  const verb = assignment.started ? "Kontynuuj" : "Zacznij czytać";
  el.innerHTML = `<span class="cta-main">${verb}</span><span class="cta-sub">${assignment.minutes}&nbsp;min · ${assignment.range}</span>`;
}

function notificationsWanted(p = plan) {
  return !!(p.enabled && p.notifications);
}

function syncNotifyPermissionUi() {
  const blocked = document.getElementById("notify-blocked");
  const hint = document.getElementById("notify-hint");
  const wanted = document.getElementById("plan-notify-on").checked;
  if (!("Notification" in window)) {
    blocked.hidden = true;
    hint.textContent = "Ta przeglądarka nie obsługuje powiadomień systemowych.";
    return;
  }
  if (wanted && Notification.permission === "denied") {
    blocked.hidden = false;
    hint.textContent = "Włączone w planie, ale zablokowane przez przeglądarkę.";
  } else {
    blocked.hidden = true;
    hint.textContent = "Przypomnienie „Zacznij czytać…” oraz postęp „Przeczytałeś …%”.";
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
  const ok = await notifyStartReading(asg);
  if (ok) {
    plan.startNotifiedDay = todayKey();
    savePlan(plan);
  }
}

async function renderHome() {
  show("home");
  setCanonical("/");
  const cta = document.getElementById("home-read-cta");
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
        const next = nextUnreadInGoal(books, plan);
        cta.href = next
          ? `/czytaj/${next.book}/${next.chapter}`
          : `/czytaj/${DEFAULT_READ.book}/${DEFAULT_READ.chapter}`;
        cta.innerHTML = `<span class="cta-main">Plan na dziś ukończony</span><span class="cta-sub">Czytaj dalej</span>`;
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
  document.getElementById("plan-preview").textContent = quotaPreview(draft);
  syncNotifyPermissionUi();
}

async function renderPlan() {
  show("plan");
  setCanonical("/plan");
  const books = await loadBooks();
  fillBookSelects(books);
  plan = loadPlan();

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
      const next = nextUnreadInGoal(books, plan);
      cont.hidden = !next;
      if (next) {
        cont.href = `/czytaj/${next.book}/${next.chapter}`;
        cont.innerHTML = `<span class="cta-main">Plan na dziś ukończony</span><span class="cta-sub">Czytaj dalej</span>`;
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
  setCanonical(`${EDITION}/${ctx.book.id}/${ctx.chapter}/${n}`);
});

document.getElementById("mark-read-btn").addEventListener("click", async () => {
  const ctx = window.__reader;
  if (!ctx || !plan.enabled) return;
  const result = markChapterRead(plan, ctx.book.id, ctx.chapter);
  plan = result.plan;
  if (result.kind === "already" || result.kind === "off") return;
  plan = advanceCursor(plan, ctx.books);
  updateMarkReadUi(ctx.book.id, ctx.chapter);
  refreshPlanBanner();
  const pct = progressPct(plan);
  if (result.kind === "extra") {
    flash("Ponad plan");
    return;
  }
  if (notificationsWanted(plan)) await notifyProgress(pct);
  if (pct >= 100) flash("Dzienny plan ukończony");
  else flash(`Plan · ${pct}%`);
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
  const text = `${ctx.book.short} ${ctx.chapter},${n} (BG 1879)\n${stripTags(verse.t)}\n${shortUrl}`;

  try {
    if (navigator.share) {
      await navigator.share({
        title: `${ctx.book.short} ${ctx.chapter},${n}`,
        text: stripTags(verse.t),
        url: shortUrl,
      });
    } else {
      await navigator.clipboard.writeText(text);
      flash(`Skopiowano · /${shortAlias}/${ctx.chapter}/${n}`);
    }
  } catch {
    flash("Anulowano");
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

  if (plan.notifications) {
    const perm = await ensureNotifyPermission();
    if (perm === "denied") {
      // Preferencja zostaje „włączone”, ale UI pokaże instrukcję odblokowania.
      flash("Powiadomienia zablokowane w przeglądarce");
    } else if (perm === "unsupported") {
      plan.notifications = false;
      flash("Przeglądarka nie obsługuje powiadomień");
    }
  }

  savePlan(plan);
  refreshPlanBanner();
  flash(plan.enabled ? `Plan zapisany · ${quotaPreview(plan)}` : "Plan wyłączony");
  renderPlan();
});

function askConfirm(title, body) {
  const overlay = document.getElementById("confirm-overlay");
  const titleEl = document.getElementById("confirm-title");
  const bodyEl = document.getElementById("confirm-body");
  const okBtn = document.getElementById("confirm-ok");
  const cancelBtn = document.getElementById("confirm-cancel");
  titleEl.textContent = title;
  bodyEl.textContent = body;
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
  const ok = await askConfirm(
    "Reset postępu",
    "Zresetować postęp planu? Dzisiejsze zaliczenia i pozycja wrócą na początek. Cel i limity zostaną."
  );
  if (!ok) return;
  plan = resetPlanProgress(loadPlan());
  refreshPlanBanner();
  flash("Postęp zresetowany");
  renderPlan();
});

document.getElementById("plan-reset-all").addEventListener("click", async () => {
  const ok = await askConfirm(
    "Przywróć domyślne",
    "Przywrócić domyślne ustawienia? To wyłączy plan i wyczyści cel, limity oraz powiadomienia."
  );
  if (!ok) return;
  plan = resetPlanAll();
  refreshPlanBanner();
  flash("Plan przywrócony do domyślnych");
  renderPlan();
});

window.addEventListener("popstate", () => route());
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin) return;
  if (a.hasAttribute("download")) return;

  // przy przejściu do następnego rozdziału — zalicz bieżący (plan lub ponad plan)
  if (a.hasAttribute("data-mark-prev") && plan.enabled && window.__reader) {
    const ctx = window.__reader;
    if (!isChapterReadToday(plan, ctx.book.id, ctx.chapter)) {
      const result = markChapterRead(plan, ctx.book.id, ctx.chapter);
      plan = result.plan;
      plan = advanceCursor(plan, ctx.books);
      if (result.kind === "plan" && notificationsWanted(plan)) {
        notifyProgress(progressPct(plan));
      }
    }
  }

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

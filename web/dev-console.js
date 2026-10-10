/**
 * Konsola testowa — montowana wyłącznie gdy isDevHost().
 * Symulacje ścieżek planu, nawigacji i stanu localStorage.
 */
import { isDevHost } from "./dev-host.js";
import {
  loadPlan,
  savePlan,
  defaultPlan,
  todayKey,
  buildChapterList,
  dailyQuota,
  progressPct,
} from "./plan.js";

const SCENARIOS = [
  {
    id: "fresh-off",
    label: "Bez planu",
    desc: "Plan wyłączony, czysty stan",
    apply: () => defaultPlan(),
  },
  {
    id: "start-bible",
    label: "Start · cała Biblia",
    desc: "3 rozdz./dzień, 0%, powiadomienia off",
    apply: () => ({
      ...defaultPlan(),
      enabled: true,
      goal: "bible",
      mode: "chapters",
      chaptersPerDay: 3,
      notifications: false,
      cursor: 0,
      readToday: [],
    }),
  },
  {
    id: "start-nt-notify",
    label: "Start · NT + powiadomienia",
    desc: "Nowy Testament, powiadomienia włączone",
    apply: () => ({
      ...defaultPlan(),
      enabled: true,
      goal: "nt",
      mode: "chapters",
      chaptersPerDay: 2,
      notifications: true,
      cursor: 0,
      readToday: [],
      startNotifiedDay: null,
    }),
  },
  {
    id: "mid-plan",
    label: "W trakcie (≈50%)",
    desc: "Połowa dziennej quoty zaliczona",
    apply: (books) => withProgress(basePlan(), 0.5, 0, books),
  },
  {
    id: "done-plan",
    label: "Plan ukończony (100%)",
    desc: "Quota wypełniona, bez ponadprogramowych",
    apply: (books) => withProgress(basePlan(), 1, 0, books),
  },
  {
    id: "extra",
    label: "Ponad plan",
    desc: "100% + 2 rozdziały extra",
    apply: (books) => withProgress(basePlan(), 1, 2, books),
  },
  {
    id: "time-mode",
    label: "Tryb czasowy · 15 min",
    desc: "Cel ST, mode=time",
    apply: () => ({
      ...defaultPlan(),
      enabled: true,
      goal: "st",
      mode: "time",
      minutesPerDay: 15,
      notifications: false,
      cursor: 0,
      readToday: [],
    }),
  },
  {
    id: "range-psalms",
    label: "Zakres · Psalmy",
    desc: "Ps 1–10, 2 rozdz./dzień",
    apply: () => ({
      ...defaultPlan(),
      enabled: true,
      goal: "range",
      fromBook: "19-psa",
      fromChapter: 1,
      toBook: "19-psa",
      toChapter: 10,
      mode: "chapters",
      chaptersPerDay: 2,
      cursor: 0,
      readToday: [],
    }),
  },
  {
    id: "new-day",
    label: "Symuluj nowy dzień",
    desc: "Zachowaj ustawienia, wyzeruj dzisiejszy postęp",
    apply: () => {
      const p = loadPlan();
      return {
        ...p,
        day: todayKey(),
        readToday: [],
        startNotifiedDay: null,
      };
    },
  },
];

function basePlan() {
  return {
    ...defaultPlan(),
    enabled: true,
    goal: "bible",
    mode: "chapters",
    chaptersPerDay: 4,
    notifications: false,
    cursor: 0,
    readToday: [],
  };
}

function withProgress(plan, fraction, extra, books) {
  const list = buildChapterList(books, plan);
  const q = dailyQuota(plan);
  const n = Math.max(0, Math.min(list.length, Math.round(q * fraction)));
  const total = Math.min(list.length, n + extra);
  const readToday = list.slice(0, total);
  return {
    ...plan,
    day: todayKey(),
    readToday,
    cursor: Math.min(readToday.length, list.length - 1),
    startNotifiedDay: fraction > 0 ? todayKey() : null,
  };
}

async function loadBooks() {
  const res = await fetch("/bg/1879/books.json");
  if (!res.ok) throw new Error("books.json");
  const data = await res.json();
  return data.books;
}

function go(path) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function refreshApp() {
  if (typeof window.__ksiagDev?.refresh === "function") {
    window.__ksiagDev.refresh();
  } else {
    location.reload();
  }
}

export async function mountDevConsole() {
  if (!isDevHost()) return;

  const style = document.createElement("style");
  style.textContent = `
    .dev-fab {
      position: fixed; top: 0.55rem; right: 0.55rem; z-index: 80;
      font: 600 0.58rem Cinzel, serif; letter-spacing: 0.12em; text-transform: uppercase;
      background: #100c09; color: #e4d7bc; border: 1px solid #e4d7bc;
      padding: 0.35rem 0.55rem; cursor: pointer;
    }
    .dev-panel {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 90;
      width: min(100%, 22rem); overflow: auto;
      background: #e4d7bc; color: #100c09;
      border-left: 2px solid #100c09;
      padding: 0.75rem 0.85rem 1.5rem;
      font-family: Cardo, serif; font-size: 0.95rem;
      box-shadow: -8px 0 24px rgba(16,12,9,0.25);
    }
    .dev-panel[hidden] { display: none !important; }
    .dev-panel h2 {
      margin: 0 1.8rem 0.35rem 0;
      font-family: Cinzel, serif; font-size: 0.65rem;
      letter-spacing: 0.16em; text-transform: uppercase;
    }
    .dev-panel .dev-close {
      position: absolute; top: 0.55rem; right: 0.55rem;
      border: 0; background: none; font: inherit; cursor: pointer;
      text-decoration: underline; font-style: italic; color: #2c241d;
    }
    .dev-panel .dev-note {
      margin: 0 0 0.75rem; font-size: 0.8rem; font-style: italic; color: #5a4d40;
    }
    .dev-panel section { margin: 0.85rem 0; }
    .dev-panel section h3 {
      margin: 0 0 0.4rem;
      font-family: Cinzel, serif; font-size: 0.55rem;
      letter-spacing: 0.14em; text-transform: uppercase; color: #5a4d40;
    }
    .dev-panel button, .dev-panel select {
      display: block; width: 100%; margin: 0.25rem 0;
      font: inherit; text-align: left;
      background: color-mix(in srgb, #e4d7bc 70%, #cfc0a4);
      border: 1px solid #100c09; color: #100c09;
      padding: 0.4rem 0.5rem; cursor: pointer;
    }
    .dev-panel button:hover { background: #100c09; color: #e4d7bc; }
    .dev-panel .dev-status {
      font-size: 0.82rem; line-height: 1.35;
      padding: 0.45rem 0.5rem; border: 1px dashed color-mix(in srgb, #100c09 40%, transparent);
      white-space: pre-wrap; word-break: break-word;
    }
    .dev-panel .dev-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; }
  `;
  document.head.appendChild(style);

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "dev-fab";
  fab.textContent = "Dev";
  fab.title = "Konsola testowa (tylko localhost)";

  const panel = document.createElement("aside");
  panel.className = "dev-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <button type="button" class="dev-close" id="dev-close">zamknij</button>
    <h2>Konsola testowa</h2>
    <p class="dev-note">Aktywna tylko na localhost. Produkcja jej nie montuje.</p>
    <section>
      <h3>Stan planu</h3>
      <pre class="dev-status" id="dev-status">…</pre>
    </section>
    <section>
      <h3>Scenariusze</h3>
      <div id="dev-scenarios"></div>
    </section>
    <section>
      <h3>Nawigacja</h3>
      <div class="dev-row">
        <button type="button" data-go="/">Home</button>
        <button type="button" data-go="/ksiegi">Spis</button>
        <button type="button" data-go="/plan">Plan</button>
        <button type="button" data-go="/czytaj/01-gen/1">Rdz I</button>
        <button type="button" data-go="/czytaj/43-joh/3/16">J 3,16</button>
        <button type="button" data-go="/czytaj/19-psa/1">Ps I</button>
      </div>
    </section>
    <section>
      <h3>Szybkie akcje</h3>
      <button type="button" id="dev-mark-one">+1 zaliczenie (bieżący / następny)</button>
      <button type="button" id="dev-clear-ls">Wyczyść localStorage planu</button>
      <button type="button" id="dev-reload">Odśwież UI</button>
    </section>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  const statusEl = panel.querySelector("#dev-status");
  const scenariosEl = panel.querySelector("#dev-scenarios");

  for (const s of SCENARIOS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = s.label;
    btn.title = s.desc;
    btn.addEventListener("click", async () => {
      try {
        const books = await loadBooks();
        const next = typeof s.apply === "function" ? s.apply(books) : s.apply;
        savePlan(next);
        refreshStatus();
        refreshApp();
      } catch (e) {
        statusEl.textContent = `Błąd: ${e.message}`;
      }
    });
    scenariosEl.appendChild(btn);
  }

  function refreshStatus() {
    const p = loadPlan();
    const pct = progressPct(p);
    statusEl.textContent = [
      `enabled: ${p.enabled}`,
      `goal: ${p.goal} · mode: ${p.mode}`,
      `quota/day: ${p.mode === "time" ? p.minutesPerDay + " min" : p.chaptersPerDay + " rozdz."}`,
      `notify: ${p.notifications}`,
      `day: ${p.day}`,
      `readToday: ${p.readToday.length} → ${pct ?? "—"}%`,
      `cursor: ${p.cursor}`,
      `keys: ${p.readToday.slice(0, 6).join(", ")}${p.readToday.length > 6 ? "…" : ""}`,
    ].join("\n");
  }

  fab.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) refreshStatus();
  });
  panel.querySelector("#dev-close").addEventListener("click", () => {
    panel.hidden = true;
  });

  panel.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      go(btn.getAttribute("data-go"));
      refreshStatus();
    });
  });

  panel.querySelector("#dev-reload").addEventListener("click", () => refreshApp());

  panel.querySelector("#dev-clear-ls").addEventListener("click", () => {
    savePlan(defaultPlan());
    refreshStatus();
    refreshApp();
  });

  panel.querySelector("#dev-mark-one").addEventListener("click", async () => {
    const books = await loadBooks();
    const p = loadPlan();
    if (!p.enabled) {
      statusEl.textContent = "Włącz plan (scenariusz) najpierw.";
      return;
    }
    const list = buildChapterList(books, p);
    const nextKey =
      list.find((k) => !p.readToday.includes(k)) ||
      list[Math.min(p.cursor, list.length - 1)];
    if (!nextKey) return;
    if (!p.readToday.includes(nextKey)) p.readToday.push(nextKey);
    p.cursor = Math.min(p.readToday.length, list.length - 1);
    savePlan(p);
    const [book, ch] = nextKey.split("/");
    go(`/czytaj/${book}/${ch}`);
    refreshStatus();
    refreshApp();
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refreshStatus();
    }
  });

  refreshStatus();
  console.info("[66ksiąg] Dev console: przycisk Dev lub Ctrl+Shift+D");
}

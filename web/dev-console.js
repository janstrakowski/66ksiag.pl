/**
 * Konsola testowa — montowana wyłącznie gdy isDevHost().
 * Szybka nawigacja po czytniku.
 */
import { isDevHost } from "./dev-host.js";

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
    .dev-panel button {
      display: block; width: 100%; margin: 0.25rem 0;
      font: inherit; text-align: left;
      background: color-mix(in srgb, #e4d7bc 70%, #cfc0a4);
      border: 1px solid #100c09; color: #100c09;
      padding: 0.4rem 0.5rem; cursor: pointer;
    }
    .dev-panel button:hover { background: #100c09; color: #e4d7bc; }
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
      <h3>Nawigacja</h3>
      <div class="dev-row">
        <button type="button" data-go="/">Home</button>
        <button type="button" data-go="/ksiegi">Spis</button>
        <button type="button" data-go="/czytaj/01-gen/1">Rdz I</button>
        <button type="button" data-go="/czytaj/43-joh/3/16">J 3,16</button>
        <button type="button" data-go="/czytaj/19-psa/1">Ps I</button>
      </div>
    </section>
    <section>
      <h3>Szybkie akcje</h3>
      <button type="button" id="dev-reload">Odśwież UI</button>
    </section>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  fab.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  panel.querySelector("#dev-close").addEventListener("click", () => {
    panel.hidden = true;
  });

  panel.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      go(btn.getAttribute("data-go"));
    });
  });

  panel.querySelector("#dev-reload").addEventListener("click", () => refreshApp());

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      panel.hidden = !panel.hidden;
    }
  });

  console.info("[66ksiąg] Dev console: przycisk Dev lub Ctrl+Shift+D");
}

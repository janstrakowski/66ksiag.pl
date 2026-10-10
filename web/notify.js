/** Systemowe powiadomienia (Notification API). Działa na localhost / HTTPS / TWA. */

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Zarejestruj SW od razu (nie czekaj na window.load). */
export async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      reg = await navigator.serviceWorker.register("/sw.js");
    }
    return await withTimeout(navigator.serviceWorker.ready, 4000);
  } catch {
    return (await navigator.serviceWorker.getRegistration()) || null;
  }
}

/**
 * W TWA z delegacją Chrome pokazuje „Notifications managed by 66ksiąg”.
 * Wtedy Notification.permission bywa „denied”, mimo że Android zezwala —
 * próbujemy faktycznie wysłać (probe).
 */
export async function effectiveNotifyPermission({ allowDelegatedProbe = false } = {}) {
  if (typeof Notification === "undefined") return "unsupported";
  await ensureServiceWorker();
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }
  // denied
  if (allowDelegatedProbe) {
    const delivered = await showSystemNotify("66ksiąg", "·", "ksiag-probe", "pl", {
      ignorePermissionGate: true,
      silent: true,
    });
    if (delivered) {
      try {
        const reg = await ensureServiceWorker();
        const list = await reg?.getNotifications?.({ tag: "ksiag-probe" });
        for (const n of list || []) n.close();
      } catch {
        /* ignore */
      }
      return "granted";
    }
  }
  return "denied";
}

export async function ensureNotifyPermission() {
  return effectiveNotifyPermission({ allowDelegatedProbe: false });
}

export async function showSystemNotify(
  title,
  body,
  tag = "ksiag-plan",
  lang = "pl",
  { ignorePermissionGate = false, silent = false } = {}
) {
  if (!("Notification" in window)) return false;
  if (!ignorePermissionGate && Notification.permission !== "granted") return false;

  const origin = typeof location !== "undefined" ? location.origin : "";
  const opts = {
    body,
    tag,
    renotify: !silent,
    silent: !!silent,
    icon: `${origin}/assets/icon-192.png`,
    badge: `${origin}/assets/icon-192.png`,
    lang,
  };
  if (!silent) opts.vibrate = [80, 40, 80];

  const reg = await ensureServiceWorker();
  if (reg?.showNotification) {
    try {
      await reg.showNotification(title, opts);
      return true;
    } catch {
      /* fallback */
    }
  }

  try {
    // eslint-disable-next-line no-new
    new Notification(title, opts);
    return true;
  } catch {
    return false;
  }
}

export async function notifyStartReading(assignment, ui) {
  if (!assignment || assignment.done) return false;
  const title = assignment.started
    ? ui?.continueRead || "Kontynuuj czytanie"
    : ui?.startRead || "Zacznij czytać";
  const body = ui?.minutesWithRange
    ? ui.minutesWithRange(assignment.minutes, assignment.range)
    : `${assignment.minutes} min · ${assignment.range}`;
  const ignore = Notification.permission !== "granted";
  return showSystemNotify(title, body, "ksiag-start", ui?.htmlLang || "pl", {
    ignorePermissionGate: ignore,
  });
}

export async function notifyProgress(pct, ui) {
  if (pct == null) return false;
  const lang = ui?.htmlLang || "pl";
  const ignore = Notification.permission !== "granted";
  if (pct >= 100) {
    return showSystemNotify(
      ui?.planNav || "Plan dzienny",
      ui?.planFinished || "Przeczytałeś 100% dziennego planu.",
      "ksiag-progress",
      lang,
      { ignorePermissionGate: ignore }
    );
  }
  const body = ui
    ? `${ui.bannerBefore}${pct}${ui.bannerAfter}`
    : `Przeczytałeś ${pct}% dziennego planu.`;
  return showSystemNotify(ui?.planNav || "Plan dzienny", body, "ksiag-progress", lang, {
    ignorePermissionGate: ignore,
  });
}

/** Potwierdzenie zaraz po włączeniu powiadomień w ustawieniach planu. */
export async function notifyEnabledConfirm(ui) {
  const ignore = Notification.permission !== "granted";
  return showSystemNotify(
    ui?.planNav || "Plan dzienny",
    ui?.notifyEnabledBody || "Powiadomienia włączone. Przypomnimy o czytaniu.",
    "ksiag-enabled",
    ui?.htmlLang || "pl",
    { ignorePermissionGate: ignore }
  );
}

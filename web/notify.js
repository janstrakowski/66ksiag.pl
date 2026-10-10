/** Systemowe powiadomienia (Notification API). Działa na localhost / HTTPS. */

export async function ensureNotifyPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

export async function showSystemNotify(title, body, tag = "ksiag-plan", lang = "pl") {
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;

  const opts = {
    body,
    tag,
    renotify: true,
    icon: "/assets/icon-192.png",
    lang,
  };

  try {
    if (navigator.serviceWorker?.ready) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
      return true;
    }
  } catch {
    /* fallback below */
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
  return showSystemNotify(title, body, "ksiag-start", ui?.htmlLang || "pl");
}

export async function notifyProgress(pct, ui) {
  if (pct == null) return false;
  const lang = ui?.htmlLang || "pl";
  if (pct >= 100) {
    return showSystemNotify(
      ui?.planNav || "Plan dzienny",
      ui?.planFinished || "Przeczytałeś 100% dziennego planu.",
      "ksiag-progress",
      lang
    );
  }
  const body = ui
    ? `${ui.bannerBefore}${pct}${ui.bannerAfter}`
    : `Przeczytałeś ${pct}% dziennego planu.`;
  return showSystemNotify(ui?.planNav || "Plan dzienny", body, "ksiag-progress", lang);
}

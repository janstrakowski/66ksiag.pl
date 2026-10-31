/** Systemowe powiadomienia (Notification API). Działa na localhost i HTTPS. */

/**
 * W starej otoczce TWA Notification.permission bywa „denied”, mimo że system
 * pozwala wysłać powiadomienie — próbujemy faktycznie je pokazać (probe).
 */
export async function effectiveNotifyPermission({ allowDelegatedProbe = false } = {}) {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }
  if (allowDelegatedProbe) {
    try {
      const probe = new Notification("66ksiąg", {
        body: "·",
        tag: "ksiag-probe",
        silent: true,
      });
      probe.close();
      return "granted";
    } catch {
      return "denied";
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

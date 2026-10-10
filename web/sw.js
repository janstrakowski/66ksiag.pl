/* Shell cache + Background Fetch (Scourby) → Cache Storage */
const CACHE = "ksiag-v11";
const AUDIO_CACHE = "ksiag-scourby-mp3-v1";
const SHELL = [
  "/",
  "/index.html",
  "/fonts.css",
  "/styles.css",
  "/app.js",
  "/plan.js",
  "/place.js",
  "/cloud.js",
  "/vendor/uqr.js",
  "/notify.js",
  "/editions.js",
  "/i18n.js",
  "/audio.js",
  "/audio-catalog.json",
  "/manifest.webmanifest",
  "/assets/orn-pair.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
];

async function broadcast(msg) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of list) c.postMessage(msg);
}

async function storeFetchedRecords(bg) {
  const cache = await caches.open(AUDIO_CACHE);
  const records = await bg.matchAll();
  let cached = 0;
  await Promise.all(
    records.map(async (record) => {
      try {
        const response = await Promise.race([
          record.responseReady,
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
        ]);
        if (response && response.ok) {
          await cache.put(record.request, response.clone());
          cached += 1;
        }
      } catch {
        /* skip failed or unfinished record */
      }
    })
  );
  return cached;
}

async function settleAudioFetch(event, ok) {
  const bg = event.registration;
  const fetchId = bg.id;
  const cached = await storeFetchedRecords(bg);

  try {
    const origin = self.location.origin;
    await event.updateUI({
      title: ok ? "66ksiąg · audio gotowe" : "66ksiąg · błąd pobierania",
      icons: [
        { src: `${origin}/assets/icon-192.png`, sizes: "192x192", type: "image/png" },
        { src: `${origin}/assets/icon-512.png`, sizes: "512x512", type: "image/png" },
      ],
    });
  } catch {
    /* ignore */
  }

  await broadcast(
    ok
      ? { type: "audio-download-done", fetchId, cached }
      : {
          type: "audio-download-fail",
          fetchId,
          reason: bg.failureReason || "failure",
        }
  );
}

self.addEventListener("backgroundfetchsuccess", (event) => {
  event.waitUntil(settleAudioFetch(event, true));
});

self.addEventListener("backgroundfetchfail", (event) => {
  event.waitUntil(settleAudioFetch(event, false));
});

self.addEventListener("backgroundfetchabort", (event) => {
  event.waitUntil(
    (async () => {
      const cached = await storeFetchedRecords(event.registration);
      await broadcast({
        type: "audio-download-fail",
        fetchId: event.registration.id,
        reason: "aborted",
        cached,
      });
    })()
  );
});

self.addEventListener("backgroundfetchclick", (event) => {
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== AUDIO_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // MP3 — Cache Storage z aplikacji / Background Fetch, nie shell precache
  if (url.pathname.endsWith(".mp3")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const net = await fetch(req);
        const cacheable =
          url.pathname.startsWith("/bg/") ||
          (url.pathname.startsWith("/kjv/") && !url.pathname.endsWith(".mp3")) ||
          SHELL.includes(url.pathname);
        if (net.ok && cacheable) {
          cache.put(req, net.clone());
        }
        return net;
      } catch {
        const hit = await cache.match(req);
        if (hit) return hit;
        if (req.mode === "navigate") {
          const shell = await cache.match("/index.html");
          if (shell) return shell;
        }
        throw new Error("offline");
      }
    })()
  );
});

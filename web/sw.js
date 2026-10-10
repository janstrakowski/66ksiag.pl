/* Shell cache + Background Fetch (Scourby) → Cache Storage */
const CACHE = "ksiag-v4";
const AUDIO_CACHE = "ksiag-scourby-mp3-v1";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/plan.js",
  "/notify.js",
  "/editions.js",
  "/i18n.js",
  "/audio.js",
  "/audio-catalog.json",
  "/manifest.webmanifest",
  "/assets/orn-pair.svg",
];

async function broadcast(msg) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of list) c.postMessage(msg);
}

async function settleAudioFetch(event, ok) {
  const bg = event.registration;
  const fetchId = bg.id;
  let cached = 0;
  if (ok) {
    const cache = await caches.open(AUDIO_CACHE);
    const records = await bg.matchAll();
    await Promise.all(
      records.map(async (record) => {
        try {
          const response = await record.responseReady;
          if (response && response.ok) {
            await cache.put(record.request, response.clone());
            cached += 1;
          }
        } catch {
          /* skip failed record */
        }
      })
    );
  }

  try {
    await event.updateUI({
      title: ok ? "KJV Audio · downloaded" : "KJV Audio · failed",
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
    broadcast({
      type: "audio-download-fail",
      fetchId: event.registration.id,
      reason: "aborted",
    })
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

/* Minimal SW: cache shell + visited chapters */
const CACHE = "ksiag-v2";
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
  "/manifest.webmanifest",
  "/assets/orn-pair.svg",
];

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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

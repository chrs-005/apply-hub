// Offline support: app shell is cached; data/*.json is network-first (falls back to cache).
const VERSION = "applyhub-v4";

// ---- push notifications (sent by the scanner on GitHub)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Apply Hub", {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag ? `${d.tag}-${Date.now()}` : undefined,
    data: { url: d.url || "./#today" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./#today", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (url.startsWith(self.registration.scope) && app) { await app.focus(); return app.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest",
               "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const networkFirst = url.pathname.includes("/data/") || url.pathname.endsWith(".js") ||
                       url.pathname.endsWith(".css") || url.pathname.endsWith("/") ||
                       url.pathname.endsWith(".html");
  if (networkFirst) {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});

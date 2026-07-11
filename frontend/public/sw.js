// JanNaadi service worker — enables PWA install ("Add to Home Screen") + light offline
// resilience. NETWORK-FIRST so citizens always get the latest app and live data; the
// cache is only a fallback when offline. Deliberately conservative for a civic app:
//   - never touches POST (complaint submissions always hit the network),
//   - never caches /api/* (rankings, submissions, config stay live),
//   - never touches cross-origin (Google Maps, fonts, Cloud APIs).
const CACHE = "jannaadi-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                              // complaint POSTs → always network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // Maps/fonts/CDN → untouched
  if (url.pathname.startsWith("/api/")) return;                  // API/data → always live
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
  );
});

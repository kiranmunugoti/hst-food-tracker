// HST service worker — offline shell + runtime caching.
// Bumping CACHE invalidates the old one on the next activation.
const CACHE = "hst-v5.4";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Never cache API calls or the shared database — they must stay fresh
  if (url.pathname.startsWith("/api/") || url.hostname.includes("githubusercontent")
      || url.hostname.includes("api.github.com")) return;

  // Navigations: network first so a new deploy is picked up, cache as fallback
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(request, copy)); return r; })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Static assets: cache first (Vite filenames are content-hashed)
  e.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(r => {
      if (r.ok && (url.origin === location.origin || url.hostname.includes("openfoodfacts"))) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(request, copy));
      }
      return r;
    }).catch(() => hit))
  );
});

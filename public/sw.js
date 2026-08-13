// HST service worker — offline shell + runtime caching.
// Bumping CACHE invalidates the old one on the next activation.
const CACHE = "hst-v8.0";
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

  // Never cache API traffic or the shared database — it must stay fresh.
  //
  // This deliberately includes the data sources. A previous version cached any
  // response whose hostname contained "openfoodfacts", cache-first and with no
  // expiry, which meant a single empty or unlucky search result was then served
  // from cache forever — a search that failed once appeared to fail permanently
  // and no amount of retrying could dislodge it. Product data is never cached
  // at this layer now; the app has its own session cache with its own rules.
  const isApi =
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("openfoodfacts") ||
    url.hostname.includes("openbeautyfacts") ||
    url.hostname.includes("nal.usda.gov") ||
    url.hostname.includes("githubusercontent") ||
    url.hostname.includes("api.github.com") ||
    url.hostname.includes("api.anthropic.com");
  if (isApi) return;

  // Navigations: network first, so a new deploy is picked up immediately.
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(request, copy)); return r; })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Same-origin static assets only. Vite content-hashes filenames, so a cache
  // hit is always the exact build that asked for it.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(request).then(hit =>
      hit || fetch(request).then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
        }
        return r;
      })
    )
  );
});

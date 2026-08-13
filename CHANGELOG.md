# Changelog

## 8.0 — consolidated release

Everything from 7.4–7.11, reviewed together and cleaned up.

### Data sources
- **USDA FoodData Central added** as a second food source, via a server-side
  proxy that keeps the API key off the client. Records are converted to the OFF
  shape at the source boundary, so the picker, parser, hazard engine and cache
  are unchanged. Nutri-Score / NOVA / Eco-Score are left blank on USDA records
  rather than approximated.
- **Search-a-licious is now the primary full-text search.** OFF deprecated
  `cgi/search.pl`, which returns HTTP 503 for long stretches — this was why name
  searches stopped returning results while barcode lookups kept working.
- **Attribute queries** ("vegan", "organic", "Nutri-Score A") moved off the same
  deprecated backend onto one `filterSearch` helper, with the legacy endpoint as
  fallback.
- Merged food search deduplicates on barcode, then normalised name + brand. OFF
  wins on conflict. USDA is queried only when OFF has not filled the list.

### Correctness
- **404 is no longer treated as a network failure.** An unknown barcode
  reported "Open Food Facts is unreachable"; it now reports that the product is
  not in the database.
- **429 / 503 are classified as rate limiting**, distinct from unreachable.
- **403 is a refusal, not an absence** — an earlier fix wrongly mapped it to
  "not found", making blocked requests look like empty results.
- **The service worker no longer caches API responses.** It previously cached
  any `openfoodfacts` response cache-first with no expiry, so one empty search
  result was served from cache permanently and no retry could dislodge it.
- **Alternatives no longer fail silently.** The fallback was gated on a status
  describing the *product* lookup rather than the alternatives query, so an
  empty category result suppressed alternatives entirely — and the empty result
  was then cached, making it permanent.
- Two alternatives fetches bypassed the proxy, the retry path and the error
  handling entirely, swallowing every failure into an empty list. Both now use
  `filterSearch`.

### Reliability
- `/api/off` and `/api/usda` now work under `vite dev` and `vite preview` via
  middleware. Previously these existed only on Vercel; locally they returned
  `index.html` with HTTP 200, so both the direct and proxied paths failed while
  the same URLs worked fine when opened in a browser tab.
- **Error boundary** in `main.jsx` — a render crash shows the error and
  component stack instead of a blank page.
- `scanning` and `discoverLoading` now reset in `finally` blocks. Any missed
  path left the Search button permanently disabled or the discover panel stuck
  on its loading skeleton.
- Scan errors show the actual message instead of "Please try again".

### Scanner
- Camera requests 1080p instead of 720p — EAN-13 bars blur at 720p at normal
  holding distance, so the decoder retried indefinitely.
- Continuous autofocus enabled; focus previously locked once at startup.
- Decoding throttled from every animation frame (~60/s) to ~12/s. Calls were
  queueing and making the preview stutter, which made holding steady harder.
- Reads that fail a checksum are accepted after two identical consecutive
  frames, instead of being discarded in silence. Some real barcodes never pass.

### Interface
- Name searches always open the picker, so a search is a browse: it shows what
  exists rather than silently picking one match.
- Picker has **Food** and **Cosmetics** tabs. The inactive tab is queried only
  when opened, and cached after that.
- Each result names its source database.
- Brand rating shows on every scan with prior records, not only bad ones, using
  the same scoring rule as the brand page.
- "Scan or search" renamed to "Search".
- **Check data sources** diagnostic probes each endpoint and reports what came
  back, sequentially so the check itself does not trip the rate limit.

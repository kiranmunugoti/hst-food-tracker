# HST — Hazard Substance Tracker

Scan or search a product and get its additives, contaminants and **undeclared
substances** — things present in a product that the label does not mention.

Version 8.0.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run dev` and `npm run preview` both serve the `/api/*` routes locally via
middleware in `vite.config.js`, so local development behaves the same as the
deployed app. Without that middleware those routes fall through to the SPA
fallback and return `index.html`, which breaks every lookup in a way that is
hard to spot — the requests still return HTTP 200.

---

## Data sources

| Source | Used for | Notes |
|---|---|---|
| **Open Food Facts** | food, primary | Nutri-Score, NOVA, additive tags, Eco-Score |
| **Search-a-licious** | food full-text + filters | OFF's Elasticsearch index; replaces the deprecated `search.pl` |
| **USDA FoodData Central** | food, supplement | Strong US branded coverage and ingredient statements. No Nutri-Score or NOVA — those stay blank rather than being invented |
| **Open Beauty Facts** | cosmetics | Separate database, own picker tab |

Ordering is deliberate: OFF answers first and wins on conflict, USDA only tops
up what OFF did not cover, and the cosmetics tab is queried only when opened.
OFF allows roughly **10 search requests per minute per IP**, so every avoidable
request is avoided.

### Deduplication

When a product appears in both food sources, barcode wins if both sides have
one; otherwise a normalised name + brand key is used. The OFF record is kept
because it carries scores that FDC has no equivalent for.

---

## Environment variables

| Variable | Where | Purpose | If unset |
|---|---|---|---|
| `USDA_API_KEY` | Vercel env var, or `.env` | FoodData Central access | Falls back to `DEMO_KEY` (~30 req/hour, shared) |
| `VITE_GH_TOKEN` | Vercel env var | Writes to the shared scan database | Reads still work; writes cleanly disabled |

Free USDA key: <https://fdc.nal.usda.gov/api-key-signup.html>

Local use — put them in `hst-app/.env` (already gitignored):

```
USDA_API_KEY=your_key_here
VITE_GH_TOKEN=your_token_here
```

---

## Layout

```
hst-app/
├── api/
│   ├── off.js        proxy for OFF / OBF / Search-a-licious (CORS + rate limits)
│   ├── usda.js       proxy for FoodData Central (keeps the API key server-side)
│   └── claude.js     optional AI-assisted analysis
├── public/sw.js      service worker — caches the app shell only, never API data
├── src/
│   ├── App.jsx       the entire application
│   └── main.jsx      entry point + error boundary
└── vite.config.js    build config + dev/preview API middleware
```

`src/App.jsx` is the only component file. Anything else left in `src/` is not
imported and does not run.

---

## Diagnosing problems

**"Check data sources"** under the Discover chips probes each endpoint
independently and reports what each returned. Probes run one at a time to stay
under the rate limit, so it takes a few seconds. Use it before assuming a lookup
bug: an empty result, a rate limit and a dead endpoint otherwise look identical
from the outside.

**Blank page.** `main.jsx` wraps the app in an error boundary, so a render crash
shows the error and component stack on screen instead of an empty page.

**Changes not taking effect.** The service worker caches the app shell. After
deploying, hard-reload once (or unregister the worker in DevTools →
Application). Bump `CACHE` in `public/sw.js` whenever shell caching changes.

**Case-sensitive filenames.** `main.jsx` imports `./App.jsx`. macOS and Windows
do not care about case; Vercel builds on Linux, which does. `APP.jsx` builds
locally and fails on deploy.

---

## Known limits

- Search-a-licious field names are inferred from its documentation. If a filter
  returns nothing where results are expected, that is the first place to look —
  the legacy fallback means it degrades rather than breaks.
- USDA contributes to name and barcode lookups only. FDC has no vegan, organic
  or NOVA tagging, so attribute queries stay OFF-only.
- Nutri-Score, NOVA and Eco-Score are absent on USDA records by design.
- Undeclared-substance detection reads ingredient text. A product with no
  ingredient list yields category-level inference only, which is weaker.

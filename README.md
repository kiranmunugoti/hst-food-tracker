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

---

## Ratings (v8.1)

Three scores, computed and shown separately. They are never averaged together.

| Score | Basis | Can it be changed by users? |
|---|---|---|
| **Safety** | CSPI Chemical Cuisine additive tiers | No |
| **Expert** | Curated awards, critic scores, lab results | Only by adding a sourced accolade |
| **Community** | Customer star reviews | Yes — this is the opinion score |

### Why they are not combined

A product can win a gold medal, be loved by customers, and still contain an
additive CSPI rates "Avoid". A single blended number would let popularity mask
composition, which is the failure this app exists to prevent. Safety stays the
headline; the others sit beside it.

### CSPI tiers

Safe · Cut back · Certain people should avoid · Caution · Avoid.

`src/ratings.js` holds a **curated subset** of CSPI's published ratings covering
common label additives — not the full database. Anything not in the table is
reported as *unrated*, never as safe, and the panel shows coverage as a
percentage so a partial assessment is visible as partial.

### Adding expert accolades

There is no public API for competition medals, critic scores or lab panels —
that data is proprietary. Accolades are curated entries on the product's record
in the shared database:

```json
"accolades": [
  { "name": "Great Taste Awards", "sourceType": "competition", "score": "2 stars", "year": 2025 },
  { "name": "Which? taste test",  "sourceType": "lab",         "score": "82/100",  "year": 2024 }
]
```

`sourceType` sets the weight: `lab` 1.0, `critic` 0.8, `panel` 0.7,
`competition` 0.6, `certifier` 0.5. Low-precision inputs (medals are ordinal)
are down-weighted again so an award cannot outvote a numeric lab result.

### Score conversion

`normalizeScore` accepts `4.5 stars`, `★★★★`, `92/100`, `B+`, `85%`, `17/20`,
`Gold`, `Grand Gold`, bare numbers, and returns a 1–10 value plus a precision
flag. Unrecognised input returns `null` rather than a guess.

100-point critic scales are **not** mapped linearly. In practice almost nothing
scores below 50, so a linear map would rate a poor 55 as 5.5/10 — "average".
The conversion rescales from a 50 floor: 55/100 becomes 2.8, 95/100 becomes 9.2.

### Personal sensitivity profiles

An "organic" label describes how something was farmed, not whether a given
person can tolerate it — organic wine still contains sulphites, organic cashews
still cause anaphylaxis. CSPI encodes part of this in its "Certain people should
avoid" tier: additives that are fine for most people and genuinely dangerous for
some. A single population-level score cannot express that.

So sensitivity is a **profile the reader sets** (14 groups: sulphites,
glutamates, artificial colours, benzoates, nitrites, polyols, carrageenan,
carmine, gluten, milk, nuts, soy, caffeine, salicylates). Products are checked
against it and matches are shown in a "For you" panel above the population
scores. Where a product carries an organic or natural claim *and* matches the
profile, that is called out explicitly, because it is the claim most likely to
be misread as "safe for me".

The profile is stored in `localStorage` and **never uploaded** — health
information belongs on the device, not in a shared database. It changes what the
reader is warned about; it never changes the product's score for anyone else.

### Community reviews

One review per device (a local id, replaced on resubmission, so one device
cannot vote repeatedly). Reviews below five are labelled as too few to be
representative rather than suppressed.

Reviewers can report an ingredient that appears on the physical label but is
missing from the database. These are tallied per substance and shown as
**unverified counts** — a prompt to check the label, not a change to the score.
A vote cannot make a nitrite disappear.

### Reader-reported composition

Additives transcribed from a physical label are shown in their own panel with
their CSPI tier, and **do not move the safety score**. A transcription is
plausible but unverified, and one person's reading should not silently re-rate a
product for everyone. The panel states what the score *would* be if confirmed —
information without assertion, leaving the judgement with the reader.

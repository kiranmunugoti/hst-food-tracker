# HST — Hazard Substance Tracker (v5.0)

Scans food products for hazardous additives, contaminants, and substances that are
**not declared on the label**. Rates brands from aggregated scan data.

Built to stay affordable at scale: the default analysis path makes no AI calls at
all, so the marginal cost of a scan is effectively zero.

## Architecture

Three layers, each with one entry point:

| Layer | Function | Responsibility |
|---|---|---|
| Lookup | `resolveProduct(query)` | Query → one product, or a candidate list. **1 request** typically, 3 worst case. |
| Analysis | `analyzeProduct(offData, label)` | Product → hazards, sugar, diet, undeclared list. Issues no lookups of its own. |
| Persist | `commitScan(analysis, label)` | Cache, shared-database write, user notifications. |

Every entry point (manual scan, picker choice, background scan from the search
bar) funnels through these same three functions — there is no second pipeline.

### Analysis modes
- **Standard** (default): deterministic. 50-additive E-number database, category
  contaminant rules, glycemic-index table, template insights, community brand
  ratings, Open Food Facts category search for alternatives. No AI calls.
- **Enhanced**: layers extended research on top. It can only ever *add* to the
  Standard baseline, so a failed or unavailable enhanced response degrades
  silently instead of blanking the analysis. Toggle in the header; it probes
  connectivity and tells you whether the service is actually reachable.

### Request budget
Open Food Facts rate-limits search to roughly 10 requests per minute. Lookups are
therefore capped at 3 requests and cached at three levels (session → shared
database → 24h edge cache in `/api/off`). Empty results are never cached, so a
failed lookup does not serve that same nothing back for 30 days.

## Run locally
    npm install
    npm run dev

## Deploy to Vercel
1. Push this folder to a GitHub repo.
2. Vercel → Add New Project → import the repo. Framework preset **Vite** is
   auto-detected (build `npm run build`, output `dist`).
3. Environment variables (Settings → Environment Variables, then **redeploy** —
   `VITE_` values are injected at build time):

   | Variable | Required | Purpose |
   |---|---|---|
   | `VITE_GH_TOKEN` | for shared writes | Fine-grained GitHub token, scoped to the database repo, **Contents: Read and write**. Without it the app runs read-only and says so. |
   | `ANTHROPIC_API_KEY` | for Enhanced mode | Server-side only — **no** `VITE_` prefix. Used by `/api/claude`. |

### Serverless functions (`/api`)
- **`/api/off`** — proxies Open Food Facts. Removes CORS restrictions and edge-caches
  for 24h, which is what keeps the app inside OFF's rate limits at scale.
- **`/api/claude`** — proxies Anthropic for Enhanced mode, keeping the key server-side.

> A `VITE_`-prefixed variable is embedded in the public JS bundle and can be
> extracted by anyone. Keep `VITE_GH_TOKEN` scoped to a single non-critical repo.
> To remove that exposure, move the database write behind a serverless function
> alongside the two above.

## Shared database — separate repository

The scan database lives in its **own repository**, not this one:

    GH_OWNER / GH_REPO  →  kiranmunugoti / hst-database   (src/App.jsx, line ~8)

This separation is deliberate. The app commits to the database on every scan, so
if the database lived in the source repo, the remote would constantly gain commits
your local clone lacks and every `git push` would be rejected with
`! [rejected] main -> main (fetch first)`. Keeping data out of the code repo means
pushes stay clean forever.

### One-time setup
1. Create a new **public** repository named `hst-database` (add a README so it has
   a `main` branch). Nothing else needed — the app creates `db.json` on the first
   successful write.
2. Create a fine-grained GitHub token scoped to **`hst-database` only**, with
   **Contents: Read and write**.
3. Add it in Vercel as `VITE_GH_TOKEN`, then **redeploy**.

To use a different name, change `GH_REPO` in `src/App.jsx`.

### Behaviour
Writes report their real outcome (`saved` / `no-token` / `error`) — the UI never
claims a commit that did not happen. Failures name their cause: a missing
repository, an invalid token, or missing Contents permission. Stale-`sha`
conflicts are retried once, and a missing `db.json` is created automatically.


## Barcode camera scanning

Tap the camera icon beside the scan box. A barcode is an exact product key, so a
scan skips fuzzy search entirely — one request, no ambiguity, no picker.

**Decoders**, tried in order:
1. `BarcodeDetector` — built into Chrome/Edge (Android and desktop). Native, nothing to download.
2. ZXing — loaded from a CDN on first use only, covering Safari/iOS and Firefox.

Scanned codes are checksum-validated before lookup, so a misread digit is
rejected rather than sent as a bad query.

**Requirements**
- **HTTPS is mandatory.** Browsers block camera access on plain HTTP. Vercel
  serves HTTPS by default; for local testing use `localhost` (exempt) — a LAN IP
  like `192.168.x.x` will not work.
- The user must grant camera permission. Denial, no camera, and a camera busy in
  another app each produce a specific message with the manual-entry fallback.
- The stream is stopped whenever the overlay closes or unmounts.

**iOS note:** camera access inside a home-screen PWA works on iOS 14.3+. On
older versions the scanner must be opened in Safari itself.


## Brand ownership

Open Food Facts records the brand printed on the pack, which is usually a
sub-brand: "Maggi" rather than Nestlé, who have owned it since 1947. Rating only
the sub-brand hides the record of the company that actually sets policy, so:

- `parseOFF` keeps **every** brand OFF lists (`"Maggi,Nestlé"` → both), instead
  of discarding everything after the first comma.
- `PARENT_COMPANY` in `src/App.jsx` maps sub-brands to their owner. Ratings,
  scan-time brand alerts and the Brand Ratings tab all aggregate at company
  level, and the tab shows which sub-brands rolled up ("incl. Maggi, KitKat").
- The product card shows both: *Maggi · owned by Nestlé*.

**This list is curated, conservative and incomplete.** It covers major
international and Indian food companies only. Ownership also changes — brands
get sold — so entries can go stale. A brand with no entry is simply rated on its
own, which is the safe default. Add entries with the `_own()` helper.


## Two domains: food and cosmetics

The app covers two product worlds, kept deliberately separate because they are
governed by different science and different regulators. Switch in the header.

| | Food | Cosmetics |
|---|---|---|
| Data source | Open Food Facts | Open Beauty Facts |
| Authorities | **EFSA** (EU ADIs) and **JECFA** (FAO/WHO) | **CIR** (cir-safety.org) and **SCCS** (EU) |
| Ingredient scheme | E-numbers | INCI |
| Analysis | additives, contaminants, sugar, Nutri-Score, NOVA | formulation, pH, delivery systems, stabilisers, fragrance allergens |

**The two rulebooks are never mixed.** A CIR "safe as used" conclusion or an
SCCS concentration limit applies to a substance *applied to skin*, and says
nothing about eating it. Presenting a topical limit as a food limit would be
scientifically wrong, so food results cite EFSA/JECFA only and cosmetic results
cite CIR/SCCS only. Shared-database keys are namespaced (`cos:`) so records from
the two domains cannot collide.

### What the cosmetics engine assesses
- **Overall formulation** — base type (water, oil, alcohol, humectant), ingredient
  count and complexity, and which flagged ingredients fall in the leading five.
  INCI lists are ordered by descending concentration down to 1%, so position is
  used as a concentration proxy — never quoted as a number.
- **pH** — inferred from the actives present, since pH is almost never printed.
  Reports the range the formulation must sit in, and flags actives that require
  incompatible ranges (L-ascorbic acid with niacinamide, retinol with an AHA).
- **Delivery systems** — liposomes, niosomes, nanomaterials, encapsulation,
  cyclodextrins, ferments. These change penetration depth, which is why SCCS
  assesses nanomaterials under separate guidance.
- **Stabilisers** — chelators, antioxidants, emulsifiers, thickeners, pH
  adjusters, preservative system. Gaps matter as much as presence: a
  water-containing product with no preservative is flagged as a microbial risk.
- **Fragrance allergens** — the 26 substances the EU requires to be declared
  individually.

`COSMETIC_DB` in `src/App.jsx` holds 35 ingredients with their CIR or SCCS
conclusion and EU limit. Like the food database it is curated and incomplete;
limits also change as opinions are revised, so verify anything consequential
against the primary source.


## Two domains, two rulebooks

The app covers **food** and **cosmetics**, switched from the header. They are
kept strictly separate, because the authorities that govern them answer
different questions and their limits are not interchangeable.

| | Food | Cosmetics |
|---|---|---|
| Data | Open Food Facts | Open Beauty Facts |
| Authorities | **EFSA** (EU) and **JECFA** (WHO/FAO) | **SCCS** (EU, binding) and **CIR** (US, advisory) |
| Question | How much may be *eaten* daily | How much may be *applied to skin* |
| Engine | Additives, contaminants, undeclared substances, sugar | Formulation, pH, delivery systems, stabilisers |

A CIR conclusion of "safe as used" describes a concentration applied to skin and
says nothing about ingestion. Mixing the two would be scientifically wrong and,
in a safety app, actively misleading — so no limit is ever carried across, and
each finding is labelled with the body it came from.

### The cosmetics engine
- **Overall formulation** — base type (water, oil, alcohol, humectant),
  complexity, and which restricted ingredients appear in the leading five
  entries, where INCI order means they are present at meaningful concentration.
- **pH** — inferred from the actives, since pH is essentially never printed on a
  pack. Reported as the range the formula *must* sit in to work, flagged as an
  inference, with genuine conflicts surfaced (a retinoid and an exfoliating acid
  cannot both be in their effective range at once).
- **Delivery systems** — liposomes, niosomes, encapsulation, cyclodextrins,
  nanomaterials, penetration enhancers. These change the delivered dose, which
  is why SCCS assesses nanomaterials under separate guidance.
- **Stabilisers** — preservatives, chelators, antioxidants, emulsifiers. Absence
  is treated as a finding: a water-containing product with no preservative
  system is a microbiological risk.

Sources: [SCCS](https://health.ec.europa.eu/scientific-committees/scientific-committee-consumer-safety-sccs_en) · [CIR](https://www.cir-safety.org/)

**Coverage caveat:** Open Beauty Facts is considerably thinner than Open Food
Facts — expect more misses on cosmetics than on food, particularly outside
Europe. The shared database mitigates this over time.

## Known limits
- Standard mode only knows the 50 additives and 7 contaminant patterns it ships
  with. Enhanced mode can research beyond that.
- GitHub is fine as a database for early scale; beyond roughly 5,000 writes/hour
  it will rate-limit and concurrent commits will collide. Cloudflare Workers KV
  or Supabase are the natural free-tier successors — swap `ghGet`/`ghSet`.

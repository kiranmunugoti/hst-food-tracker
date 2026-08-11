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

## Known limits
- Standard mode only knows the 50 additives and 7 contaminant patterns it ships
  with. Enhanced mode can research beyond that.
- GitHub is fine as a database for early scale; beyond roughly 5,000 writes/hour
  it will rate-limit and concurrent commits will collide. Cloudflare Workers KV
  or Supabase are the natural free-tier successors — swap `ghGet`/`ghSet`.

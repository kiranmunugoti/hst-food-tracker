# HST — Hazard Substance Tracker (v3.2)

Free-mode food safety tracker: Open Food Facts API + local rules engine + GitHub shared DB.
Zero AI cost per scan. Flip `AI_MODE = true` in `src/App.jsx` to enable Anthropic-powered enrichment
(requires routing calls through a backend with an API key — see notes below).

## Run locally
    npm install
    npm run dev

## Deploy to Vercel
1. Push this folder to a GitHub repo.
2. In Vercel: Add New Project → import the repo.
   Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist`.
3. Optional (enables writes to the shared GitHub db.json):
   Project → Settings → Environment Variables → add `VITE_GH_TOKEN` = a GitHub
   fine-grained token with **Contents: Read and write** on `kiranmunugoti/hst-food-tracker`.
   Redeploy after adding it. Without the token the app still runs — reads are public,
   writes are silently skipped.

## Troubleshooting
- Blank page → open browser DevTools (F12) → Console, and check Vercel → Deployments → Build Logs.
- `VITE_GH_TOKEN` must be set at build time (Vite inlines it). Re-deploy after changing it.
- Note: a `VITE_` env var is embedded in the public JS bundle — anyone can extract the token.
  Fine for a demo repo; for production, move GitHub writes behind a Vercel serverless function.

## AI mode caveat
`AI_MODE = true` calls `api.anthropic.com` directly from the browser. That only works inside
Claude.ai artifacts (which inject auth). On Vercel you must create an `/api/claude` serverless
function that holds your `ANTHROPIC_API_KEY` and proxies requests, then point `callAI` at it.
Free mode (default) needs none of this.

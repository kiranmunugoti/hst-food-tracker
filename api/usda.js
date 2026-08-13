// Vercel serverless proxy for USDA FoodData Central.
//
// Two reasons this exists rather than calling FDC from the browser:
//   1. The API key stays server-side. FDC keys are per-account and rate-limited
//      (1,000 requests/hour), so shipping one in the bundle would let anyone
//      exhaust it.
//   2. Edge caching. Branded-food records change rarely, so a 24h cache keeps
//      repeat lookups off the quota entirely.
//
// DEMO_KEY works without signup but is limited to roughly 30 requests/hour per
// IP, which is fine for local testing and not enough for real use. Set
// USDA_API_KEY in Vercel → Settings → Environment Variables (free key from
// https://fdc.nal.usda.gov/api-key-signup.html) and redeploy.
const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
const ALLOWED_PATHS = ["/foods/search", "/food"];

export default async function handler(req, res) {
  try {
    const path = req.query.path || "/foods/search";
    if (!ALLOWED_PATHS.some(p => path === p || path.startsWith(p + "/"))) {
      return res.status(403).json({ error: "Path not allowed" });
    }

    const key = process.env.USDA_API_KEY || "DEMO_KEY";
    const params = new URLSearchParams();
    // Forward only the parameters the app actually uses. An allow-list keeps
    // this from becoming an open relay to the whole FDC API.
    for (const k of ["query", "pageSize", "dataType", "brandOwner", "pageNumber"]) {
      if (req.query[k] != null && req.query[k] !== "") params.set(k, req.query[k]);
    }
    params.set("api_key", key);

    const r = await fetch(`${FDC_BASE}${path}?${params.toString()}`, {
      headers: { "User-Agent": "HST-Tracker/7.7 (hst-food-tracker)" },
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(502).json({ error: "Non-JSON response from FoodData Central" }); }

    // Report a missing/exhausted key clearly rather than as an empty result —
    // silently returning nothing would look identical to "no such product".
    if (r.status === 403) {
      return res.status(403).json({
        error: process.env.USDA_API_KEY
          ? "FoodData Central rejected the API key."
          : "No USDA_API_KEY is set and the shared DEMO_KEY quota is exhausted.",
      });
    }

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Upstream fetch failed", detail: String(e?.message || e) });
  }
}

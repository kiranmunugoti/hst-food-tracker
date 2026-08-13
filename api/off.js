// Vercel serverless proxy for Open Food Facts.
// Eliminates browser CORS issues entirely and edge-caches responses for 24h,
// which also keeps the app far under OFF's rate limits at scale.
const ALLOWED_HOSTS = [
  "world.openfoodfacts.org", "search.openfoodfacts.org",   // food
  "world.openbeautyfacts.org",                              // cosmetics
];

export default async function handler(req, res) {
  try {
    const target = req.query.url;
    if (!target) return res.status(400).json({ error: "Missing url parameter" });
    let u;
    try { u = new URL(target); } catch { return res.status(400).json({ error: "Invalid URL" }); }
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.includes(u.hostname)) {
      return res.status(403).json({ error: "Host not allowed" });
    }
    const r = await fetch(u.toString(), {
      headers: { "User-Agent": "HST-Tracker/8.0 (hst-food-tracker; contact via GitHub)" },
    });
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Upstream fetch failed", detail: String(e?.message || e) });
  }
}

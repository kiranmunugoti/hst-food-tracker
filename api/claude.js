// Vercel serverless proxy for the Anthropic API.
// Keeps ANTHROPIC_API_KEY server-side (set it in Vercel → Settings →
// Environment Variables — do NOT prefix it with VITE_, or it would be
// embedded in the public bundle where anyone could extract it).
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Upstream request failed", detail: String(e?.message || e) });
  }
}

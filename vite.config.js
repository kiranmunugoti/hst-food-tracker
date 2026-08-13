import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// __GH_TOKEN__ is replaced at build time with the value of the VITE_GH_TOKEN
// environment variable (set it in Vercel → Project → Settings → Environment
// Variables, then redeploy). If unset, it becomes "" and GitHub writes are
// simply skipped — the app still runs fully.

// ─── DEV API MIDDLEWARE ────────────────────────────────────────────────────────
// /api/off and /api/usda are Vercel serverless functions. They do not exist
// under `vite dev` or `vite preview`, so those routes fell through to the SPA
// fallback and returned index.html with HTTP 200.
//
// That is why Open Food Facts worked in a browser tab but not in the app:
// opening a URL directly performs no CORS check, while fetch() from the app's
// origin does. When the direct call was refused, the proxy fallback returned
// HTML instead of JSON, so BOTH paths failed and every lookup came back empty.
// This middleware runs the same logic locally so dev matches production.
const OFF_ALLOWED_HOSTS = [
  "world.openfoodfacts.org", "search.openfoodfacts.org",
  "world.openbeautyfacts.org",
];
const UA = "HST-Tracker/7.10 (hst-food-tracker; dev)";

function devApiPlugin() {
  return {
    name: "hst-dev-api",
    configureServer(server) { attach(server); },
    // `vite preview` serves the built bundle and has no serverless functions
    // either, so it needs the same middleware or preview silently breaks too.
    configurePreviewServer(server) { attach(server); },
  };
}

function attach(server) {
  {
    {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/off") && !req.url?.startsWith("/api/usda")) return next();

        const send = (code, obj) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(obj));
        };

        try {
          const url = new URL(req.url, "http://localhost");

          if (url.pathname.startsWith("/api/off")) {
            const target = url.searchParams.get("url");
            if (!target) return send(400, { error: "Missing url parameter" });
            let u;
            try { u = new URL(target); } catch { return send(400, { error: "Invalid URL" }); }
            if (u.protocol !== "https:" || !OFF_ALLOWED_HOSTS.includes(u.hostname)) {
              return send(403, { error: "Host not allowed" });
            }
            const r = await fetch(u.toString(), { headers: { "User-Agent": UA } });
            const text = await r.text();
            res.statusCode = r.status;
            res.setHeader("Content-Type", "application/json");
            return res.end(text);
          }

          // /api/usda
          const path = url.searchParams.get("path") || "/foods/search";
          if (!["/foods/search", "/food"].some(p => path === p || path.startsWith(p + "/"))) {
            return send(403, { error: "Path not allowed" });
          }
          const key = process.env.USDA_API_KEY || process.env.VITE_USDA_API_KEY || "DEMO_KEY";
          const params = new URLSearchParams();
          for (const k of ["query", "pageSize", "dataType", "brandOwner", "pageNumber"]) {
            const v = url.searchParams.get(k);
            if (v) params.set(k, v);
          }
          params.set("api_key", key);
          const r = await fetch(`https://api.nal.usda.gov/fdc/v1${path}?${params}`, {
            headers: { "User-Agent": UA },
          });
          const text = await r.text();
          res.statusCode = r.status;
          res.setHeader("Content-Type", "application/json");
          return res.end(text);
        } catch (e) {
          return send(502, { error: "Upstream fetch failed", detail: String(e?.message || e) });
        }
      });
    }
  }
}

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  define: {
    __GH_TOKEN__: JSON.stringify(process.env.VITE_GH_TOKEN || ""),
  },
});

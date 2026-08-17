import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// Reads src/brand.js without importing it, so the config stays plain and does
// not need a transform step to load an ESM module with JSX siblings.
function readBrand() {
  const src = fs.readFileSync(path.resolve("src/brand.js"), "utf8");
  const pick = (k) => (src.match(new RegExp(`${k}\\s*=\\s*"([^"]*)"`)) || [])[1] || "";
  return {
    APP_NAME: pick("APP_NAME"),
    APP_SHORT: pick("APP_SHORT"),
    APP_DESCRIPTION: pick("APP_DESCRIPTION"),
  };
}

// Injects the name into index.html and the PWA manifest at build time, so
// renaming the app is a one-line edit in src/brand.js rather than a hunt through
// five files that had already drifted out of sync.
function brandPlugin() {
  return {
    name: "hst-brand",
    transformIndexHtml(html) {
      const b = readBrand();
      return html.replace(/%APP_NAME%/g, b.APP_NAME)
                 .replace(/%APP_SHORT%/g, b.APP_SHORT)
                 .replace(/%APP_DESCRIPTION%/g, b.APP_DESCRIPTION);
    },
    // The manifest lives in public/ and is copied verbatim, so it is rewritten
    // in the output directory after the copy.
    closeBundle() {
      try {
        const b = readBrand();
        const out = path.resolve("dist/manifest.webmanifest");
        if (!fs.existsSync(out)) return;
        const m = JSON.parse(fs.readFileSync(out, "utf8"));
        m.name = b.APP_NAME;
        m.short_name = b.APP_SHORT;
        m.description = b.APP_DESCRIPTION;
        fs.writeFileSync(out, JSON.stringify(m, null, 2));
      } catch (e) {
        this.warn("brand: could not rewrite manifest — " + e.message);
      }
    },
  };
}

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
const UA = "HST-Tracker/8.0 (hst-food-tracker; dev)";

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
  plugins: [react(), devApiPlugin(), brandPlugin()],
  build: {
    // Ship source maps. Without them a production crash reports only minified
    // frames like `ty/<.children<.children<`, which name nothing and cannot be
    // traced back to a line. The map is a separate file the browser fetches
    // only when devtools are open, so it costs users nothing.
    sourcemap: true,
  },
  define: {
    __GH_TOKEN__: JSON.stringify(process.env.VITE_GH_TOKEN || ""),
  },
});

import { DOMAIN } from "../lib/config.js";

// The free Open Food Facts / Open Beauty Facts client: direct REST calls,
// falling back to a same-origin proxy for CORS and rate-limit relief.
// ─── FREE OPEN FOOD FACTS API (no key, no cost) ────────────────────────────────
// Direct REST calls to world.openfoodfacts.org — completely free & CORS-enabled.
// Falls back to the AI-powered lookup only when direct fetch is blocked/fails.
const OFF_FIELDS = "product_name,brands,image_url,nutriscore_grade,nova_group,ecoscore_grade,quantity,serving_size,ingredients_text,additives_tags,allergens_tags,labels_tags,categories_tags,countries_tags,nutriments";

let _offStatus = "ok"; // status of last direct lookup: "ok" | "nomatch" | "network"

// ─── OPEN FOOD FACTS CLIENT ────────────────────────────────────────────────────
// One lookup path. Every request goes through offJson, which tries the direct
// call and falls back to the same-origin /api/off proxy (needed for CORS on the
// modern search host, and for rate-limit relief via 24h edge caching).
//
// Budget matters here: OFF rate-limits search to ~10 requests/minute, so a
// resolve makes ONE request in the common case and at most three.
const OFF_HOST = "https://world.openfoodfacts.org";
const OFF_SEARCH_HOST = "https://search.openfoodfacts.org";
// Open Beauty Facts is the cosmetics sister project — same API shape and the
// same barcode keys, so the entire lookup path is reused unchanged.
const OBF_HOST = "https://world.openbeautyfacts.org";
const hostFor     = (d) => (d === "cosmetics" ? OBF_HOST : OFF_HOST);
const domainHost  = () => hostFor(DOMAIN);
const domainLabel = () => (DOMAIN === "cosmetics" ? "Open Beauty Facts" : "Open Food Facts");

// A 404 from OFF is a real answer — "no such product" — not a failure to
// reach OFF. Conflating the two is what made an unknown barcode report as
// "unreachable", so the two cases are separate types from here down.
class OffNotFound extends Error {
  constructor(url) { super("Not in database"); this.name = "OffNotFound"; this.url = url; }
}

// 429 (per-IP limit) and 503 (OFF's global crawl limit) mean "come back later",
// which is neither an absence nor a dead connection. Kept separate so the app
// can say which one it is instead of guessing.
class OffRateLimited extends Error {
  constructor(status) { super("Rate limited (HTTP " + status + ")"); this.name = "OffRateLimited"; this.status = status; }
}

// Reads the body once and only accepts it as JSON. When /api/off does not
// exist (vite dev, artifact preview, a static host with no functions) the
// request resolves 200 with index.html, which must not be mistaken for data.
async function readJson(r) {
  const text = await r.text();
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json") && /^\s*</.test(text)) throw new Error("Non-JSON response (no /api/off on this host)");
  try { return JSON.parse(text); } catch { throw new Error("Malformed JSON response"); }
}

async function offJson(url) {
  let directErr = null;
  try {
    const r = await fetch(url);
    if (r.status === 404) throw new OffNotFound(url);
    if (r.status === 429 || r.status === 503) throw new OffRateLimited(r.status);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await readJson(r);
  } catch (e) {
    // A 404 is authoritative — the proxy would only fetch the same 404 again,
    // and retrying it would burn a request against the rate limit for nothing.
    if (e instanceof OffNotFound) throw e;
    directErr = e;
  }
  try {
    const r = await fetch(`/api/off?url=${encodeURIComponent(url)}`);
    if (r.status === 404) throw new OffNotFound(url);
    // 403 here is the proxy's own host allow-list, or OFF blocking the request.
    // Either way it is a refusal, not an absence — it must not read as "no match".
    if (r.status === 429 || r.status === 503) throw new OffRateLimited(r.status);
    if (!r.ok) throw new Error("proxy HTTP " + r.status);
    return await readJson(r);
  } catch (e) {
    if (e instanceof OffNotFound) throw e;
    if (e instanceof OffRateLimited || directErr instanceof OffRateLimited) {
      throw e instanceof OffRateLimited ? e : directErr;
    }
    // Both routes failed at the transport layer — this is the genuine
    // "unreachable" case, and the only one that should be reported as such.
    throw directErr || e;
  }
}

async function offGetByCode(code, domain = DOMAIN) {
  let d;
  try {
    d = await offJson(`${hostFor(domain)}/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
  } catch (e) {
    if (e instanceof OffNotFound) return null;   // barcode simply isn't in this database
    throw e;                                     // real network/CORS failure — let it count as blocked
  }
  // v2 also signals an unknown code as status 0 with HTTP 200.
  if (d && d.status === 0) return null;
  return d.product?.product_name ? d.product : null;
}

// Legacy keyword search. Open Food Facts has deprecated this endpoint and it
// now returns HTTP 503 for long stretches, so it is no longer the primary path
// for food — only the fallback, and the only option for Open Beauty Facts.
async function offSearchLegacy(terms, limit, domain = DOMAIN) {
  let d;
  try {
    d = await offJson(`${hostFor(domain)}/cgi/search.pl?search_terms=${encodeURIComponent(terms)}&search_simple=1&action=process&json=1&page_size=${limit}&fields=${OFF_FIELDS}`);
  } catch (e) {
    if (e instanceof OffNotFound) return [];   // searched fine, matched nothing
    throw e;
  }
  return (d.products || []).filter(p => p.product_name);
}

// OFF's v2 API returns text fields as comma-separated strings; Search-a-licious
// returns several of the same fields as ARRAYS. `asText(p.brands).split(",")`
// keeps an array (arrays are truthy) and then throws "split is not a function",
// so every hit from the search index is coerced to the v2 shape at the source
// boundary — one place, rather than guarding every consumer.
function asText(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.filter(x => x != null).join(",");
  return String(v);
}
function asList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  return String(v).split(",").map(x => x.trim()).filter(Boolean);
}

// Coerces a Search-a-licious hit into the exact shape parseOFF and the pickers
// expect from the v2 API.
function normalizeHit(p) {
  if (!p || typeof p !== "object") return p;
  return {
    ...p,
    product_name:     asText(p.product_name) || asText(p.product_name_en),
    brands:           asText(p.brands),
    quantity:         asText(p.quantity),
    serving_size:     asText(p.serving_size),
    ingredients_text: asText(p.ingredients_text),
    image_url:        typeof p.image_url === "string" ? p.image_url : (p.image_url?.[0] || null),
    nutriscore_grade: asText(p.nutriscore_grade).toLowerCase() || null,
    ecoscore_grade:   asText(p.ecoscore_grade).toLowerCase() || null,
    nova_group:       p.nova_group == null ? null : Number(asText(p.nova_group)) || null,
    additives_tags:   asList(p.additives_tags),
    allergens_tags:   asList(p.allergens_tags),
    labels_tags:      asList(p.labels_tags),
    categories_tags:  asList(p.categories_tags),
    nutriments:       (p.nutriments && typeof p.nutriments === "object") ? p.nutriments : {},
  };
}

// Search-a-licious — OFF's Elasticsearch-backed replacement for search.pl.
// It accepts the same `fields` list, so candidates come back fully populated
// in ONE request; no per-result product lookup, which keeps the request budget
// intact. Food only: there is no Open Beauty Facts index.
async function offSearchSAL(terms, limit) {
  let d;
  try {
    d = await offJson(`${OFF_SEARCH_HOST}/search?q=${encodeURIComponent(terms)}&page_size=${limit}&fields=code,${OFF_FIELDS}`);
  } catch (e) {
    if (e instanceof OffNotFound) return [];
    throw e;
  }
  return (d.hits || []).map(normalizeHit).filter(p => p.product_name);
}

async function offSearch(terms, limit, domain = DOMAIN) {
  if (domain === "cosmetics") return offSearchLegacy(terms, limit, domain);
  // Try the supported index first. Fall back to the legacy endpoint only if
  // Search-a-licious itself fails — a genuine empty result is not a failure
  // and must not trigger a second request for the same query.
  try {
    const hits = await offSearchSAL(terms, limit);
    if (hits.length) return hits;
  } catch { /* fall through to legacy */ }
  return offSearchLegacy(terms, limit, domain);
}

// _offStatus is written from here AND from the resolve path in discovery.js
// (a barcode/name lookup is what actually determines "ok" vs "network" vs
// "nomatch"), so it needs a setter rather than a raw mutable export.
export function setOffStatus(v) { _offStatus = v; }

export { OFF_FIELDS, _offStatus, OFF_HOST, OFF_SEARCH_HOST, OBF_HOST, hostFor, domainHost, domainLabel, OffNotFound, OffRateLimited, readJson, offJson, offGetByCode, offSearchLegacy, asText, asList, normalizeHit, offSearchSAL, offSearch };

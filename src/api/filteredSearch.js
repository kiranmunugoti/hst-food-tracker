import { OFF_SEARCH_HOST, OFF_FIELDS, offJson, normalizeHit, hostFor } from "./openFoodFacts.js";

// Attribute search ("vegan", "no additives", "Nutri-Score A") against the
// Search-a-licious index, with the legacy /api/v2/search endpoint as a
// fallback if a field name here goes stale.
// ─── FILTERED (ATTRIBUTE) SEARCH ───────────────────────────────────────────────
// Attribute queries — "vegan", "no additives", "Nutri-Score A".
//
// Search-a-licious takes filters as a Lucene-style q, so these run against the
// supported index. The legacy /api/v2/search stays as fallback: it shares the
// deprecated Perl backend with search.pl, but if a field name here is wrong the
// query degrades to the old path rather than silently returning nothing.
const SAL_FIELD_MAP = {
  nutrition_grades_tags: "nutrition_grades",
  nova_groups_tags: "nova_groups",
  labels_tags: "labels_tags",
  ingredients_analysis_tags: "ingredients_analysis_tags",
  categories_tags: "categories_tags",
  countries_tags: "countries_tags",
  additives_n: "additives_n",
};

function salQueryFrom(params) {
  const clauses = [];
  let free = "";
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    if (k === "search_terms") { free = String(v); continue; }
    const field = SAL_FIELD_MAP[k];
    if (!field) continue;
    // A comma-separated value is a set of alternatives ("d,e" → D or E).
    const vals = String(v).split(",").map(s => s.trim()).filter(Boolean);
    if (!vals.length) continue;
    clauses.push(vals.length === 1
      ? `${field}:"${vals[0]}"`
      : `(${vals.map(x => `${field}:"${x}"`).join(" OR ")})`);
  }
  return [free, ...clauses].filter(Boolean).join(" ");
}


async function filterSearch(params, domain, limit = 12, page = 1) {
  // Search-a-licious indexes food only — Open Beauty Facts has no equivalent.
  if (domain !== "cosmetics") {
    const q = salQueryFrom(params);
    if (q) {
      try {
        const d = await offJson(`${OFF_SEARCH_HOST}/search?q=${encodeURIComponent(q)}&page_size=${limit}&page=${page}&fields=code,${OFF_FIELDS}`);
        const hits = (d.hits || []).map(normalizeHit).filter(p => p.product_name);
        // An empty page beyond the first is a legitimate end-of-results, not a
        // failure — returning it stops the caller falling back and re-fetching.
        if (hits.length || page > 1) return { products: hits, count: d.count ?? hits.length, page };
      } catch { /* fall through to the legacy endpoint */ }
    }
  }
  const qs = new URLSearchParams({
    ...params,
    fields: OFF_FIELDS,
    page_size: String(limit),
    page: String(page),
    sort_by: "unique_scans_n",
  }).toString();
  const d = await offJson(`${hostFor(domain)}/api/v2/search?${qs}`);
  const products = (d.products || []).map(normalizeHit).filter(p => p.product_name);
  return { products, count: d.count ?? products.length, page };
}

export { SAL_FIELD_MAP, salQueryFrom, filterSearch };

import { DOMAIN } from "../lib/config.js";
import { asText, asList, OffRateLimited, offGetByCode, offSearch, _offStatus, setOffStatus } from "./openFoodFacts.js";
import { usdaGetByCode } from "./usda.js";
import { withMarket, marketTag, currentMarket } from "./market.js";
import { filterSearch } from "./filteredSearch.js";
import { sourcePlan, foodSearchMerged } from "./sourceDiagnostics.js";
import { ghGetByCode } from "./githubDb.js";
import { callAI } from "./claude.js";

// Category/attribute discovery ("products with no additives"), free-text
// name resolution across both databases (with the community DB checked
// first), and the AI-bridged fallback for sandboxed environments that block
// Open Food Facts outright.
// ─── CLOUD DISCOVERY ───────────────────────────────────────────────────────────
// Category questions ("products with no additives", "vegan snacks") should
// surface products the user has never seen, so they query the live product
// database with real filters rather than re-listing the shared scan history.
//
// Open Food Facts and Open Beauty Facts both expose tag filters on /api/v2/search.
// Numeric range filtering is not supported, so nutritional intent is expressed
// through the graded tags (nutrition_grades_tags, nova_groups_tags) instead.
const DISCOVERY_FILTERS = [
  { m: /no additives|without additives|additive.?free|clean label|good e.?numbers?|safe e.?numbers?|no e.?numbers?/i,
    params: { additives_n: "0" }, label: "no additives declared", domain: "food" },
  { m: /(?:good|best|high|top).{0,12}nutri.?score|nutri.?score a\b|healthiest/i,
    params: { nutrition_grades_tags: "a" }, label: "Nutri-Score A", domain: "food" },
  { m: /(?:low|poor|bad|worst).{0,12}nutri.?score|nutri.?score [de]\b/i,
    params: { nutrition_grades_tags: "d,e" }, label: "Nutri-Score D or E", domain: "food" },
  { m: /ultra.?processed|nova ?4/i,
    params: { nova_groups_tags: "4" }, label: "ultra-processed (NOVA 4)", domain: "food" },
  { m: /unprocessed|minimally processed|nova ?1/i,
    params: { nova_groups_tags: "1" }, label: "unprocessed (NOVA 1)", domain: "food" },
  { m: /\bvegan\b/i,           params: { labels_tags: "en:vegan" },        label: "vegan", domain: null },
  { m: /\bvegetarian\b/i,      params: { labels_tags: "en:vegetarian" },   label: "vegetarian", domain: "food" },
  { m: /\borganic\b|\bbio\b/i, params: { labels_tags: "en:organic" },      label: "organic", domain: null },
  { m: /gluten.?free/i,        params: { labels_tags: "en:gluten-free" },  label: "gluten-free", domain: "food" },
  { m: /palm.?oil.?free|no palm oil/i, params: { labels_tags: "en:palm-oil-free" }, label: "palm-oil free", domain: "food" },
  { m: /fair.?trade/i,         params: { labels_tags: "en:fair-trade" },    label: "fair trade", domain: null },
  { m: /no sugar|sugar.?free|without sugar/i, params: { labels_tags: "en:no-added-sugar" }, label: "no added sugar", domain: "food" },
  { m: /cruelty.?free/i,       params: { labels_tags: "en:cruelty-free" },  label: "cruelty-free", domain: "cosmetics" },
  { m: /fragrance.?free|without fragrance|no parfum/i, params: { labels_tags: "en:fragrance-free" }, label: "fragrance-free", domain: "cosmetics" },
  { m: /paraben.?free|no parabens/i, params: { labels_tags: "en:paraben-free" }, label: "paraben-free", domain: "cosmetics" },
];

// A free-text remainder is used as the search term alongside the filters, so
// "vegan chocolate" filters by the vegan label AND searches for chocolate.
const DISCOVERY_STOPWORDS = /\b(?:products?|items?|foods?|with|without|good|bad|best|worst|show|find|list|me|any|the|a|an|and|or|of|in|for|that|have|has|are|is|which|what|no)\b/gi;

function discoveryIntent(query) {
  const q = String(query || "");
  const matched = DISCOVERY_FILTERS.filter(f => f.m.test(q));
  if (!matched.length) return null;
  const params = Object.assign({}, ...matched.map(f => f.params));
  // Domain: honour an explicit signal from a matched filter, else guess
  const explicit = matched.map(f => f.domain).find(Boolean);
  const domain = explicit || guessDomain(q) || "food";
  // Anything left after removing the filter phrases and stopwords is a term
  let remainder = q;
  matched.forEach(f => { remainder = remainder.replace(f.m, " "); });
  remainder = remainder.replace(DISCOVERY_STOPWORDS, " ").replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  return { params, domain, term: remainder, labels: matched.map(f => f.label) };
}

// Run the discovery query against the live database.
async function cloudDiscover(intent, limit = 8) {
  const params = withMarket({ ...intent.params });
  if (intent.term) params.search_terms = intent.term;
  let { products } = await filterSearch(params, intent.domain, limit);
  if (!products.length && marketTag()) {
    // Nothing locally — widen rather than report an empty catalogue.
    ({ products } = await filterSearch({ ...intent.params, ...(intent.term ? { search_terms: intent.term } : {}) }, intent.domain, limit));
  }
  return products.map(p => {
    const parsed = parseOFF(p);
    parsed._domain = intent.domain;
    return parsed;
  });
}

// ─── DOMAIN DETECTION ──────────────────────────────────────────────────────────
// Food and cosmetics live in separate databases, but the user should not have
// to say which. A keyword guess decides which database to try FIRST; if that
// misses, the other is tried. So the common case still costs one request, and
// the worst case two — well inside Open Food Facts' rate limit.
const COSMETIC_HINT = /shampoo|conditioner|serum|moisturi|cleanser|toner|sunscreen|spf|lotion|cream(?!\s*(?:cheese|biscuit|cracker))|lipstick|mascara|foundation|concealer|deodorant|antiperspirant|perfume|fragrance|body ?wash|face ?wash|micellar|exfoliat|peel|retinol|niacinamide|hyaluronic|salicylic|glycolic|balm|shower ?gel|hand ?wash|soap|scrub|nail|polish|eyeliner|eyeshadow|blush|primer|essence|ampoule|masque|hair ?oil|hair ?mask|dye|bleach|talc|powder ?compact/i;
const FOOD_HINT = /milk|bread|noodle|pasta|rice|cereal|biscuit|cookie|chocolate|yogh?urt|cheese|butter|juice|soda|cola|water|snack|chips|crisps|sauce|ketchup|jam|honey|tea|coffee|oil(?! ?(?:hair|body|face))|flour|sugar|salt|spice|masala|dal|atta|namkeen|candy|sweets|drink|beverage|protein ?(?:bar|powder)|cracker|wafer|ice ?cream|pizza|burger|soup|curry/i;

function guessDomain(query) {
  const q = String(query || "").toLowerCase();
  if (COSMETIC_HINT.test(q) && !FOOD_HINT.test(q)) return "cosmetics";
  if (FOOD_HINT.test(q) && !COSMETIC_HINT.test(q)) return "food";
  return null;   // no signal either way — try food first, it has far more data
}

// ─── CLOUD DISCOVERY SEARCH ────────────────────────────────────────────────────
// Attribute queries ("products with no additives", "vegan", "Nutri-Score A")
// are questions about the WHOLE catalogue, not about what has been scanned
// before. Answering them from the shared database would only ever return the
// handful of products already in it, so these queries go to the live source
// and are translated into its own filter parameters.
const CLOUD_FILTERS = [
  { m: /no additives|without additives|additive.?free|good e.?numbers?|no e.?numbers?|clean label/i,
    food: { additives_n: 0 }, label: "no additives" },
  { m: /\be.?numbers?\b|with additives/i,
    food: { additives_tags: "en:e621,en:e250,en:e102,en:e951" }, label: "containing additives" },
  { m: /good nutri.?score|nutri.?score a\b|healthiest|most nutritious/i,
    food: { nutrition_grades_tags: "a" }, label: "Nutri-Score A" },
  { m: /low nutri.?score|poor nutri.?score|nutri.?score [de]\b|least healthy/i,
    food: { nutrition_grades_tags: "d,e" }, label: "Nutri-Score D–E" },
  { m: /ultra.?processed/i,
    food: { nova_groups_tags: "4" }, label: "ultra-processed (NOVA 4)" },
  { m: /unprocessed|minimally processed|not ultra.?processed|least processed/i,
    food: { nova_groups_tags: "1" }, label: "unprocessed (NOVA 1)" },
  { m: /\bvegan\b/i,
    food: { ingredients_analysis_tags: "en:vegan" },
    cosmetics: { labels_tags: "en:vegan" }, label: "vegan" },
  { m: /\bvegetarian\b/i,
    food: { ingredients_analysis_tags: "en:vegetarian" }, label: "vegetarian" },
  { m: /organic|\bbio\b/i,
    food: { labels_tags: "en:organic" }, cosmetics: { labels_tags: "en:organic" }, label: "organic" },
  { m: /palm.?oil.?free|no palm oil/i,
    food: { ingredients_analysis_tags: "en:palm-oil-free" }, label: "palm-oil-free" },
  { m: /gluten.?free/i,
    food: { labels_tags: "en:gluten-free" }, label: "gluten-free" },
  { m: /no added sugar|sugar.?free|without added sugar/i,
    food: { labels_tags: "en:no-added-sugar" }, label: "no added sugar" },
  { m: /fragrance.?free|perfume.?free|no fragrance/i,
    cosmetics: { labels_tags: "en:fragrance-free" }, label: "fragrance-free" },
  { m: /paraben.?free|no parabens/i,
    cosmetics: { labels_tags: "en:paraben-free" }, label: "paraben-free" },
  { m: /cruelty.?free|not tested on animals/i,
    cosmetics: { labels_tags: "en:cruelty-free" }, label: "cruelty-free" },
];

// Pull the residual words out of a query so "organic biscuits" filters by
// organic AND searches for biscuits, rather than returning organic anything.
const FILTER_STOPWORDS = /\b(products?|foods?|items?|things?|with|without|no|good|bad|best|worst|show|find|list|me|the|a|an|and|or|in|of|that|are|is|free|which|what|any)\b/gi;

async function cloudSearch(query, page = 1) {
  const q = String(query || "");
  const matched = CLOUD_FILTERS.filter(f => f.m.test(q));
  if (!matched.length) return null;

  // Which catalogue to ask. A cosmetics-only filter forces that side.
  const hinted = guessDomain(q);
  const cosmeticOnly = matched.every(f => f.cosmetics && !f.food);
  const domain = cosmeticOnly ? "cosmetics" : (hinted || "food");

  const params = {};
  const applied = [];
  matched.forEach(f => {
    const set = f[domain] || f.food || f.cosmetics;
    if (!set) return;
    Object.assign(params, set);
    applied.push(f.label);
  });
  if (!Object.keys(params).length) return null;

  // Anything left over becomes a free-text term alongside the filters. Words a
  // filter already consumed must be stripped first: leaving "organic" in the
  // text would also require it in the product NAME, wrongly narrowing results
  // to products that happen to say "organic" in their title.
  let residual = q;
  matched.forEach(f => { residual = residual.replace(f.m, " "); });
  residual = residual.replace(FILTER_STOPWORDS, " ").replace(/\s+/g, " ").trim();
  if (residual.length > 2) params.search_terms = residual;


  try {
    const PAGE_SIZE = 12;
    let { products, count } = await filterSearch(withMarket(params), domain, PAGE_SIZE, page);
    if (!products.length && page === 1 && marketTag()) {
      ({ products, count } = await filterSearch(params, domain, PAGE_SIZE, page));
    }
    return {
      applied, domain, params, page,
      count,
      // More pages exist if this page came back full. Using the reported total
      // alone is unreliable — the two backends count differently.
      hasMore: products.length >= PAGE_SIZE,
      products: products.map(p => ({
        name: asText(p.product_name).trim(),
        brand: asText(p.brands).split(",")[0].trim() || null,
        nutriScore: p.nutriscore_grade || null,
        nova: p.nova_group || null,
        raw: p,
        _domain: domain,
      })),
    };
  } catch (e) {
    console.warn("cloudSearch:", e);
    // Carry the reason forward. Swallowing it into a bare failed flag is what
    // made a dead endpoint indistinguishable from an empty catalogue.
    return { applied, domain, params, page, count: 0, products: [], failed: true,
             hasMore: false, error: String(e?.message || e) };
  }
}

// Resolve a query to a single product, or to a candidate list for the user to
// choose from. Returning candidates is what stops "amul milk" silently
// resolving to "Amul Milk Chocolate".
async function resolveProduct(query, limit = 6) {
  const q = query.trim();
  let blocked = 0, tried = 0, limited = 0;
  const step = async (fn) => {
    tried++;
    try { return await fn(); }
    catch (e) { blocked++; if (e instanceof OffRateLimited) limited++; return null; }
  };
  const finish = (product, candidates, domain) => {
    const found = !!product || (candidates && candidates.length > 0);
    setOffStatus(found ? "ok"
      : limited > 0 ? "ratelimited"
      : (tried > 0 && blocked >= tried) ? "network"
      : "nomatch");
    const parsed = product ? parseOFF(product) : null;
    if (parsed) parsed._domain = domain;
    return { product: parsed, candidates: (candidates || []).map(c => ({ ...c, _domain: domain })), domain };
  };

  // Which database to try first. A barcode carries no hint, so order is by
  // likelihood: Open Food Facts is much larger than Open Beauty Facts.
  const guess = guessDomain(q);
  const order = guess === "cosmetics" ? ["cosmetics", "food"] : ["food", "cosmetics"];

  // ── Barcode: exact lookup. Try each database until one knows the code. ──
  if (/^\d{8,14}$/.test(q)) {
    // Community-added products first. Free, instant, and the only place a
    // product absent from every open database can possibly be found.
    const local = ghGetByCode(q);
    if (local?.rec?.offData) {
      setOffStatus("ok");
      return { product: local.rec.offData, candidates: [], domain: local.rec.domain || "food", fromCommunity: true };
    }

    const plan = sourcePlan(currentMarket());

    // In the US, FoodData Central is checked FIRST for a food barcode. A US
    // pack is far more likely to be in FDC than in Open Food Facts, so asking
    // OFF first usually means one wasted request before the answer.
    if (plan.usda === "first" && guess !== "cosmetics") {
      const usdaFirst = await step(() => usdaGetByCode(q));
      if (usdaFirst) return finish(usdaFirst, [], "food");
    }

    for (const d of order) {
      const hit = await step(() => offGetByCode(q, d));
      if (hit) return finish(hit, [], d);
    }

    // Elsewhere FDC is checked after OFF — local brands are likelier to be the
    // match — and in Europe it is not tried at all.
    if (plan.usda === "parallel") {
      const usda = await step(() => usdaGetByCode(q));
      if (usda) return finish(usda, [], "food");
    }

    const out = finish(null, [], guess || "food");
    // Every request succeeded and every database said "no such code". That is
    // a gap in the databases, not a connectivity problem, and the advice the
    // user needs is different — so it gets its own status.
    if (_offStatus === "nomatch") setOffStatus("unknown-code");
    return out;
  }

  // ── Name search: always return the candidate list. ──
  // Even a single match is returned as a candidate rather than resolved
  // silently, because a name search is a browse: the point is to show what
  // exists, not to guess which one was meant.
  const searcher = (d) => (d === "cosmetics" ? offSearch(q, limit, d) : foodSearchMerged(q, limit));
  for (const d of order) {
    const hits = (await step(() => searcher(d))) || [];
    if (hits.length > 0) return finish(null, hits, d);
  }

  // The Search-a-licious index is now queried inside offSearch as the primary
  // path, so the old "last resort" block that hit it separately is gone — it
  // would have re-run the same query and spent a second request for nothing.
  return finish(null, [], guess || "food");
}

// Sandboxed environments (e.g. preview iframes) can block OFF entirely. Only
// then do we bridge the lookup through the assisted path.
async function offViaAssisted(query) {
  const isBarcode = /^\d{8,14}$/.test(query.trim());
  const nutFields = `{"energy-kcal_100g":null,"fat_100g":null,"saturated-fat_100g":null,"carbohydrates_100g":null,"sugars_100g":null,"added-sugars_100g":null,"fiber_100g":null,"proteins_100g":null,"salt_100g":null,"sodium_100g":null,"energy-kcal_serving":null,"fat_serving":null,"carbohydrates_serving":null,"sugars_serving":null,"proteins_serving":null,"salt_serving":null}`;
  const shape = `{"product_name":"","brands":"","image_url":null,"nutriscore_grade":null,"nova_group":null,"ecoscore_grade":null,"quantity":null,"serving_size":null,"ingredients_text":null,"additives_tags":[],"allergens_tags":[],"labels_tags":[],"categories_tags":[],"nutriments":${nutFields}}`;
  const prompt = isBarcode
    ? `Look up Open Food Facts product barcode "${query.trim()}". Return ONLY a JSON object (no markdown): ${shape}`
    : `Search Open Food Facts for "${query}". Best match only. Return ONLY a JSON object (no markdown): ${shape}`;
  try {
    const txt = await callAI(prompt, 2000, true);
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    if (!p.product_name) return null;
    const parsed = parseOFF(p);
    parsed._src = "off-assisted";
    return parsed;
  } catch { return null; }
}

function parseOFF(p) {
  const n = p.nutriments || {};
  const g = (...keys) => { for (const k of keys) { if (n[k] != null && n[k] !== "") return Number(n[k]); } return null; };
  return {
    name: asText(p.product_name) || "Unknown",
    // Which database this record came from, carried through so the result card
    // and the cache both stay honest about provenance.
    source: p._source || "off",
    brand: asText(p.brands).split(",")[0].trim() || null,
    // OFF often lists several, e.g. "Maggi,Nestlé" — keep them all rather than
    // discarding the owning company after the first comma
    brands: asText(p.brands).split(",").map(b => b.trim()).filter(Boolean),
    image: p.image_url || null,
    quantity: p.quantity || null,
    servingSize: p.serving_size || null,
    nutriScore: asText(p.nutriscore_grade).toLowerCase() || null,
    novaGroup: p.nova_group ? Number(p.nova_group) : null,
    ecoScore: asText(p.ecoscore_grade).toLowerCase() || null,
    ingredients: asText(p.ingredients_text) || null,
    // asList + String(): a tag list can arrive as an array, a comma string, or
    // with non-string members depending on the source.
    additives: asList(p.additives_tags).map(a => String(a).replace(/^en:/, "")),
    allergens: asList(p.allergens_tags).map(a => String(a).replace(/^en:/, "")),
    labels: asList(p.labels_tags).map(l => String(l).replace(/^en:/, "")),
    categories: asList(p.categories_tags).slice(0, 3).map(c => String(c).replace(/^en:/, "")),
    nut: {
      energy_kcal: g("energy-kcal_100g","energy-kcal"),
      fat:         g("fat_100g"),
      saturated:   g("saturated-fat_100g"),
      carbs:       g("carbohydrates_100g"),
      sugars:      g("sugars_100g"),
      added_sugars:g("added-sugars_100g"),
      fiber:       g("fiber_100g","fibers_100g"),
      protein:     g("proteins_100g"),
      salt:        g("salt_100g"),
      sodium:      g("sodium_100g"),
      energy_srv:  g("energy-kcal_serving"),
      fat_srv:     g("fat_serving"),
      carbs_srv:   g("carbohydrates_serving"),
      sugars_srv:  g("sugars_serving"),
      protein_srv: g("proteins_serving"),
      salt_srv:    g("salt_serving"),
    },
  };
}


export { DISCOVERY_FILTERS, discoveryIntent, cloudDiscover, guessDomain, CLOUD_FILTERS, cloudSearch, resolveProduct, offViaAssisted, parseOFF };

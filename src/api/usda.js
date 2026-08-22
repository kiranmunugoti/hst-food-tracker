import { OffNotFound, OffRateLimited, readJson } from "./openFoodFacts.js";

// Second food source: USDA FoodData Central. Supplements Open Food Facts
// with full US packaged-goods coverage; converted into OFF's own shape so
// nothing downstream needs to know which database a record came from.
// ─── USDA FOODDATA CENTRAL ─────────────────────────────────────────────────────
// Second food source. Open Food Facts is strongest on European products; FDC's
// Branded Foods dataset covers US packaged goods with full ingredient
// statements, which is exactly what undeclared-substance detection needs.
//
// It is a SUPPLEMENT, not a replacement: FDC has no Nutri-Score, no NOVA group
// and no Eco-Score, so an OFF record is always preferred when both have the
// same product. Its own budget is separate (1,000 req/hour with a real key),
// and it is only queried when OFF has not already answered — never in parallel.
const USDA_PROXY = "/api/usda";

// FDC nutrient IDs → the OFF nutriment keys parseOFF already reads, so a
// converted record needs no special handling anywhere downstream.
const FDC_NUTRIENTS = {
  1008: "energy-kcal_100g",
  1004: "fat_100g",
  1258: "saturated-fat_100g",
  1005: "carbohydrates_100g",
  2000: "sugars_100g",
  1235: "added-sugars_100g",
  1079: "fiber_100g",
  1003: "proteins_100g",
};

async function usdaJson(path, params) {
  const qs = new URLSearchParams({ path, ...params }).toString();
  const r = await fetch(`${USDA_PROXY}?${qs}`);
  if (r.status === 404) throw new OffNotFound(path);
  if (r.status === 429) throw new OffRateLimited(429);
  if (!r.ok) {
    // 403 means the key is missing or its quota is gone. That is a
    // configuration problem, not an empty result, and must not read as one.
    let detail = "";
    try { detail = (await r.json())?.error || ""; } catch { /* ignore */ }
    throw new Error(detail || "FoodData Central HTTP " + r.status);
  }
  return readJson(r);
}

// Convert an FDC Branded Foods record into the raw OFF product shape. Doing the
// conversion at the edge of the source means the picker, parseOFF, the hazard
// engine and the cache all stay unchanged.
function fdcToOFF(food) {
  const nutriments = {};
  (food.foodNutrients || []).forEach(n => {
    const id = n.nutrientId ?? n.nutrient?.id;
    const key = FDC_NUTRIENTS[id];
    const val = n.value ?? n.amount;
    if (key && val != null) nutriments[key] = val;
    // Sodium arrives in mg. OFF stores sodium and salt in grams, and salt is
    // derived from sodium by the standard 2.5 factor.
    if (id === 1093 && val != null) {
      nutriments["sodium_100g"] = +(val / 1000).toFixed(4);
      nutriments["salt_100g"] = +((val / 1000) * 2.5).toFixed(4);
    }
  });

  // FDC splits the owner company from the marketing brand; keep both in OFF's
  // comma-separated order so brand grouping still rolls sub-brands up.
  const brands = [food.brandName, food.brandOwner].map(b => (b || "").trim()).filter(Boolean);
  const uniqBrands = [...new Set(brands)];

  return {
    code: food.gtinUpc || null,
    product_name: food.description || food.lowercaseDescription || "Unknown",
    brands: uniqBrands.join(","),
    image_url: null,                       // FDC hosts no product photography
    ingredients_text: food.ingredients || null,
    quantity: food.packageWeight || null,
    serving_size: food.servingSize ? `${food.servingSize}${food.servingSizeUnit || ""}` : null,
    // Deliberately absent: FDC computes none of these. Leaving them null is
    // truthful; inventing them would put a fabricated grade on the card.
    nutriscore_grade: null,
    nova_group: null,
    ecoscore_grade: null,
    additives_tags: [],                    // no additive taxonomy — hazards come from ingredients text
    allergens_tags: [],
    labels_tags: [],
    categories_tags: food.foodCategory ? [food.foodCategory] : [],
    nutriments,
    _source: "usda",
    _fdcId: food.fdcId || null,
  };
}

async function usdaSearch(terms, limit) {
  let d;
  try {
    d = await usdaJson("/foods/search", {
      query: terms,
      pageSize: String(Math.min(limit, 25)),
      dataType: "Branded",                 // packaged products only; raw commodity rows have no label
    });
  } catch (e) {
    if (e instanceof OffNotFound) return [];
    throw e;
  }
  return (d.foods || []).map(fdcToOFF).filter(p => p.product_name && p.product_name !== "Unknown");
}

// FDC has no barcode endpoint, but gtinUpc is indexed, so searching the digits
// and confirming an exact match is the supported way to resolve a barcode.
async function usdaGetByCode(code) {
  const hits = await usdaSearch(code, 5).catch(e => {
    if (e instanceof OffNotFound) return [];
    throw e;
  });
  const norm = (s) => String(s || "").replace(/^0+/, "");
  return hits.find(p => norm(p.code) === norm(code)) || null;
}

export { USDA_PROXY, FDC_NUTRIENTS, usdaJson, fdcToOFF, usdaSearch, usdaGetByCode };

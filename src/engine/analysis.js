import { DOMAIN, AI_MODE } from "../lib/config.js";
import { getRisk, fmt } from "../lib/theme.js";
import { localHazards, localSugar } from "../lib/hazards.js";
import { analyzeCosmetic } from "./cosmetics.js";
import { aiHazards, aiSugar, aiDietClassify } from "../api/claude.js";
import { asText, _offStatus } from "../api/openFoodFacts.js";
import { withMarket, marketTag } from "../api/market.js";
import { filterSearch } from "../api/filteredSearch.js";
import { resolveProduct, offViaAssisted } from "../api/discovery.js";

// The single analysis path used by every entry point (manual scan, picker
// choice, background scan from the search bar), plus the two free
// alternative-product finders that ride on the same Open Food Facts search.
async function fetchOFFAlternatives(categories, excludeName) {
  const cat = (categories || [])[0];
  if (!cat) return [];
  const catTag = cat.includes(":") ? cat : "en:" + cat;
  const grab = async (grades) => {
    try {
      // Goes through filterSearch so it gets the Search-a-licious path, the
      // proxy fallback and the 404/rate-limit handling — a raw fetch here had
      // none of them and failed silently to an empty alternatives list.
      // Market first — an alternative the reader cannot buy is not an
      // alternative. Widen only if the local market has nothing.
      const local = await filterSearch(
        withMarket({ categories_tags: catTag, nutrition_grades_tags: grades }), "food", 8);
      if (local.products.length >= 3 || !marketTag()) return local.products;
      const wide = await filterSearch(
        { categories_tags: catTag, nutrition_grades_tags: grades }, "food", 8);
      // Local results stay first; the rest fill the gap and are marked so the
      // card can say where they come from.
      const key = (x) => asText(x.product_name).toLowerCase().replace(/[^a-z0-9]/g, "");
      const seenC = new Set(local.products.map(key));
      return [...local.products,
              ...wide.products.filter(p => !seenC.has(key(p)))
                              .map(p => ({ ...p, _elsewhere: true }))];
    } catch { return []; }
  };
  let prods = await grab("a");
  if (prods.length < 3) prods = [...prods, ...(await grab("b"))];
  const seen = new Set(); const ex = (excludeName || "").toLowerCase();
  return prods
    .filter(p => { const nm = (p.product_name || "").trim().toLowerCase(); if (!nm || nm === ex || seen.has(nm)) return false; seen.add(nm); return true; })
    .slice(0, 3)
    .map(p => {
      const n = p.nutriments || {}; const sg = n["sugars_100g"]; const fb = n["fiber_100g"];
      return {
        name: asText(p.product_name).trim(), brand: asText(p.brands).split(",")[0].trim() || null,
        elsewhere: !!p._elsewhere,
        reason: `Nutri-Score ${(p.nutriscore_grade || "a").toUpperCase()} option in the same category${sg != null ? ` with ${fmt(Number(sg))}g sugars per 100g` : ""}.${p._elsewhere ? " Not confirmed as sold in your market." : ""}`,
        improvements: [sg != null && sg < 5 ? "Low sugar" : null, fb != null && fb > 3 ? "High fibre" : null, "Better Nutri-Score"].filter(Boolean),
        nutriScore: p.nutriscore_grade || "a", sourceUrl: null, sourceName: "Open Food Facts",
      };
    });
}

// Free calorie-matched whole-food alternatives via OFF category search
async function fetchOFFCalorieAlts(kcal) {
  if (kcal == null) return [];
  const cats = ["en:fruits", "en:vegetables", "en:nuts", "en:legumes", "en:cereals-and-potatoes"];
  const out = []; const seen = new Set();
  for (const c of cats) {
    try {
      const { products } = await filterSearch(
        withMarket({ categories_tags: c, nutrition_grades_tags: "a" }), "food", 12);
      products.forEach(p => {
        const n = p.nutriments || {}; const e = n["energy-kcal_100g"];
        if (e == null || Math.abs(e - kcal) > 50) return;
        const nm = (p.product_name || "").trim();
        if (!nm || seen.has(nm.toLowerCase())) return;
        seen.add(nm.toLowerCase());
        const num = (k) => (n[k] != null && n[k] !== "" ? Number(n[k]) : null);
        const sg = num("sugars_100g"), fb = num("fiber_100g"), pr = num("proteins_100g"), ft = num("fat_100g");
        out.push({
          name: nm, calories: Math.round(Number(e)), caloriesPer: "100g",
          brand: asText(p.brands).split(",")[0].trim() || null, category: c.replace("en:", ""),
          protein: pr, sugars: sg, fiber: fb, fat: ft,
          whyBetter: `Nutri-Score A whole-food option at ${Math.round(Number(e))} kcal per 100g.`,
          benefits: [fb != null && fb > 3 ? "High fibre" : null, sg != null && sg < 5 ? "Low sugar" : null, pr != null && pr > 5 ? "Protein source" : null].filter(Boolean),
          nutriScore: p.nutriscore_grade || "a", sourceUrl: null, sourceName: "Open Food Facts",
        });
      });
    } catch {}
    if (out.length >= 10) break;
  }
  return out.sort((a, b) => (b.fiber || 0) - (a.fiber || 0)).slice(0, 7);
}

// One free end-to-end product analysis (used by scan + background search scans)
// ─── ANALYSIS ──────────────────────────────────────────────────────────────────
// The single analysis path used by every entry point (manual scan, picker
// choice, background scan from the search bar). Takes an already-resolved
// product so it never issues a lookup of its own — that separation is what
// keeps the request budget predictable.
//
// Standard mode is fully deterministic. Enhanced mode layers extra findings on
// top and can only ever ADD to the baseline, never replace it, so a failed or
// empty enhanced response degrades silently instead of blanking the analysis.
async function analyzeProduct(offData, label) {
  // The product itself decides which engine runs — food limits and cosmetic
  // limits answer different questions and must never be applied to the wrong
  // thing, whatever mode the interface happens to be in.
  const productDomain = offData?._domain || DOMAIN;
  if (productDomain === "cosmetics") return { ...analyzeCosmetic(offData, label), domain: "cosmetics" };
  const name = offData?.name || label;
  const subs = localHazards(name, offData?.ingredients || null, offData?.additives || [], offData?.categories || []);
  let sugar = localSugar(offData, name);

  if (AI_MODE) {
    const extra = await aiHazards(name, offData?.ingredients || null).catch(() => []);
    const seen = new Set(subs.map(s => (s.key || "").toLowerCase()));
    extra.filter(s => s.key && s.name).forEach(s => {
      const k = s.key.toLowerCase();
      if (!seen.has(k)) { seen.add(k); subs.push({ ...s, id: s.key, source: "ai" }); }
    });
    if (!sugar) sugar = await aiSugar(name).catch(() => null);
  }

  const diet = await aiDietClassify(name, offData?.ingredients || null, offData?.labels || [], offData?.allergens || []).catch(() => "unknown");
  // Undeclared = documented for the product but absent from its ingredient list
  const undeclared = offData?.ingredients ? subs.filter(s => s.ingredientConfirmed === false) : [];
  return { offData, aiSugarData: sugar, allSubs: subs, risk: getRisk(subs), diet, undeclared, undeclaredCount: undeclared.length, domain: "food" };
}

// Resolve + analyze, bridging through the assisted path only when the network
// blocked OFF outright. Returns null when the caller should show a picker.
async function lookupAndAnalyze(label) {
  const { product, candidates, domain } = await resolveProduct(label).catch(() => ({ product: null, candidates: [], domain: "food" }));
  // Any candidate at all goes to the picker. A name search is a browse, so even
  // one result is shown as a choice rather than analysed on the user's behalf.
  if (candidates.length > 0) return { candidates, domain };
  let offData = product;
  if (!offData && (AI_MODE || _offStatus === "network")) offData = await offViaAssisted(label);
  if (offData && !offData._domain) offData._domain = domain;
  return { analysis: await analyzeProduct(offData, label), domain };
}

export { fetchOFFAlternatives, fetchOFFCalorieAlts, analyzeProduct, lookupAndAnalyze };

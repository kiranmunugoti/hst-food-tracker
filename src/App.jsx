import { useState, useRef, useEffect } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const GH_OWNER  = "kiranmunugoti";
const GH_REPO   = "hst-food-tracker";
const GH_BRANCH = "main";
const GH_FILE   = "db.json";
const GH_RAW    = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${GH_FILE}`;
// Set VITE_GH_TOKEN in Vercel env vars for write access. Reads are always public.
// __GH_TOKEN__ is injected at build time by Vite (see vite.config.js). Inside
// Claude artifacts the global doesn't exist — the typeof guard keeps the app
// running with reads public and writes silently disabled.
const GH_TOKEN  = (typeof __GH_TOKEN__ !== "undefined" && __GH_TOKEN__) || "";

// ─── ENGINE MODE ───────────────────────────────────────────────────────────────
// false = FREE MODE (default): local rules engine + Open Food Facts API + GitHub
//         cache. Zero AI calls, zero cost per scan — scales to millions of users.
// true  = AI MODE: Anthropic API enrichment (web-researched hazards, brand
//         research, generated insights). Costs per call — use as a premium tier.
//         NOTE: works out-of-the-box only inside Claude artifacts; on Vercel it
//         needs a serverless proxy for the API key. Every AI call falls back to
//         the free engine automatically if it fails.
// Toggleable at runtime from the ⚡ switch in the header.
let AI_MODE = false;

// ─── SEED HAZARD DB ────────────────────────────────────────────────────────────
const SEED = {
  glyphosate:{ name:"Glyphosate",       category:"Pesticide",           risk:"high",   eNumber:null,   foods:["wheat","oats","corn","soybeans"],      effects:"Potential carcinogen (IARC Group 2A), gut microbiome disruption", limit:"0.1 mg/kg (EU)" },
  lead:      { name:"Lead",             category:"Heavy Metal",          risk:"high",   eNumber:null,   foods:["leafy greens","root vegetables","rice"],effects:"Neurotoxic, impairs brain development",                           limit:"0.02 mg/kg" },
  mercury:   { name:"Mercury",          category:"Heavy Metal",          risk:"high",   eNumber:null,   foods:["tuna","swordfish","shark"],             effects:"Neurotoxin, dangerous for pregnant women",                        limit:"0.5 mg/kg" },
  arsenic:   { name:"Arsenic",          category:"Heavy Metal",          risk:"high",   eNumber:null,   foods:["rice","apple juice","seafood"],         effects:"Carcinogen, cardiovascular disease risk",                         limit:"0.01 mg/L" },
  acrylamide:{ name:"Acrylamide",       category:"Process Contaminant",  risk:"high",   eNumber:null,   foods:["french fries","potato chips","coffee"], effects:"Probable carcinogen, neurotoxic at high doses",                   limit:"ALARA (no official limit)" },
  aflatoxin: { name:"Aflatoxin B1",     category:"Mycotoxin",            risk:"high",   eNumber:null,   foods:["peanuts","corn","tree nuts","spices"],  effects:"Potent carcinogen, liver damage",                                 limit:"2 µg/kg (EU)" },
  bpa:       { name:"Bisphenol A",      category:"Packaging Chemical",   risk:"medium", eNumber:null,   foods:["canned goods","plastic packaging"],    effects:"Endocrine disruptor, developmental effects",                      limit:"0.04 µg/kg bw/day" },
  pfas:      { name:"PFAS",             category:"Packaging Chemical",   risk:"high",   eNumber:null,   foods:["microwave popcorn","fast food wraps"],  effects:"Immune suppression, cancer risk, hormone disruption",             limit:"4 ng/L (EPA)" },
  e102:      { name:"Tartrazine",       category:"Artificial Dye",       risk:"medium", eNumber:"E102", foods:["soft drinks","candy","snacks"],         effects:"Hyperactivity in children, allergic reactions",                   limit:"7.5 mg/kg bw/day" },
  e110:      { name:"Sunset Yellow FCF",category:"Artificial Dye",       risk:"medium", eNumber:"E110", foods:["orange drinks","candy","cereals"],      effects:"Hyperactivity, allergic reactions",                               limit:"4 mg/kg bw/day" },
  e211:      { name:"Sodium Benzoate",  category:"Preservative",         risk:"medium", eNumber:"E211", foods:["soft drinks","fruit juices","pickles"],  effects:"Forms benzene with Vit C; hyperactivity",                        limit:"5 mg/kg" },
  e249:      { name:"Potassium Nitrite",category:"Preservative",         risk:"high",   eNumber:"E249", foods:["cured meats","bacon","ham"],            effects:"Forms nitrosamines, colorectal cancer risk",                      limit:"150 mg/kg" },
  e250:      { name:"Sodium Nitrite",   category:"Preservative",         risk:"high",   eNumber:"E250", foods:["hot dogs","bacon","deli meats"],        effects:"Converts to nitrosamines; colorectal cancer risk",                limit:"150 mg/kg" },
  e407:      { name:"Carrageenan",      category:"Thickener",            risk:"medium", eNumber:"E407", foods:["dairy","chocolate milk","deli meats"],  effects:"Intestinal inflammation, possible carcinogen (degraded)",         limit:"Not established" },
  e951:      { name:"Aspartame",        category:"Artificial Sweetener", risk:"medium", eNumber:"E951", foods:["diet sodas","sugar-free gum"],          effects:"Possible carcinogen (IARC Group 2B, 2023)",                       limit:"40 mg/kg bw/day" },
  e171:      { name:"Titanium Dioxide", category:"Colour",               risk:"high",   eNumber:"E171", foods:["confectionery","chewing gum","donuts"], effects:"Possible carcinogen; banned in EU foods 2022",                    limit:"BANNED in EU" },
  e621:      { name:"MSG",              category:"Flavour Enhancer",     risk:"low",    eNumber:"E621", foods:["instant noodles","chips","soups"],      effects:"Headaches in sensitive individuals; GRAS",                        limit:"No ADI" },
  bha:       { name:"BHA",             category:"Preservative",         risk:"medium", eNumber:"E320", foods:["chips","crackers","cereals","butter"],  effects:"Possible carcinogen, endocrine disruptor",                        limit:"0.02% of fat" },
};

// ─── LOCAL RULES ENGINE (free — replaces per-scan AI calls) ────────────────────
// ~50 flagged E-number additives. Matched against OFF additives_tags (confirmed)
// and ingredient text. cat=category, fx=effects, lim=limit, m=ingredient regex.
const ADDITIVE_DB = {
  E102:{name:"Tartrazine",cat:"Artificial Dye",risk:"medium",fx:"Hyperactivity in children, allergic reactions",lim:"7.5 mg/kg bw/day",m:/tartrazine/},
  E104:{name:"Quinoline Yellow",cat:"Artificial Dye",risk:"medium",fx:"Hyperactivity; restricted in EU",lim:"0.5 mg/kg bw/day",m:/quinoline yellow/},
  E110:{name:"Sunset Yellow FCF",cat:"Artificial Dye",risk:"medium",fx:"Hyperactivity, allergic reactions",lim:"4 mg/kg bw/day",m:/sunset yellow/},
  E120:{name:"Carmine (Cochineal)",cat:"Colour",risk:"medium",fx:"Severe allergic reactions in sensitive individuals",lim:"2.5 mg/kg bw/day",m:/carmine|cochineal/},
  E122:{name:"Carmoisine",cat:"Artificial Dye",risk:"medium",fx:"Hyperactivity; banned in several countries",lim:"4 mg/kg bw/day",m:/carmoisine|azorubine/},
  E124:{name:"Ponceau 4R",cat:"Artificial Dye",risk:"medium",fx:"Hyperactivity; banned in US",lim:"0.7 mg/kg bw/day",m:/ponceau/},
  E127:{name:"Erythrosine",cat:"Artificial Dye",risk:"medium",fx:"Thyroid effects at high doses",lim:"0.1 mg/kg bw/day",m:/erythrosine/},
  E129:{name:"Allura Red AC",cat:"Artificial Dye",risk:"medium",fx:"Hyperactivity in children",lim:"7 mg/kg bw/day",m:/allura red/},
  E131:{name:"Patent Blue V",cat:"Artificial Dye",risk:"medium",fx:"Allergic reactions; banned in US",lim:"5 mg/kg bw/day",m:/patent blue/},
  E132:{name:"Indigo Carmine",cat:"Artificial Dye",risk:"low",fx:"Occasional hypersensitivity",lim:"5 mg/kg bw/day",m:/indigo carmine|indigotine/},
  E133:{name:"Brilliant Blue FCF",cat:"Artificial Dye",risk:"low",fx:"Rare allergic reactions",lim:"6 mg/kg bw/day",m:/brilliant blue/},
  E142:{name:"Green S",cat:"Artificial Dye",risk:"medium",fx:"Hypersensitivity; banned in several countries",lim:"5 mg/kg bw/day",m:/green s\b/},
  E150D:{name:"Caramel IV (Sulphite Ammonia)",cat:"Colour",risk:"medium",fx:"Contains 4-MEI, possible carcinogen",lim:"100 mg/kg bw/day",m:/caramel col/},
  E151:{name:"Brilliant Black BN",cat:"Artificial Dye",risk:"medium",fx:"Hypersensitivity; banned in several countries",lim:"5 mg/kg bw/day",m:/brilliant black/},
  E155:{name:"Brown HT",cat:"Artificial Dye",risk:"medium",fx:"Hypersensitivity, asthma reactions",lim:"1.5 mg/kg bw/day",m:/brown ht/},
  E171:{name:"Titanium Dioxide",cat:"Colour",risk:"high",fx:"Possible carcinogen; banned in EU foods 2022",lim:"BANNED in EU",m:/titanium dioxide/},
  E173:{name:"Aluminium",cat:"Colour",risk:"medium",fx:"Neurotoxicity concerns with accumulation",lim:"1 mg/kg bw/week",m:/aluminium powder/},
  E210:{name:"Benzoic Acid",cat:"Preservative",risk:"medium",fx:"Forms benzene with Vit C; hypersensitivity",lim:"5 mg/kg bw/day",m:/benzoic acid/},
  E211:{name:"Sodium Benzoate",cat:"Preservative",risk:"medium",fx:"Forms benzene with Vit C; hyperactivity",lim:"5 mg/kg bw/day",m:/sodium benzoate/},
  E212:{name:"Potassium Benzoate",cat:"Preservative",risk:"medium",fx:"Forms benzene with Vit C",lim:"5 mg/kg bw/day",m:/potassium benzoate/},
  E214:{name:"Parabens (Ethylparaben)",cat:"Preservative",risk:"high",fx:"Endocrine disruption; approval withdrawn in EU",lim:"Restricted",m:/paraben/},
  E220:{name:"Sulphur Dioxide",cat:"Preservative",risk:"medium",fx:"Asthma attacks, destroys vitamin B1",lim:"0.7 mg/kg bw/day",m:/sulphur dioxide|sulfur dioxide/},
  E221:{name:"Sodium Sulphite",cat:"Preservative",risk:"medium",fx:"Asthma and allergic reactions",lim:"0.7 mg/kg bw/day",m:/sodium sulphite|sodium sulfite/},
  E223:{name:"Sodium Metabisulphite",cat:"Preservative",risk:"medium",fx:"Asthma, hypersensitivity reactions",lim:"0.7 mg/kg bw/day",m:/metabisulphite|metabisulfite/},
  E249:{name:"Potassium Nitrite",cat:"Preservative",risk:"high",fx:"Forms nitrosamines, colorectal cancer risk",lim:"150 mg/kg",m:/potassium nitrite/},
  E250:{name:"Sodium Nitrite",cat:"Preservative",risk:"high",fx:"Converts to nitrosamines; colorectal cancer risk",lim:"150 mg/kg",m:/sodium nitrite|\bnitrite\b/},
  E251:{name:"Sodium Nitrate",cat:"Preservative",risk:"high",fx:"Converts to nitrite then nitrosamines",lim:"150 mg/kg",m:/sodium nitrate/},
  E252:{name:"Potassium Nitrate",cat:"Preservative",risk:"high",fx:"Converts to nitrite then nitrosamines",lim:"150 mg/kg",m:/potassium nitrate|saltpetre/},
  E310:{name:"Propyl Gallate",cat:"Preservative",risk:"medium",fx:"Possible endocrine disruptor",lim:"0.5 mg/kg bw/day",m:/propyl gallate/},
  E319:{name:"TBHQ",cat:"Preservative",risk:"medium",fx:"Possible carcinogen at high doses, immune effects",lim:"0.7 mg/kg bw/day",m:/tbhq|tert-?butylhydroquinone/},
  E320:{name:"BHA",cat:"Preservative",risk:"medium",fx:"Possible carcinogen, endocrine disruptor",lim:"1 mg/kg bw/day",m:/\bbha\b|butylated hydroxyanisole/},
  E321:{name:"BHT",cat:"Preservative",risk:"medium",fx:"Possible tumor promoter, endocrine effects",lim:"0.25 mg/kg bw/day",m:/\bbht\b|butylated hydroxytoluene/},
  E385:{name:"Calcium Disodium EDTA",cat:"Preservative",risk:"medium",fx:"Mineral depletion at high intake",lim:"1.9 mg/kg bw/day",m:/\bedta\b/},
  E407:{name:"Carrageenan",cat:"Thickener",risk:"medium",fx:"Intestinal inflammation, possible carcinogen (degraded)",lim:"Not established",m:/carrageenan/},
  E407A:{name:"Processed Eucheuma Seaweed",cat:"Thickener",risk:"medium",fx:"Similar concerns to carrageenan",lim:"Not established",m:/eucheuma/},
  E425:{name:"Konjac",cat:"Thickener",risk:"medium",fx:"Choking hazard; banned in jelly sweets in EU",lim:"10 g/kg",m:/konjac/},
  E433:{name:"Polysorbate 80",cat:"Emulsifier",risk:"medium",fx:"Gut microbiome disruption, inflammation",lim:"25 mg/kg bw/day",m:/polysorbate/},
  E466:{name:"Carboxymethyl Cellulose",cat:"Thickener",risk:"medium",fx:"Gut microbiome disruption, inflammation",lim:"Not established",m:/carboxymethyl ?cellulose|cellulose gum/},
  E471:{name:"Mono- and Diglycerides",cat:"Emulsifier",risk:"low",fx:"May contain trans fats; generally safe",lim:"Not established",m:/mono-? ?and di-?glycerides/},
  E551:{name:"Silicon Dioxide",cat:"Anti-caking Agent",risk:"low",fx:"Nanoparticle accumulation concerns",lim:"Under review (EFSA)",m:/silicon dioxide|silica/},
  E621:{name:"MSG",cat:"Flavour Enhancer",risk:"low",fx:"Headaches in sensitive individuals; GRAS",lim:"No ADI",m:/monosodium glutamate|\bmsg\b/},
  E627:{name:"Disodium Guanylate",cat:"Flavour Enhancer",risk:"low",fx:"Avoid with gout; often paired with MSG",lim:"Not established",m:/guanylate/},
  E631:{name:"Disodium Inosinate",cat:"Flavour Enhancer",risk:"low",fx:"Avoid with gout; often paired with MSG",lim:"Not established",m:/inosinate/},
  E924:{name:"Potassium Bromate",cat:"Flour Treatment",risk:"high",fx:"Carcinogen; banned in EU, UK, Canada",lim:"BANNED in EU",m:/bromate/},
  E950:{name:"Acesulfame K",cat:"Artificial Sweetener",risk:"medium",fx:"Possible metabolic effects; debated safety",lim:"9 mg/kg bw/day",m:/acesulfame/},
  E951:{name:"Aspartame",cat:"Artificial Sweetener",risk:"medium",fx:"Possible carcinogen (IARC Group 2B, 2023)",lim:"40 mg/kg bw/day",m:/aspartame/},
  E952:{name:"Cyclamate",cat:"Artificial Sweetener",risk:"medium",fx:"Banned in US since 1969",lim:"7 mg/kg bw/day",m:/cyclamate/},
  E954:{name:"Saccharin",cat:"Artificial Sweetener",risk:"medium",fx:"Historical carcinogenicity concerns",lim:"5 mg/kg bw/day",m:/saccharin/},
  E955:{name:"Sucralose",cat:"Artificial Sweetener",risk:"medium",fx:"Gut microbiome effects; unstable at high heat",lim:"15 mg/kg bw/day",m:/sucralose/},
  E1520:{name:"Propylene Glycol",cat:"Humectant",risk:"low",fx:"Generally safe; high doses affect CNS",lim:"25 mg/kg bw/day",m:/propylene glycol/},
};

// Category contaminants — never on labels, flagged as unconfirmed (→ undeclared alerts)
const CONTAMINANT_RULES = [
  [/\brice\b/, "arsenic"],
  [/\btuna\b|swordfish|shark|king mackerel|marlin|bigeye/, "mercury"],
  [/french fries|\bfries\b|crisps|potato chips|coffee|biscuit|cracker|cookie|toast/, "acrylamide"],
  [/peanut|groundnut|pistachio|\bcorn\b|maize|chilli powder|chili powder|nutmeg/, "aflatoxin"],
  [/\bcanned\b|\btinned\b/, "bpa"],
  [/microwave popcorn|fast.?food/, "pfas"],
  [/\bwheat\b|\boats?\b|\bbarley\b/, "glyphosate"],
];

function localHazards(name, ingredients, additives = [], categories = []) {
  const found = {};
  const ingr = (ingredients || "").toLowerCase();
  const mk = (eKey, rec, confirmed, via) => ({
    key: eKey.toLowerCase(), id: eKey.toLowerCase(), name: rec.name, eNumber: eKey,
    category: rec.cat, risk: rec.risk, effects: rec.fx, limit: rec.lim,
    foundInIngredient: via, ingredientConfirmed: confirmed,
    sourceUrl: `https://world.openfoodfacts.org/additive/${eKey.toLowerCase()}`, sourceName: "Open Food Facts",
    source: "local",
  });
  // 1. E-numbers declared in OFF additives_tags → confirmed
  (additives || []).forEach(tag => {
    const e = tag.replace(/^en:/, "").toUpperCase();
    if (ADDITIVE_DB[e] && !found[e]) found[e] = mk(e, ADDITIVE_DB[e], true, "declared additives");
  });
  // 2. E-numbers / names present in ingredient text → confirmed
  if (ingr) Object.entries(ADDITIVE_DB).forEach(([e, rec]) => {
    if (found[e]) return;
    if (ingr.includes(e.toLowerCase()) || (rec.m && rec.m.test(ingr)) || ingr.includes(rec.name.toLowerCase()))
      found[e] = mk(e, rec, true, rec.name);
  });
  // 3. Category-level contaminants → NOT confirmed (feeds undeclared alerts)
  const hay = (name + " " + ingr + " " + (categories || []).join(" ")).toLowerCase();
  CONTAMINANT_RULES.forEach(([re, seedKey]) => {
    if (re.test(hay) && SEED[seedKey] && !found[seedKey]) {
      const s = SEED[seedKey];
      found[seedKey] = { key: seedKey, id: seedKey, name: s.name, eNumber: s.eNumber, category: s.category, risk: s.risk, effects: s.effects, limit: s.limit, foundInIngredient: null, ingredientConfirmed: false, sourceUrl: null, sourceName: "Category pattern", source: "local" };
    }
  });
  return Object.values(found);
}

// Glycemic index estimation by food keyword (per 100g, typical published values)
const GI_TABLE = [
  [/glucose|dextrose/,100],[/soda|cola|soft drink/,63],[/juice/,50],[/candy|sweets|gumm/,70],
  [/white bread|bread|\bbun\b|bagel/,72],[/\brice\b/,70],[/corn ?flakes|breakfast cereal|cereal/,74],
  [/chocolate/,45],[/cookie|biscuit/,60],[/ice ?cream/,60],[/pasta|noodle/,50],
  [/yogh?urt/,35],[/\bmilk\b/,32],[/apple|pear|berr/,38],[/banana/,51],
  [/potato|fries|chips|crisps/,70],[/honey/,58],[/pizza/,60],[/\boats?\b/,55],
];

function localSugar(offData, name) {
  const sugars = offData?.nut?.sugars ?? null;
  if (sugars == null) return null;
  const hay = (name + " " + (offData?.categories || []).join(" ")).toLowerCase();
  let gi = null;
  for (const [re, v] of GI_TABLE) { if (re.test(hay)) { gi = v; break; } }
  const added = offData?.nut?.added_sugars ?? null;
  const diabeticRisk = sugars > 22.5 || (gi ?? 0) >= 70 ? "high" : sugars > 11.25 || (gi ?? 0) >= 56 ? "medium" : "low";
  return { total_sugars: sugars, added_sugars: added, natural_sugars: added != null ? +(sugars - added).toFixed(1) : null, gi: gi ?? 55, diabeticRisk };
}

function localInsight(name, subs, nut, offData) {
  const conf = (subs || []).filter(s => s.ingredientConfirmed !== false);
  const und  = (subs || []).filter(s => s.ingredientConfirmed === false);
  const parts = [];
  if (conf.length) {
    const high = conf.filter(s => s.risk === "high");
    const names = conf.slice(0, 3).map(s => s.name).join(", ");
    parts.push(high.length
      ? `${name} contains ${high.length} high-risk substance${high.length !== 1 ? "s" : ""} (${high.slice(0,2).map(s=>s.name).join(", ")}) — regular consumption is best avoided.`
      : `${name} contains ${conf.length} flagged additive${conf.length !== 1 ? "s" : ""} (${names}), generally considered acceptable in moderation.`);
  } else parts.push(`No hazardous substances were confirmed in the ingredient list of ${name}.`);
  if (und.length) parts.push(`${und.length} potential contaminant${und.length !== 1 ? "s" : ""} (${und.slice(0,2).map(s=>s.name).join(", ")}) ${und.length !== 1 ? "are" : "is"} associated with this food category but not declared on the label.`);
  const sugars = nut?.sugars ?? null;
  if (sugars != null) parts.push(sugars > 22.5 ? `At ${sugars}g of sugar per 100g this is a high-sugar product — limit portions, especially for diabetics.` : sugars > 11.25 ? `Sugar content is moderate at ${sugars}g per 100g.` : `Sugar content is low at ${sugars}g per 100g.`);
  const ns = offData?.nutriScore, nova = offData?.novaGroup;
  if (ns || nova) {
    const bits = [];
    if (ns) bits.push(`Nutri-Score ${ns.toUpperCase()}`);
    if (nova) bits.push(`NOVA group ${nova}${nova === 4 ? " (ultra-processed)" : ""}`);
    parts.push(`${bits.join(" and ")} overall${(ns && "de".includes(ns)) || nova === 4 ? " — prefer less processed alternatives where possible" : ""}.`);
  }
  return parts.join(" ");
}

function localBrandCred(brand, tracked) {
  const stats = computeBrandStats(tracked || []).find(b => b.brand.toLowerCase() === brand.toLowerCase());
  if (!stats) return null;
  return {
    score: Math.round(stats.score), verdict: stats.verdict, founded: null, headquarters: null,
    certifications: [],
    controversies: stats.undeclared > 0 ? [`${stats.undeclared} undeclared-substance report${stats.undeclared !== 1 ? "s" : ""} in community data`] : [],
    positives: (stats.ns.a + stats.ns.b) > 0 ? [`${stats.ns.a + stats.ns.b} product${stats.ns.a + stats.ns.b !== 1 ? "s" : ""} rated Nutri-Score A/B`] : [],
    summary: `Community rating from ${stats.count} scanned product${stats.count !== 1 ? "s" : ""}: ${stats.high} high-risk, ${stats.undeclared} undeclared substance report${stats.undeclared !== 1 ? "s" : ""}. Based on your scans and the shared database — not AI web research.`,
    transparency: stats.undeclared === 0 ? "High" : stats.undeclared <= 2 ? "Medium" : "Low",
    recallHistory: "Unknown",
  };
}

// Free healthier alternatives via the Open Food Facts search API
async function fetchOFFAlternatives(categories, excludeName) {
  const cat = (categories || [])[0];
  if (!cat) return [];
  const catTag = cat.includes(":") ? cat : "en:" + cat;
  const grab = async (grades) => {
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/search?categories_tags=${encodeURIComponent(catTag)}&nutrition_grades_tags=${grades}&fields=product_name,brands,nutriscore_grade,nutriments&page_size=8&sort_by=unique_scans_n`);
      if (!r.ok) return [];
      const d = await r.json();
      return d.products || [];
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
        name: p.product_name.trim(), brand: (p.brands || "").split(",")[0].trim() || null,
        reason: `Nutri-Score ${(p.nutriscore_grade || "a").toUpperCase()} option in the same category${sg != null ? ` with ${fmt(Number(sg))}g sugars per 100g` : ""}.`,
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
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/search?categories_tags=${c}&nutrition_grades_tags=a&fields=product_name,brands,nutriscore_grade,nutriments&page_size=12&sort_by=unique_scans_n`);
      if (!r.ok) continue;
      const d = await r.json();
      (d.products || []).forEach(p => {
        const n = p.nutriments || {}; const e = n["energy-kcal_100g"];
        if (e == null || Math.abs(e - kcal) > 50) return;
        const nm = (p.product_name || "").trim();
        if (!nm || seen.has(nm.toLowerCase())) return;
        seen.add(nm.toLowerCase());
        const num = (k) => (n[k] != null && n[k] !== "" ? Number(n[k]) : null);
        const sg = num("sugars_100g"), fb = num("fiber_100g"), pr = num("proteins_100g"), ft = num("fat_100g");
        out.push({
          name: nm, calories: Math.round(Number(e)), caloriesPer: "100g",
          brand: (p.brands || "").split(",")[0].trim() || null, category: c.replace("en:", ""),
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
  return { offData, aiSugarData: sugar, allSubs: subs, risk: getRisk(subs), diet, undeclared, undeclaredCount: undeclared.length };
}

// Resolve + analyze, bridging through the assisted path only when the network
// blocked OFF outright. Returns null when the caller should show a picker.
async function lookupAndAnalyze(label) {
  const { product, candidates } = await resolveProduct(label).catch(() => ({ product: null, candidates: [] }));
  if (candidates.length > 1) return { candidates };
  let offData = product;
  if (!offData && (AI_MODE || _offStatus === "network")) offData = await offViaAssisted(label);
  return { analysis: await analyzeProduct(offData, label) };
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────
const RISK_CFG = {
  high:   { fg:"#c0392b", bg:"rgba(192,57,43,0.08)",   border:"rgba(192,57,43,0.18)"   },
  medium: { fg:"#b07d2b", bg:"rgba(176,125,43,0.08)",  border:"rgba(176,125,43,0.18)"  },
  low:    { fg:"#2e7d52", bg:"rgba(46,125,82,0.08)",   border:"rgba(46,125,82,0.18)"   },
  none:   { fg:"#3d6b99", bg:"rgba(61,107,153,0.08)",  border:"rgba(61,107,153,0.18)"  },
};
const DIET_CFG = {
  vegan:       { label:"Vegan",       icon:"🌱", fg:"#2d7a45", bg:"rgba(45,122,69,0.09)",  border:"rgba(45,122,69,0.22)"  },
  vegetarian:  { label:"Vegetarian",  icon:"🥦", fg:"#4a8c2a", bg:"rgba(74,140,42,0.08)",  border:"rgba(74,140,42,0.2)"   },
  pescatarian: { label:"Pescatarian", icon:"🐟", fg:"#1a6e8a", bg:"rgba(26,110,138,0.08)", border:"rgba(26,110,138,0.2)"  },
  meat:        { label:"Meat-based",  icon:"🥩", fg:"#8a3a1a", bg:"rgba(138,58,26,0.08)",  border:"rgba(138,58,26,0.2)"   },
  unknown:     { label:"Unknown",     icon:"❓", fg:"#7a7670", bg:"rgba(122,118,112,0.06)",border:"rgba(122,118,112,0.15)" },
};
const NS_COLOR   = { a:"#2e7d52", b:"#4a9060", c:"#b07d2b", d:"#a0622a", e:"#c0392b" };
const NOVA_COLOR = { 1:"#2e7d52", 2:"#4a9060", 3:"#b07d2b", 4:"#c0392b" };
const NOVA_LABEL = { 1:"Unprocessed", 2:"Culinary ingredients", 3:"Processed", 4:"Ultra-processed" };

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function tlColor(type, v) {
  if (v == null) return "#999";
  const T = { fat:[17.5,3], satfat:[5,1.5], sugars:[22.5,11.25], salt:[1.5,0.75] };
  const [hi, med] = T[type] || [999, 999];
  return v >= hi ? "#c0392b" : v >= med ? "#b07d2b" : "#2e7d52";
}
function tlLabel(type, v) {
  if (v == null) return "";
  const T = { fat:[17.5,3], satfat:[5,1.5], sugars:[22.5,11.25], salt:[1.5,0.75] };
  const [hi, med] = T[type] || [999, 999];
  return v >= hi ? "High" : v >= med ? "Medium" : "Low";
}
function fmt(v, d = 1) {
  if (v == null) return "—";
  return typeof v === "number" ? v.toFixed(v < 0.1 ? 2 : d) : String(v);
}
function getRisk(subs) {
  if (!subs || subs.length === 0) return null;
  if (subs.some(s => s.risk === "high"))   return "high";
  if (subs.some(s => s.risk === "medium")) return "medium";
  return "low";
}
function normKey(str) {
  return str.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").slice(0, 80);
}
function lastText(d) {
  return (d.content || []).filter(b => b.type === "text").map(b => b.text).reverse()[0] || "";
}

// ─── THEME ─────────────────────────────────────────────────────────────────────
function makeTheme(dark) {
  return dark ? {
    bg:"#111213", bgSub:"#161819", surface:"#1c1e21", surfaceHov:"#202226",
    border:"#2a2d33", borderMed:"#353840", text:"#e8e9eb", textSub:"#8a8f9a", textMuted:"#555b68",
    accent:"#6b7cff", accentFg:"#fff", header:"#161819", tabBg:"#161819",
    leftBg:"#161819", rightBg:"#111213", inputBg:"#1c1e21", inputBorder:"#2a2d33", inputText:"#e8e9eb",
    cardBg:"#1c1e21", cardBorder:"#2a2d33", cardSel:"#1e2028", cardSelBorder:"#6b7cff",
    tableTh:"#1a1c20", tableBorder:"#252830", pill:"#222530", pillText:"#6e7585",
  } : {
    bg:"#f6f5f3", bgSub:"#f0eeec", surface:"#fff", surfaceHov:"#fafaf9",
    border:"#e8e6e2", borderMed:"#d4d0cb", text:"#1a1917", textSub:"#6b6760", textMuted:"#a09c97",
    accent:"#3d52c4", accentFg:"#fff", header:"#fff", tabBg:"#fff",
    leftBg:"#fff", rightBg:"#f6f5f3", inputBg:"#fff", inputBorder:"#e0ddd8", inputText:"#1a1917",
    cardBg:"#fafaf9", cardBorder:"#e8e6e2", cardSel:"#f8f7ff", cardSelBorder:"#3d52c4",
    tableTh:"#f4f2ef", tableBorder:"#ece9e4", pill:"#eeecea", pillText:"#7a7670",
  };
}

// ─── API HELPERS ───────────────────────────────────────────────────────────────
const WEB = [{ type:"web_search_20250305", name:"web_search" }];
const MODEL = "claude-sonnet-4-20250514";

async function callAI(prompt, maxTokens = 1500, useWeb = true) {
  const body = { model: MODEL, max_tokens: maxTokens, messages: [{ role:"user", content: prompt }] };
  if (useWeb) body.tools = WEB;
  const attempt = async (url) => {
    const r = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error?.message || ("HTTP " + r.status));
    return d;
  };
  try {
    // 1) Direct — works inside the Claude workspace (auth is injected there)
    const d = await attempt("https://api.anthropic.com/v1/messages");
    return lastText(d);
  } catch {
    // 2) Serverless proxy — works on Vercel with ANTHROPIC_API_KEY configured
    try {
      const d = await attempt("/api/claude");
      return lastText(d);
    } catch { return ""; }
  }
}

// ─── FREE OPEN FOOD FACTS API (no key, no cost) ────────────────────────────────
// Direct REST calls to world.openfoodfacts.org — completely free & CORS-enabled.
// Falls back to the AI-powered lookup only when direct fetch is blocked/fails.
const OFF_FIELDS = "product_name,brands,image_url,nutriscore_grade,nova_group,ecoscore_grade,quantity,serving_size,ingredients_text,additives_tags,allergens_tags,labels_tags,categories_tags,nutriments";

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

async function offJson(url) {
  let directErr = null;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } catch (e) { directErr = e; }
  const r = await fetch(`/api/off?url=${encodeURIComponent(url)}`);
  if (!r.ok) throw directErr || new Error("proxy HTTP " + r.status);
  return r.json();
}

async function offGetByCode(code) {
  const d = await offJson(`${OFF_HOST}/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
  return d.product?.product_name ? d.product : null;
}

async function offSearch(terms, limit) {
  const d = await offJson(`${OFF_HOST}/cgi/search.pl?search_terms=${encodeURIComponent(terms)}&search_simple=1&action=process&json=1&page_size=${limit}&fields=${OFF_FIELDS}`);
  return (d.products || []).filter(p => p.product_name);
}

// Resolve a query to a single product, or to a candidate list for the user to
// choose from. Returning candidates is what stops "amul milk" silently
// resolving to "Amul Milk Chocolate".
async function resolveProduct(query, limit = 6) {
  const q = query.trim();
  let blocked = 0, tried = 0;
  const step = async (fn) => { tried++; try { return await fn(); } catch { blocked++; return null; } };
  const done = (product, candidates) => {
    const found = !!product || (candidates && candidates.length > 0);
    _offStatus = found ? "ok" : (tried > 0 && blocked >= tried ? "network" : "nomatch");
    return { product: product ? parseOFF(product) : null, candidates: candidates || [] };
  };

  // Barcode: exact lookup, one request.
  if (/^\d{8,14}$/.test(q)) return done(await step(() => offGetByCode(q)), []);

  // Name: one search request; multiple hits become the picker list.
  const hits = (await step(() => offSearch(q, limit))) || [];
  if (hits.length === 1) return done(hits[0], []);
  if (hits.length > 1)   return done(null, hits);

  // Nothing matched — one retry via the modern search host, which handles
  // fuzzy multi-word queries better, then fetch that product by barcode.
  const code = await step(async () => {
    const d = await offJson(`${OFF_SEARCH_HOST}/search?q=${encodeURIComponent(q)}&page_size=3`);
    return (d.hits || []).find(h => h.code)?.code || null;
  });
  if (code) return done(await step(() => offGetByCode(code)), []);
  return done(null, []);
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
    name: p.product_name || "Unknown",
    brand: (p.brands || "").split(",")[0].trim() || null,
    image: p.image_url || null,
    quantity: p.quantity || null,
    servingSize: p.serving_size || null,
    nutriScore: p.nutriscore_grade?.toLowerCase() || null,
    novaGroup: p.nova_group ? Number(p.nova_group) : null,
    ecoScore: p.ecoscore_grade?.toLowerCase() || null,
    ingredients: p.ingredients_text || null,
    additives: (p.additives_tags || []).map(a => a.replace(/^en:/, "")),
    allergens: (p.allergens_tags || []).map(a => a.replace(/^en:/, "")),
    labels: (p.labels_tags || []).map(l => l.replace(/^en:/, "")),
    categories: (p.categories_tags || []).slice(0, 3).map(c => c.replace(/^en:/, "")),
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

async function aiHazards(name, ingredients) {
  const hasIngr = !!(ingredients && ingredients.trim().length > 10);
  const ctx = hasIngr
    ? `Product: "${name}". Ingredient list: "${ingredients.slice(0, 800)}"`
    : `Product name only: "${name}"`;
  const rule = hasIngr
    ? `STRICT: Only flag substances ACTUALLY PRESENT in the ingredient list. Map each to a specific ingredient. Return [] if none confirmed.`
    : `No ingredients available. Only include substances documented in published sources for this specific product. Set ingredientConfirmed:false for all.`;
  try {
    const txt = await callAI(`${ctx} ${rule} Use web search to verify. Return ONLY a JSON array (no markdown): [{"key":"snake_id","name":"Name","eNumber":"E211 or null","category":"Pesticide|Heavy Metal|Artificial Dye|Preservative|Artificial Sweetener|Flavour Enhancer|Thickener|Colour|Mycotoxin|Process Contaminant|Packaging Chemical|Other","risk":"high|medium|low","effects":"1 sentence","limit":"regulatory limit","foundInIngredient":"exact ingredient or null","ingredientConfirmed":true,"sourceUrl":"https://... or null","sourceName":"EFSA or FDA or null"}]`, 2000, true);
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function aiSugar(name) {
  try {
    const txt = await callAI(`Find sugar data for "${name}". Return ONLY JSON: {"total_sugars":number,"added_sugars":number_or_null,"natural_sugars":number_or_null,"gi":number,"diabeticRisk":"high|medium|low"}. Per 100g.`, 400, true);
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    return p.total_sugars != null ? p : null;
  } catch { return null; }
}

async function aiBrandCredibility(brand, productName) {
  if (!brand) return null;
  try {
    const txt = await callAI(`Research food brand "${brand}" (product: "${productName}"). Return ONLY JSON: {"score":1_to_10,"verdict":"Excellent|Good|Average|Poor|Concerning","founded":year_or_null,"headquarters":"city,country or null","certifications":[],"controversies":[],"positives":[],"summary":"2 sentences","transparency":"High|Medium|Low","recallHistory":"Clean|Minor recalls|Major recalls|Unknown"}`, 800, true);
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch { return null; }
}

async function aiDietClassify(name, ingredients, labels, allergens) {
  const text = [(ingredients || ""), ...(labels || []), ...(allergens || [])].join(" ").toLowerCase();
  const hasMeat   = /beef|pork|chicken|lamb|turkey|duck|bacon|ham|sausage|lard|gelatin/.test(text);
  const hasFish   = /anchov|tuna|salmon|shrimp|prawn|crab|lobster|fish|seafood/.test(text);
  const hasDairy  = /milk|cream|butter|cheese|whey|lactose|casein|yogurt/.test(text);
  const hasEgg    = /\begg\b|albumen/.test(text);
  const hasHoney  = /honey|beeswax|carmine|shellac|isinglass/.test(text);
  const isVeganLbl = (labels || []).some(l => /vegan/i.test(l));
  const isVegLbl   = (labels || []).some(l => /vegetarian/i.test(l));
  if (hasMeat) return "meat";
  if (hasFish && !hasMeat) return "pescatarian";
  if (isVeganLbl && !hasDairy && !hasEgg && !hasHoney) return "vegan";
  if (isVegLbl && !hasFish) return "vegetarian";
  if (!hasMeat && !hasFish && !hasDairy && !hasEgg && !hasHoney && ingredients && ingredients.length > 20) return "vegan";
  if (!hasMeat && !hasFish && (hasDairy || hasEgg)) return "vegetarian";
  if (!ingredients || !AI_MODE) return "unknown";
  try {
    const txt = await callAI(`Product: "${name}". Ingredients: "${(ingredients || "").slice(0, 300)}". Return ONE word: vegan, vegetarian, pescatarian, meat, or unknown.`, 30, false);
    const ans = txt.trim().toLowerCase().replace(/[^a-z]/g, "");
    return ["vegan","vegetarian","pescatarian","meat","unknown"].includes(ans) ? ans : "unknown";
  } catch { return "unknown"; }
}

async function aiInsight(name, subs, nut, offData) {
  const confirmed = (subs || []).filter(s => s.ingredientConfirmed !== false).map(s => s.name).join(", ") || "none";
  const sugar = nut?.sugars ?? null;
  try {
    const txt = await callAI(`Safety analysis for "${name}". Confirmed hazardous substances (in ingredients): ${confirmed}. Total sugars: ${sugar != null ? sugar + "g/100g" : "unknown"}. Nutri-Score: ${offData?.nutriScore?.toUpperCase() || "N/A"}, NOVA: ${offData?.novaGroup || "N/A"}. Write 3-4 sentences: overall safety, sugar concerns, one practical tip. Base only on confirmed facts.`, 700, false);
    return txt || "Analysis unavailable.";
  } catch { return "Analysis unavailable."; }
}

async function aiAlternatives(name, brand, nutriScore, risk, ingredients) {
  try {
    const txt = await callAI(`User scanned "${name}" by ${brand || "unknown"}. Nutri-Score: ${nutriScore?.toUpperCase() || "unknown"}, Risk: ${risk || "unknown"}. Find 2-3 healthier real alternatives. Return ONLY JSON array: [{"name":"Product","brand":"Brand","reason":"Why better (1 sentence)","improvements":["improvement"],"nutriScore":"a|b|c|d|e|unknown","sourceUrl":"https://... or null","sourceName":"source or null"}]`, 800, true);
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function aiCalorieAlts(name, calories, category, risk, nutrients) {
  try {
    const txt = await callAI(`User scanned "${name}" (${calories || "unknown"} kcal/100g, ${risk || "unknown"} risk, category: ${category || "food"}). Nutrients: ${JSON.stringify(nutrients || {})}. Find 5-7 healthier alternatives within ±50 kcal per 100g. RULES: (1) ALWAYS include fruits and vegetables — e.g. apples, bananas, berries, avocado based on calorie range. (2) Mix whole foods AND minimally processed. (3) Priority: fruits/veg > whole grains > minimally processed. (4) Verify calories via web search. Return ONLY JSON array: [{"name":"Specific name e.g. Fresh Apple","calories":number,"caloriesPer":"100g","brand":null,"category":"Fruit|Vegetable|Nut|Grain|Snack|Other","protein":number_or_null,"sugars":number_or_null,"fiber":number_or_null,"fat":number_or_null,"whyBetter":"1 sentence","benefits":["benefit"],"nutriScore":"a|b|c|d|e|unknown","sourceUrl":"https://... or null","sourceName":"source or null"}]. Sort healthiest first. At least 2-3 must be fruits/veg/nuts.`, 1500, true);
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ─── GITHUB DB ─────────────────────────────────────────────────────────────────
// ghDb is module-level so it persists across re-renders without React state
let _ghDb = { products:{}, searchLog:[] };
let _ghSha = "";

async function ghLoad(setDbCount) {
  try {
    const r = await fetch(`${GH_RAW}?t=${Date.now()}`);
    if (!r.ok) return;
    const data = await r.json();
    _ghDb = data;
    setDbCount(Object.keys(data.products || {}).length);
    // Also get SHA for writes
    if (GH_TOKEN) {
      const r2 = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`, {
        headers:{ Authorization:`Bearer ${GH_TOKEN}`, Accept:"application/vnd.github.v3+json" },
      });
      if (r2.ok) { const meta = await r2.json(); _ghSha = meta.sha; }
    }
  } catch (e) { console.warn("ghLoad:", e); }
}

function ghGet(ck) {
  const rec = _ghDb.products?.[ck];
  if (!rec) return null;
  const ageDays = (Date.now() - (rec.savedAt || 0)) / 86400000;
  return ageDays > 30 ? null : rec; // expire after 30 days
}

// Write the whole DB to GitHub. Returns "saved" | "no-token" | "error".
// Handles stale/missing sha (409/422) by refetching and retrying once.
async function ghWrite(message) {
  if (!GH_TOKEN) return "no-token";
  try {
    const body = JSON.stringify(_ghDb, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(body)));
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`;
    const headers = { Authorization:`Bearer ${GH_TOKEN}`, "Content-Type":"application/json", Accept:"application/vnd.github.v3+json" };
    const doPut = () => fetch(url, { method:"PUT", headers, body: JSON.stringify({ message, content: encoded, branch: GH_BRANCH, ...(_ghSha ? { sha: _ghSha } : {}) }) });
    let r = await doPut();
    if (r.status === 409 || r.status === 422) {
      // sha stale (another writer) or wrong — refresh and retry once
      const m = await fetch(url, { headers: { Authorization:`Bearer ${GH_TOKEN}`, Accept:"application/vnd.github.v3+json" } });
      if (m.ok) _ghSha = (await m.json()).sha;
      else if (m.status === 404) _ghSha = ""; // file doesn't exist yet — create it
      r = await doPut();
    }
    if (!r.ok) { console.warn("ghWrite failed:", r.status, await r.text().catch(()=> "")); return "error"; }
    const resp = await r.json();
    _ghSha = resp.content?.sha || _ghSha;
    return "saved";
  } catch (e) { console.warn("ghWrite:", e); return "error"; }
}

async function ghSet(ck, data, setDbCount) {
  _ghDb.products = _ghDb.products || {};
  _ghDb.products[ck] = { ...data, savedAt: Date.now(), version: 1 };
  _ghDb._meta = { lastUpdated: new Date().toISOString().slice(0,10), totalProducts: Object.keys(_ghDb.products).length };
  setDbCount(Object.keys(_ghDb.products).length);
  return ghWrite(`db: ${ck}`);
}

// ─── BRAND RATINGS ─────────────────────────────────────────────────────────────
function undeclaredOf(rec) {
  // Substances documented for the product but NOT found on its ingredient label
  if (rec.undeclaredCount != null) return rec.undeclaredCount;
  if (!rec.offData?.ingredients) return 0;
  const subs = rec.allSubs || rec.substances || [];
  return subs.filter(s => s.ingredientConfirmed === false).length;
}

function brandScoreOf(b) {
  // Per-product weighted penalty → 0-10 score
  const penalty = (b.high * 2 + b.medium * 0.75 + b.undeclared * 1.5 + b.ns.c * 0.5 + b.ns.d * 1 + b.ns.e * 1.5) / Math.max(1, b.count);
  const score = Math.max(0, Math.min(10, +(10 - penalty * 2.2).toFixed(1)));
  const verdict = score >= 8 ? "Excellent" : score >= 6 ? "Good" : score >= 4 ? "Average" : score >= 2 ? "Poor" : "Concerning";
  return { score, verdict };
}

function computeBrandStats(tracked) {
  const map = {}; const seen = new Set();
  const push = (brand, rec) => {
    const bk = brand.toLowerCase().trim();
    if (!map[bk]) map[bk] = { brand, count:0, high:0, medium:0, low:0, undeclared:0, ns:{a:0,b:0,c:0,d:0,e:0}, hits:0, products:[] };
    const b = map[bk];
    b.count++; b.hits += rec.hitCount || 1;
    if (rec.risk === "high") b.high++; else if (rec.risk === "medium") b.medium++; else if (rec.risk === "low") b.low++;
    const und = undeclaredOf(rec); b.undeclared += und;
    const ns = rec.offData?.nutriScore; if (ns && b.ns[ns] != null) b.ns[ns]++;
    b.products.push({ name: rec.offData?.name || rec.name || "Unknown", risk: rec.risk || null, ns: ns || null, undeclared: und });
  };
  tracked.forEach(f => {
    if (!f.offData?.brand) return;
    const k = (f.offData.brand + "|" + (f.offData.name || f.name || "")).toLowerCase();
    if (!seen.has(k)) { seen.add(k); push(f.offData.brand, f); }
  });
  Object.values(_ghDb.products || {}).forEach(rec => {
    if (!rec.offData?.brand) return;
    const k = (rec.offData.brand + "|" + (rec.offData.name || "")).toLowerCase();
    if (!seen.has(k)) { seen.add(k); push(rec.offData.brand, rec); }
  });
  return Object.values(map).map(b => ({ ...b, ...brandScoreOf(b) })).sort((a, z) => z.score - a.score || z.count - a.count);
}

function brandHistory(brand) {
  // Prior record of a brand across the shared DB (for scan-time alerts)
  if (!brand) return null;
  const bl = brand.toLowerCase().trim();
  const recs = Object.values(_ghDb.products || {}).filter(p => (p.offData?.brand || "").toLowerCase().trim() === bl);
  if (!recs.length) return null;
  return {
    count: recs.length,
    undeclared: recs.reduce((a, p) => a + undeclaredOf(p), 0),
    high: recs.filter(p => p.risk === "high").length,
  };
}

let _searchFlushTimer = null;
function ghLogSearch(query, category) {
  if (!_ghDb.searchLog) _ghDb.searchLog = [];
  _ghDb.searchLog.unshift({ query, category, at: Date.now() });
  if (_ghDb.searchLog.length > 500) _ghDb.searchLog = _ghDb.searchLog.slice(0, 500);
  // Persist search records too — debounced to one commit per 20s of activity
  if (GH_TOKEN) {
    clearTimeout(_searchFlushTimer);
    _searchFlushTimer = setTimeout(() => ghWrite("log: searches"), 20000);
  }
}

// ─── FOOD ILLUSTRATION ─────────────────────────────────────────────────────────
function FoodBg() {
  const items = [
    {x:8,y:12,s:2.2,r:-15,e:"🥦"},{x:78,y:8,s:1.8,r:20,e:"🍎"},{x:45,y:5,s:2.0,r:0,e:"🥕"},
    {x:18,y:72,s:2.4,r:10,e:"🍋"},{x:85,y:65,s:2.1,r:-20,e:"🫐"},{x:62,y:78,s:1.9,r:15,e:"🧄"},
    {x:32,y:85,s:2.3,r:-8,e:"🥑"},{x:90,y:30,s:1.7,r:25,e:"🍊"},{x:5,y:45,s:1.6,r:-30,e:"🌽"},
    {x:55,y:90,s:2.0,r:12,e:"🍓"},{x:72,y:48,s:1.5,r:-18,e:"🥝"},{x:24,y:33,s:1.8,r:22,e:"🫑"},
    {x:48,y:58,s:1.4,r:-5,e:"🍇"},{x:88,y:85,s:1.6,r:18,e:"🧅"},{x:15,y:88,s:1.7,r:-12,e:"🥐"},
  ];
  return (
    <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",userSelect:"none"}}>
      {items.map((it, i) => (
        <div key={i} style={{
          position:"absolute", left:`${it.x}%`, top:`${it.y}%`,
          fontSize:`${it.s}rem`, transform:`rotate(${it.r}deg)`,
          opacity:0.07, filter:"grayscale(100%)",
          animation:`foodFloat ${3+i*0.4}s ease-in-out ${i*0.3}s infinite alternate`,
        }}>{it.e}</div>
      ))}
    </div>
  );
}

// ─── TOAST ─────────────────────────────────────────────────────────────────────
function Toast({ items, onDismiss, t }) {
  const colors = { off:"#2e7d52", high:"#c0392b", medium:"#b07d2b", sugar:"#3d6b99", cache:"#6b7cff", shared:"#3d52c4", database:"#2e7d52", scan:"#3d52c4", undeclared:"#c0392b", brand:"#8a3a1a" };
  const labels = { off:"Open Food Facts", high:"High Risk", medium:"Medium Risk", sugar:"Sugar Alert", cache:"Cached", shared:"Shared DB", database:"GitHub DB", scan:"AI Scan", undeclared:"Undeclared Substance", brand:"Brand Alert" };
  return (
    <div style={{position:"fixed",top:16,right:16,zIndex:9999,display:"flex",flexDirection:"column",gap:8,maxWidth:340,pointerEvents:"none"}}>
      {items.map(n => {
        const c = colors[n.type] || colors.scan;
        return (
          <div key={n.id} style={{background:t.surface,borderLeft:`3px solid ${c}`,border:`1px solid ${t.border}`,borderRadius:8,padding:"10px 14px",display:"flex",gap:10,alignItems:"flex-start",boxShadow:"0 4px 24px rgba(0,0,0,0.12)",animation:"slideIn 0.28s ease",pointerEvents:"all"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:10,fontWeight:600,color:c,marginBottom:3}}>{labels[n.type] || "Info"}</div>
              <div style={{fontSize:12,color:t.textSub,lineHeight:1.5}}>{n.message}</div>
            </div>
            <button onClick={() => onDismiss(n.id)} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:16,padding:0,lineHeight:1}}>×</button>
          </div>
        );
      })}
    </div>
  );
}

// ─── BRAND CARD ────────────────────────────────────────────────────────────────
function BrandCard({ cred, brand, loading, t }) {
  if (loading) return (
    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"18px 20px"}}>
      <div style={{fontSize:12,fontWeight:600,color:t.textSub,marginBottom:12}}>Brand Credibility</div>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <div style={{width:48,height:48,borderRadius:10,background:t.pill,animation:"shimmer 1.4s ease infinite"}}/>
        <div style={{flex:1}}><div style={{height:12,width:"60%",background:t.pill,borderRadius:4,marginBottom:6}}/><div style={{height:10,width:"40%",background:t.pill,borderRadius:4}}/></div>
      </div>
    </div>
  );
  if (!cred) return null;
  const sc = cred.score;
  const scoreColor = sc>=8?"#2e7d52":sc>=6?"#b07d2b":sc>=4?"#a0622a":"#c0392b";
  const arc = (sc / 10) * 251;
  return (
    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"16px 20px",borderBottom:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
        <div>
          <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>Brand Credibility</div>
          <div style={{fontSize:16,fontWeight:700,color:t.text}}>{brand}</div>
          {cred.founded && <div style={{fontSize:11,color:t.textSub,marginTop:2}}>Est. {cred.founded}{cred.headquarters ? ` · ${cred.headquarters}` : ""}</div>}
        </div>
        <div style={{position:"relative",width:64,height:64,flexShrink:0}}>
          <svg viewBox="0 0 90 90" width={64} height={64} style={{transform:"rotate(-90deg)"}}>
            <circle cx="45" cy="45" r="40" fill="none" stroke={t.border} strokeWidth="7"/>
            <circle cx="45" cy="45" r="40" fill="none" stroke={scoreColor} strokeWidth="7" strokeDasharray={`${arc} 251`} strokeLinecap="round"/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:16,fontWeight:800,color:scoreColor,lineHeight:1}}>{sc}</span>
            <span style={{fontSize:8,color:t.textMuted}}>/10</span>
          </div>
        </div>
      </div>
      <div style={{padding:"10px 20px",background:sc>=8?"rgba(46,125,82,0.06)":sc>=6?"rgba(176,125,43,0.06)":"rgba(192,57,43,0.06)",borderBottom:`1px solid ${t.border}`,display:"flex",gap:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:12,fontWeight:700,color:scoreColor}}>{cred.verdict}</span>
        {cred.transparency && <div style={{display:"flex",gap:5,alignItems:"center"}}><span style={{fontSize:10,color:t.textMuted}}>Transparency:</span><span style={{fontSize:10,fontWeight:600,color:cred.transparency==="High"?"#2e7d52":cred.transparency==="Medium"?"#b07d2b":"#c0392b"}}>{cred.transparency}</span></div>}
        {cred.recallHistory && <div style={{display:"flex",gap:5,alignItems:"center"}}><span style={{fontSize:10,color:t.textMuted}}>Recalls:</span><span style={{fontSize:10,fontWeight:600,color:cred.recallHistory==="Clean"?"#2e7d52":"#c0392b"}}>{cred.recallHistory}</span></div>}
      </div>
      {cred.summary && <div style={{padding:"12px 20px",borderBottom:`1px solid ${t.border}`}}><p style={{margin:0,fontSize:12,color:t.textSub,lineHeight:1.7}}>{cred.summary}</p></div>}
      <div style={{padding:"14px 20px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        {cred.certifications?.length > 0 && (
          <div>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:7}}>Certifications</div>
            {cred.certifications.slice(0,3).map(c => <div key={c} style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}><div style={{width:5,height:5,borderRadius:"50%",background:"#2e7d52",flexShrink:0}}/><span style={{fontSize:11,color:t.textSub}}>{c}</span></div>)}
          </div>
        )}
        {cred.positives?.length > 0 && (
          <div>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:7}}>Strengths</div>
            {cred.positives.slice(0,3).map(p => <div key={p} style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}><div style={{width:5,height:5,borderRadius:"50%",background:"#3d52c4",flexShrink:0}}/><span style={{fontSize:11,color:t.textSub}}>{p}</span></div>)}
          </div>
        )}
        {cred.controversies?.length > 0 && (
          <div style={{gridColumn:"1/-1"}}>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:7}}>Known Concerns</div>
            {cred.controversies.slice(0,3).map(c => <div key={c} style={{display:"flex",gap:6,alignItems:"flex-start",marginBottom:4}}><div style={{width:5,height:5,borderRadius:"50%",background:"#c0392b",flexShrink:0,marginTop:5}}/><span style={{fontSize:11,color:t.textSub,lineHeight:1.5}}>{c}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NUTRITION ROW ─────────────────────────────────────────────────────────────
function NRow({ label, val100, valSrv, unit, ri, bold, indent, type, hasSrv, t }) {
  if (val100 == null && valSrv == null) return null;
  const pct = ri && val100 != null ? Math.round((val100 / ri) * 100) : null;
  const col = type ? tlColor(type, val100) : (t?.text || "#1a1917");
  return (
    <tr style={{borderBottom:`1px solid ${t?.tableBorder||"#eee"}`}}>
      <td style={{padding:indent?"5px 12px 5px 26px":"8px 12px",fontSize:indent?11:12.5,color:t?.text||"#1a1917",fontWeight:bold?600:400}}>
        {indent && <span style={{color:t?.textMuted,marginRight:5}}>—</span>}{label}
      </td>
      <td style={{padding:"8px 12px",fontSize:12.5,fontWeight:bold?600:500,color:col,textAlign:"right",fontFamily:"monospace",whiteSpace:"nowrap"}}>
        {val100 != null ? `${fmt(val100)}${unit}` : "—"}
      </td>
      {hasSrv && <td style={{padding:"8px 12px",fontSize:11.5,color:t?.textSub||"#6b6760",textAlign:"right",fontFamily:"monospace",whiteSpace:"nowrap"}}>{valSrv != null ? `${fmt(valSrv)}${unit}` : "—"}</td>}
      <td style={{padding:"8px 12px",fontSize:11,color:type?col:(t?.textMuted||"#aaa"),textAlign:"right",fontFamily:"monospace",whiteSpace:"nowrap"}}>{pct != null ? `${pct}%` : ""}</td>
    </tr>
  );
}

// ─── OFF PRODUCT CARD ──────────────────────────────────────────────────────────
function OFFCard({ offData, aiSugarData, substances, insight, insightLoading, brandCred, brandCredLoading, alternatives, altLoading, diet, t, dark }) {
  const [showIngr, setShowIngr] = useState(false);
  const n = offData.nut;
  const hasSrv = !!offData.servingSize;
  const totalSugars   = n.sugars        ?? aiSugarData?.total_sugars   ?? null;
  const addedSugars   = n.added_sugars  ?? aiSugarData?.added_sugars   ?? null;
  const naturalSugars = (totalSugars != null && addedSugars != null) ? +(totalSugars - addedSugars).toFixed(1) : (aiSugarData?.natural_sugars ?? null);
  const riskLevel = getRisk(substances);
  const ns = offData.nutriScore;
  const dc = diet && diet !== "unknown" ? DIET_CFG[diet] : null;
  const card = { background:t.surface, border:`1px solid ${t.border}`, borderRadius:12, overflow:"hidden" };
  const sHdr = { padding:"12px 16px", borderBottom:`1px solid ${t.border}`, fontSize:11, fontWeight:600, color:t.textMuted, letterSpacing:"0.06em", textTransform:"uppercase" };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* PRODUCT HEADER */}
      <div style={{...card}}>
        <div style={{display:"flex",flexWrap:"wrap"}}>
          <div style={{width:156,minHeight:156,background:dark?"#1a1c20":"#f8f7f5",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,borderRight:`1px solid ${t.border}`,overflow:"hidden"}}>
            {offData.image && (offData.image.startsWith("data:image/") || offData.image.startsWith("http"))
              ? <img src={offData.image} alt={offData.name} style={{width:"100%",height:156,objectFit:"contain",padding:10,boxSizing:"border-box"}}/>
              : <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:14,textAlign:"center"}}><span style={{fontSize:34,opacity:0.2}}>🛒</span><span style={{fontSize:9,color:t.textMuted,lineHeight:1.5}}>No image</span></div>
            }
          </div>
          <div style={{flex:1,padding:"16px 18px",minWidth:0}}>
            {offData.brand && <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:3}}>{offData.brand}</div>}
            <h2 style={{margin:"0 0 5px",fontSize:17,fontWeight:700,color:t.text,lineHeight:1.3,wordBreak:"break-word"}}>{offData.name}</h2>
            {offData.quantity && <div style={{fontSize:11,color:t.textSub}}>{offData.quantity}{offData.servingSize ? ` · Serving: ${offData.servingSize}` : ""}</div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:10,alignItems:"center"}}>
              <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",border:"1px solid rgba(46,125,82,0.2)",padding:"2px 8px",borderRadius:4}}>Open Food Facts</span>
              {riskLevel && <span style={{fontSize:9,fontWeight:600,color:RISK_CFG[riskLevel].fg,background:RISK_CFG[riskLevel].bg,border:`1px solid ${RISK_CFG[riskLevel].border}`,padding:"2px 8px",borderRadius:4}}>{riskLevel.charAt(0).toUpperCase()+riskLevel.slice(1)} Risk</span>}
              {offData.labels.slice(0,2).map(l => <span key={l} style={{fontSize:9,color:t.textSub,background:t.pill,border:`1px solid ${t.border}`,padding:"2px 8px",borderRadius:4,textTransform:"capitalize"}}>{l.replace(/-/g," ")}</span>)}
            </div>
            {dc && (
              <div style={{marginTop:8,display:"inline-flex",alignItems:"center",gap:7,background:dc.bg,border:`1px solid ${dc.border}`,borderRadius:8,padding:"5px 12px"}}>
                <span style={{fontSize:15,lineHeight:1}}>{dc.icon}</span>
                <span style={{fontSize:11,fontWeight:700,color:dc.fg}}>{dc.label}</span>
                <span style={{fontSize:10,color:t.textSub}}>diet</span>
              </div>
            )}
            <div style={{display:"flex",gap:20,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
              {ns && (()=>{
                const grades = ["a","b","c","d","e"];
                return (
                  <div>
                    <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>Nutri-Score</div>
                    <div style={{display:"flex",alignItems:"flex-end",gap:2}}>
                      {grades.map(g => { const active = g===ns; return <div key={g} style={{width:active?32:22,height:active?32:22,borderRadius:active?7:4,background:active?(NS_COLOR[g]||"#999"):(dark?"#2a2d33":"#e8e6e2"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:active?14:10,fontWeight:700,color:active?"#fff":(dark?"#555b68":"#a09c97"),marginBottom:active?0:4}}>{g.toUpperCase()}</div>; })}
                    </div>
                  </div>
                );
              })()}
              {offData.novaGroup && (
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>NOVA</div>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <div style={{width:30,height:30,borderRadius:"50%",background:NOVA_COLOR[offData.novaGroup]||"#999",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#fff"}}>{offData.novaGroup}</div>
                    <div style={{fontSize:11,color:t.textSub,maxWidth:120,lineHeight:1.4}}>{NOVA_LABEL[offData.novaGroup]}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* UNDECLARED SUBSTANCE WARNING */}
      {offData.ingredients && (() => {
        const und = substances.filter(s => s.ingredientConfirmed === false);
        if (und.length === 0) return null;
        return (
          <div style={{background:dark?"rgba(192,57,43,0.09)":"rgba(192,57,43,0.05)",border:"1.5px solid rgba(192,57,43,0.35)",borderRadius:12,padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:15}}>⚠️</span>
              <span style={{fontSize:11,fontWeight:700,color:"#c0392b",letterSpacing:"0.06em",textTransform:"uppercase"}}>Substances not listed on the label</span>
            </div>
            <div style={{fontSize:12,color:t.textSub,lineHeight:1.7,marginBottom:10}}>
              {und.length} substance{und.length!==1?"s are":" is"} documented for this product{offData.brand?` by ${offData.brand}`:""} but do{und.length===1?"es":""} not appear in its declared ingredient list. This may indicate contamination, packaging migration, or incomplete labelling.
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {und.map((s,i) => (
                <span key={i} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:600,color:"#c0392b",background:"rgba(192,57,43,0.1)",border:"1px solid rgba(192,57,43,0.25)",padding:"4px 11px",borderRadius:6}}>
                  {s.name}{s.eNumber?` · ${s.eNumber}`:""}
                  <span style={{fontSize:9,fontWeight:500,color:t.textMuted}}>({s.risk} risk)</span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* BRAND CREDIBILITY */}
      <BrandCard cred={brandCred} brand={offData.brand} loading={brandCredLoading} t={t}/>

      {/* NUTRITION */}
      {(n.energy_kcal != null || totalSugars != null) && (
        <div style={{...card}}>
          <div style={{...sHdr,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Nutrition Facts</span>
            <span style={{fontSize:10,fontWeight:400,color:t.textMuted,textTransform:"none",letterSpacing:0}}>per 100g{hasSrv?` · per serving (${offData.servingSize})`:""}</span>
          </div>
          {[n.fat,n.saturated,totalSugars,n.salt].some(v=>v!=null) && (
            <div style={{display:"flex",borderBottom:`1px solid ${t.border}`}}>
              {[{l:"Fat",v:n.fat,k:"fat"},{l:"Sat. fat",v:n.saturated,k:"satfat"},{l:"Sugars",v:totalSugars,k:"sugars"},{l:"Salt",v:n.salt,k:"salt"}].filter(x=>x.v!=null).map((x,i,arr)=>(
                <div key={x.l} style={{flex:1,padding:"11px 8px",textAlign:"center",borderRight:i<arr.length-1?`1px solid ${t.border}`:"none"}}>
                  <div style={{fontSize:10,color:t.textSub,marginBottom:4}}>{x.l}</div>
                  <div style={{fontSize:17,fontWeight:700,color:t.text,fontFamily:"monospace"}}>{fmt(x.v)}g</div>
                  <div style={{marginTop:5,display:"inline-flex",alignItems:"center",gap:4}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:tlColor(x.k,x.v)}}/>
                    <span style={{fontSize:9,fontWeight:600,color:tlColor(x.k,x.v)}}>{tlLabel(x.k,x.v)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {totalSugars != null && (
            <div style={{display:"grid",gridTemplateColumns:addedSugars!=null&&naturalSugars!=null?"1fr 1fr 1fr":addedSugars!=null?"1fr 1fr":"1fr",gap:10,padding:"14px 16px",background:dark?"rgba(176,125,43,0.05)":"rgba(176,125,43,0.04)",borderBottom:`1px solid ${t.border}`}}>
              {[
                { label:"Total Sugars",   value:totalSugars,   col:tlColor("sugars",totalSugars) },
                addedSugars   != null && { label:"Added Sugars",   value:addedSugars,   col:tlColor("sugars",addedSugars) },
                naturalSugars != null && { label:"Natural Sugars",  value:naturalSugars, col:"#2e7d52" },
              ].filter(Boolean).map(item => (
                <div key={item.label} style={{background:t.surface,border:`1.5px solid ${item.col}30`,borderRadius:10,padding:"11px 12px",textAlign:"center"}}>
                  <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:4}}>{item.label}</div>
                  <div style={{fontSize:26,fontWeight:800,color:item.col,lineHeight:1,fontFamily:"monospace"}}>{fmt(item.value)}g</div>
                  <div style={{fontSize:10,color:t.textSub,marginTop:4}}>per 100g</div>
                </div>
              ))}
            </div>
          )}
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{background:t.tableTh,borderBottom:`2px solid ${t.border}`}}>
                {["Nutrient","Per 100g",hasSrv?"Per serving":null,"%RI"].filter(Boolean).map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:h==="Nutrient"?"left":"right",fontSize:10,fontWeight:600,color:t.textSub,letterSpacing:"0.04em"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <NRow label="Energy"        val100={n.energy_kcal} valSrv={n.energy_srv}  unit=" kcal" ri={2000} bold   hasSrv={hasSrv} t={t}/>
              <NRow label="Fat"           val100={n.fat}         valSrv={n.fat_srv}     unit="g"     ri={70}  bold   hasSrv={hasSrv} t={t} type="fat"/>
              <NRow label="Saturated fat" val100={n.saturated}   valSrv={null}          unit="g"     ri={20}  indent hasSrv={hasSrv} t={t} type="satfat"/>
              <NRow label="Carbohydrates" val100={n.carbs}       valSrv={n.carbs_srv}   unit="g"     ri={260} bold   hasSrv={hasSrv} t={t}/>
              <NRow label="Sugars"        val100={totalSugars}   valSrv={n.sugars_srv}  unit="g"     ri={90}  indent hasSrv={hasSrv} t={t} type="sugars"/>
              {addedSugars != null && <NRow label="Added sugars" val100={addedSugars} valSrv={null} unit="g" ri={50} indent hasSrv={hasSrv} t={t} type="sugars"/>}
              <NRow label="Dietary fibre" val100={n.fiber}       valSrv={null}          unit="g"     ri={30}        hasSrv={hasSrv} t={t}/>
              <NRow label="Protein"       val100={n.protein}     valSrv={n.protein_srv} unit="g"     ri={50}  bold   hasSrv={hasSrv} t={t}/>
              <NRow label="Salt"          val100={n.salt}        valSrv={n.salt_srv}    unit="g"     ri={6}   bold   hasSrv={hasSrv} t={t} type="salt"/>
            </tbody>
          </table>
          <div style={{padding:"8px 14px",fontSize:9,color:t.textMuted,borderTop:`1px solid ${t.border}`}}>* Reference intake for an average adult (2000 kcal)</div>
        </div>
      )}

      {/* ADDITIVES */}
      {offData.additives.length > 0 && (
        <div style={{...card}}>
          <div style={{...sHdr}}>Additives · {offData.additives.length} detected</div>
          <div style={{padding:"14px 16px",display:"flex",flexWrap:"wrap",gap:6}}>
            {offData.additives.map(a => {
              const e = a.replace("en:","").toUpperCase();
              const flagged = substances.some(s => s.eNumber && s.eNumber.replace(/[-\/]/g,"").toLowerCase() === e.replace(/[-\/]/g,"").toLowerCase());
              return <span key={a} style={{fontSize:11,fontFamily:"monospace",background:flagged?RISK_CFG.high.bg:t.pill,color:flagged?RISK_CFG.high.fg:t.pillText,padding:"4px 10px",borderRadius:5,border:`1px solid ${flagged?RISK_CFG.high.border:t.border}`,fontWeight:flagged?600:400}}>{e}{flagged?" ⚠":""}</span>;
            })}
          </div>
        </div>
      )}

      {/* ALLERGENS */}
      {offData.allergens.length > 0 && (
        <div style={{background:dark?"rgba(176,125,43,0.07)":"rgba(176,125,43,0.05)",border:"1px solid rgba(176,125,43,0.22)",borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:11,fontWeight:600,color:"#b07d2b",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10}}>Allergens</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {offData.allergens.map(a => <span key={a} style={{fontSize:11,fontWeight:500,background:"rgba(176,125,43,0.1)",color:"#8a5e1a",padding:"4px 12px",borderRadius:5,border:"1px solid rgba(176,125,43,0.25)",textTransform:"capitalize"}}>{a.replace(/-/g," ")}</span>)}
          </div>
        </div>
      )}

      {/* INGREDIENTS */}
      {offData.ingredients && (
        <div style={{...card}}>
          <div style={{...sHdr}}>Ingredients</div>
          <div style={{padding:"14px 16px"}}>
            <p style={{margin:0,fontSize:12,color:t.textSub,lineHeight:1.8,display:showIngr?"block":"-webkit-box",WebkitLineClamp:showIngr?undefined:4,WebkitBoxOrient:"vertical",overflow:showIngr?"visible":"hidden"}}>{offData.ingredients}</p>
            {offData.ingredients.length > 280 && <button onClick={() => setShowIngr(p=>!p)} style={{marginTop:8,background:"none",border:"none",color:t.accent,cursor:"pointer",fontSize:11,padding:0,fontFamily:"inherit",fontWeight:500}}>{showIngr?"Show less":"Show all"}</button>}
          </div>
        </div>
      )}

      {/* HAZARD ANALYSIS */}
      {substances.length > 0 && (()=>{
        const confirmed   = substances.filter(s => s.ingredientConfirmed !== false);
        const unconfirmed = substances.filter(s => s.ingredientConfirmed === false);
        return (
          <div style={{...card}}>
            <div style={{...sHdr,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6,color:confirmed.length>0?RISK_CFG.high.fg:t.textSub}}>
              <span>Hazard Analysis · {confirmed.length} confirmed{unconfirmed.length>0?`, ${unconfirmed.length} unverified`:""}</span>
              <span style={{fontSize:9,fontWeight:400,color:t.textMuted,textTransform:"none",letterSpacing:0}}>Confirmed = found in ingredient list</span>
            </div>
            {confirmed.map((s,i) => (
              <div key={i} style={{margin:"0 12px 8px",background:t.bgSub,border:`1px solid ${t.border}`,borderLeft:`3px solid ${RISK_CFG[s.risk]?.fg||"#999"}`,borderRadius:7,padding:"11px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                  <div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
                      {s.eNumber && <span style={{fontSize:9,fontFamily:"monospace",fontWeight:600,color:"#b07d2b",background:"rgba(176,125,43,0.1)",padding:"1px 6px",borderRadius:3}}>{s.eNumber}</span>}
                      <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"1px 6px",borderRadius:3}}>✓ In ingredients</span>
                      {s.foundInIngredient && <span style={{fontSize:9,color:t.textMuted}}>via "{s.foundInIngredient}"</span>}
                    </div>
                    <div style={{fontSize:13,fontWeight:600,color:t.text}}>{s.name}</div>
                    <div style={{fontSize:10,color:t.textMuted}}>{s.category}</div>
                  </div>
                  <span style={{fontSize:9,fontWeight:700,color:RISK_CFG[s.risk]?.fg,background:RISK_CFG[s.risk]?.bg,border:`1px solid ${RISK_CFG[s.risk]?.border}`,padding:"3px 9px",borderRadius:4,whiteSpace:"nowrap",flexShrink:0}}>{s.risk?.charAt(0).toUpperCase()+s.risk?.slice(1)}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:11,marginBottom:s.sourceUrl?8:0}}>
                  <div style={{color:t.textSub,lineHeight:1.55}}>{s.effects}</div>
                  <div style={{color:t.textMuted,fontFamily:"monospace",fontSize:10}}>{s.limit}</div>
                </div>
                {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:t.accent,textDecoration:"none",borderBottom:`1px solid ${t.accent}40`}}>↗ {s.sourceName||"View source"}</a>}
              </div>
            ))}
            {unconfirmed.length > 0 && (
              <div style={{padding:"8px 12px",borderTop:`1px solid ${t.border}`}}>
                <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:8}}>Category-level (not confirmed in this product)</div>
                {unconfirmed.map((s,i) => (
                  <div key={i} style={{background:t.bgSub,border:`1px solid ${t.border}`,borderRadius:6,padding:"8px 12px",marginBottom:6,opacity:0.75}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        {s.eNumber && <span style={{fontSize:9,fontFamily:"monospace",fontWeight:600,color:"#b07d2b",background:"rgba(176,125,43,0.1)",padding:"1px 6px",borderRadius:3}}>{s.eNumber}</span>}
                        <span style={{fontSize:12,fontWeight:500,color:t.textSub}}>{s.name}</span>
                        <span style={{fontSize:9,color:t.textMuted,background:t.pill,padding:"1px 6px",borderRadius:3}}>Not confirmed</span>
                      </div>
                      <span style={{fontSize:9,color:t.textMuted,background:t.pill,padding:"2px 8px",borderRadius:4}}>{s.risk} risk</span>
                    </div>
                    {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:t.textMuted,textDecoration:"none",marginTop:5}}>↗ {s.sourceName||"Source"}</a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* HEALTHIER ALTERNATIVES */}
      {(altLoading || (alternatives && alternatives.length > 0)) && (
        <div style={{...card}}>
          <div style={{...sHdr,color:"#2e7d52"}}>Healthier Alternatives</div>
          {altLoading && !alternatives.length
            ? <div style={{padding:"18px 16px",display:"flex",alignItems:"center",gap:10,color:t.textSub,fontSize:12}}><span style={{display:"inline-block",width:12,height:12,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Finding better alternatives…</div>
            : <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                {alternatives.map((alt,i) => (
                  <div key={i} style={{background:t.bgSub,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:7,padding:"12px 14px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:5}}>
                      <div><div style={{fontSize:13,fontWeight:600,color:t.text}}>{alt.name}</div>{alt.brand&&<div style={{fontSize:10,color:t.textSub,marginTop:1}}>{alt.brand}</div>}</div>
                      <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
                        {alt.nutriScore&&alt.nutriScore!=="unknown"&&<span style={{fontSize:10,fontWeight:700,color:"#fff",background:NS_COLOR[alt.nutriScore]||"#999",padding:"2px 7px",borderRadius:4}}>{alt.nutriScore.toUpperCase()}</span>}
                        <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"2px 8px",borderRadius:4}}>Better</span>
                      </div>
                    </div>
                    <div style={{fontSize:12,color:t.textSub,lineHeight:1.6,marginBottom:6}}>{alt.reason}</div>
                    {alt.improvements?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:alt.sourceUrl?6:0}}>{alt.improvements.map((imp,j)=><span key={j} style={{fontSize:10,color:"#2e7d52",background:"rgba(46,125,82,0.08)",border:"1px solid rgba(46,125,82,0.18)",padding:"2px 9px",borderRadius:10}}>✓ {imp}</span>)}</div>}
                    {alt.sourceUrl&&<a href={alt.sourceUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:t.accent,textDecoration:"none",borderBottom:`1px solid ${t.accent}40`}}>↗ {alt.sourceName||"View"}</a>}
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {/* AI SAFETY ANALYSIS */}
      <div style={{...card}}>
        <div style={{...sHdr}}>Safety Analysis</div>
        <div style={{padding:"14px 16px"}}>
          {insightLoading
            ? <div style={{color:t.textMuted,fontSize:12,fontStyle:"italic",animation:"pulse 1.4s ease infinite"}}>Generating analysis…</div>
            : insight ? <p style={{margin:0,fontSize:13,color:t.textSub,lineHeight:1.8}}>{insight}</p>
            : <div style={{color:t.textMuted,fontSize:12}}>Pending…</div>
          }
        </div>
      </div>
      <div style={{fontSize:9,color:t.textMuted,lineHeight:1.7,paddingBottom:4}}>Data from Open Food Facts · {AI_MODE?"Extended brand research":"Built-in safety engine"} · Educational purposes only.</div>
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [input,setInput]         = useState("");
  const [tracked,setTracked]     = useState([]);
  const [selected,setSelected]   = useState(null);
  const [scanning,setScanning]   = useState(false);
  const [filterRisk,setFilterRisk] = useState("all");
  const [dark,setDark]           = useState(false);
  const [aiMode,setAiMode]       = useState(AI_MODE);
  const [toasts,setToasts]       = useState([]);
  const [insight,setInsight]     = useState("");
  const [insightLoading,setInsightLoading] = useState(false);
  const [brandCred,setBrandCred] = useState(null);
  const [brandCredLoading,setBrandCredLoading] = useState(false);
  const [alternatives,setAlternatives] = useState([]);
  const [altLoading,setAltLoading]     = useState(false);
  const [activeTab,setActiveTab] = useState("tracker");
  const [dbCount,setDbCount]     = useState(0);
  const [showDbStats,setShowDbStats] = useState(false);
  const [dbProducts,setDbProducts]   = useState([]);
  const [dbStatsLoading,setDbStatsLoading] = useState(false);
  const [altTabFood,setAltTabFood]   = useState(null);
  const [altTabResults,setAltTabResults] = useState([]);
  const [altTabLoading,setAltTabLoading] = useState(false);
  const [showAltFor,setShowAltFor]   = useState(null);
  const [panelAlts,setPanelAlts]     = useState([]);
  const [panelAltLoading,setPanelAltLoading] = useState(false);
  const [searchQ,setSearchQ]         = useState("");
  const [searchOpen,setSearchOpen]   = useState(false);
  const [picker,setPicker]           = useState(null); // { query, candidates: raw OFF products }
  const warnedReadOnly               = useRef(false);
  const searchRef = useRef(null);

  // Close the search dropdown on outside click or Escape (works app-wide,
  // not just while the input is focused)
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false); };
    const onKey  = (e) => { if (e.key === "Escape") setSearchOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [searchOpen]);
  const [searchRes,setSearchRes]     = useState(null);
  const [searchLoading,setSearchLoading] = useState(false);
  const [hazardDb,setHazardDb] = useState(Object.fromEntries(Object.entries(SEED).map(([k,v])=>[k,{...v,source:"seed"}])));

  const tid     = useRef(0);
  const cache   = useRef({ scan:{}, insight:{}, brand:{}, alts:{}, calAlts:{}, panelAlts:{} });
  const didInit = useRef(false);
  const t = makeTheme(dark);

  // Load GitHub DB on mount
  useEffect(() => { ghLoad(setDbCount); }, []);

  const toast = (type, msg) => {
    const id = ++tid.current;
    setToasts(p => [...p, { id, type, message: msg }]);
    setTimeout(() => setToasts(p => p.filter(n => n.id !== id)), 6000);
  };

  const toggleAI = () => {
    AI_MODE = !AI_MODE; setAiMode(AI_MODE);
    if (AI_MODE) {
      toast("scan", "Enhanced analysis enabled. Verifying service availability…");
      // Minimal connectivity probe — confirms whether AI calls actually succeed
      // in this environment, since failures otherwise fall back silently.
      (async () => {
        const ok = await callAI("Reply with the single word OK.", 10, false).catch(() => "");
        if (ok && AI_MODE) toast("database", "Enhanced analysis service connected — scans will include extended research and generated insights.");
        else if (AI_MODE) toast("high", "Enhanced analysis service is not reachable in this deployment. Scans will use the standard engine until ANTHROPIC_API_KEY is configured on the server (see README).");
      })();
    } else {
      toast("scan", "Standard analysis enabled. Product scans use the built-in safety engine and Open Food Facts data.");
    }
  };

  const ck = (s) => cache.current;
  const fromCache = (store, key) => cache.current[store]?.[key] ?? null;
  const toCache   = (store, key, val) => { cache.current[store] = cache.current[store] || {}; cache.current[store][key] = val; };
  const nk        = (s) => normKey(s);

  // ── SCAN ────────────────────────────────────────────────────────────────────
  // Show a tracked entry and kick off its detail panels
  function showEntry(entry, key) {
    setTracked(p => [entry, ...p]);
    setSelected(entry);
    setScanning(false);
    loadInsight(entry.name, entry.substances, entry.offData?.nut, entry.offData, key);
    const cb = fromCache("brand", key);
    if (cb) setBrandCred(cb); else if (entry.offData?.brand) loadBrand(entry.offData.brand, entry.name, key);
    const ca = fromCache("alts", key);
    if (ca) setAlternatives(ca); else loadAlts(entry, key);
  }

  function entryFrom(rec, label, extra = {}) {
    return {
      id: Date.now(),
      name: rec.offData?.name || label,
      searchTerm: label,
      substances: rec.allSubs || [],
      offData: rec.offData,
      aiSugarData: rec.aiSugarData,
      risk: rec.risk,
      diet: rec.diet || "unknown",
      undeclaredCount: rec.undeclaredCount ?? undeclaredOf(rec),
      date: new Date().toLocaleDateString(),
      ...extra,
    };
  }

  // Persist an analysis and announce what was found. Results with no product
  // data and no findings are deliberately NOT persisted — caching an empty
  // lookup would serve that same nothing back for 30 days.
  function commitScan(a, label) {
    const name = a.offData?.name || label;
    const key = nk(name);
    const payload = { offData:a.offData, aiSugarData:a.aiSugarData, allSubs:a.allSubs, risk:a.risk, diet:a.diet, undeclaredCount:a.undeclaredCount, hitCount:1, savedAt:Date.now() };
    const history = a.offData?.brand ? brandHistory(a.offData.brand) : null;

    if (a.offData || a.allSubs.length > 0) {
      toCache("scan", key, payload);
      ghSet(key, payload, setDbCount).then(st => {
        if (st === "saved") toast("database", `"${name}" committed to the shared database.`);
        else if (st === "no-token" && !warnedReadOnly.current) {
          warnedReadOnly.current = true;
          toast("database", "Read-only mode: results are stored for this session only. Set VITE_GH_TOKEN and redeploy to enable shared database writes.");
        } else if (st === "error") toast("database", "Shared database write failed — the result is kept for this session. See the browser console for details.");
      });
    }

    const entry = entryFrom({ ...a, offData:a.offData }, label);
    showEntry(entry, key);

    if (a.offData) toast("off", `Found "${name}" on Open Food Facts.`);
    else toast("scan", _offStatus === "network"
      ? "Open Food Facts is unreachable from this browser. The analysis is name-based only — press ↻ to retry."
      : `No Open Food Facts match for "${label}". The analysis is name-based only; nothing was cached, so ↻ retries fresh.`);

    if (a.risk === "high") toast("high", `High risk: ${a.allSubs.filter(s=>s.risk==="high").map(s=>s.name).slice(0,2).join(", ")}.`);
    else if (a.risk === "medium") toast("medium", "Medium risk substances detected.");

    if (a.undeclared.length > 0) toast("undeclared", `${a.offData?.brand ? a.offData.brand + " — " : ""}"${name}" may contain ${a.undeclared.length} substance${a.undeclared.length!==1?"s":""} not listed on the label: ${a.undeclared.map(s=>s.name).slice(0,3).join(", ")}.`);
    if (history && (history.undeclared > 0 || history.high >= 2)) toast("brand", `${a.offData.brand}: ${history.undeclared > 0 ? `${history.undeclared} undeclared-substance report${history.undeclared!==1?"s":""}` : `${history.high} high-risk products`} across ${history.count} product${history.count!==1?"s":""} in the shared database.`);

    const sugar = a.offData?.nut?.sugars ?? a.aiSugarData?.total_sugars ?? null;
    if (sugar != null && sugar > 22.5) toast("sugar", `High sugar: ${sugar}g per 100g.`);
  }

  async function scan(rawName) {
    const label = (rawName || input).trim();
    if (!label) return;
    setInput(""); setScanning(true); setBrandCred(null); setAlternatives([]);
    const key = nk(label);

    // 1. Session cache
    const sc = fromCache("scan", key);
    if (sc) {
      showEntry(entryFrom(sc, label, { fromCache:"session" }), key);
      toast("cache", "Session cache — instant result.");
      return;
    }

    // 2. Shared database
    const ghRec = ghGet(key);
    if (ghRec) {
      const hitCount = (ghRec.hitCount || 0) + 1;
      toCache("scan", key, ghRec);
      ghSet(key, { ...ghRec, hitCount }, setDbCount);
      const entry = entryFrom(ghRec, label, { fromCache:"shared", hitCount });
      showEntry(entry, key);
      if (ghRec.alts) setAlternatives(ghRec.alts);
      toast("shared", `From the shared database · searched ${hitCount} time${hitCount!==1?"s":""}`);
      const und = undeclaredOf(ghRec);
      if (und > 0) toast("undeclared", `"${entry.name}" may contain ${und} substance${und!==1?"s":""} not listed on its label.`);
      return;
    }

    // 3. Fresh lookup
    try {
      const { candidates, analysis } = await lookupAndAnalyze(label);
      if (candidates) {
        // Ambiguous query — let the user choose rather than guessing wrong
        setScanning(false);
        setPicker({ query: label, candidates });
        return;
      }
      commitScan(analysis, label);
    } catch (e) {
      console.warn("scan:", e);
      setScanning(false);
      toast("scan", "The scan could not be completed. Please try again.");
    }
  }

  // Continue after the user picks one of the ambiguous candidates
  async function scanCandidate(rawProduct) {
    const label = picker?.query || rawProduct.product_name || "";
    setPicker(null); setScanning(true);
    try {
      const offData = parseOFF(rawProduct);
      commitScan(await analyzeProduct(offData, label), label);
    } catch (e) {
      console.warn("scanCandidate:", e);
      setScanning(false);
      toast("scan", "The scan could not be completed. Please try again.");
    }
  }


  async function loadInsight(name, subs, nut, offData, key) {
    const k = key || nk(name);
    const cached = fromCache("insight", k);
    if (cached) { setInsight(cached); setInsightLoading(false); return; }
    setInsightLoading(true); setInsight("");
    let txt = AI_MODE ? await aiInsight(name, subs, nut, offData) : localInsight(name, subs, nut, offData);
    if (AI_MODE && (!txt || txt === "Analysis unavailable.")) txt = localInsight(name, subs, nut, offData); // fallback
    toCache("insight", k, txt);
    setInsight(txt); setInsightLoading(false);
  }

  async function loadBrand(brand, productName, key) {
    const k = key || nk(productName);
    const cached = fromCache("brand", k);
    if (cached) { setBrandCred(cached); setBrandCredLoading(false); return; }
    setBrandCredLoading(true);
    let cred = AI_MODE ? await aiBrandCredibility(brand, productName).catch(() => null) : localBrandCred(brand, tracked);
    if (!cred) cred = localBrandCred(brand, tracked); // fallback: community data
    toCache("brand", k, cred);
    setBrandCred(cred); setBrandCredLoading(false);
  }

  // Alternatives are resolved by the same two-source strategy everywhere:
  // the preferred source for the current mode, then the other as a fallback.
  // Written once here rather than repeated in each of the three call sites.
  async function resolveAlts(entry) {
    const viaOff = () => fetchOFFAlternatives(entry.offData?.categories, entry.name).catch(() => []);
    const viaAssisted = () => aiAlternatives(entry.name, entry.offData?.brand, entry.offData?.nutriScore, entry.risk, entry.offData?.ingredients).catch(() => []);
    const [primary, fallback] = AI_MODE ? [viaAssisted, viaOff] : [viaOff, viaAssisted];
    const first = await primary();
    if (first && first.length) return first;
    // Only reach for the fallback when it can actually work
    if (!AI_MODE && _offStatus !== "network") return [];
    return (await fallback()) || [];
  }

  async function resolveCalorieAlts(entry) {
    const nut = entry.offData?.nut || {};
    const viaOff = () => fetchOFFCalorieAlts(nut.energy_kcal).catch(() => []);
    const viaAssisted = () => aiCalorieAlts(entry.name, nut.energy_kcal, entry.offData?.categories?.[0], entry.risk, { fat:nut.fat, sugars:nut.sugars, protein:nut.protein, fiber:nut.fiber }).catch(() => []);
    const [primary, fallback] = AI_MODE ? [viaAssisted, viaOff] : [viaOff, viaAssisted];
    const first = await primary();
    if (first && first.length) return first;
    if (!AI_MODE && _offStatus !== "network") return [];
    return (await fallback()) || [];
  }

  async function loadAlts(entry, key) {
    const k = key || nk(entry.name);
    const needsAlt = entry.risk==="high" || entry.risk==="medium" || ["c","d","e"].includes(entry.offData?.nutriScore||"");
    if (!needsAlt) return;
    const cached = fromCache("alts", k);
    if (cached) { setAlternatives(cached); return; }
    setAltLoading(true);
    const alts = await resolveAlts(entry);
    toCache("alts", k, alts);
    setAlternatives(alts); setAltLoading(false);
    // Also persist alts to GitHub DB
    const rec = ghGet(k);
    if (rec) ghSet(k, {...rec, alts}, setDbCount);
  }

  function selectEntry(entry) {
    if (e) e.stopPropagation();
    const term = entry.searchTerm || entry.name;
    [nk(term), nk(entry.name)].forEach(k => {
      ["scan","insight","brand","alts","calAlts","panelAlts"].forEach(store => { if (cache.current[store]) delete cache.current[store][k]; });
      if (_ghDb.products) delete _ghDb.products[k]; // fresh result will re-save
    });
    setTracked(p => p.filter(f => f.id !== entry.id));
    if (selected?.id === entry.id) setSelected(null);
    toast("scan", `Rescanning "${term}" — all caches bypassed.`);
    scan(term);
  }

  // ── OPEN DB STATS ────────────────────────────────────────────────────────────
  async function openDbStats() {
    setShowDbStats(true); setDbStatsLoading(true);
    try {
      const r = await fetch(`${GH_RAW}?t=${Date.now()}`);
      if (r.ok) {
        const data = await r.json();
        setDbProducts(Object.entries(data.products || {}).map(([k,v]) => ({key:k,...v})).sort((a,b) => (b.hitCount||0)-(a.hitCount||0)));
        setDbCount(Object.keys(data.products||{}).length);
      }
    } catch {}
    setDbStatsLoading(false);
  }

  // ── SEARCH BAR ───────────────────────────────────────────────────────────────
  const SUGGESTIONS = [
    "companies with good credibility","high risk products I scanned","vegan products I scanned",
    "vegetarian foods I tracked","foods with added sugars","products with E-numbers",
    "low Nutri-Score items","ultra-processed foods","brands with controversies",
  ];

  // Populate the shared database in the background when a search names a
  // product we have never analysed. One code path for both modes.
  async function bgScanFromSearch(query) {
    try {
      const { candidates, analysis } = await lookupAndAnalyze(query);
      // Ambiguous names are skipped rather than guessed — the user can scan
      // properly from the Hazard Tracker tab and choose the right variant.
      if (candidates) {
        setSearchRes(prev => prev ? { ...prev, savingToDb:false, answer:`Several products match "${query}". Scan it from the Hazard Tracker tab to pick the right one.` } : prev);
        return;
      }
      const a = analysis;
      if (!a.offData && a.allSubs.length === 0) {
        setSearchRes(prev => prev ? { ...prev, savingToDb:false, answer:`No product data found for "${query}" — nothing was saved.` } : prev);
        return;
      }
      const k = nk(query);
      const payload = { offData:a.offData, aiSugarData:a.aiSugarData, allSubs:a.allSubs, risk:a.risk, diet:a.diet, undeclaredCount:a.undeclaredCount, hitCount:1, savedAt:Date.now() };
      toCache("scan", k, payload);
      const st = await ghSet(k, payload, setDbCount);
      setSearchRes(prev => prev ? { ...prev, savingToDb:false, savedToDb:st === "saved",
        answer: a.offData
          ? `Found ${st === "saved" ? "and saved " : ""}"${a.offData.name}"${a.offData.brand ? ` by ${a.offData.brand}` : ""} — ${a.risk || "no"} risk, ${a.allSubs.length} flagged substance${a.allSubs.length !== 1 ? "s" : ""}.`
          : prev.answer } : prev);
      if (st === "saved") toast("database", `"${a.offData?.name || query}" committed to the shared database.`);
    } catch (e) {
      console.warn("bgScanFromSearch:", e);
      setSearchRes(prev => prev ? { ...prev, savingToDb:false } : prev);
    }
  }

  async function runSearch(q) {
    const query = (q || searchQ).trim();
    if (!query) return;
    setSearchLoading(true); setSearchRes(null); setSearchOpen(true);
    const qLow = query.toLowerCase();

    const dbMatches = Object.entries(_ghDb.products || {})
      .filter(([k,v]) => k.includes(qLow) || (v.offData?.name||"").toLowerCase().includes(qLow) || (v.offData?.brand||"").toLowerCase().includes(qLow))
      .slice(0,6)
      .map(([k,v]) => ({ name:v.offData?.name||k, brand:v.offData?.brand||null, risk:v.risk, diet:v.diet||"unknown", nutriScore:v.offData?.nutriScore||null, hitCount:v.hitCount||1 }));

    const summary = tracked.map(f => ({ name:f.name, brand:f.offData?.brand||null, risk:f.risk, nutriScore:f.offData?.nutriScore||null, substances:f.substances.map(s=>s.name).slice(0,4), sugars:f.offData?.nut?.sugars??f.aiSugarData?.total_sugars??null, diet:f.diet||"unknown" }));

    // Local matcher over this session's scans plus the shared database. Always
    // available: it answers directly in Standard mode and backs up Enhanced.
    const localResult = () => {
      const mine = summary.filter(f =>
        f.name.toLowerCase().includes(qLow) || (f.brand||"").toLowerCase().includes(qLow) ||
        (qLow.includes("high risk") && f.risk === "high") ||
        (qLow.includes("vegan") && f.diet === "vegan") ||
        (qLow.includes("vegetarian") && f.diet === "vegetarian") ||
        (qLow.includes("sugar") && (f.sugars ?? 0) > 11.25) ||
        (qLow.includes("e-number") && f.substances.some(s => /^E\d/i.test(s))) ||
        ((qLow.includes("processed") || qLow.includes("nutri")) && ["c","d","e"].includes(f.nutriScore || ""))
      );
      const all = [
        ...mine.map(m => ({ name:m.name + (m.brand ? ` (${m.brand})` : ""), reason:`${m.risk||"unknown"} risk${m.sugars!=null?` · ${m.sugars}g sugar`:""} · your scan`, diet:m.diet })),
        ...dbMatches.map(m => ({ name:m.name + (m.brand ? ` (${m.brand})` : ""), reason:`${m.risk||"unknown"} risk · searched ${m.hitCount}× · shared database`, diet:m.diet })),
      ];
      return all.length ? { answer:`Found ${all.length} matching item${all.length!==1?"s":""} across your scans and the shared database.`, matches:all.slice(0,6), tip:null, category:"database" } : null;
    };

    // A bare product-like phrase (not a question) is a candidate for background analysis
    const looksLikeProduct = /^[a-z0-9 '&\-]{2,50}$/i.test(query) && !query.includes("?")
      && !["who","what","why","how","which","are","is","do","does","show","find","list","tell"].some(w => qLow.startsWith(w));

    const startBgScan = (base) => {
      setSearchRes({ ...base, savingToDb:true });
      setSearchLoading(false);
      ghLogSearch(query, base.category || "database");
      bgScanFromSearch(query);
    };

    // Shared-database hits with nothing scanned locally — answer immediately
    if (dbMatches.length > 0 && summary.length === 0) {
      setSearchRes({ answer:`Found ${dbMatches.length} product${dbMatches.length!==1?"s":""} in the shared database matching "${query}".`, matches:dbMatches.map(m => ({ name:m.name + (m.brand ? ` (${m.brand})` : ""), reason:`${m.risk||"unknown"} risk · searched ${m.hitCount}× · ${m.diet}`, diet:m.diet })), tip:`The database holds ${dbCount} products.`, category:"database", fromDb:true });
      setSearchLoading(false); ghLogSearch(query, "database");
      return;
    }

    if (!AI_MODE) {
      try {
        const local = localResult();
        if (local) { setSearchRes(local); setSearchLoading(false); ghLogSearch(query, "database"); return; }
        if (looksLikeProduct && !ghGet(nk(query))) {
          startBgScan({ answer:`"${query}" is not in the database yet — analysing it now…`, matches:[], tip:null, category:"database" });
          return;
        }
        setSearchRes({ answer:`No matches for "${query}" in your scans or the shared database. Try scanning the product first.`, matches:[], tip:`The database holds ${dbCount} products.`, category:"general" });
      } catch (e) {
        console.warn("runSearch:", e);
        setSearchRes({ answer:"Search encountered a problem. Please try again.", matches:[], tip:null, category:"general" });
      }
      setSearchLoading(false); ghLogSearch(query, "general");
      return;
    }

    // Enhanced mode: generated answer, with the local matcher as the fallback
    try {
      const dbCtx = dbMatches.length ? `Shared database matches: ${JSON.stringify(dbMatches.slice(0,3))}.` : "";
      const txt = await callAI(`HST food safety app. User scanned: ${JSON.stringify(summary)}. ${dbCtx} The database holds ${dbCount} products. Query: "${query}". Return ONLY JSON: {"answer":"2-4 sentences","matches":[{"name":"item","reason":"why","diet":"vegan|vegetarian|pescatarian|meat|unknown"}],"tip":"one tip","category":"credibility|risk|sugar|additives|nutrition|diet|database|general"}. No markdown.`, 1000, true);
      const m = txt.match(/\{[\s\S]*\}/);
      const result = m ? JSON.parse(m[0]) : (localResult() || { answer:"No results found.", matches:[], tip:null, category:"general" });

      if (looksLikeProduct && !ghGet(nk(query))) { startBgScan(result); return; }
      setSearchRes(result); ghLogSearch(query, result.category || "general");
    } catch {
      setSearchRes(localResult() || { answer:"Search encountered a problem. Please try again.", matches:[], tip:null, category:"general" });
    }
    setSearchLoading(false);
  }


  // ── OTHER OPTIONS PANEL ──────────────────────────────────────────────────────
  function openAltPanel(e, entry) {
    e.stopPropagation();
    if (showAltFor === entry.id) { setShowAltFor(null); setPanelAlts([]); return; }
    setShowAltFor(entry.id);
    const k = nk(entry.name);
    const cached = fromCache("panelAlts",k) || fromCache("alts",k);
    if (cached) { setPanelAlts(cached); setPanelAltLoading(false); return; }
    setPanelAlts([]); setPanelAltLoading(true);
    resolveAlts(entry)
      .then(a => { const r = a || []; setPanelAlts(r); toCache("panelAlts", k, r); setPanelAltLoading(false); })
      .catch(() => setPanelAltLoading(false));
  }

  // ── CALORIE ALTERNATIVES TAB ─────────────────────────────────────────────────
  async function lookupCalorieAlts(entry) {
    setAltTabFood(entry);
    const k = nk(entry.name);
    const cached = fromCache("calAlts", k);
    if (cached) { setAltTabResults(cached); setAltTabLoading(false); toast("cache","Loaded from cache."); return; }
    setAltTabResults([]); setAltTabLoading(true);
    const alts = await resolveCalorieAlts(entry);
    toCache("calAlts", k, alts);
    setAltTabResults(alts); setAltTabLoading(false);
  }

  // ── FILTERED LIST ────────────────────────────────────────────────────────────
  const filteredTracked = filterRisk === "all" ? tracked : tracked.filter(f => f.risk === filterRisk);

  const tabBtn = (id, label) => (
    <button onClick={() => setActiveTab(id)} style={{background:"none",border:"none",borderBottom:`2px solid ${activeTab===id?t.accent:"transparent"}`,color:activeTab===id?t.accent:t.textSub,padding:"11px 16px",cursor:"pointer",fontSize:11,fontWeight:activeTab===id?600:500,marginBottom:-2,whiteSpace:"nowrap",transition:"all 0.18s"}}>{label}</button>
  );

  // ── DB STATS MODAL ───────────────────────────────────────────────────────────
  function DbStatsModal() {
    const [filter,setFilter] = useState("");
    const filtered = dbProducts.filter(p => !filter || (p.offData?.name||p.key||"").toLowerCase().includes(filter.toLowerCase()) || (p.offData?.brand||"").toLowerCase().includes(filter.toLowerCase()));
    const totalHits = dbProducts.reduce((a,p) => a+(p.hitCount||1), 0);
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:800,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}} onClick={() => setShowDbStats(false)}>
        <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,width:"min(900px,96vw)",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={e => e.stopPropagation()}>
          <div style={{padding:"18px 22px",borderBottom:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>GitHub Shared Database</div>
              <div style={{fontSize:18,fontWeight:700,color:t.text}}>Product Database Stats</div>
              <div style={{display:"flex",gap:12,marginTop:10,flexWrap:"wrap"}}>
                {[["Products",dbProducts.length,t.accent],["Searches",totalHits,"#2e7d52"],["High Risk",dbProducts.filter(p=>p.risk==="high").length,"#c0392b"],["Vegan",dbProducts.filter(p=>p.diet==="vegan").length,"#2d7a45"]].map(([l,v,c])=>(
                  <div key={l} style={{textAlign:"center",padding:"8px 14px",background:dark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.03)",borderRadius:8,border:`1px solid ${t.border}`}}>
                    <div style={{fontSize:20,fontWeight:800,color:c,letterSpacing:"-0.5px"}}>{v}</div>
                    <div style={{fontSize:9,color:t.textMuted,marginTop:1}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => setShowDbStats(false)} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:22}}>×</button>
          </div>
          <div style={{padding:"10px 22px",borderBottom:`1px solid ${t.border}`}}>
            <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter by name or brand…" style={{width:"100%",background:t.inputBg,border:`1.5px solid ${t.inputBorder}`,borderRadius:8,padding:"8px 12px",color:t.inputText,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div style={{overflowY:"auto",flex:1}}>
            {dbStatsLoading ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,padding:40,color:t.textSub,fontSize:13}}>
                <span style={{display:"inline-block",width:16,height:16,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Loading from GitHub…
              </div>
            ) : filtered.length === 0 ? (
              <div style={{textAlign:"center",padding:40,color:t.textMuted,fontSize:12}}>No products found.</div>
            ) : (
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:t.tableTh,position:"sticky",top:0,zIndex:1}}>
                  {["Product","Brand","Risk","Diet","Nutri","Sugars","Searches","Saved"].map(h=>(
                    <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:10,fontWeight:600,color:t.textSub,borderBottom:`2px solid ${t.border}`,letterSpacing:"0.04em",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map((p,i) => {
                    const name = p.offData?.name||p.key||"Unknown";
                    const sugars = p.offData?.nut?.sugars ?? p.aiSugarData?.total_sugars ?? null;
                    const ageDays = Math.floor((Date.now()-(p.savedAt||0))/86400000);
                    const dc = DIET_CFG[p.diet||"unknown"];
                    return (
                      <tr key={i} style={{borderBottom:`1px solid ${t.tableBorder}`,cursor:"pointer",transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov} onMouseLeave={e=>e.currentTarget.style.background=""} onClick={() => { setInput(name); setShowDbStats(false); }}>
                        <td style={{padding:"9px 12px",fontWeight:600,color:t.text,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={name}>{name}</td>
                        <td style={{padding:"9px 12px",color:t.textSub,fontSize:11}}>{p.offData?.brand||"—"}</td>
                        <td style={{padding:"9px 12px"}}>{p.risk?<span style={{fontSize:9,fontWeight:700,color:RISK_CFG[p.risk]?.fg,background:RISK_CFG[p.risk]?.bg,border:`1px solid ${RISK_CFG[p.risk]?.border}`,padding:"2px 7px",borderRadius:4}}>{p.risk.charAt(0).toUpperCase()+p.risk.slice(1)}</span>:"—"}</td>
                        <td style={{padding:"9px 12px"}}>{dc&&p.diet!=="unknown"?<span style={{display:"inline-flex",alignItems:"center",gap:4,background:dc.bg,border:`1px solid ${dc.border}`,borderRadius:5,padding:"2px 7px"}}><span style={{fontSize:11}}>{dc.icon}</span><span style={{fontSize:9,fontWeight:600,color:dc.fg}}>{dc.label}</span></span>:"—"}</td>
                        <td style={{padding:"9px 12px"}}>{p.offData?.nutriScore?<span style={{fontSize:10,fontWeight:700,color:"#fff",background:NS_COLOR[p.offData.nutriScore]||"#999",padding:"2px 8px",borderRadius:4}}>{p.offData.nutriScore.toUpperCase()}</span>:"—"}</td>
                        <td style={{padding:"9px 12px",fontFamily:"monospace",fontSize:11,color:sugars!=null?(sugars>22.5?"#c0392b":sugars>11.25?"#b07d2b":"#2e7d52"):t.textMuted}}>{sugars!=null?`${sugars}g`:"—"}</td>
                        <td style={{padding:"9px 12px",fontFamily:"monospace",fontWeight:700,color:t.accent}}>{p.hitCount||1}×</td>
                        <td style={{padding:"9px 12px",fontSize:10,color:t.textMuted}}>{ageDays===0?"Today":`${ageDays}d ago`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div style={{padding:"10px 22px",borderTop:`1px solid ${t.border}`,fontSize:10,color:t.textMuted,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Click any row to scan it. Data at <a href={`https://github.com/${GH_OWNER}/${GH_REPO}/blob/${GH_BRANCH}/${GH_FILE}`} target="_blank" rel="noopener noreferrer" style={{color:t.accent,textDecoration:"none"}}>github/{GH_OWNER}/{GH_REPO}</a></span>
            <span style={{color:t.accent,fontWeight:600}}>{filtered.length}/{dbProducts.length}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:t.bg,color:t.text,fontFamily:"Inter,'Segoe UI',system-ui,sans-serif",overflow:"hidden"}}>
      {/* ════ PRODUCT PICKER MODAL ════ */}
      {/* ── AMBIGUOUS MATCH PICKER ── */}
      {picker && (
        <div onClick={() => setPicker(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:20}}>
          <div onClick={e => e.stopPropagation()} style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:16,padding:"22px 24px",width:"min(520px,100%)",maxHeight:"80vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.35)"}}>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>{picker.candidates.length} matches</div>
            <h2 style={{margin:"0 0 6px",fontSize:17,fontWeight:700,color:t.text}}>Which "{picker.query}"?</h2>
            <div style={{fontSize:11,color:t.textSub,marginBottom:16,lineHeight:1.6}}>Open Food Facts returned several products for this name. Pick the exact one to analyse.</div>

            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {picker.candidates.map((p, i) => {
                const ns = p.nutriscore_grade;
                const brand = (p.brands || "").split(",")[0].trim();
                return (
                  <button key={i} onClick={() => scanCandidate(p)} style={{textAlign:"left",background:t.surface,border:`1.5px solid ${t.border}`,borderRadius:10,padding:"11px 13px",cursor:"pointer",display:"flex",gap:12,alignItems:"center",width:"100%"}}>
                    {p.image_url
                      ? <img src={p.image_url} alt="" style={{width:44,height:44,borderRadius:6,objectFit:"contain",background:t.bgSub,flexShrink:0}}/>
                      : <div style={{width:44,height:44,borderRadius:6,background:t.bgSub,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🍽️</div>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.product_name}</div>
                      <div style={{fontSize:10,color:t.textSub,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {brand || "Unknown brand"}{p.quantity ? ` · ${p.quantity}` : ""}
                      </div>
                    </div>
                    {ns && <span style={{fontSize:9,fontWeight:700,color:"#fff",background:NS_COLOR[ns]||"#999",padding:"2px 7px",borderRadius:4,flexShrink:0}}>{ns.toUpperCase()}</span>}
                    <span style={{fontSize:14,color:t.textMuted,flexShrink:0}}>→</span>
                  </button>
                );
              })}
            </div>

            <button onClick={() => setPicker(null)} style={{marginTop:14,width:"100%",background:t.pill,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:t.textSub}}>Cancel</button>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{font-family:'Inter','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased;box-sizing:border-box}
        @keyframes slideIn{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}
        @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes shimmer{0%,100%{opacity:0.4}50%{opacity:0.8}}
        @keyframes foodFloat{from{transform:translateY(0)}to{transform:translateY(-10px)}}
        @keyframes hstFade{0%,100%{opacity:0.04}50%{opacity:0.08}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.2);border-radius:4px}
        input::placeholder{color:rgba(128,128,128,0.4);font-style:italic}
        button{font-family:inherit}
      `}</style>

      <Toast items={toasts} onDismiss={id => setToasts(p => p.filter(n => n.id !== id))} t={t}/>
      {showDbStats && <DbStatsModal/>}

      {/* ── HEADER ── */}
      <header style={{background:t.header,borderBottom:`1px solid ${t.border}`,padding:"12px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,background:t.accent,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span style={{fontSize:13,fontWeight:800,color:"#fff",letterSpacing:"-0.5px"}}>HST</span>
          </div>
          <div>
            <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:2}}>Hazard Substance Tracker</div>
            <h1 style={{margin:0,fontSize:"clamp(14px,2vw,19px)",fontWeight:800,color:t.text,letterSpacing:"-0.4px"}}>Food Safety <span style={{color:t.accent}}>Monitor</span></h1>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>

          {/* SEARCH BAR */}
          <div ref={searchRef} style={{position:"relative"}}>
            <div style={{display:"flex",alignItems:"center",background:t.inputBg,border:`1.5px solid ${searchOpen?t.accent:t.inputBorder}`,borderRadius:22,padding:"0 14px",gap:8,width:"clamp(180px,22vw,280px)",transition:"all 0.2s",boxShadow:searchOpen?`0 0 0 3px ${t.accent}18`:"none"}}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{flexShrink:0,opacity:0.4}}><circle cx="6.5" cy="6.5" r="5.5" stroke={t.text} strokeWidth="1.5"/><path d="M11 11l3.5 3.5" stroke={t.text} strokeWidth="1.5" strokeLinecap="round"/></svg>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} onFocus={()=>setSearchOpen(true)} onKeyDown={e=>{if(e.key==="Enter")runSearch();if(e.key==="Escape"){setSearchOpen(false);setSearchQ("");}}} placeholder="Search anything…" style={{flex:1,background:"none",border:"none",outline:"none",fontSize:12,color:t.inputText,padding:"8px 0",minWidth:0}}/>
              {searchQ && <button onClick={()=>{setSearchQ("");setSearchRes(null);}} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:16,padding:0,lineHeight:1,flexShrink:0}}>×</button>}
            </div>
            {searchOpen && (
              <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,width:"clamp(300px,40vw,480px)",background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,boxShadow:`0 12px 40px rgba(0,0,0,${dark?0.5:0.15})`,zIndex:500,overflow:"hidden"}}>
                {!searchQ && !searchRes && !searchLoading && (
                  <div style={{padding:"12px 0"}}>
                    <div style={{padding:"4px 16px 8px",fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase"}}>Suggested</div>
                    {SUGGESTIONS.map(s => (
                      <div key={s} onClick={()=>{setSearchQ(s);runSearch(s);}} style={{padding:"9px 16px",fontSize:12,color:t.textSub,cursor:"pointer",display:"flex",alignItems:"center",gap:10}} onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov} onMouseLeave={e=>e.currentTarget.style.background=""}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{opacity:0.35,flexShrink:0}}><circle cx="6.5" cy="6.5" r="5.5" stroke={t.text} strokeWidth="1.5"/><path d="M11 11l3.5 3.5" stroke={t.text} strokeWidth="1.5" strokeLinecap="round"/></svg>
                        {s}
                      </div>
                    ))}
                    <div style={{padding:"8px 16px",borderTop:`1px solid ${t.border}`,fontSize:10,color:t.textMuted}}>Press Esc to close</div>
                  </div>
                )}
                {searchLoading && <div style={{padding:"24px 20px",display:"flex",alignItems:"center",gap:12,color:t.textSub,fontSize:13}}><span style={{display:"inline-block",width:14,height:14,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Searching…</div>}
                {searchRes && !searchLoading && (
                  <div>
                    <div style={{padding:"16px 18px",borderBottom:`1px solid ${t.border}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                        <div style={{fontSize:10,fontWeight:600,color:t.accent,letterSpacing:"0.07em",textTransform:"uppercase"}}>{searchRes.category==="credibility"?"Brand Credibility":searchRes.category==="risk"?"Risk Assessment":searchRes.category==="sugar"?"Sugar Analysis":searchRes.category==="diet"?"Diet":searchRes.category==="database"?"Shared Database":"Search Result"}</div>
                        {searchRes.fromDb && <span style={{fontSize:9,fontWeight:700,color:"#2e7d52",background:"rgba(46,125,82,0.1)",border:"1px solid rgba(46,125,82,0.2)",padding:"2px 8px",borderRadius:4}}>GitHub DB — instant</span>}
                        {searchRes.savingToDb && <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:9,fontWeight:600,color:"#b07d2b",background:"rgba(176,125,43,0.1)",border:"1px solid rgba(176,125,43,0.2)",padding:"2px 8px",borderRadius:4}}><span style={{display:"inline-block",width:8,height:8,border:"1.5px solid #b07d2b",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Saving to GitHub…</span>}
                        {searchRes.savedToDb && <span style={{fontSize:9,fontWeight:700,color:"#2e7d52",background:"rgba(46,125,82,0.1)",border:"1px solid rgba(46,125,82,0.2)",padding:"2px 8px",borderRadius:4}}>Saved to GitHub ✓</span>}
                      </div>
                      <p style={{margin:0,fontSize:13,color:t.text,lineHeight:1.7}}>{searchRes.answer}</p>
                    </div>
                    {searchRes.matches?.length > 0 && (
                      <div style={{borderBottom:`1px solid ${t.border}`}}>
                        <div style={{padding:"8px 18px 4px",fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase"}}>Matching items</div>
                        {searchRes.matches.slice(0,5).map((m,i) => {
                          const dietVal = m.diet || tracked.find(f=>f.name.toLowerCase().includes(m.name.toLowerCase()))?.diet;
                          const dc2 = dietVal && dietVal!=="unknown" ? DIET_CFG[dietVal] : null;
                          return (
                            <div key={i} style={{padding:"9px 18px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,borderTop:`1px solid ${t.tableBorder}`,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov} onMouseLeave={e=>e.currentTarget.style.background=""} onClick={()=>{ const found=tracked.find(f=>f.name.toLowerCase().includes(m.name.toLowerCase())||f.offData?.brand?.toLowerCase().includes(m.name.toLowerCase())); if(found){selectEntry(found);setActiveTab("tracker");setSearchOpen(false);} }}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
                                  <span style={{fontSize:12,fontWeight:600,color:t.text}}>{m.name}</span>
                                  {dc2 && <span style={{display:"inline-flex",alignItems:"center",gap:4,background:dc2.bg,border:`1px solid ${dc2.border}`,borderRadius:5,padding:"1px 7px"}}><span style={{fontSize:11}}>{dc2.icon}</span><span style={{fontSize:9,fontWeight:600,color:dc2.fg}}>{dc2.label}</span></span>}
                                </div>
                                <div style={{fontSize:11,color:t.textSub,lineHeight:1.5}}>{m.reason}</div>
                              </div>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{flexShrink:0,opacity:0.3,marginTop:3}}><path d="M6 3l5 5-5 5" stroke={t.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {searchRes.tip && <div style={{padding:"12px 18px",background:dark?"rgba(61,82,196,0.08)":"rgba(61,82,196,0.04)",display:"flex",gap:10,alignItems:"flex-start"}}><div style={{width:18,height:18,borderRadius:"50%",background:t.accent,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}><span style={{fontSize:10,color:"#fff",fontWeight:700}}>i</span></div><p style={{margin:0,fontSize:11,color:t.textSub,lineHeight:1.6}}>{searchRes.tip}</p></div>}
                    <div style={{padding:"8px 18px",display:"flex",justifyContent:"flex-end"}}><button onClick={()=>{setSearchOpen(false);setSearchRes(null);setSearchQ("");}} style={{background:"none",border:"none",fontSize:11,color:t.textMuted,cursor:"pointer",padding:0}}>Dismiss</button></div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* GITHUB DB BADGE */}
          <button onClick={openDbStats} style={{textAlign:"center",padding:"4px 10px",background:dark?"rgba(61,82,196,0.12)":"rgba(61,82,196,0.07)",border:`1px solid ${dark?"rgba(61,82,196,0.25)":"rgba(61,82,196,0.15)"}`,borderRadius:8,cursor:"pointer",position:"relative",transition:"all 0.18s"}} onMouseEnter={e=>e.currentTarget.style.opacity="0.8"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
            <div style={{position:"absolute",top:4,right:4,width:5,height:5,borderRadius:"50%",background:dbCount>0?"#2e7d52":"#b07d2b",animation:dbCount>0?"none":"pulse 1.2s infinite"}}/>
            <div style={{fontSize:16,fontWeight:800,color:t.accent,letterSpacing:"-0.5px"}}>{dbCount}</div>
            <div style={{fontSize:9,fontWeight:500,color:t.textMuted,marginTop:1}}>GitHub DB</div>
          </button>

          {/* ANALYSIS MODE TOGGLE */}
          <button onClick={toggleAI} title={aiMode?"Enhanced analysis: extended research and generated insights":"Standard analysis: built-in safety engine and Open Food Facts data"} style={{background:aiMode?`${t.accent}18`:t.pill,border:`1.5px solid ${aiMode?t.accent:t.border}`,borderRadius:20,padding:"6px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all 0.25s"}}>
            <span style={{fontSize:11,fontWeight:600,color:aiMode?t.accent:t.textSub}}>{aiMode?"Enhanced":"Standard"}</span>
            <span style={{width:26,height:14,borderRadius:8,background:aiMode?t.accent:t.borderMed,position:"relative",transition:"background 0.2s",flexShrink:0}}>
              <span style={{position:"absolute",top:2,left:aiMode?14:2,width:10,height:10,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
            </span>
          </button>

          {/* DARK TOGGLE */}
          <button onClick={()=>setDark(p=>!p)} style={{background:t.pill,border:`1px solid ${t.border}`,borderRadius:20,padding:"6px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:7,transition:"all 0.25s"}}>
            <span style={{fontSize:13}}>{dark?"☀️":"🌙"}</span>
            <span style={{fontSize:11,fontWeight:600,color:t.textSub}}>{dark?"Light":"Dark"}</span>
          </button>

          {/* STATS */}
          {[["Tracked",tracked.length],["High risk",tracked.filter(f=>f.risk==="high").length]].map(([l,v])=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={{fontSize:19,fontWeight:800,color:t.text,letterSpacing:"-0.5px"}}>{v}</div>
              <div style={{fontSize:9,fontWeight:500,color:t.textMuted,marginTop:1}}>{l}</div>
            </div>
          ))}
        </div>
      </header>

      {/* ── TABS ── */}
      <div style={{background:t.tabBg,display:"flex",borderBottom:`2px solid ${t.border}`,padding:"0 22px",overflowX:"auto"}}>
        {tabBtn("tracker","Hazard Tracker")}
        {tabBtn("alternatives","Alternative Foods")}
        {tabBtn("brands","Brand Ratings")}
      </div>

      {/* ════ TRACKER TAB ════ */}
      {activeTab==="tracker" && (
        <div style={{display:"grid",gridTemplateColumns:"minmax(260px,320px) 1fr",height:"calc(100vh - 109px)"}}>

          {/* LEFT PANEL */}
          <div style={{background:t.leftBg,borderRight:`1px solid ${t.border}`,display:"flex",flexDirection:"column",overflow:"hidden",position:"relative"}}>
            <div style={{padding:"16px 16px 10px"}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text,marginBottom:3}}>Scan a product</div>
              <div style={{fontSize:11,color:t.textMuted,marginBottom:10}}>Open Food Facts + {AI_MODE?"enhanced":"standard"} hazard analysis</div>
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} disabled={scanning} placeholder="Product name or barcode…" style={{width:"100%",border:`1.5px solid ${t.inputBorder}`,borderRadius:9,padding:"10px 13px",fontSize:13,outline:"none",background:t.inputBg,color:t.inputText,display:"block"}} onFocus={e=>e.target.style.borderColor=t.accent} onBlur={e=>e.target.style.borderColor=t.inputBorder}/>
              <button onClick={()=>scan()} disabled={scanning||!input.trim()} style={{marginTop:8,width:"100%",background:scanning?t.pill:t.accent,border:"none",color:scanning?t.textMuted:t.accentFg,padding:"11px",borderRadius:9,cursor:scanning||!input.trim()?"default":"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:!input.trim()&&!scanning?0.45:1,transition:"all 0.2s"}}>
                {scanning?<><span style={{display:"inline-block",width:13,height:13,border:`2px solid ${t.textMuted}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Scanning…</>:"Scan"}
              </button>
              <div style={{marginTop:9,padding:"8px 11px",background:dark?"rgba(61,82,196,0.1)":"rgba(61,82,196,0.05)",border:`1px solid ${dark?"rgba(61,82,196,0.25)":"rgba(61,82,196,0.15)"}`,borderRadius:8,fontSize:10,color:t.textSub,lineHeight:1.6}}>
                Scans saved to GitHub — loads instantly for everyone else.
              </div>
            </div>

            {/* RISK FILTER */}
            <div style={{padding:"7px 14px",borderBottom:`1px solid ${t.border}`,display:"flex",gap:4}}>
              {[["all","All"],["high","High"],["medium","Med"],["low","Low"]].map(([r,l])=>(
                <button key={r} onClick={()=>setFilterRisk(r)} style={{flex:1,padding:"5px 3px",background:filterRisk===r?(r==="all"?t.accent:RISK_CFG[r]?.fg||t.accent):t.pill,border:"none",color:filterRisk===r?"#fff":t.pillText,borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:600,transition:"all 0.18s"}}>{l}</button>
              ))}
            </div>

            {/* PRODUCT LIST */}
            <div style={{flex:1,overflowY:"auto",padding:"8px"}}>
              {scanning && (
                <div style={{padding:"12px",marginBottom:4,background:dark?"rgba(61,82,196,0.08)":"rgba(61,82,196,0.05)",border:`1px solid ${dark?"rgba(61,82,196,0.18)":"rgba(61,82,196,0.12)"}`,borderRadius:9,fontSize:11,color:t.accent,display:"flex",alignItems:"center",gap:8,animation:"pulse 1.2s infinite"}}>
                  <span style={{display:"inline-block",width:10,height:10,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite",flexShrink:0}}/>
                  <div><div>Scanning "{input}"…</div><div style={{fontSize:9,color:t.textMuted,marginTop:2}}>Shared DB → Open Food Facts → {AI_MODE?"Enhanced analysis":"Safety engine"}</div></div>
                </div>
              )}
              {filteredTracked.length===0 && !scanning && <div style={{padding:"30px 14px",textAlign:"center",color:t.textMuted,fontSize:11,lineHeight:1.9}}>No products scanned yet.</div>}
              {filteredTracked.map(f => {
                const sugar = f.offData?.nut?.sugars ?? f.aiSugarData?.total_sugars ?? null;
                const isSel = selected?.id === f.id;
                const isHighRisk = f.risk==="high"||f.risk==="medium"||["c","d","e"].includes(f.offData?.nutriScore||"");
                const dc = f.diet && f.diet!=="unknown" ? DIET_CFG[f.diet] : null;
                return (
                  <div key={f.id} style={{marginBottom:4}}>
                    <div onClick={()=>selectEntry(f)} style={{padding:"10px 12px",background:isSel?t.cardSel:t.cardBg,border:`1px solid ${isSel?t.cardSelBorder:t.cardBorder}`,borderLeft:`3px solid ${dc?dc.fg:(f.risk?RISK_CFG[f.risk]?.fg:"transparent")}`,borderRadius:isHighRisk?"9px 9px 0 0":9,cursor:"pointer",transition:"all 0.18s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {f.name}
                            {f.fromCache==="session"&&<span style={{marginLeft:5,fontSize:8,fontWeight:600,color:t.accent,background:`${t.accent}15`,padding:"1px 5px",borderRadius:3,verticalAlign:"middle"}}>cached</span>}
                            {f.fromCache==="shared"&&<span style={{marginLeft:5,fontSize:8,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"1px 5px",borderRadius:3,verticalAlign:"middle"}}>shared</span>}
                          </div>
                          {f.offData?.brand && <div style={{fontSize:10,color:t.textSub,marginTop:1}}>{f.offData.brand}</div>}
                        </div>
                        <div style={{display:"flex",gap:3,alignItems:"center",flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                          {f.offData?.nutriScore && <span style={{fontSize:9,fontWeight:700,color:"#fff",background:NS_COLOR[f.offData.nutriScore]||"#999",padding:"1px 6px",borderRadius:4}}>{f.offData.nutriScore.toUpperCase()}</span>}
                          {f.risk && <span style={{fontSize:8,fontWeight:600,color:RISK_CFG[f.risk]?.fg,background:RISK_CFG[f.risk]?.bg,border:`1px solid ${RISK_CFG[f.risk]?.border}`,padding:"1px 6px",borderRadius:4}}>{f.risk.charAt(0).toUpperCase()+f.risk.slice(1)}</span>}
                          {dc && <span title={dc.label} style={{fontSize:11,display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,borderRadius:4,background:dc.bg,border:`1px solid ${dc.border}`}}>{dc.icon}</span>}
                          <button onClick={e=>rescan(e,f)} title="Rescan — bypass all caches and fetch fresh data" style={{fontSize:11,display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,borderRadius:4,background:t.pill,border:`1px solid ${t.border}`,color:t.textSub,cursor:"pointer",padding:0,lineHeight:1}}>↻</button>
                        </div>
                      </div>
                      <div style={{marginTop:4,fontSize:9,color:t.textMuted,fontFamily:"monospace"}}>
                        {f.substances.length} hazard{f.substances.length!==1?"s":""}
                        {f.offData&&` · ${f.offData.additives.length} additives`}
                        {sugar!=null&&` · ${sugar}g sugar`}
                        {" · "}{f.date}
                      </div>
                      {dc && <div style={{marginTop:4,display:"inline-flex",alignItems:"center",gap:4,background:dc.bg,border:`1px solid ${dc.border}`,borderRadius:5,padding:"2px 7px"}}><span style={{fontSize:10}}>{dc.icon}</span><span style={{fontSize:9,fontWeight:600,color:dc.fg}}>{dc.label}</span></div>}
                    </div>
                    {isHighRisk && (
                      <button onClick={e=>openAltPanel(e,f)} style={{width:"100%",background:showAltFor===f.id?t.accent:`${RISK_CFG[f.risk==="high"?"high":"medium"]?.fg}12`,border:`1px solid ${showAltFor===f.id?t.accent:RISK_CFG[f.risk==="high"?"high":"medium"]?.border}`,borderTop:"none",borderRadius:"0 0 9px 9px",padding:"7px 12px",cursor:"pointer",fontSize:10,fontWeight:600,color:showAltFor===f.id?t.accentFg:RISK_CFG[f.risk==="high"?"high":"medium"]?.fg,transition:"all 0.18s",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                        {panelAltLoading&&showAltFor===f.id?<><span style={{display:"inline-block",width:9,height:9,border:"1.5px solid currentColor",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Finding options…</>:(showAltFor===f.id?"Hide options":"See better options")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ALT OPTIONS SLIDE PANEL */}
            {showAltFor && (
              <div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:50,borderTop:`2px solid ${t.accent}`,background:t.surface,boxShadow:`0 -4px 24px rgba(0,0,0,${dark?0.4:0.12})`,maxHeight:"55vh",display:"flex",flexDirection:"column",animation:"slideUp 0.28s ease"}}>
                <div style={{padding:"12px 14px 8px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${t.border}`}}>
                  <div><div style={{fontSize:10,fontWeight:600,color:t.accent,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:2}}>Better Options</div><div style={{fontSize:12,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}}>{tracked.find(f=>f.id===showAltFor)?.name||""}</div></div>
                  <button onClick={()=>{setShowAltFor(null);setPanelAlts([]);}} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:18}}>×</button>
                </div>
                <div style={{overflowY:"auto",flex:1,padding:"8px 10px",display:"flex",flexDirection:"column",gap:8}}>
                  {panelAltLoading && !panelAlts.length && <div style={{padding:"20px",textAlign:"center",color:t.textSub,fontSize:12,display:"flex",flexDirection:"column",alignItems:"center",gap:10}}><span style={{display:"inline-block",width:18,height:18,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Searching…</div>}
                  {!panelAltLoading && panelAlts.length===0 && <div style={{padding:"18px",textAlign:"center",color:t.textMuted,fontSize:12}}>No alternatives found.</div>}
                  {panelAlts.map((alt,i)=>(
                    <div key={i} style={{background:t.cardBg,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:8,padding:"11px 12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6,marginBottom:5}}>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:t.text,lineHeight:1.3}}>{alt.name}</div>{alt.brand&&<div style={{fontSize:10,color:t.textSub,marginTop:1}}>{alt.brand}</div>}</div>
                        <div style={{display:"flex",gap:4,flexShrink:0}}>
                          {alt.nutriScore&&alt.nutriScore!=="unknown"&&<span style={{fontSize:9,fontWeight:700,color:"#fff",background:NS_COLOR[alt.nutriScore]||"#999",padding:"2px 6px",borderRadius:4}}>{alt.nutriScore.toUpperCase()}</span>}
                          <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"1px 6px",borderRadius:4}}>Better</span>
                        </div>
                      </div>
                      <div style={{fontSize:11,color:t.textSub,lineHeight:1.55,marginBottom:alt.improvements?.length?6:0}}>{alt.reason}</div>
                      {alt.improvements?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:alt.sourceUrl?6:0}}>{alt.improvements.slice(0,2).map((imp,j)=><span key={j} style={{fontSize:9,color:"#2e7d52",background:"rgba(46,125,82,0.08)",border:"1px solid rgba(46,125,82,0.18)",padding:"1px 7px",borderRadius:8}}>✓ {imp}</span>)}</div>}
                      {alt.sourceUrl&&<a href={alt.sourceUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:t.accent,textDecoration:"none"}}>↗ {alt.sourceName||"View"}</a>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT PANEL */}
          <div style={{overflowY:"auto",padding:"18px 22px",background:t.rightBg}}>
            {!selected ? (
              <div style={{position:"relative",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                <FoodBg/>
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",userSelect:"none"}}>
                  <span style={{fontSize:"clamp(100px,20vw,200px)",fontWeight:800,color:t.text,opacity:dark?0.03:0.04,letterSpacing:"-6px",lineHeight:1,animation:"hstFade 5s ease-in-out infinite"}}>HST</span>
                </div>
                <div style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:16,maxWidth:380,textAlign:"center"}}>
                  <div style={{width:68,height:68,background:t.accent,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 20px ${t.accent}35`}}>
                    <span style={{fontSize:22,fontWeight:800,color:"#fff",letterSpacing:"-1px"}}>HST</span>
                  </div>
                  <div><div style={{fontSize:20,fontWeight:700,color:t.text,marginBottom:5,letterSpacing:"-0.3px"}}>Hazard Substance Tracker</div><div style={{fontSize:12,color:t.textMuted,fontWeight:500}}>Open Food Facts · AI Hazard Analysis · Brand Credibility · GitHub DB</div></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,width:"100%",marginTop:4}}>
                    {[["Real product data","Free Open Food Facts API"],["Hazard detection",AI_MODE?"Extended research + curated DB":"Curated substance database"],["Full sugar profile","Total, added & natural"],["Brand ratings","Aggregate scores & label alerts"],["Diet classification","Vegan / Veg / Meat"],["Shared database","GitHub — instant results"]].map(([title,sub])=>(
                      <div key={title} style={{background:t.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${t.border}`,textAlign:"left"}}>
                        <div style={{fontSize:12,fontWeight:600,color:t.text,marginBottom:3}}>{title}</div>
                        <div style={{fontSize:10,color:t.textMuted,lineHeight:1.5}}>{sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:t.textMuted,marginTop:2}}>Type a product name or barcode above to begin</div>
                </div>
              </div>
            ) : selected.offData ? (
              <OFFCard offData={selected.offData} aiSugarData={selected.aiSugarData} substances={selected.substances} insight={insight} insightLoading={insightLoading} brandCred={brandCred} brandCredLoading={brandCredLoading} alternatives={alternatives} altLoading={altLoading} diet={selected.diet||"unknown"} t={t} dark={dark}/>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{background:t.surface,borderRadius:12,padding:"16px 18px",border:`1px solid ${t.border}`}}>
                  <div style={{fontSize:10,fontWeight:600,color:RISK_CFG.medium.fg,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>No Open Food Facts data</div>
                  <h2 style={{margin:"0 0 5px",fontSize:18,fontWeight:700,color:t.text}}>{selected.name}</h2>
                  <div style={{fontSize:11,color:t.textSub}}>{selected.substances.length} substances detected · {selected.date}</div>
                  <div style={{marginTop:10,fontSize:11,color:t.textMuted,lineHeight:1.6}}>Product not found — it may not be in Open Food Facts yet, the search terms may need adjusting (try the barcode number for an exact match), or the request was blocked. Failed lookups are never cached, so retrying fetches fresh.</div>
                  <button onClick={e=>rescan(e,selected)} style={{marginTop:10,background:t.accent,border:"none",color:t.accentFg,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:7}}>↻ Rescan — bypass all caches</button>
                </div>
                {selected.substances.map((s,i)=>(
                  <div key={i} style={{background:t.surface,borderLeft:`3px solid ${RISK_CFG[s.risk]?.fg||"#999"}`,borderRadius:9,padding:"11px 14px",border:`1px solid ${t.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                      <div>{s.eNumber&&<span style={{fontSize:9,fontFamily:"monospace",fontWeight:600,color:"#b07d2b",background:"rgba(176,125,43,0.1)",padding:"1px 6px",borderRadius:3,marginBottom:3,display:"inline-block"}}>{s.eNumber}</span>}<div style={{fontSize:13,fontWeight:600,color:t.text}}>{s.name}</div><div style={{fontSize:10,color:t.textMuted}}>{s.category}</div></div>
                      <span style={{fontSize:9,fontWeight:600,color:RISK_CFG[s.risk]?.fg,background:RISK_CFG[s.risk]?.bg,border:`1px solid ${RISK_CFG[s.risk]?.border}`,padding:"3px 9px",borderRadius:4}}>{s.risk?.charAt(0).toUpperCase()+s.risk?.slice(1)}</span>
                    </div>
                    <div style={{fontSize:11,color:t.textSub,lineHeight:1.6}}>{s.effects}</div>
                  </div>
                ))}
                <div style={{background:t.surface,borderRadius:10,padding:"14px 16px",border:`1px solid ${t.border}`}}>
                  <div style={{fontSize:12,fontWeight:600,color:t.text,marginBottom:8}}>Safety Analysis</div>
                  {insightLoading?<div style={{color:t.textMuted,fontSize:12,fontStyle:"italic",animation:"pulse 1.4s ease infinite"}}>Generating…</div>:insight?<p style={{margin:0,fontSize:12,color:t.textSub,lineHeight:1.8}}>{insight}</p>:null}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════ BRAND RATINGS TAB ════ */}
      {activeTab==="brands" && (() => {
        const brands = computeBrandStats(tracked);
        const totalUndeclared = brands.reduce((a,b)=>a+b.undeclared,0);
        const concerning = brands.filter(b=>b.score<4).length;
        const scoreColor = (sc)=> sc>=8?"#2e7d52":sc>=6?"#b07d2b":sc>=4?"#a0622a":"#c0392b";
        return (
          <div style={{overflowY:"auto",height:"calc(100vh - 109px)",background:t.bg,padding:"20px 24px"}}>
            <div style={{maxWidth:1100,margin:"0 auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12,marginBottom:16}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Aggregated from your scans + shared GitHub DB</div>
                  <div style={{fontSize:19,fontWeight:800,color:t.text,letterSpacing:"-0.4px"}}>Brand Ratings</div>
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {[["Brands",brands.length,t.accent],["Products",brands.reduce((a,b)=>a+b.count,0),"#2e7d52"],["Undeclared",totalUndeclared,totalUndeclared>0?"#c0392b":"#2e7d52"],["Concerning",concerning,concerning>0?"#c0392b":"#2e7d52"]].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:"center",padding:"8px 16px",background:t.surface,borderRadius:9,border:`1px solid ${t.border}`}}>
                      <div style={{fontSize:19,fontWeight:800,color:c,letterSpacing:"-0.5px"}}>{v}</div>
                      <div style={{fontSize:9,color:t.textMuted,marginTop:1}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
              {brands.length===0 ? (
                <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"48px 24px",textAlign:"center"}}>
                  <div style={{fontSize:30,marginBottom:10,opacity:0.3}}>🏷️</div>
                  <div style={{fontSize:14,fontWeight:600,color:t.text,marginBottom:5}}>No branded products yet</div>
                  <div style={{fontSize:12,color:t.textMuted,lineHeight:1.7}}>Scan branded products in the Hazard Tracker tab.<br/>Ratings build automatically from every scan — yours and everyone else's.</div>
                </div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
                  {brands.map(b => {
                    const sc = scoreColor(b.score);
                    const arc = (b.score/10)*251;
                    return (
                      <div key={b.brand} style={{background:t.surface,border:`1px solid ${t.border}`,borderLeft:`3px solid ${sc}`,borderRadius:12,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                        <div style={{padding:"14px 16px",borderBottom:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                          <div style={{minWidth:0}}>
                            <div style={{fontSize:15,fontWeight:700,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.brand}</div>
                            <div style={{fontSize:10,color:t.textSub,marginTop:2}}>{b.count} product{b.count!==1?"s":""} · searched {b.hits}×</div>
                            <span style={{display:"inline-block",marginTop:6,fontSize:10,fontWeight:700,color:sc,background:`${sc}14`,border:`1px solid ${sc}30`,padding:"2px 9px",borderRadius:5}}>{b.verdict}</span>
                          </div>
                          <div style={{position:"relative",width:58,height:58,flexShrink:0}}>
                            <svg viewBox="0 0 90 90" width={58} height={58} style={{transform:"rotate(-90deg)"}}>
                              <circle cx="45" cy="45" r="40" fill="none" stroke={t.border} strokeWidth="7"/>
                              <circle cx="45" cy="45" r="40" fill="none" stroke={sc} strokeWidth="7" strokeDasharray={`${arc} 251`} strokeLinecap="round"/>
                            </svg>
                            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                              <span style={{fontSize:15,fontWeight:800,color:sc,lineHeight:1}}>{b.score}</span>
                              <span style={{fontSize:8,color:t.textMuted}}>/10</span>
                            </div>
                          </div>
                        </div>
                        <div style={{padding:"10px 16px",display:"flex",gap:14,flexWrap:"wrap",borderBottom:`1px solid ${t.border}`,background:t.bgSub}}>
                          {[["High",b.high,"#c0392b"],["Med",b.medium,"#b07d2b"],["Low",b.low,"#2e7d52"],["Undeclared",b.undeclared,b.undeclared>0?"#c0392b":t.textMuted]].map(([l,v,c])=>(
                            <div key={l} style={{display:"flex",alignItems:"baseline",gap:4}}>
                              <span style={{fontSize:14,fontWeight:800,color:v>0?c:t.textMuted,fontFamily:"monospace"}}>{v}</span>
                              <span style={{fontSize:9,color:t.textMuted}}>{l}</span>
                            </div>
                          ))}
                        </div>
                        {b.undeclared>0 && (
                          <div style={{padding:"9px 16px",background:dark?"rgba(192,57,43,0.08)":"rgba(192,57,43,0.05)",borderBottom:`1px solid ${t.border}`,display:"flex",gap:8,alignItems:"flex-start"}}>
                            <span style={{fontSize:12,flexShrink:0}}>⚠️</span>
                            <span style={{fontSize:10.5,color:"#c0392b",fontWeight:600,lineHeight:1.55}}>{b.undeclared} substance report{b.undeclared!==1?"s":""} not declared on product labels.</span>
                          </div>
                        )}
                        <div style={{padding:"11px 16px",display:"flex",flexWrap:"wrap",gap:5}}>
                          {b.products.slice(0,6).map((p,i)=>(
                            <span key={i} onClick={()=>{setInput(p.name);setActiveTab("tracker");}} title="Click to scan" style={{fontSize:10,color:t.textSub,background:t.pill,border:`1px solid ${p.undeclared>0?"rgba(192,57,43,0.35)":t.border}`,padding:"3px 9px",borderRadius:5,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,maxWidth:180}}>
                              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                              {p.risk&&<span style={{width:6,height:6,borderRadius:"50%",background:RISK_CFG[p.risk]?.fg,flexShrink:0}}/>}
                              {p.undeclared>0&&<span style={{fontSize:9,color:"#c0392b",flexShrink:0}}>⚠</span>}
                            </span>
                          ))}
                          {b.products.length>6&&<span style={{fontSize:10,color:t.textMuted,padding:"3px 4px"}}>+{b.products.length-6} more</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{fontSize:9,color:t.textMuted,lineHeight:1.7,marginTop:16,paddingBottom:8}}>Score = 10 − weighted per-product penalties (high/medium risk, undeclared substances, poor Nutri-Score). Community-driven data · educational purposes only.</div>
            </div>
          </div>
        );
      })()}

      {/* ════ ALTERNATIVE FOODS TAB ════ */}
      {activeTab==="alternatives" && (
        <div style={{overflowY:"auto",height:"calc(100vh - 109px)",background:t.bg}}>
          <div style={{display:"grid",gridTemplateColumns:"minmax(280px,340px) 1fr",height:"100%"}}>
            {/* LEFT */}
            <div style={{background:t.leftBg,borderRight:`1px solid ${t.border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"16px 16px 12px",borderBottom:`1px solid ${t.border}`}}>
                <div style={{fontSize:12,fontWeight:600,color:t.text,marginBottom:3}}>Alternative Foods</div>
                <div style={{fontSize:11,color:t.textMuted,lineHeight:1.6}}>Select a product to find healthier alternatives with the same calories.</div>
              </div>
              <div style={{flex:1,overflowY:"auto",padding:"8px"}}>
                {tracked.length===0?(
                  <div style={{padding:"32px 14px",textAlign:"center",color:t.textMuted,fontSize:11,lineHeight:1.9}}>No products yet.<br/>Scan a product first.</div>
                ):tracked.map(f=>{
                  const kcal = f.offData?.nut?.energy_kcal??null;
                  const isSel = altTabFood?.id===f.id;
                  const dc = f.diet&&f.diet!=="unknown"?DIET_CFG[f.diet]:null;
                  return(
                    <div key={f.id} onClick={()=>lookupCalorieAlts(f)} style={{padding:"11px 12px",marginBottom:4,background:isSel?t.cardSel:t.cardBg,border:`1px solid ${isSel?t.cardSelBorder:t.cardBorder}`,borderLeft:`3px solid ${dc?dc.fg:(f.risk?RISK_CFG[f.risk]?.fg:"transparent")}`,borderRadius:9,cursor:"pointer",transition:"all 0.18s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>{f.offData?.brand&&<div style={{fontSize:10,color:t.textSub,marginTop:1}}>{f.offData.brand}</div>}</div>
                        <div style={{display:"flex",gap:3,alignItems:"center",flexShrink:0}}>
                          {f.offData?.nutriScore&&<span style={{fontSize:9,fontWeight:700,color:"#fff",background:NS_COLOR[f.offData.nutriScore]||"#999",padding:"1px 6px",borderRadius:4}}>{f.offData.nutriScore.toUpperCase()}</span>}
                          {f.risk&&<span style={{fontSize:8,fontWeight:600,color:RISK_CFG[f.risk]?.fg,background:RISK_CFG[f.risk]?.bg,border:`1px solid ${RISK_CFG[f.risk]?.border}`,padding:"1px 5px",borderRadius:3}}>{f.risk.charAt(0).toUpperCase()+f.risk.slice(1)}</span>}
                        </div>
                      </div>
                      <div style={{marginTop:5,display:"flex",alignItems:"center",gap:8}}>
                        {kcal!=null&&<span style={{fontSize:10,fontFamily:"monospace",fontWeight:600,color:t.accent}}>{kcal} kcal</span>}
                        <span style={{fontSize:9,color:t.textMuted}}>per 100g</span>
                        {dc&&<span style={{display:"inline-flex",alignItems:"center",gap:3,background:dc.bg,border:`1px solid ${dc.border}`,borderRadius:5,padding:"1px 6px",marginLeft:"auto"}}><span style={{fontSize:10}}>{dc.icon}</span><span style={{fontSize:9,fontWeight:600,color:dc.fg}}>{dc.label}</span></span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* RIGHT */}
            <div style={{overflowY:"auto",padding:"20px 24px",background:t.rightBg}}>
              {!altTabFood?(
                <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",gap:14,position:"relative",overflow:"hidden"}}>
                  <FoodBg/>
                  <div style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
                    <div style={{width:56,height:56,background:t.accent,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 16px ${t.accent}30`}}><span style={{fontSize:22,color:"#fff"}}>🥗</span></div>
                    <div style={{fontSize:17,fontWeight:700,color:t.text,letterSpacing:"-0.3px"}}>Calorie-Matched Alternatives</div>
                    <div style={{fontSize:12,color:t.textMuted,maxWidth:320,lineHeight:1.75}}>Select any scanned product to find healthier foods — fruits, vegetables, whole foods — matched to the same calorie count.</div>
                  </div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"16px 18px"}}>
                    <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:4}}>Finding alternatives for</div>
                    <div style={{fontSize:17,fontWeight:700,color:t.text,marginBottom:5}}>{altTabFood.name}</div>
                    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
                      {altTabFood.offData?.nut?.energy_kcal&&<div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{fontSize:22,fontWeight:800,color:t.accent,fontFamily:"monospace"}}>{altTabFood.offData.nut.energy_kcal}</span><span style={{fontSize:11,color:t.textSub}}>kcal / 100g</span></div>}
                      {altTabFood.risk&&<span style={{fontSize:10,fontWeight:600,color:RISK_CFG[altTabFood.risk]?.fg,background:RISK_CFG[altTabFood.risk]?.bg,border:`1px solid ${RISK_CFG[altTabFood.risk]?.border}`,padding:"3px 10px",borderRadius:5}}>{altTabFood.risk.charAt(0).toUpperCase()+altTabFood.risk.slice(1)} Risk</span>}
                    </div>
                    {altTabFood.offData?.nut?.energy_kcal&&<div style={{marginTop:8,fontSize:10,color:t.textSub,padding:"6px 10px",background:dark?"rgba(61,82,196,0.08)":"rgba(61,82,196,0.05)",borderRadius:6}}>Showing fruits, vegetables & healthier foods within ±50 kcal of {altTabFood.offData.nut.energy_kcal} kcal/100g</div>}
                  </div>
                  {altTabLoading&&<div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"32px",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}><span style={{display:"inline-block",width:22,height:22,border:`2.5px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/><div style={{fontSize:13,color:t.textSub}}>Searching for calorie-matched alternatives…</div></div>}
                  {!altTabLoading&&altTabResults.length===0&&altTabFood&&<div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"32px",textAlign:"center",color:t.textMuted,fontSize:12}}>No alternatives found.</div>}
                  {altTabResults.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      <div style={{fontSize:11,fontWeight:600,color:t.textSub}}>{altTabResults.length} healthier alternatives · sorted by nutritional quality</div>
                      {altTabResults.map((alt,i)=>{
                        const calDiff = alt.calories&&altTabFood.offData?.nut?.energy_kcal?alt.calories-altTabFood.offData.nut.energy_kcal:null;
                        return(
                          <div key={i} style={{background:t.surface,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:12,overflow:"hidden"}}>
                            <div style={{padding:"14px 16px",borderBottom:`1px solid ${t.border}`}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:8}}>
                                <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:t.text,marginBottom:2}}>{alt.name}</div>{alt.brand&&<div style={{fontSize:11,color:t.textSub}}>{alt.brand}</div>}</div>
                                <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
                                  {alt.nutriScore&&alt.nutriScore!=="unknown"&&<span style={{fontSize:10,fontWeight:700,color:"#fff",background:NS_COLOR[alt.nutriScore]||"#999",padding:"3px 9px",borderRadius:5}}>{alt.nutriScore.toUpperCase()}</span>}
                                  <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",border:"1px solid rgba(46,125,82,0.2)",padding:"2px 8px",borderRadius:4}}>Better choice</span>
                                </div>
                              </div>
                              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                                <div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{fontSize:20,fontWeight:800,color:t.accent,fontFamily:"monospace"}}>{alt.calories}</span><span style={{fontSize:10,color:t.textSub}}>kcal/{alt.caloriesPer||"100g"}</span></div>
                                {calDiff!=null&&<span style={{fontSize:10,fontWeight:600,color:Math.abs(calDiff)<=10?"#2e7d52":t.textSub,background:Math.abs(calDiff)<=10?"rgba(46,125,82,0.08)":t.pill,padding:"2px 8px",borderRadius:5}}>{calDiff===0?"Same calories":calDiff>0?`+${calDiff} kcal`:`${calDiff} kcal`}</span>}
                              </div>
                            </div>
                            <div style={{padding:"12px 16px",borderBottom:`1px solid ${t.border}`}}>
                              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                                {[["Protein",alt.protein,"g","#3d6b99"],["Sugars",alt.sugars,"g",tlColor("sugars",alt.sugars)],["Fibre",alt.fiber,"g","#2e7d52"],["Fat",alt.fat,"g",tlColor("fat",alt.fat)]].map(([label,val,unit,col])=>(
                                  <div key={label} style={{textAlign:"center",padding:"8px 4px",background:t.bgSub,borderRadius:7}}>
                                    <div style={{fontSize:9,color:t.textMuted,marginBottom:3,fontWeight:500}}>{label}</div>
                                    <div style={{fontSize:14,fontWeight:700,color:val!=null?col:t.textMuted,fontFamily:"monospace"}}>{val!=null?`${fmt(val)}${unit}`:"—"}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div style={{padding:"12px 16px"}}>
                              <div style={{fontSize:12,color:t.textSub,lineHeight:1.65,marginBottom:8}}>{alt.whyBetter}</div>
                              {alt.benefits?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:alt.sourceUrl?8:0}}>{alt.benefits.map((b,j)=><span key={j} style={{fontSize:10,color:"#2e7d52",background:"rgba(46,125,82,0.07)",border:"1px solid rgba(46,125,82,0.18)",padding:"2px 9px",borderRadius:10}}>✓ {b}</span>)}</div>}
                              {alt.sourceUrl&&<a href={alt.sourceUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,color:t.accent,textDecoration:"none",marginTop:4}}>↗ {alt.sourceName||"View"}</a>}
                            </div>
                          </div>
                        );
                      })}
                      <div style={{fontSize:9,color:t.textMuted,lineHeight:1.7,padding:"4px 2px"}}>{AI_MODE?"Verified with extended research":"Open Food Facts data"} · availability may vary.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

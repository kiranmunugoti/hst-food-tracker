import { useState, useRef, useEffect } from "react";
import { productRatings, addReview, CSPI_TIERS, SENSITIVITY_GROUPS, HEALTH_CONDITIONS } from "./ratings.js";
import { APP_TITLE_LEAD, APP_TITLE_ACCENT } from "./brand.js";

// ─── CONFIG ────────────────────────────────────────────────────────────────────
// The shared scan database lives in its OWN repository, separate from this
// source code. The app commits to it on every scan, so keeping it out of the
// code repo means your `git push` is never rejected by commits the app made.
// Create the repo (public, empty) and put its name here.
const GH_OWNER  = "kiranmunugoti";
const GH_REPO   = "hst-database";   // data only — NOT the source repo
const GH_BRANCH = "main";
const GH_FILE   = "db.json";
const GH_RAW    = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${GH_FILE}`;
// Write access needs VITE_GH_TOKEN (Vercel env var, scoped to the database repo
// only). Reads are public and always work. __GH_TOKEN__ is injected at build
// time by Vite; the typeof guard keeps the app running where it is absent, with
// reads working and writes cleanly disabled.
const GH_TOKEN  = (typeof __GH_TOKEN__ !== "undefined" && __GH_TOKEN__) || "";

// ─── ANALYSIS MODE ─────────────────────────────────────────────────────────────
// false = STANDARD (default): deterministic engine + Open Food Facts + shared
//         database. No AI calls, so the marginal cost per scan is zero.
// true  = ENHANCED: layers extended research on top. Can only ADD to the
//         Standard baseline, so an unavailable response degrades silently.
//         Needs ANTHROPIC_API_KEY server-side on Vercel (see /api/claude).
// Toggleable at runtime from the header switch.
let AI_MODE = false;

// ─── DOMAIN ────────────────────────────────────────────────────────────────────
// "food"      → Open Food Facts + additive/contaminant engine, referenced to
//               EFSA and JECFA, the bodies that actually govern food additives.
// "cosmetics" → Open Beauty Facts + INCI formulation engine, referenced to CIR
//               and SCCS, the bodies that govern cosmetic ingredients.
// The two are kept strictly apart: a CIR conclusion is about skin contact and
// says nothing about ingestion, so limits must never be carried across.
let DOMAIN = "food";

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
  // Food additive limits come from EFSA (which sets the EU ADI) and JECFA (the
  // joint FAO/WHO committee) — the bodies that actually govern food additives.
  // Cosmetic authorities such as CIR and SCCS assess topical exposure and are
  // deliberately not used here.
  const mk = (eKey, rec, confirmed, via) => ({
    key: eKey.toLowerCase(), id: eKey.toLowerCase(), name: rec.name, eNumber: eKey,
    category: rec.cat, risk: rec.risk, effects: rec.fx, limit: rec.lim,
    foundInIngredient: via, ingredientConfirmed: confirmed,
    body: "EFSA", sourceName: "EFSA / JECFA (via Open Food Facts)",
    sourceUrl: `https://world.openfoodfacts.org/additive/${eKey.toLowerCase()}`,
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

// ═══════════════════════════════════════════════════════════════════════════════
// COSMETICS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
// Assessments here follow the two bodies that actually govern cosmetic
// ingredients:
//   • CIR  — Cosmetic Ingredient Review (US expert panel, cir-safety.org).
//            Conclusions: safe as used / safe with qualifications / unsafe /
//            insufficient data.
//   • SCCS — EU Scientific Committee on Consumer Safety. Opinions feed the
//            restrictions in EU Cosmetics Regulation 1223/2009 Annexes II–VI.
//
// Concentration limits quoted below are the EU regulatory limits arising from
// SCCS opinions. They apply to TOPICAL use only and say nothing about
// ingestion — a distinction the app must never blur.
const COSMETIC_DB = {
  // ── Preservatives ──
  methylisothiazolinone: { inci:"Methylisothiazolinone", fn:"Preservative", risk:"high",
    effects:"Potent contact sensitiser; a major cause of allergic contact dermatitis",
    limit:"Banned in leave-on products (EU); 0.0015% in rinse-off", body:"SCCS",
    note:"SCCS concluded no safe concentration could be established for leave-on use.",
    m:/methylisothiazolinone|\bMI\b/i },
  methylchloroisothiazolinone: { inci:"Methylchloroisothiazolinone", fn:"Preservative", risk:"high",
    effects:"Strong sensitiser, used in a 3:1 blend with MI",
    limit:"0.0015% of a 3:1 MCI/MI mixture, rinse-off only (EU)", body:"SCCS",
    m:/methylchloroisothiazolinone|\bMCI\b/i },
  formaldehyde: { inci:"Formaldehyde", fn:"Preservative", risk:"high",
    effects:"Carcinogen by inhalation (IARC Group 1); sensitiser",
    limit:"Banned as an added ingredient in EU cosmetics", body:"SCCS",
    m:/\bformaldehyde\b|formalin/i },
  dmdm_hydantoin: { inci:"DMDM Hydantoin", fn:"Preservative (formaldehyde releaser)", risk:"medium",
    effects:"Releases formaldehyde slowly; sensitisation risk",
    limit:"0.6% (EU); products must be labelled 'releases formaldehyde' above 0.001%", body:"SCCS",
    m:/dmdm hydantoin/i },
  imidazolidinyl_urea: { inci:"Imidazolidinyl Urea", fn:"Preservative (formaldehyde releaser)", risk:"medium",
    effects:"Formaldehyde releaser; contact allergen",
    limit:"0.6% (EU)", body:"CIR", m:/imidazolidinyl urea/i },
  diazolidinyl_urea: { inci:"Diazolidinyl Urea", fn:"Preservative (formaldehyde releaser)", risk:"medium",
    effects:"Formaldehyde releaser; contact allergen",
    limit:"0.5% (EU)", body:"CIR", m:/diazolidinyl urea/i },
  quaternium_15: { inci:"Quaternium-15", fn:"Preservative (formaldehyde releaser)", risk:"medium",
    effects:"The most sensitising of the formaldehyde releasers",
    limit:"0.2% (EU)", body:"CIR", m:/quaternium-?15/i },
  methylparaben: { inci:"Methylparaben", fn:"Preservative", risk:"low",
    effects:"Weak oestrogenic activity in vitro; well tolerated in use",
    limit:"0.4% single ester, 0.8% total parabens (EU)", body:"SCCS",
    note:"SCCS considers methyl- and ethylparaben safe at permitted levels.",
    m:/methylparaben/i },
  propylparaben: { inci:"Propylparaben", fn:"Preservative", risk:"medium",
    effects:"Endocrine-activity concerns prompted a lowered limit",
    limit:"0.14% (EU, reduced from 0.4% after SCCS review)", body:"SCCS",
    m:/propylparaben|butylparaben/i },
  isobutylparaben: { inci:"Isobutylparaben", fn:"Preservative", risk:"high",
    effects:"Endocrine-disruption concerns; insufficient safety data",
    limit:"Banned in EU cosmetics", body:"SCCS", m:/isopropylparaben|isobutylparaben|pentylparaben|phenylparaben|benzylparaben/i },
  phenoxyethanol: { inci:"Phenoxyethanol", fn:"Preservative", risk:"low",
    effects:"Generally well tolerated; occasional irritation",
    limit:"1.0% (EU)", body:"SCCS",
    note:"SCCS re-confirmed 1% as safe for all age groups.",
    m:/phenoxyethanol/i },
  triclosan: { inci:"Triclosan", fn:"Preservative / antimicrobial", risk:"medium",
    effects:"Endocrine effects in animals; antimicrobial resistance concerns",
    limit:"0.3% in specified products only (EU)", body:"SCCS", m:/triclosan/i },

  // ── UV filters ──
  oxybenzone: { inci:"Benzophenone-3 (Oxybenzone)", fn:"UV filter", risk:"medium",
    effects:"Systemic absorption; endocrine-activity concerns; contact allergen",
    limit:"6% in sunscreens, 0.5% when used to protect formulation (EU)", body:"SCCS",
    note:"SCCS lowered the permitted level following absorption data.",
    m:/benzophenone-?3|oxybenzone/i },
  octinoxate: { inci:"Ethylhexyl Methoxycinnamate (Octinoxate)", fn:"UV filter", risk:"medium",
    effects:"Endocrine-activity concerns in animal studies",
    limit:"10% (EU)", body:"SCCS", m:/ethylhexyl methoxycinnamate|octinoxate|octyl methoxycinnamate/i },
  homosalate: { inci:"Homosalate", fn:"UV filter", risk:"medium",
    effects:"Endocrine-activity concerns prompted a substantial limit reduction",
    limit:"7.34% in face products (EU, reduced from 10%)", body:"SCCS", m:/homosalate/i },
  octocrylene: { inci:"Octocrylene", fn:"UV filter", risk:"low",
    effects:"Contact allergen; degrades to benzophenone over time",
    limit:"10% (EU)", body:"SCCS", m:/octocrylene/i },
  titanium_dioxide_nano: { inci:"Titanium Dioxide (nano)", fn:"UV filter", risk:"medium",
    effects:"Safe on intact skin; inhalation of loose powder or spray is the concern",
    limit:"25% (EU); not permitted in sprayable products", body:"SCCS",
    note:"SCCS nanomaterial guidance applies — form and route of exposure govern the risk.",
    m:/titanium dioxide.*nano|\bnano.*titanium dioxide/i },
  zinc_oxide_nano: { inci:"Zinc Oxide (nano)", fn:"UV filter", risk:"low",
    effects:"Not absorbed through intact skin; inhalation is the concern",
    limit:"25% (EU); not permitted in sprayable products", body:"SCCS",
    m:/zinc oxide.*nano|\bnano.*zinc oxide/i },

  // ── Surfactants ──
  sls: { inci:"Sodium Lauryl Sulfate", fn:"Surfactant (anionic)", risk:"medium",
    effects:"Irritant and barrier-disrupting at higher concentrations, especially leave-on",
    limit:"No numeric limit; CIR: safe in rinse-off, concentration-limited in leave-on", body:"CIR",
    note:"CIR concluded safe when formulated to be non-irritating — brief skin contact.",
    m:/sodium lauryl sulfate|sodium laurilsulfate|\bSLS\b/i },
  sles: { inci:"Sodium Laureth Sulfate", fn:"Surfactant (anionic)", risk:"low",
    effects:"Milder than SLS; ethoxylation can leave 1,4-dioxane traces",
    limit:"CIR: safe as used; 1,4-dioxane must be removed", body:"CIR",
    m:/sodium laureth sulfate|sodium lauryl ether sulfate|\bSLES\b/i },
  cocamidopropyl_betaine: { inci:"Cocamidopropyl Betaine", fn:"Surfactant (amphoteric)", risk:"low",
    effects:"Sensitisation usually traced to manufacturing impurities",
    limit:"CIR: safe when impurities are controlled", body:"CIR", m:/cocamidopropyl betaine/i },

  // ── Actives (pH-dependent) ──
  glycolic_acid: { inci:"Glycolic Acid", fn:"AHA exfoliant", risk:"medium",
    effects:"Increases UV sensitivity; irritation at low pH",
    limit:"4% at pH ≥3.8 for consumer use (EU)", body:"SCCS",
    ph:[3.5,4.5], phNote:"Needs an acidic pH to exfoliate; below pH 3.5 irritation rises sharply.",
    m:/glycolic acid/i },
  lactic_acid: { inci:"Lactic Acid", fn:"AHA exfoliant", risk:"low",
    effects:"Milder AHA; increases UV sensitivity",
    limit:"4% at pH ≥3.8 for consumer use (EU)", body:"SCCS",
    ph:[3.5,4.5], m:/lactic acid/i },
  salicylic_acid: { inci:"Salicylic Acid", fn:"BHA exfoliant", risk:"medium",
    effects:"Not for use on children; avoid in pregnancy at high levels",
    limit:"2% in leave-on, 3% in rinse-off (EU)", body:"SCCS",
    ph:[3.0,4.0], phNote:"Active in its free acid form, which needs pH below about 4.",
    m:/salicylic acid/i },
  ascorbic_acid: { inci:"Ascorbic Acid (Vitamin C)", fn:"Antioxidant active", risk:"low",
    effects:"Unstable; oxidises to inactive and potentially irritating products",
    limit:"No restriction", body:"CIR",
    ph:[2.5,3.5], phNote:"L-ascorbic acid only penetrates below about pH 3.5, which is itself irritating.",
    m:/\bascorbic acid\b|l-ascorbic/i },
  niacinamide: { inci:"Niacinamide", fn:"Vitamin B3 active", risk:"low",
    effects:"Well tolerated; flushing at high concentration",
    limit:"No restriction", body:"CIR",
    ph:[5.0,7.0], phNote:"Converts to nicotinic acid (which causes flushing) at low pH.",
    m:/niacinamide|nicotinamide/i },
  retinol: { inci:"Retinol", fn:"Vitamin A active", risk:"medium",
    effects:"Irritation, peeling, UV sensitivity; avoid in pregnancy",
    limit:"0.3% in face products, 0.05% in body lotion (EU)", body:"SCCS",
    ph:[5.5,6.5], phNote:"Degrades rapidly in acidic formulations.",
    m:/\bretinol\b|retinyl palmitate|retinaldehyde|\bretinal\b/i },
  benzoyl_peroxide: { inci:"Benzoyl Peroxide", fn:"Antibacterial active", risk:"medium",
    effects:"Bleaches fabric; irritation; oxidises other actives",
    limit:"Restricted to specific product types (EU)", body:"SCCS", m:/benzoyl peroxide/i },
  hydroquinone: { inci:"Hydroquinone", fn:"Skin lightener", risk:"high",
    effects:"Ochronosis with prolonged use; cytotoxic to melanocytes",
    limit:"Banned in EU cosmetics (permitted only in artificial nail systems)", body:"SCCS",
    m:/hydroquinone/i },

  // ── Other substances of concern ──
  phthalate_dep: { inci:"Diethyl Phthalate", fn:"Fragrance fixative / solvent", risk:"medium",
    effects:"Endocrine-activity concerns for the phthalate class",
    limit:"CIR: safe as used; several other phthalates banned in EU", body:"CIR",
    m:/diethyl phthalate|\bDEP\b|phthalate/i },
  bht_cos: { inci:"BHT", fn:"Antioxidant / stabiliser", risk:"low",
    effects:"Low risk at cosmetic levels",
    limit:"0.8% leave-on face (SCCS opinion)", body:"SCCS", m:/\bBHT\b|butylated hydroxytoluene/i },
  edta_cos: { inci:"Disodium EDTA", fn:"Chelator / stabiliser", risk:"low",
    effects:"Poorly biodegradable; can increase penetration of other ingredients",
    limit:"CIR: safe as used", body:"CIR", m:/\bEDTA\b|edetate/i },
  d5_siloxane: { inci:"Cyclopentasiloxane (D5)", fn:"Emollient / solvent", risk:"medium",
    effects:"Persistent and bioaccumulative; environmental restriction",
    limit:"Restricted to below 0.1% in wash-off products (EU)", body:"SCCS",
    m:/cyclopentasiloxane|cyclotetrasiloxane|\bD5\b|\bD4\b/i },
  talc: { inci:"Talc", fn:"Absorbent / bulking agent", risk:"medium",
    effects:"Must be asbestos-free; inhalation risk in loose powders",
    limit:"Prohibited in powders for children under 3 (EU)", body:"SCCS", m:/\btalc\b/i },
  aluminium_salt: { inci:"Aluminium Salts", fn:"Antiperspirant active", risk:"low",
    effects:"SCCS found systemic exposure acceptable at typical use levels",
    limit:"10.60% in non-spray antiperspirants (SCCS opinion)", body:"SCCS",
    m:/aluminum chlorohydrate|aluminium chlorohydrate|aluminum zirconium|aluminium zirconium/i },

  // ── Banned or severely restricted in EU cosmetics ────────────────────────
  lilial: { inci:"Butylphenyl Methylpropional (Lilial)", fn:"Fragrance", risk:"high",
    effects:"Classified as a reproductive toxicant (CMR 1B)",
    limit:"Banned in EU cosmetics since March 2022", body:"SCCS",
    note:"Prohibited outright rather than restricted. Still appears in older stock and imports.",
    m:/butylphenyl methylpropional|lilial/i },
  kojic_acid: { inci:"Kojic Acid", fn:"Skin brightener", risk:"medium",
    effects:"Skin sensitisation; thyroid effects examined at higher exposures",
    limit:"1% in face and hand products (EU)", body:"SCCS",
    m:/kojic acid/i },
  arbutin: { inci:"Alpha-Arbutin", fn:"Skin brightener", risk:"medium",
    effects:"Releases hydroquinone on breakdown",
    limit:"2% face creams, 0.5% body lotion (EU)", body:"SCCS",
    note:"Limits are set to keep released hydroquinone below a level of concern.",
    m:/arbutin/i },
  resorcinol: { inci:"Resorcinol", fn:"Hair dye intermediate", risk:"medium",
    effects:"Skin sensitiser; thyroid effects at high exposure",
    limit:"0.5% (oxidative hair dyes, EU)", body:"SCCS", m:/resorcinol/i },
  ppd: { inci:"p-Phenylenediamine (PPD)", fn:"Hair dye", risk:"high",
    effects:"Potent contact sensitiser; severe allergic reactions possible",
    limit:"2% (oxidative hair dyes, EU); banned in products for eyelashes/eyebrows", body:"SCCS",
    m:/phenylenediamine|\bppd\b/i },
  toluene: { inci:"Toluene", fn:"Solvent", risk:"high",
    effects:"Reproductive toxicity; CNS effects on inhalation",
    limit:"25% in nail products only, with warnings (EU)", body:"SCCS", m:/\btoluene\b/i },
  formaldehyde_nail: { inci:"Methylene Glycol / Formalin", fn:"Nail hardener", risk:"high",
    effects:"Formaldehyde equivalent; carcinogenic by inhalation",
    limit:"5% in nail hardeners only, with warnings (EU)", body:"SCCS",
    m:/methylene glycol|formalin/i },

  // ── Penetration enhancers: they raise the delivered dose of everything ────
  propylene_glycol: { inci:"Propylene Glycol", fn:"Humectant / penetration enhancer", risk:"low",
    effects:"Occasional irritation and contact allergy",
    limit:"Safe as used in cosmetics", body:"CIR",
    note:"Increases how much of everything else in the formula crosses the barrier.",
    m:/propylene glycol/i },
  ethoxydiglycol: { inci:"Ethoxydiglycol", fn:"Solvent / penetration enhancer", risk:"medium",
    effects:"Strongly increases absorption of co-formulated actives",
    limit:"Safe with qualifications on concentration", body:"CIR",
    note:"The delivered dose of actives alongside it is meaningfully higher than the label concentration suggests.",
    m:/ethoxydiglycol/i },
  alcohol_denat: { inci:"Alcohol Denat.", fn:"Solvent / penetration enhancer", risk:"medium",
    effects:"Barrier disruption with repeated use, especially high in the list",
    limit:"Safe as used", body:"CIR", m:/alcohol denat|\bsd alcohol\b/i },

  // ── Declarable fragrance allergens (EU list of 26) ────────────────────────
  limonene: { inci:"Limonene", fn:"Fragrance allergen", risk:"low",
    effects:"Oxidises in air into a more potent sensitiser",
    limit:"Declarable above 0.001% leave-on / 0.01% rinse-off (EU)", body:"SCCS", m:/\blimonene\b/i },
  linalool: { inci:"Linalool", fn:"Fragrance allergen", risk:"low",
    effects:"Oxidation products are the actual allergens",
    limit:"Declarable above 0.001% leave-on / 0.01% rinse-off (EU)", body:"SCCS", m:/\blinalool\b/i },
  citronellol: { inci:"Citronellol", fn:"Fragrance allergen", risk:"low",
    effects:"Contact allergy in sensitised individuals",
    limit:"Declarable above 0.001% leave-on / 0.01% rinse-off (EU)", body:"SCCS", m:/citronellol/i },
  geraniol: { inci:"Geraniol", fn:"Fragrance allergen", risk:"low",
    effects:"Contact allergy in sensitised individuals",
    limit:"Declarable above 0.001% leave-on / 0.01% rinse-off (EU)", body:"SCCS", m:/geraniol/i },
  eugenol: { inci:"Eugenol", fn:"Fragrance allergen", risk:"low",
    effects:"Contact allergy in sensitised individuals",
    limit:"Declarable above 0.001% leave-on / 0.01% rinse-off (EU)", body:"SCCS", m:/\beugenol\b/i },
  coumarin: { inci:"Coumarin", fn:"Fragrance allergen", risk:"low",
    effects:"Contact allergy in sensitised individuals",
    limit:"Declarable above 0.001% leave-on / 0.01% rinse-off (EU)", body:"SCCS", m:/coumarin/i },
  cinnamal: { inci:"Cinnamal", fn:"Fragrance allergen", risk:"medium",
    effects:"Among the more frequently sensitising fragrance materials",
    limit:"Declarable; concentration-restricted in some uses (EU)", body:"SCCS", m:/cinnamal|cinnamyl alcohol/i },
  isoeugenol: { inci:"Isoeugenol", fn:"Fragrance allergen", risk:"medium",
    effects:"Potent sensitiser, restricted by concentration as well as labelling",
    limit:"0.02% in fine fragrance, lower elsewhere (EU)", body:"SCCS", m:/isoeugenol/i },
};

// The 26 fragrance allergens the EU requires to be declared individually.
// Presence is not a hazard as such — it is a disclosure and sensitisation signal.
const FRAGRANCE_ALLERGENS = ["limonene","linalool","citronellol","geraniol","eugenol","coumarin","cinnamal","citral","isoeugenol","hydroxycitronellal","benzyl salicylate","benzyl alcohol","benzyl benzoate","benzyl cinnamate","cinnamyl alcohol","farnesol","hexyl cinnamal","butylphenyl methylpropional","amyl cinnamal","anise alcohol","methyl 2-octynoate","alpha-isomethyl ionone","evernia prunastri","evernia furfuracea","cinnamyl aldehyde","amylcinnamyl alcohol"];

// Delivery systems change how deeply and how fast an ingredient penetrates,
// which is why SCCS assesses them separately from the raw ingredient.
const DELIVERY_SYSTEMS = [
  { key:"liposome", m:/liposom/i, name:"Liposomes", note:"Phospholipid vesicles that carry actives deeper into the stratum corneum, raising both efficacy and irritation potential." },
  { key:"niosome", m:/niosom/i, name:"Niosomes", note:"Non-ionic surfactant vesicles used to improve penetration and stability." },
  { key:"nano", m:/\bnano|nanoparticle|nanosom|nanoemulsion/i, name:"Nanomaterials", note:"SCCS assesses nanomaterials under dedicated guidance; the route of exposure (especially inhalation) governs the risk." },
  { key:"encapsulation", m:/encapsulat|microencapsul|microsphere|micro-?sponge/i, name:"Encapsulation", note:"Shields unstable actives and releases them gradually, which usually lowers irritation." },
  { key:"cyclodextrin", m:/cyclodextrin/i, name:"Cyclodextrin complexes", note:"Host molecules that stabilise volatile or poorly soluble actives." },
  { key:"ferment", m:/ferment|lysate|filtrate/i, name:"Fermented actives", note:"Fermentation-derived ingredients; composition varies by process and is harder to characterise." },
];

// Stabiliser classes. Their absence matters as much as their presence: a
// water-containing product with no preservative system is a microbial risk.
const STABILISER_CLASSES = [
  { key:"chelator", m:/\bEDTA\b|edetate|phytic acid|sodium phytate|etidronic/i, name:"Chelators", note:"Bind trace metals that would otherwise catalyse oxidation." },
  { key:"antioxidant", m:/tocopherol|\bBHT\b|\bBHA\b|ascorbyl palmitate|sodium metabisulfite|ferulic/i, name:"Antioxidants", note:"Protect oils and actives from oxidising." },
  { key:"emulsifier", m:/polysorbate|cetearyl alcohol|glyceryl stearate|ceteareth|steareth|lecithin|sorbitan/i, name:"Emulsifiers", note:"Hold oil and water phases together; instability shows as separation." },
  { key:"thickener", m:/carbomer|xanthan|cellulose|carrageenan|acrylates.*copolymer|sclerotium/i, name:"Thickeners", note:"Set viscosity and help suspend actives evenly." },
  { key:"phadjust", m:/sodium hydroxide|triethanolamine|citric acid|sodium citrate|lactic acid|aminomethyl propanol/i, name:"pH adjusters", note:"Bring the formulation to its intended pH." },
  { key:"preservative", m:/phenoxyethanol|paraben|benzoate|sorbate|isothiazolinone|hydantoin|imidazolidinyl|diazolidinyl|quaternium|benzyl alcohol|dehydroacetic|chlorphenesin|caprylyl glycol|ethylhexylglycerin/i, name:"Preservative system", note:"Prevents microbial growth in any product containing water." },
];

// ─── COSMETIC ANALYSIS ─────────────────────────────────────────────────────────
// INCI lists are ordered by descending concentration down to 1%, after which
// order is free. That ordering is the only concentration signal available from
// a label, so position is used as a proxy — carefully, and never as a number.
function splitINCI(text) {
  if (!text) return [];
  return String(text)
    .replace(/\(.*?\)/g, " ")               // drop parenthetical notes
    .split(/[,;•\n]/)
    .map(x => x.trim().replace(/^[\-\*\d.\s]+/, ""))
    .filter(x => x.length > 1 && x.length < 90);
}

function cosmeticHazards(ingredientsText) {
  const found = [];
  const raw = (ingredientsText || "").toLowerCase();
  const list = splitINCI(ingredientsText);
  Object.entries(COSMETIC_DB).forEach(([key, rec]) => {
    if (!rec.m.test(raw)) return;
    // Position in the list approximates concentration
    const idx = list.findIndex(i => rec.m.test(i));
    found.push({
      key, id:key, name:rec.inci, category:rec.fn, risk:rec.risk,
      effects:rec.effects, limit:rec.limit, body:rec.body, note:rec.note || null,
      ph:rec.ph || null, phNote:rec.phNote || null,
      position: idx >= 0 ? idx + 1 : null,
      ofTotal: list.length || null,
      ingredientConfirmed: true,      // read directly from the declared INCI list
      sourceName: rec.body === "SCCS" ? "SCCS (EU)" : "CIR",
      sourceUrl: rec.body === "SCCS"
        ? "https://health.ec.europa.eu/scientific-committees/scientific-committee-consumer-safety-sccs_en"
        : "https://www.cir-safety.org/",
    });
  });
  return found;
}

function fragranceAllergensIn(ingredientsText) {
  const raw = (ingredientsText || "").toLowerCase();
  return FRAGRANCE_ALLERGENS.filter(a => raw.includes(a));
}

// pH is almost never printed on packaging, so it is inferred from the actives
// present. The output is the range the formulation MUST sit in to work, plus
// any conflicts between actives that want incompatible ranges.
function phAnalysis(hazards, ingredientsText) {
  const withPh = hazards.filter(h => h.ph);
  const raw = (ingredientsText || "").toLowerCase();
  if (!withPh.length) {
    const isWater = /^\s*(aqua|water|eau)/i.test(String(ingredientsText || "").trim());
    return isWater
      ? { known:false, note:"No pH-dependent actives were identified. A water-based product would normally be formulated near skin pH (4.5–5.5)." }
      : { known:false, note:"No pH-dependent actives were identified." };
  }
  const lo = Math.max(...withPh.map(h => h.ph[0]));
  const hi = Math.min(...withPh.map(h => h.ph[1]));
  const conflicts = [];
  for (let i = 0; i < withPh.length; i++) {
    for (let j = i + 1; j < withPh.length; j++) {
      const a = withPh[i], b = withPh[j];
      if (a.ph[1] < b.ph[0] || b.ph[1] < a.ph[0]) {
        conflicts.push({
          a: a.name, b: b.name,
          detail: `${a.name} needs pH ${a.ph[0]}–${a.ph[1]} while ${b.name} needs pH ${b.ph[0]}–${b.ph[1]}. In one formulation at least one of them is working outside its effective range.`,
        });
      }
    }
  }
  // Known chemical incompatibilities that are not purely about pH
  const pairs = [];
  if (/\bretinol\b|retinaldehyde/.test(raw) && /(glycolic|lactic|salicylic) acid/.test(raw))
    pairs.push("Retinol alongside an exfoliating acid increases irritation, and the acid pH degrades the retinol.");
  if (/\bascorbic acid\b/.test(raw) && /niacinamide/.test(raw))
    pairs.push("L-ascorbic acid and niacinamide want opposite pH ranges; at low pH niacinamide can convert to nicotinic acid, which causes flushing.");
  if (/benzoyl peroxide/.test(raw) && /(\bascorbic acid\b|\bretinol\b)/.test(raw))
    pairs.push("Benzoyl peroxide oxidises vitamin C and retinol, deactivating both.");

  return {
    known: true,
    range: lo <= hi ? [lo, hi] : null,
    drivers: withPh.map(h => ({ name:h.name, ph:h.ph, note:h.phNote })),
    conflicts, incompatibilities: pairs,
    note: lo <= hi
      ? `To work as intended this formulation should sit between pH ${lo} and ${hi}.`
      : "The actives present require incompatible pH ranges, so they cannot all be effective in a single formulation.",
  };
}

function deliverySystemsIn(ingredientsText) {
  const raw = (ingredientsText || "").toLowerCase();
  return DELIVERY_SYSTEMS.filter(d => d.m.test(raw)).map(d => ({ key:d.key, name:d.name, note:d.note }));
}

function stabiliserAnalysis(ingredientsText) {
  const raw = (ingredientsText || "").toLowerCase();
  const present = STABILISER_CLASSES.filter(c => c.m.test(raw)).map(c => ({ key:c.key, name:c.name, note:c.note }));
  const hasPreservative = present.some(p => p.key === "preservative");
  const waterBased = /\b(aqua|water|eau)\b/.test(raw);
  const gaps = [];
  if (waterBased && !hasPreservative)
    gaps.push("This product contains water but no recognised preservative was identified. Water-containing cosmetics need a preservative system to prevent microbial growth.");
  if (present.some(p => p.key === "emulsifier") && !present.some(p => p.key === "antioxidant") && /\boil\b|butter|seed oil/.test(raw))
    gaps.push("An oil phase is present with no antioxidant identified, which makes the oils more likely to oxidise over the product's life.");
  return { present, gaps, waterBased, hasPreservative };
}

// Overall formulation: what the product is built from, judged by INCI order.
function formulationAnalysis(ingredientsText, hazards) {
  const list = splitINCI(ingredientsText);
  if (!list.length) return null;
  const raw = (ingredientsText || "").toLowerCase();
  const base = /^(aqua|water|eau)/i.test(list[0]) ? "Water-based"
    : /alcohol|denat/i.test(list[0]) ? "Alcohol-based"
    : /oil|butter|ester|caprylic|triglyceride/i.test(list[0]) ? "Oil-based (anhydrous)"
    : /glycerin|propanediol|butylene glycol/i.test(list[0]) ? "Humectant-based"
    : "Other";
  // Only the first several entries are meaningfully ordered by concentration
  const leading = list.slice(0, 5);
  const flaggedLeading = hazards.filter(h => h.position && h.position <= 5);
  const allergens = fragranceAllergensIn(ingredientsText);
  const hasFragrance = /\b(parfum|fragrance|aroma)\b/.test(raw);
  return {
    base, total:list.length, leading, flaggedLeading,
    allergens, hasFragrance,
    complexity: list.length > 40 ? "Very high" : list.length > 25 ? "High" : list.length > 12 ? "Moderate" : "Low",
    note: `${list.length} declared ingredients. INCI order is by descending concentration down to 1%, so the first few dominate the formulation.`,
  };
}

// Credibility for a cosmetic product, mirroring the food version's logic:
// disclosure first, then what the disclosure reveals.
function cosmeticCredibility(rec) {
  const off = rec?.offData || null;
  const hazards = rec?.allSubs || [];
  const form = rec?.formulation || null;
  const factors = [];
  let score = 10;

  if (off?.ingredients) {
    factors.push({ label:"Full INCI list published", detail:"Every ingredient is declared, so the formulation can be assessed.", impact:"positive" });
  } else if (off) {
    score -= 2.5;
    factors.push({ label:"No INCI list", detail:"This product does not publish its ingredients, so nothing can be verified.", impact:"negative" });
  } else {
    score -= 3.5;
    factors.push({ label:"No product record", detail:"Not found in Open Beauty Facts; this analysis is based on the name alone.", impact:"negative" });
  }

  const high = hazards.filter(h => h.risk === "high");
  const med  = hazards.filter(h => h.risk === "medium");
  if (high.length) {
    score -= Math.min(4, high.length * 1.6);
    factors.push({ label:`${high.length} restricted or banned ingredient${high.length!==1?"s":""}`, detail:high.slice(0,3).map(h=>h.name).join(", "), impact:"negative" });
  }
  if (med.length) {
    score -= Math.min(2, med.length * 0.5);
    factors.push({ label:`${med.length} ingredient${med.length!==1?"s":""} with concentration limits`, detail:med.slice(0,3).map(h=>h.name).join(", "), impact:"neutral" });
  }
  if (form?.allergens?.length) {
    score -= Math.min(1.2, form.allergens.length * 0.2);
    factors.push({ label:`${form.allergens.length} declared fragrance allergen${form.allergens.length!==1?"s":""}`, detail:"The EU requires these 26 substances to be named individually because of sensitisation risk.", impact:"neutral" });
  } else if (form?.hasFragrance) {
    score -= 0.5;
    factors.push({ label:"Fragrance not broken down", detail:"Listed only as 'parfum', so the individual components are not disclosed.", impact:"negative" });
  }
  const stab = rec?.stabilisers;
  if (stab?.gaps?.length) {
    score -= Math.min(1.5, stab.gaps.length * 0.9);
    factors.push({ label:"Formulation gap", detail:stab.gaps[0], impact:"negative" });
  } else if (stab?.hasPreservative) {
    factors.push({ label:"Preservative system present", detail:"Appropriate for a product containing water.", impact:"positive" });
  }
  const ph = rec?.ph;
  if (ph?.conflicts?.length || ph?.incompatibilities?.length) {
    score -= 0.8;
    factors.push({ label:"Active incompatibility", detail:(ph.conflicts[0]?.detail) || ph.incompatibilities[0], impact:"negative" });
  }

  if (!off) score = Math.min(score, 2.5);
  else if (!off.ingredients) score = Math.min(score, 4.5);
  score = Math.max(0, Math.min(10, +score.toFixed(1)));
  const verdict = !off ? "Unverifiable"
    : score >= 8 ? "Well formulated" : score >= 6 ? "Reasonable" : score >= 4 ? "Some concerns" : score >= 2 ? "Significant concerns" : "Poor";
  return {
    score, verdict, factors, domain:"cosmetics",
    transparency: !off?.ingredients ? "Low" : (form?.hasFragrance && !form?.allergens?.length) ? "Medium" : "High",
    dataCompleteness: off ? Math.round((["name","brand","ingredients","image"].filter(f => off[f]).length / 4) * 100) : 0,
  };
}

function analyzeCosmetic(offData, label) {
  const ingredients = offData?.ingredients || null;
  const hazards = cosmeticHazards(ingredients);
  const ph = phAnalysis(hazards, ingredients);
  const delivery = deliverySystemsIn(ingredients);
  const stabilisers = stabiliserAnalysis(ingredients);
  const formulation = formulationAnalysis(ingredients, hazards);
  const rec = { offData, allSubs:hazards, ph, delivery, stabilisers, formulation, domain:"cosmetics" };
  const cred = cosmeticCredibility(rec);
  return { ...rec, risk:getRisk(hazards), credibility:cred, undeclared:[], undeclaredCount:0, aiSugarData:null, diet:"n/a" };
}

// ─── BRAND OWNERSHIP ───────────────────────────────────────────────────────────
// Open Food Facts records the brand printed on the pack, which is often a
// sub-brand: "Maggi" rather than Nestlé, who have owned it since 1947. Holding
// only the sub-brand accountable hides the record of the company that actually
// sets policy, so ratings roll up to the parent where one is known.
//
// This list is curated and deliberately conservative — only well-established
// ownerships are included. It is necessarily incomplete, and ownership changes
// (disposals, acquisitions) will make entries go stale, so a missing parent
// simply means the brand is rated on its own.
const PARENT_COMPANY = {};
const _own = (parent, brands) => brands.forEach(b => { PARENT_COMPANY[b.toLowerCase()] = parent; });

_own("Nestlé", ["maggi","kitkat","kit kat","nescafé","nescafe","nespresso","milo","cerelac","nesquik","coffee-mate","coffee mate","perrier","s.pellegrino","san pellegrino","aero","milkybar","milky bar","toll house","stouffer's","lean cuisine","hot pockets","gerber","carnation","nestle","nestlé","nan","lactogen","everyday","munch","polo","barone"]);
_own("Unilever", ["knorr","hellmann's","hellmanns","ben & jerry's","ben and jerry's","magnum","cornetto","wall's","walls","marmite","colman's","colmans","pot noodle","kissan","brooke bond","bru","lakme","sunsilk"]);
_own("PepsiCo", ["lay's","lays","doritos","cheetos","tostitos","ruffles","quaker","gatorade","mountain dew","mirinda","kurkure","pepsi","7up","aquafina","sting"]);
_own("The Coca-Cola Company", ["coca-cola","coca cola","sprite","fanta","minute maid","powerade","dasani","costa coffee","innocent","thums up","limca","maaza","smartwater","vitaminwater","kinley"]);
_own("Mondelez", ["cadbury","oreo","toblerone","milka","ritz","trident","halls","belvita","tang","bournvita","dairy milk","5 star","gems","perk"]);
_own("Mars", ["snickers","m&m's","m&ms","twix","bounty","milky way","galaxy","dolmio","ben's original","uncle ben's","pedigree","whiskas","orbit","extra","skittles","celebrations"]);
_own("Kellanova", ["pringles","kellogg's","kelloggs","special k","coco pops","rice krispies","pop-tarts","pop tarts","cheez-it","chocos"]);
_own("General Mills", ["cheerios","betty crocker","nature valley","old el paso","fibre one","fiber one"]);
_own("Danone", ["activia","actimel","alpro","evian","volvic","aptamil","oikos","danone","protinex"]);
_own("Ferrero", ["nutella","kinder","tic tac","ferrero rocher","thorntons","butterfinger"]);
_own("Kraft Heinz", ["heinz","kraft","oscar mayer","jell-o","jello","complan","glucon d","glucon-d"]);
_own("ITC", ["aashirvaad","sunfeast","bingo","yippee","b natural"]);
_own("Britannia", ["britannia","good day","marie gold","nutrichoice","tiger","milk bikis","treat"]);
_own("Parle", ["parle","parle-g","parle g","monaco","hide & seek","hide and seek","krackjack","melody","mango bite"]);
_own("Nissin", ["top ramen","cup noodles","nissin"]);
_own("Haldiram's", ["haldiram","haldiram's","haldirams"]);
_own("Amul (GCMMF)", ["amul"]);
_own("Bisleri", ["bisleri"]);
_own("Dabur", ["dabur","real","réal"]);
_own("Marico", ["saffola","parachute"]);
_own("Hershey", ["hershey","hershey's","reese's","jolly rancher"]);
_own("Lotte", ["lotte","choco pie"]);
_own("Perfetti Van Melle", ["mentos","chupa chups","alpenliebe","center fresh","big babol"]);

// Resolve a brand to the company behind it. Returns null when unknown, and
// never returns the brand itself, so callers can tell "no parent on record"
// from "the brand is the company".
function parentOf(brand) {
  if (!brand) return null;
  const key = String(brand).toLowerCase().trim().replace(/\s+/g, " ");
  const parent = PARENT_COMPANY[key];
  if (!parent) return null;
  return parent.toLowerCase() === key ? null : parent;
}

// The identity a brand should be RATED under: its parent if known, else itself.
function ratingIdentity(brand) {
  if (!brand) return null;
  return parentOf(brand) || String(brand).trim();
}

// Every brand OFF listed, plus the resolved parent — used so a product filed
// under "Maggi" still matches a search or rating for Nestlé.
function brandChain(offData) {
  const all = (offData?.brands && offData.brands.length ? offData.brands : [offData?.brand]).filter(Boolean);
  const parent = parentOf(all[0]);
  const out = [...all];
  if (parent && !out.some(b => b.toLowerCase() === parent.toLowerCase())) out.push(parent);
  return out;
}

// ─── PRODUCT CREDIBILITY ───────────────────────────────────────────────────────
// Judges THIS product on what it does and does not disclose. Entirely
// deterministic and derived from the product's own record, so the same product
// always scores the same regardless of what else has been scanned.
//
// Transparency is the organising idea: a product that publishes a full
// ingredient list and carries no undisclosed substances is credible even if it
// is not especially healthy. Nutritional quality is scored separately and
// weighted less, because it answers a different question.
function productCredibility(rec) {
  if (rec?.domain === "cosmetics" || DOMAIN === "cosmetics") return rec?.credibility || cosmeticCredibility(rec);
  const off = rec?.offData || null;
  const subs = rec?.allSubs || rec?.substances || [];
  const undeclared = off?.ingredients ? subs.filter(s => s.ingredientConfirmed === false).length : (rec?.undeclaredCount || 0);
  const factors = [];
  let score = 10;

  // 1. Ingredient disclosure — the single strongest credibility signal
  if (off?.ingredients) {
    factors.push({ label: "Ingredients published", detail: "The full ingredient list is on record.", impact: "positive" });
  } else if (off) {
    score -= 2.5;
    factors.push({ label: "No ingredient list", detail: "This product does not publish its ingredients, so nothing can be confirmed from the label.", impact: "negative" });
  } else {
    score -= 3.5;
    factors.push({ label: "No product record", detail: "The product was not found in Open Food Facts, so this analysis is based on its name alone.", impact: "negative" });
  }

  // 2. Undisclosed substances — what the label leaves out
  if (undeclared > 0) {
    score -= Math.min(4, undeclared * 1.4);
    factors.push({ label: `${undeclared} substance${undeclared !== 1 ? "s" : ""} not on the label`, detail: "Documented for this product or its category but absent from the declared ingredients.", impact: "negative" });
  } else if (off?.ingredients) {
    factors.push({ label: "Nothing undisclosed found", detail: "No substances were identified beyond those declared.", impact: "positive" });
  }

  // 3. Declared hazardous additives — disclosed, so a smaller penalty
  const high = subs.filter(s => s.risk === "high" && s.ingredientConfirmed !== false).length;
  const med  = subs.filter(s => s.risk === "medium" && s.ingredientConfirmed !== false).length;
  if (high > 0) {
    score -= Math.min(2.5, high * 1.2);
    factors.push({ label: `${high} high-risk additive${high !== 1 ? "s" : ""} declared`, detail: "Disclosed on the label, but of significant concern.", impact: "negative" });
  }
  if (med > 0) {
    score -= Math.min(1.2, med * 0.35);
    factors.push({ label: `${med} medium-risk additive${med !== 1 ? "s" : ""} declared`, detail: "Disclosed and generally acceptable in moderation.", impact: "neutral" });
  }

  // 4. Nutritional quality — a lighter weight than disclosure
  const ns = off?.nutriScore;
  if (ns && "abcde".includes(ns)) {
    if (ns === "d") score -= 0.8;
    else if (ns === "e") score -= 1.4;
    else if (ns === "a" || ns === "b") score += 0.4;
    factors.push({
      label: `Nutri-Score ${ns.toUpperCase()}`,
      detail: "abc".includes(ns) ? "Acceptable nutritional quality." : "Poor nutritional quality.",
      impact: "ab".includes(ns) ? "positive" : "cde".indexOf(ns) >= 1 ? "negative" : "neutral",
    });
  }
  if (off?.novaGroup === 4) {
    score -= 0.8;
    factors.push({ label: "Ultra-processed (NOVA 4)", detail: "Made largely from industrial ingredients and additives.", impact: "negative" });
  }

  // 5. Certifications on the product itself
  const labels = (off?.labels || []).map(l => String(l).replace(/^en:/, "").replace(/-/g, " "));
  const certs = labels.filter(l => /organic|bio|fair.?trade|non.?gmo|rainforest|vegan|gluten.?free/i.test(l));
  if (certs.length) {
    score += Math.min(0.6, certs.length * 0.3);
    factors.push({ label: `${certs.length} certification${certs.length !== 1 ? "s" : ""}`, detail: certs.slice(0, 3).join(", "), impact: "positive" });
  }

  // Unverifiable is not the same as clean. With no record — or a record with no
  // ingredient list — most checks simply could not run, so the score is capped
  // rather than left high by default. Missing evidence must never read as a
  // pass, otherwise the least documented products score best.
  if (!off) score = Math.min(score, 2.5);
  else if (!off.ingredients) score = Math.min(score, 4.5);

  score = Math.max(0, Math.min(10, +score.toFixed(1)));
  const verdict = !off ? "Unverifiable"
    : score >= 8 ? "Transparent" : score >= 6 ? "Mostly transparent" : score >= 4 ? "Partly disclosed" : score >= 2 ? "Poorly disclosed" : "Opaque";
  const transparency = !off?.ingredients ? "Low" : undeclared === 0 ? "High" : undeclared <= 2 ? "Medium" : "Low";

  // How much is actually known about this product — separate from the score,
  // because sparse data is a caveat on the analysis, not a fault of the product
  const fields = ["name","brand","ingredients","image","nutriScore","novaGroup"];
  const known = off ? fields.filter(f => off[f] != null && off[f] !== "").length : 0;
  const nutKnown = off?.nut ? Object.values(off.nut).filter(v => v != null).length : 0;

  return {
    score, verdict, transparency, factors,
    undeclared, declaredHigh: high,
    dataCompleteness: Math.round(((known / fields.length) * 0.7 + Math.min(1, nutKnown / 8) * 0.3) * 100),
    hitCount: rec?.hitCount || 1,
  };
}

// ─── BRAND SCORE (stable) ──────────────────────────────────────────────────────
// Computed only from the shared database, which is the same for everyone, so a
// brand scores identically no matter which of its products you are viewing and
// no matter what you have scanned this session. Session scans are deliberately
// excluded: including them made the figure drift as you worked.
function brandScoreStable(brand) {
  if (!brand) return null;
  const identity = ratingIdentity(brand);           // parent company when known
  const idl = identity.toLowerCase().trim();

  // A product belongs to this company if any brand on its record — or the
  // parent resolved from it — matches. This is what makes a product filed
  // under "Maggi" count towards Nestlé.
  const recs = Object.values(_ghDb.products || {}).filter(p => {
    const chain = brandChain(p.offData).map(b => b.toLowerCase().trim());
    if (chain.includes(idl)) return true;
    return chain.some(b => (ratingIdentity(b) || "").toLowerCase().trim() === idl);
  });
  if (!recs.length) return null;

  const agg = { count: recs.length, high: 0, medium: 0, low: 0, undeclared: 0, ns: { a:0,b:0,c:0,d:0,e:0 }, hits: 0 };
  const subBrands = new Set();
  recs.forEach(p => {
    agg.hits += p.hitCount || 1;
    if (p.risk === "high") agg.high++; else if (p.risk === "medium") agg.medium++; else if (p.risk === "low") agg.low++;
    agg.undeclared += undeclaredOf(p);
    const ns = p.offData?.nutriScore;
    if (ns && agg.ns[ns] != null) agg.ns[ns]++;
    const b = p.offData?.brand;
    if (b && b.toLowerCase().trim() !== idl) subBrands.add(b.trim());
  });
  const { score, verdict } = brandScoreOf(agg);
  return { ...agg, score, verdict, identity, isParent: identity.toLowerCase() !== brand.toLowerCase().trim(), subBrands: [...subBrands] };
}

// Free healthier alternatives via the Open Food Facts search API
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
  const base = str.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").slice(0, 80);
  // Namespace cosmetic keys so a shampoo and a soup of the same name cannot
  // collide in the shared database.
  return DOMAIN === "cosmetics" ? "cos:" + base : base;
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

// Merged food search: Open Food Facts, topped up from USDA FoodData Central.
//
// OFF is queried first and its records win on conflict — they carry Nutri-Score,
// NOVA and additive tags that FDC has no equivalent for. USDA is only called
// when OFF has not already filled the list, so a well-covered query costs the
// same one request it always did.
// Which sources are worth querying, and in what order, for a given market.
//
// FoodData Central indexes US branded products. That is useful well beyond the
// US: American brands are widely sold in India, Australia, the Gulf, Singapore,
// Japan and Latin America, and OFF's coverage of those shelves is thin. So FDC
// is queried in parallel with OFF almost everywhere.
//
// Europe is the exception. OFF originated there, its European coverage is by
// far its strongest, and European formulations differ from US ones — different
// permitted additives, different recipes under the same brand. An FDC record
// would describe a product that is not the one on a European shelf, so it is
// skipped rather than shown misleadingly.
//
// One honest limitation this cannot solve: an FDC record always describes the
// US formulation. Where a brand sells a locally-made variant, the additive list
// may differ from the pack in hand — which is why the disclaimer says
// formulations differ by country.
const EUROPEAN_MARKETS = new Set(["gb", "ie", "de", "fr", "es", "it", "nl", "be", "ch"]);

function sourcePlan(market) {
  // US: FDC is the better primary — a US pack is likelier to be there than in OFF.
  if (market === "us") return { usda: "first" };
  // Europe: OFF only.
  if (EUROPEAN_MARKETS.has(market)) return { usda: "skip" };
  // Everywhere else: both at once. FDC covers the imported American brands,
  // OFF covers local ones, and neither alone is enough.
  return { usda: "parallel" };
}

async function foodSearchMerged(terms, limit) {
  const plan = sourcePlan(currentMarket());

  let offHits = [], offFailed = null;
  let usdaPromise = null;

  // In the US both sources are asked at once. FDC has its own rate budget
  // (1,000/hour) separate from OFF's 10/minute, so a parallel call costs OFF
  // nothing and halves the wait.
  if (plan.usda === "first" || plan.usda === "parallel") {
    usdaPromise = usdaSearch(terms, limit).catch(() => []);
  }

  try { offHits = await offSearch(terms, limit, "food"); }
  catch (e) { offFailed = e; }

  // Enough from OFF and no reason to look further.
  if (offHits.length >= limit && plan.usda === "skip") return offHits;

  let usdaHits = [];
  if (usdaPromise) {
    usdaHits = await usdaPromise;
  }
  if (offFailed && !usdaHits.length) throw offFailed;

  // Dedupe. Barcode is authoritative when both sides have one; otherwise fall
  // back to a normalised name+brand key, which catches the common case of the
  // same product present in both databases without a shared GTIN.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const seen = new Set();
  const keysOf = (p) => {
    const k = [];
    if (p.code) k.push("c:" + String(p.code).replace(/^0+/, ""));
    k.push("n:" + norm(p.product_name) + "|" + norm(asText(p.brands).split(",")[0]));
    return k;
  };
  // Order. Appending USDA after OFF buries US products below European ones in
  // the market where OFF is weakest, so in the US the two are interleaved.
  // Interleave wherever both sources ran, so neither database's products get
  // buried under the other's. Which one leads differs: in the US, FDC is the
  // more likely match; elsewhere OFF leads because it carries the local brands
  // FDC has never heard of.
  const interleave = (a, b) => {
    const mixed = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) mixed.push(a[i]);
      if (b[i]) mixed.push(b[i]);
    }
    return mixed;
  };
  const ordered =
    plan.usda === "first"    ? interleave(usdaHits, offHits) :
    plan.usda === "parallel" ? interleave(offHits, usdaHits) :
                               offHits;

  const out = [];
  for (const p of ordered) {
    const keys = keysOf(p);
    if (keys.some(k => seen.has(k))) continue;
    keys.forEach(k => seen.add(k));
    out.push(p);
  }

  // Market ranking. Search results were not market-aware at all — only
  // alternatives and discovery were — so a name search returned whatever the
  // index ranked highest regardless of where the reader shops. Results are
  // REORDERED rather than filtered: a product sold elsewhere is still a valid
  // answer to "what is this", and dropping it could hide the very item in hand.
  const tag = marketTag();
  if (tag) {
    const localFirst = (p) => {
      const c = p.countries_tags || p.countries || [];
      const list = Array.isArray(c) ? c.map(String) : String(c).split(",");
      return list.some(x => x.toLowerCase().includes(tag.replace("en:", ""))) ? 0 : 1;
    };
    out.sort((a, b) => localFirst(a) - localFirst(b));
  }

  return out.slice(0, Math.max(limit, offHits.length));
}

// ─── SOURCE DIAGNOSTICS ────────────────────────────────────────────────────────
// A dead endpoint, a rate limit and an empty catalogue otherwise all produce
// the same "no results". This probes each endpoint independently and reports
// what came back, so a failure can be identified rather than guessed at.
//
// Deliberately sequential with a small gap: firing six search requests at once
// is itself enough to trip OFF's 10/min limit and would produce a false report.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function probeEndpoint(label, fn) {
  const t0 = Date.now();
  try {
    const n = await fn();
    return { label, ok: true, detail: `${n} result${n === 1 ? "" : "s"}`, ms: Date.now() - t0 };
  } catch (e) {
    const kind = e instanceof OffRateLimited ? "rate limited"
      : e instanceof OffNotFound ? "not found"
      : "failed";
    return { label, ok: false, detail: `${kind} — ${String(e?.message || e)}`, ms: Date.now() - t0 };
  }
}

async function diagnoseSources(term = "greek yogurt") {
  const probes = [
    ["Open Food Facts — barcode API", async () => {
      // Nutella: a barcode that certainly exists, so a failure here is transport.
      const d = await offJson(`${OFF_HOST}/api/v2/product/3017620422003.json?fields=product_name`);
      return d?.product?.product_name ? 1 : 0;
    }],
    ["Search-a-licious — full-text", async () => (await offSearchSAL(term, 3)).length],
    ["Open Food Facts — legacy search.pl", async () => (await offSearchLegacy(term, 3, "food")).length],
    ["Search-a-licious — filters (organic)", async () => {
      const { products } = await filterSearch({ labels_tags: "en:organic" }, "food", 3);
      return products.length;
    }],
    ["USDA FoodData Central", async () => (await usdaSearch(term, 3)).length],
    ["Open Beauty Facts — cosmetics search", async () => (await offSearchLegacy("yogurt", 3, "cosmetics")).length],
  ];
  const out = [];
  for (const [label, fn] of probes) {
    out.push(await probeEndpoint(label, fn));
    await sleep(600);
  }
  return out;
}

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

// Returns raw product records (OFF shape) for a set of filter params.
// ─── MARKET / LOCATION ─────────────────────────────────────────────────────────
// Open Food Facts began in France and its coverage is still heaviest there, so
// an unfiltered query returns European products to everyone. That makes the
// alternatives useless — nobody in Minnesota can buy a French yoghurt.
//
// Queries are therefore filtered to the reader's market. The filter is applied
// as a PREFERENCE, not a hard constraint: if it returns nothing, the query is
// re-run unfiltered rather than showing an empty list, because a distant
// alternative still beats no alternative.
const MARKETS = {
  us: { label: "United States", tag: "en:united-states" },
  ca: { label: "Canada",        tag: "en:canada" },
  gb: { label: "United Kingdom",tag: "en:united-kingdom" },
  ie: { label: "Ireland",       tag: "en:ireland" },
  au: { label: "Australia",     tag: "en:australia" },
  nz: { label: "New Zealand",   tag: "en:new-zealand" },
  in: { label: "India",         tag: "en:india" },
  de: { label: "Germany",       tag: "en:germany" },
  fr: { label: "France",        tag: "en:france" },
  es: { label: "Spain",         tag: "en:spain" },
  it: { label: "Italy",         tag: "en:italy" },
  nl: { label: "Netherlands",   tag: "en:netherlands" },
  be: { label: "Belgium",       tag: "en:belgium" },
  ch: { label: "Switzerland",   tag: "en:switzerland" },
  mx: { label: "Mexico",        tag: "en:mexico" },
  br: { label: "Brazil",        tag: "en:brazil" },
  jp: { label: "Japan",         tag: "en:japan" },
  za: { label: "South Africa",  tag: "en:south-africa" },
  ae: { label: "UAE",           tag: "en:united-arab-emirates" },
  sg: { label: "Singapore",     tag: "en:singapore" },
  world: { label: "Anywhere",   tag: null },
};

// Best guess from the browser, used only as the initial value — the reader can
// override it, and the override is what is stored.
function guessMarket() {
  try {
    const stored = window.localStorage.getItem("hst_market");
    if (stored && MARKETS[stored]) return stored;
    const loc = new Intl.Locale(navigator.language || "en-US");
    const region = (loc.region || "").toLowerCase();
    if (MARKETS[region]) return region;
    // Time zone is a better signal than language: en-US is the default locale
    // on plenty of devices outside the US.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/^America\//.test(tz)) return /Toronto|Vancouver|Edmonton|Winnipeg|Halifax/.test(tz) ? "ca" : "us";
    if (/^Europe\/London|Europe\/Belfast/.test(tz)) return "gb";
    if (/^Asia\/(Kolkata|Calcutta)/.test(tz)) return "in";
    if (/^Australia\//.test(tz)) return "au";
  } catch { /* fall through */ }
  return "world";
}

let _market = "world";
const setMarketTag = (m) => { _market = m; };
const marketTag = () => MARKETS[_market]?.tag || null;
const currentMarket = () => _market;

// Adds the market filter to a parameter set, when one is set.
function withMarket(params) {
  const tag = marketTag();
  return tag ? { ...params, countries_tags: tag } : params;
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
    _offStatus = found ? "ok"
      : limited > 0 ? "ratelimited"
      : (tried > 0 && blocked >= tried) ? "network"
      : "nomatch";
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
      _offStatus = "ok";
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
    if (_offStatus === "nomatch") _offStatus = "unknown-code";
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
let _ghLastError = "";  // human-readable reason the last write failed

// Load the shared database. Returns "ok" | "empty" | "error" so the caller can
// tell an empty database apart from an unreachable one.
async function ghLoad(setDbCount) {
  try {
    const r = await fetch(`${GH_RAW}?t=${Date.now()}`);
    if (!r.ok) {
      // 404 = the database file does not exist yet. That is a normal first-run
      // state: the first write creates it.
      console.info(`Shared database not found at ${GH_OWNER}/${GH_REPO}/${GH_FILE} (HTTP ${r.status}). It will be created on the first successful write.`);
      return "empty";
    }
    const data = await r.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("malformed database file");
    _ghDb = { products: data.products || {}, searchLog: data.searchLog || [], _meta: data._meta || {} };
    setDbCount(Object.keys(_ghDb.products).length);
    if (GH_TOKEN) {
      const r2 = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`, {
        headers:{ Authorization:`Bearer ${GH_TOKEN}`, Accept:"application/vnd.github.v3+json" },
      });
      if (r2.ok) { const meta = await r2.json(); _ghSha = meta.sha; }
    }
    return "ok";
  } catch (e) {
    console.warn("ghLoad:", e);
    return "error";
  }
}

// Looks up a barcode in the shared database. Community-added products live in
// the same store as scanned ones, so a product someone added by hand is found
// by the next person who scans it — which is the whole point of adding it.
// The database is already in memory, so this costs no request and is checked
// before any remote source.
function ghGetByCode(code) {
  const want = String(code || "").replace(/^0+/, "");
  if (!want) return null;
  for (const [key, rec] of Object.entries(_ghDb.products || {})) {
    const c = rec?.offData?.code;
    if (c && String(c).replace(/^0+/, "") === want) return { key, rec };
  }
  return null;
}

function ghGet(ck) {
  const rec = _ghDb.products?.[ck];
  if (!rec) return null;
  const ageDays = (Date.now() - (rec.savedAt || 0)) / 86400000;
  return ageDays > 30 ? null : rec; // expire after 30 days
}

// Write the whole DB to GitHub. Returns "saved" | "no-token" | "error".
// Handles stale/missing sha (409/422) by refetching and retrying once.
// ─── PRODUCT IMAGES ────────────────────────────────────────────────────────────
// Images are stored as SEPARATE repository files, never inside db.json.
//
// ghWrite() rewrites the whole database file on every save, so an embedded
// base64 image is re-uploaded on every subsequent write by anyone. At 640px
// that is ~75 KB per product: 1,000 products would mean a 74 MB upload each
// time a single review is saved, past the point GitHub's contents API accepts.
// One file per image keeps the database holding a ~90-byte URL instead.
const IMG_MAX_DIM = 640;      // enough for a card; a barcode photo is not art
const IMG_QUALITY = 0.72;

// Downscales and re-encodes before upload. A modern phone photo is 3–8 MB,
// which is both slow to upload and pointless at the size it will be displayed.
async function compressImage(source, maxDim = IMG_MAX_DIM, quality = IMG_QUALITY) {
  const bitmap = source instanceof Blob ? await createImageBitmap(source) : source;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  const dataUrl = c.toDataURL("image/jpeg", quality);
  return { dataUrl, base64: dataUrl.split(",")[1], w, h,
           bytes: Math.round(dataUrl.length * 0.75) };
}

// Uploads to the database repo under images/. Returns the public raw URL.
async function ghPutImage(key, base64) {
  if (!GH_TOKEN) return null;                       // read-only deployment
  const path = `images/${key}.jpg`;
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github.v3+json" };
  try {
    // An existing file needs its sha to overwrite; a missing one 404s, which is
    // the normal first-upload case rather than an error.
    let sha;
    const head = await fetch(url, { headers });
    if (head.ok) sha = (await head.json()).sha;

    const r = await fetch(url, {
      method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: `image: ${key}`, content: base64, branch: GH_BRANCH, ...(sha ? { sha } : {}) }),
    });
    if (!r.ok) {
      console.warn("ghPutImage failed:", r.status, await r.text().catch(() => ""));
      return null;
    }
    return `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${path}`;
  } catch (e) {
    console.warn("ghPutImage:", e);
    return null;
  }
}

// Device-only fallback when the deployment has no write token. The photo is
// still worth keeping for the person who took it, and localStorage is honest
// about its scope — it is not presented as shared.
function localImageKey(key) { return `hst_img_${key}`; }
function saveLocalImage(key, dataUrl) {
  try { window.localStorage.setItem(localImageKey(key), dataUrl); return true; }
  catch { return false; }   // quota exceeded — images are the first thing to fill it
}
function getLocalImage(key) {
  try { return window.localStorage.getItem(localImageKey(key)); } catch { return null; }
}

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
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      // Name the likely cause instead of a bare failure — these are the three
      // setup mistakes that actually happen.
      const hint = r.status === 404
        ? `Repository ${GH_OWNER}/${GH_REPO} not found. Create it (public, with a main branch) or correct GH_REPO.`
        : r.status === 401 ? "The token is invalid or expired."
        : r.status === 403 ? `The token lacks 'Contents: Read and write' on ${GH_OWNER}/${GH_REPO}.`
        : `HTTP ${r.status}.`;
      console.warn("ghWrite failed:", r.status, hint, detail);
      _ghLastError = hint;
      return "error";
    }
    const resp = await r.json();
    _ghSha = resp.content?.sha || _ghSha;
    return "saved";
  } catch (e) { console.warn("ghWrite:", e); return "error"; }
}

// Merges rather than replaces.
//
// This previously assigned the record wholesale, so any writer that did not
// happen to carry every field destroyed the rest. commitScan writes only the
// scan payload — offData, substances, risk — so a single rescan wiped every
// review, contribution, accolade and photo score attached to that product.
// Community data is append-only in spirit and must survive writers that know
// nothing about it.
//
// Scan fields still overwrite, which is intended: a fresh analysis should
// replace a stale one. Only keys absent from `data` are preserved.
async function ghSet(ck, data, setDbCount) {
  _ghDb.products = _ghDb.products || {};
  const prior = _ghDb.products[ck] || {};
  _ghDb.products[ck] = { ...prior, ...data, savedAt: Date.now(), version: 1 };
  _ghDb._meta = { lastUpdated: new Date().toISOString().slice(0,10), totalProducts: Object.keys(_ghDb.products).length };
  setDbCount(Object.keys(_ghDb.products).length);
  return ghWrite(`db: ${ck}`);
}

// One photo per barcode. Keying on the barcode rather than the product name
// means two differently-named records for the same pack share one image, and a
// re-upload targets the same file instead of creating a second one. Products
// with no barcode still fall back to the name key — the alternative would be no
// photo at all for community-added items that lack a code.
function photoKeyFor(entry) {
  const code = String(entry?.offData?.code || "").replace(/\D/g, "").replace(/^0+/, "");
  return code ? `code-${code}` : normKey(entry?.name || "");
}

// Checks that the photo actually shows the product it is being attached to.
// Quality scoring cannot do this: a sharp, well-lit photo of the wrong pack
// scores perfectly. This reads the label in the image and compares it with the
// record.
//
// Returns { verdict, reason, seen } where verdict is:
//   "match"     — the label agrees with the product name
//   "mismatch"  — the label clearly shows something else; the upload is refused
//   "unclear"   — no legible label, or the check is unavailable; accepted but
//                 recorded as unverified rather than silently trusted
// Deterministic verification, tried first: decode any barcode visible in the
// photo and compare it with the record's barcode.
//
// This is stronger than reading label text, and needs no API and no server.
// A barcode is an exact identifier — if the photo shows 7613034626844 and the
// record is 7613034626844, it is the same product, full stop. Reading the brand
// name can only ever say "plausibly".
//
// Returns null when no barcode is legible, which is common for a photo framed on
// the front of a pack — the caller then falls back to the label check.
async function verifyPhotoByBarcode(bitmap, expectedCode) {
  const want = String(expectedCode || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!want) return null;
  let detector = null;
  if ("BarcodeDetector" in window) {
    try { detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS }); } catch { /* none */ }
  }
  const found = await decodeLadder(bitmap, detector, null, { fast: true }).catch(() => null);
  if (!found?.code) return null;
  const got = String(found.code).replace(/\D/g, "").replace(/^0+/, "");
  if (!got) return null;
  return got === want
    ? { verdict: "match", reason: `Barcode ${got} in the photo matches the record.`, seen: got }
    : { verdict: "mismatch", reason: `The photo shows barcode ${got}, but this record is ${want}.`, seen: got };
}

// Reads the human-readable digits printed under a barcode.
//
// This is the last resort after every decode strategy has failed. A barcode's
// bars can be unreadable — foil glare, curvature, damage — while the digits
// beside them are perfectly legible, so a photo that no decoder can parse often
// still carries the number in plain type.
//
// The result is always PROPOSED, never applied. OCR confuses 8/B, 5/S, 1/7, and
// a wrong barcode silently returns a different product's analysis — which for
// someone checking for gelatin is worse than no answer at all. So the digits are
// filled into the field for the reader to check against the pack, with the
// checksum result shown as evidence.
async function readBarcodeDigits(base64) {
  const prompt = `This photo shows a product barcode. Read ONLY the human-readable digits printed beside or beneath the bars.

Reply with ONLY a JSON object, no other text:
{"digits":"<the digits, no spaces or dashes>","confidence":"high"|"low","note":"<what you could and could not read>"}

Rules:
- Return digits exactly as printed, including any leading zero and any digit set apart from the main block.
- Typical lengths are 8, 12, 13 or 14 digits.
- If any digit is uncertain or obscured, set confidence to "low" and still return your best reading.
- If no digits are legible at all, return {"digits":"","confidence":"low","note":"not legible"}.`;

  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
      { type: "text", text: prompt },
    ]}],
  };

  const call = async (url) => {
    const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error?.message || ("HTTP " + r.status));
    return (d.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  };

  let text = "";
  try { text = await call("https://api.anthropic.com/v1/messages"); }
  catch { text = await call("/api/claude"); }

  const parsed = JSON.parse(String(text).replace(/```json|```/g, "").trim());
  const digits = String(parsed.digits || "").replace(/\D/g, "");
  return {
    digits,
    confidence: parsed.confidence === "high" ? "high" : "low",
    note: String(parsed.note || ""),
    // Independent evidence the reader can weigh: a GTIN check digit that
    // validates means the reading is almost certainly correct.
    checksumOk: digits.length >= 8 ? validBarcodeChecksum(digits) : false,
  };
}

async function verifyPhotoMatches(base64, name, brand) {
  const prompt = `You are checking whether a product photo matches a database record.

Record name: ${name}
Record brand: ${brand || "(unknown)"}

Look at the image and read any product name, brand or packaging text you can see.
Reply with ONLY a JSON object, no other text:
{"verdict":"match"|"mismatch"|"unclear","seen":"<product/brand text you can read, or empty>","reason":"<one short sentence>"}

Rules:
- "match" only if the visible branding is plausibly the same product.
- "mismatch" if the packaging clearly shows a different product or brand.
- "unclear" if no label text is legible, the image is not a product, or you cannot tell.
- A different flavour, size or language variant of the SAME brand and product line is a match.`;

  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        { type: "text", text: prompt },
      ],
    }],
  };

  const call = async (url) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error?.message || ("HTTP " + r.status));
    return (d.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  };

  let text = "";
  try { text = await call("https://api.anthropic.com/v1/messages"); }
  catch { try { text = await call("/api/claude"); } catch { return { verdict: "unclear", reason: "Verification is unavailable in this deployment.", seen: "" }; } }

  try {
    const parsed = JSON.parse(String(text).replace(/```json|```/g, "").trim());
    const v = ["match", "mismatch", "unclear"].includes(parsed.verdict) ? parsed.verdict : "unclear";
    return { verdict: v, reason: String(parsed.reason || ""), seen: String(parsed.seen || "") };
  } catch {
    // An unparseable reply must not be read as approval.
    return { verdict: "unclear", reason: "The verification reply could not be read.", seen: "" };
  }
}

// Measurable photo quality, so "better" is decided by the image rather than by
// whoever uploaded most recently.
//
//   sharpness — variance of a Laplacian. A blurred photo has little
//               high-frequency detail, so its variance collapses. This is the
//               single most useful signal for a label photo.
//   exposure  — fraction of pixels crushed to pure black or blown to pure
//               white. Detail lost that way cannot be recovered.
//   size      — resolution, with sharply diminishing returns; a huge blurry
//               photo should not beat a modest sharp one.
async function scoreImage(bitmap) {
  const MAX = 720;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  const gray = new Float32Array(w * h);
  let clipped = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    gray[p] = g;
    if (g <= 4 || g >= 251) clipped++;
  }

  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i-1] - gray[i+1] - gray[i-w] - gray[i+w];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  const variance = n ? (sumSq / n) - (sum / n) ** 2 : 0;

  // Dynamic range from the 5th/95th percentiles rather than min/max, so a few
  // stray pixels do not make a flat, murky photo look well exposed.
  const hist = new Array(256).fill(0);
  for (let p = 0; p < gray.length; p++) hist[Math.max(0, Math.min(255, gray[p] | 0))]++;
  const total = gray.length;
  let acc = 0, p5 = 0, p95 = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.05) { p5 = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.05) { p95 = i; break; } }
  const range = p95 - p5;

  // Sharpness: the divisor is set high enough that the metric does not saturate.
  // At a low divisor every in-focus photo pegged at 1.0 and a slightly soft one
  // scored identically to a crisp one, which made the comparison useless.
  const sharpness = Math.min(1, Math.sqrt(variance) / 45);

  // Exposure combines two failures that look different but both destroy detail:
  // clipping (blown highlights, crushed blacks) and low contrast. A dark photo
  // with nothing clipped scored a perfect 1.0 before the range term was added.
  const clipPenalty = Math.max(0, 1 - (clipped / (w * h)) * 4);
  const rangeScore  = Math.min(1, range / 140);
  const exposure    = clipPenalty * 0.5 + rangeScore * 0.5;

  const size = Math.min(1, Math.sqrt((bitmap.width * bitmap.height) / (1280 * 960)));

  const score = +(sharpness * 0.55 + exposure * 0.25 + size * 0.20).toFixed(3);
  return { score, sharpness: +sharpness.toFixed(3), exposure: +exposure.toFixed(3),
           size: +size.toFixed(3), range, w: bitmap.width, h: bitmap.height };
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
    if (!map[bk]) map[bk] = { brand, count:0, high:0, medium:0, low:0, undeclared:0, ns:{a:0,b:0,c:0,d:0,e:0}, hits:0, products:[], subBrands:new Set() };
    const b = map[bk];
    b.count++; b.hits += rec.hitCount || 1;
    if (rec.risk === "high") b.high++; else if (rec.risk === "medium") b.medium++; else if (rec.risk === "low") b.low++;
    const und = undeclaredOf(rec); b.undeclared += und;
    const ns = rec.offData?.nutriScore; if (ns && b.ns[ns] != null) b.ns[ns]++;
    const sub = rec.offData?.brand;
    if (sub && sub.toLowerCase().trim() !== brand.toLowerCase().trim()) b.subBrands.add(sub.trim());
    b.products.push({ name: rec.offData?.name || rec.name || "Unknown", risk: rec.risk || null, ns: ns || null, undeclared: und, brand: sub || null });
  };
  // Group under the owning company where one is known, so a company's record
  // is not split across its sub-brands (Maggi, KitKat and Nescafé all count
  // towards Nestlé).
  tracked.forEach(f => {
    if (!f.offData?.brand) return;
    const k = (f.offData.brand + "|" + (f.offData.name || f.name || "")).toLowerCase();
    if (!seen.has(k)) { seen.add(k); push(ratingIdentity(f.offData.brand), f); }
  });
  Object.values(_ghDb.products || {}).forEach(rec => {
    if (!rec.offData?.brand) return;
    const k = (rec.offData.brand + "|" + (rec.offData.name || "")).toLowerCase();
    if (!seen.has(k)) { seen.add(k); push(ratingIdentity(rec.offData.brand), rec); }
  });
  return Object.values(map).map(b => ({ ...b, subBrands:[...b.subBrands], ...brandScoreOf(b) })).sort((a, z) => z.score - a.score || z.count - a.count);
}

function brandHistory(brand) {
  // Prior record for this company across the shared DB (for scan-time alerts)
  if (!brand) return null;
  const bl = (ratingIdentity(brand) || brand).toLowerCase().trim();
  const recs = Object.values(_ghDb.products || {}).filter(p =>
    brandChain(p.offData).some(b => b.toLowerCase().trim() === bl || (ratingIdentity(b) || "").toLowerCase().trim() === bl));
  if (!recs.length) return null;
  // Same aggregate shape brandScoreOf expects, so the scan-time rating is
  // identical to the one shown on the brand page — one scoring rule, not two.
  const agg = {
    count: recs.length,
    high: recs.filter(p => p.risk === "high").length,
    medium: recs.filter(p => p.risk === "medium").length,
    undeclared: recs.reduce((a, p) => a + undeclaredOf(p), 0),
    ns: { a:0, b:0, c:0, d:0, e:0 },
  };
  recs.forEach(p => { const g = p.offData?.nutriScore; if (g && agg.ns[g] != null) agg.ns[g]++; });
  return { ...agg, ...brandScoreOf(agg) };
}

let _searchFlushTimer = null;
let _searchDirty = false;

// Commit pending search records. Product writes already serialise the whole
// database (search log included), so this only needs to cover searches that
// are not followed by a scan.
function flushSearchLog() {
  clearTimeout(_searchFlushTimer);
  _searchFlushTimer = null;
  if (!_searchDirty || !GH_TOKEN) return;
  _searchDirty = false;
  ghWrite("log: searches");
}

function ghLogSearch(query, category) {
  if (!_ghDb.searchLog) _ghDb.searchLog = [];
  _ghDb.searchLog.unshift({ query, category, at: Date.now() });
  if (_ghDb.searchLog.length > 500) _ghDb.searchLog = _ghDb.searchLog.slice(0, 500);
  if (!GH_TOKEN) return;
  _searchDirty = true;
  // Debounced so a burst of typing produces one commit, but short enough that
  // records are not lost when the user leaves shortly after searching.
  clearTimeout(_searchFlushTimer);
  _searchFlushTimer = setTimeout(flushSearchLog, 8000);
}

// Last chance to persist when the tab is hidden or closed
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSearchLog(); });
  window.addEventListener("pagehide", flushSearchLog);
}

// ─── BARCODE SCANNING ──────────────────────────────────────────────────────────
// A barcode is an exact product key, so scanning one skips fuzzy search
// entirely: no ambiguity, no picker, one network request.
//
// Two decoders, tried in order:
//   1. BarcodeDetector — built into Chrome/Edge on Android and desktop. Native,
//      fast, nothing to download.
//   2. ZXing (via CDN, loaded only on first use) — covers Safari/iOS and
//      Firefox, which have no BarcodeDetector.
const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"];
let _zxingPromise = null;

function loadZXing() {
  if (_zxingPromise) return _zxingPromise;
  _zxingPromise = new Promise((resolve, reject) => {
    if (window.ZXingBrowser) return resolve(window.ZXingBrowser);
    const el = document.createElement("script");
    el.src = "https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js";
    el.async = true;
    el.onload = () => window.ZXingBrowser ? resolve(window.ZXingBrowser) : reject(new Error("ZXing failed to initialise"));
    el.onerror = () => reject(new Error("Could not load the barcode library"));
    document.head.appendChild(el);
  });
  return _zxingPromise;
}

// A valid EAN/UPC has a check digit; verifying it rejects most misreads.
function validBarcodeChecksum(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return /^\d{8,14}$/.test(code);
  const d = code.split("").map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

// Camera overlay. Streams the rear camera, decodes continuously, and calls
// onDetect with the first checksum-valid barcode. Always stops the stream on
// unmount — a live camera left running is both a privacy and battery problem.
// Contrast-boosts a bitmap for a second decode attempt: grayscale, then hard
// black/white. Barcodes are binary by nature, so thresholding sharpens the bar
// edges a faded or badly-lit photo blurs.
//
// The scale factor is capped by total pixels, NOT fixed at 2x. ImageCapture
// returns the sensor's full resolution — a 12MP photo upscaled 2x is a 186 MB
// canvas and a 48MP one is 732 MB, which throws or gets the tab killed on a
// phone. Small frames still get the upscale that helps them; large ones are
// already detailed enough and are only thresholded.
const MAX_DECODE_PIXELS = 12e6;

// Draws a bitmap through a transform, returning a new bitmap. Used to retry a
// failed decode at a different orientation or crop rather than giving up.
async function transformBitmap(bitmap, { rotate = 0, crop = null, scale = 1 } = {}) {
  const src = crop
    ? { x: bitmap.width * crop.x, y: bitmap.height * crop.y,
        w: bitmap.width * crop.w, h: bitmap.height * crop.h }
    : { x: 0, y: 0, w: bitmap.width, h: bitmap.height };

  const swap = rotate === 90 || rotate === 270;
  const outW = Math.round((swap ? src.h : src.w) * scale);
  const outH = Math.round((swap ? src.w : src.h) * scale);

  const c = document.createElement("canvas");
  c.width = outW; c.height = outH;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(bitmap, src.x, src.y, src.w, src.h,
    -(src.w * scale) / 2, -(src.h * scale) / 2, src.w * scale, src.h * scale);
  return createImageBitmap(c);
}

// The decode ladder. A single failed attempt says almost nothing — decoders
// fail for different reasons, so each rung addresses a different cause:
//
//   1. plain          — the common case
//   2. contrast       — faded print, poor light
//   3. rotations      — a barcode read sideways or upside down; the native
//                       detector is orientation-sensitive in practice
//   4. centre crop    — background clutter, or the code small in a wide frame
//   5. second decoder — ZXing uses a different algorithm to BarcodeDetector,
//                       so it succeeds on images the native one rejects
//
// Only after ALL of these fail is the image genuinely unreadable — and then
// the still is kept rather than discarded, so the reader can type the digits
// they can plainly see.
async function decodeLadder(bitmap, detector, onProgress, { fast = false } = {}) {
  const attempts = [
    ["reading", async () => bitmap],
    ["boosting contrast", async () => enhanceForDecode(bitmap)],
    ["rotating 90°", async () => transformBitmap(bitmap, { rotate: 90 })],
    ["rotating 270°", async () => transformBitmap(bitmap, { rotate: 270 })],
    ["rotating 180°", async () => transformBitmap(bitmap, { rotate: 180 })],
    ["zooming in", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.1, y: 0.25, w: 0.8, h: 0.5 } }))],

    // Horizontal bands. A barcode wrapped round a bottle is curved, so the bars
    // are only parallel across a narrow strip — the full-height image never
    // decodes, but a single band often does. Three bands cover the code sitting
    // high, centred or low in the frame.
    ["scanning upper band", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.05, y: 0.20, w: 0.9, h: 0.22 } }))],
    ["scanning middle band", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.05, y: 0.40, w: 0.9, h: 0.22 } }))],
    ["scanning lower band", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.05, y: 0.60, w: 0.9, h: 0.22 } }))],

    // Narrow centre strip at high magnification.
    ["magnifying centre", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.25, y: 0.38, w: 0.5, h: 0.24 }, scale: 3 }))],

    // Tiled sweep — the rung that finds small codes on small packs. Nine
    // overlapping tiles, each magnified, so a code occupying a ninth of the
    // frame is decoded as though it filled it.
    //
    // Skipped in fast mode. Twenty rungs over a full-resolution photo takes
    // seconds, and the background loop runs every two seconds — so the slow
    // path belongs on a deliberate Capture, not on autopilot.
    ...(fast ? [] : tileRegions().map((crop, i) => [
      `sweeping area ${i + 1}/9`,
      async () => enhanceForDecode(await transformBitmap(bitmap, { crop, scale: 2.5 })),
    ])),
  ];

  if (detector) {
    for (const [label, make] of attempts) {
      onProgress?.(label);
      try {
        const found = await detector.detect(await make());
        if (found?.length) return { code: found[0].rawValue, via: label };
      } catch { /* next rung */ }
    }
  }

  if (fast) return null;

  // Different decoder, same image. This is the rung that most often rescues a
  // still the native detector has already refused.
  onProgress?.("trying a second decoder");
  try {
    const ZX = await loadZXing();
    const c = document.createElement("canvas");
    c.width = bitmap.width; c.height = bitmap.height;
    c.getContext("2d").drawImage(bitmap, 0, 0);
    const res = await new ZX.BrowserMultiFormatReader()
      .decodeFromImageUrl(c.toDataURL("image/png")).catch(() => null);
    const txt = res?.getText?.();
    if (txt) return { code: txt, via: "second decoder" };
  } catch { /* exhausted */ }

  return null;
}

// Otsu's method: computes the threshold that best separates dark from light
// for THIS image, instead of assuming 128. On a foil or glossy wrapper the
// lighting is uneven across the label — one end blown out, the other in shadow
// — and a fixed threshold turns the bright end entirely white and the dark end
// entirely black, erasing the bars at both. Otsu adapts to the actual histogram.
function otsuThreshold(data) {
  const hist = new Array(256).fill(0);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const g = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) | 0;
    hist[g]++; n++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = i; }
  }
  return threshold;
}

// Splits a frame into overlapping tiles. A small barcode — a single KitKat
// finger, a two-cup Reese's pack — occupies a fraction of the frame, so the
// decoder is working with a code that is tiny relative to everything around it.
// In its own tile the same code is close to full width, which is the condition
// decoders are built for. Overlap prevents a code from being cut in half by a
// tile boundary.
function tileRegions(cols = 3, rows = 3, overlap = 0.35) {
  const w = 1 / cols, h = 1 / rows;
  const ow = w * overlap, oh = h * overlap;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: Math.max(0, c * w - ow), y: Math.max(0, r * h - oh),
        w: Math.min(1, w + ow * 2), h: Math.min(1, h + oh * 2),
      });
    }
  }
  return out;
}

async function enhanceForDecode(bitmap) {
  const base = bitmap.width * bitmap.height;
  const scale = base * 4 <= MAX_DECODE_PIXELS ? 2 : base <= MAX_DECODE_PIXELS ? 1 : Math.sqrt(MAX_DECODE_PIXELS / base);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;      // keep bar edges hard
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const th = otsuThreshold(d);
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    const v = g > th ? 255 : 0;
    d[i] = d[i+1] = d[i+2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return createImageBitmap(c);
}

function BarcodeScanner({ onDetect, onClose, t, isMobile }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const stopRef = useRef(false);
  const [status, setStatus] = useState("starting");   // starting | scanning | error
  const [message, setMessage] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const detectorRef  = useRef(null);   // BarcodeDetector, reused for file decode
  const capturingRef = useRef(false);  // manual capture in progress
  const autoBusyRef  = useRef(false);  // background attempt in progress — must NOT block manual
  const captureNowRef = useRef(null);  // manual "Capture" action, set once scanning starts
  const fileRef      = useRef(null);
  // When every decode strategy fails the still is KEPT, not discarded. The
  // digits are printed under the barcode and a person can read them when no
  // decoder can — throwing the image away wastes the one capture that worked.
  const [failedShot, setFailedShot] = useState(null);   // { url, typed }
  const [typedCode, setTypedCode]   = useState("");
  const [readState, setReadState]   = useState(null);   // { busy } | { digits, confidence, checksumOk, note }

  // Proposes the digits from the photo. Fills the field rather than searching,
  // so the reader confirms against the pack before anything is looked up.
  async function readDigitsFromShot() {
    if (!failedShot?.base64) return;
    setReadState({ busy: true });
    try {
      const r = await readBarcodeDigits(failedShot.base64);
      setReadState(r);
      if (r.digits) setTypedCode(r.digits);
    } catch (e) {
      setReadState({ error: String(e?.message || e) });
    }
  }
  const [canTorch, setCanTorch] = useState(false);
  // Optical/digital zoom. This is the fix for a small barcode: a phone camera
  // cannot focus closer than roughly 10 cm, so moving in to fill the frame just
  // produces a blurred image. Zooming keeps the lens at a distance it can focus
  // at while making the code occupy far more pixels — which is what the decoder
  // actually needs. It is not the same as cropping: zoom happens at the sensor,
  // so it adds real detail rather than enlarging what is already lost.
  const [trackInfo, setTrackInfo] = useState(null);
  const [zoomCaps, setZoomCaps] = useState(null);   // { min, max, step }
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    stopRef.current = false;
    let zxingControls = null;

    const stopAll = () => {
      stopRef.current = true;
      try { zxingControls?.stop(); } catch {}
      streamRef.current?.getTracks().forEach(tr => tr.stop());
      streamRef.current = null;
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage("This browser cannot access the camera. Type the barcode number instead.");
        return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            // 720p is not enough resolution for the thin bars of an EAN-13 at
            // normal holding distance — the decoder sees blur and keeps
            // retrying, which is why a clearly visible barcode can take ages.
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
            // Without continuous autofocus the camera locks focus once, on
            // whatever was in frame at start, and never refocuses on the label.
            advanced: [{ focusMode: "continuous" }],
          },
          audio: false,
        });
      } catch (err) {
        setStatus("error");
        setMessage(
          err?.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser settings, or type the barcode number."
          : err?.name === "NotFoundError" ? "No camera was found on this device. Type the barcode number instead."
          : err?.name === "NotReadableError" ? "The camera is in use by another app. Close it and try again."
          : "The camera could not be started. Type the barcode number instead."
        );
        return;
      }
      if (stopRef.current) { stream.getTracks().forEach(tr => tr.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");   // iOS refuses fullscreen-less playback without this
        await video.play().catch(() => {});
      }
      // Torch is only available on some Android devices
      const track = stream.getVideoTracks()[0];
      // What the camera ACTUALLY granted, which is often not what was asked
      // for. A track that fell back to 640x480 explains a failure that no
      // amount of retrying or zooming will fix, so it is reported rather than
      // assumed.
      const st = track?.getSettings?.() || {};
      setTrackInfo({
        w: st.width || 0, h: st.height || 0,
        fps: Math.round(st.frameRate || 0),
        focus: st.focusMode || "unknown",
        downgraded: (st.width || 0) < 1280,
      });
      const caps = track?.getCapabilities?.() || {};
      setCanTorch(!!caps.torch);
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        setZoomCaps({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
        setZoom(caps.zoom.min);
      }
      setStatus("scanning");

      // Some real barcodes never pass a checksum — ITF-14 cases, worn or
      // curved labels. Rather than discard them silently (which makes the
      // scanner look frozen), two identical consecutive reads are accepted as
      // confirmation: agreement between independent frames is its own check.
      const recent = { value: null, count: 0 };
      const handle = (code) => {
        const clean = String(code).replace(/\D/g, "");
        if (!clean || clean.length < 8) return false;

        if (validBarcodeChecksum(clean)) { stopAll(); onDetect(clean); return true; }

        if (recent.value === clean) {
          recent.count++;
          if (recent.count >= 2) { stopAll(); onDetect(clean); return true; }
        } else { recent.value = clean; recent.count = 1; }

        // Tell the user something is happening rather than leaving a dead view.
        setMessage("Reading the barcode — hold steady for a moment.");
        return false;
      };

      // ── Still capture ──
      // Live video decoding fights motion blur and a low preview resolution.
      // A still is sharper: ImageCapture.takePhoto() returns the sensor's full
      // resolution, several times the video track's. Decoding that still
      // succeeds on labels the video loop never resolves — curved packaging,
      // small print, poor light.
      const captureStill = async () => {
        const track = streamRef.current?.getVideoTracks?.()[0];
        // Preferred: full-resolution photo. Chrome/Android only.
        if (track && typeof window.ImageCapture === "function") {
          try {
            const blob = await new window.ImageCapture(track).takePhoto();
            return await createImageBitmap(blob);
          } catch { /* fall through to the canvas path */ }
        }
        // Fallback: the current video frame at its native size. Lower
        // resolution than a photo, but still free of the preview's downscaling
        // and works in Firefox and on iOS.
        const v = videoRef.current;
        if (!v?.videoWidth) return null;
        const c = document.createElement("canvas");
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        return await createImageBitmap(c);
      };

      // Runs the full decode ladder over a still and reports progress.
      const decodeStill = async (detector, bitmap, { fast = false, keepOnFail = true } = {}) => {
        if (!bitmap) return null;
        const r = await decodeLadder(bitmap, detector, (step) => setMessage(`Captured — ${step}…`), { fast });
        if (r) return r.code;
        // Only a deliberate capture keeps the image. Auto attempts run in the
        // background, and popping the type-the-digits panel up mid-scan while
        // the user is still framing the code is noise.
        if (keepOnFail) keepFailedShot(bitmap);
        return null;
      };

      if ("BarcodeDetector" in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats?.() || BARCODE_FORMATS;
          const detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS.filter(f => supported.includes(f)) });
          // detect() is expensive. Running it every animation frame (60/s) means
          // each call queues behind the last and the preview stutters, which
          // makes it HARDER to hold the code steady. ~12/s decodes just as well
          // and leaves the camera responsive.
          detectorRef.current = detector;

          let lastRun = 0, started = 0, lastStill = 0, stills = 0;
          const tick = async (ts) => {
            if (stopRef.current || !videoRef.current) return;
            if (!started) started = ts;

            if (ts - lastRun >= 80) {
              lastRun = ts;
              try {
                const found = await detector.detect(videoRef.current);
                if (found?.length && handle(found[0].rawValue)) return;
              } catch {}
            }

            // Automatic still capture. After a couple of seconds of live
            // decoding getting nowhere, the video stream is not going to
            // resolve this label — so grab a sharper still and decode that
            // instead of continuing to loop. Repeats every 2s, up to 4 tries,
            // which covers the user bringing the code into frame.
            // Auto attempts use their OWN flag, not the shared one. The manual
            // Capture button was gated on capturingRef, which this loop held for
            // the duration of each attempt — so pressing Capture during an auto
            // attempt returned silently and the button appeared dead.
            if (ts - started > 1500 && ts - lastStill > 2500 && stills < 4
                && !autoBusyRef.current && !capturingRef.current) {
              lastStill = ts;
              stills++;
              autoBusyRef.current = true;
              setMessage(`Looking harder (${stills}/4)…`);
              try {
                const code = await decodeStill(detector, await captureStill(), { fast: true, keepOnFail: false });
                if (code && handle(code)) return;
                setMessage(stills >= 4
                  ? "Not readable from the video. Press Capture for a full-strength scan of one photo — or type the digits."
                  : "Reading — keep the barcode in frame.");
              } catch { /* keep the live loop running */ }
              finally { autoBusyRef.current = false; }
            }

            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          captureNowRef.current = async () => {
            // Only guards against a second press, never against the background
            // loop — a pressed button must always do something visible.
            if (capturingRef.current) { setMessage("Already scanning that photo…"); return; }
            capturingRef.current = true;
            stills = 99;                     // stand the auto loop down; the user has taken over
            setMessage("Capturing — full scan, this takes a few seconds…");
            try {
              const code = await decodeStill(detector, await captureStill(), { fast: false, keepOnFail: true });
              if (code && handle(code)) return;
              setMessage("No decoder could read that photo — the digits under the barcode can be typed below.");
            } catch (e) {
              setMessage("Capture failed: " + String(e?.message || e));
            } finally { capturingRef.current = false; }
          };
          return;
        } catch { /* fall through to ZXing */ }
      }

      try {
        const ZX = await loadZXing();
        if (stopRef.current) return;
        const reader = new ZX.BrowserMultiFormatReader();
        zxingControls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) handle(result.getText());
        });
        // Capture must work on this path too (Firefox, older Safari), or the
        // button would be present and silently do nothing.
        captureNowRef.current = async () => {
          if (capturingRef.current) return;
          capturingRef.current = true;
          setMessage("Capturing…");
          try {
            const v = videoRef.current;
            if (!v?.videoWidth) throw new Error("Camera not ready");
            const c = document.createElement("canvas");
            c.width = v.videoWidth; c.height = v.videoHeight;
            c.getContext("2d").drawImage(v, 0, 0);
            const url = c.toDataURL("image/png");
            const res = await reader.decodeFromImageUrl(url).catch(() => null);
            const clean = String(res?.getText?.() || "").replace(/\D/g, "");
            if (clean.length >= 8) { stopAll(); onDetect(clean); return; }
            setMessage("No decoder could read that capture — type the digits below instead.");
          } catch (e) {
            setMessage("Capture failed: " + String(e?.message || e));
          } finally { capturingRef.current = false; }
        };
      } catch {
        setStatus("error");
        setMessage("The barcode reader could not be loaded. Check your connection, or type the number instead.");
      }
    })();

    return stopAll;
  }, [onDetect]);

  function keepFailedShot(bitmap) {
    try {
      const c = document.createElement("canvas");
      // Downscale for display only — the decode already happened at full size.
      const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
      c.width = Math.round(bitmap.width * scale);
      c.height = Math.round(bitmap.height * scale);
      c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", 0.85);
      setFailedShot({ url, base64: url.split(",")[1] });
    } catch { /* display is a bonus, not a requirement */ }
  }

  // Decode a photo the user picked. Useful when the camera cannot hold focus,
  // when the product is no longer to hand, or for a photo taken earlier.
  async function decodeFile(file) {
    if (!file) return;
    setMessage("Reading the photo…");
    try {
      const bitmap = await createImageBitmap(file);
      let detector = detectorRef.current;
      if (!detector && "BarcodeDetector" in window) {
        detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS });
      }
      const found = await decodeLadder(bitmap, detector, (step) => setMessage(`Reading the photo — ${step}…`));
      const code = found?.code || null;
      if (!code) keepFailedShot(bitmap);

      const clean = String(code || "").replace(/\D/g, "");
      if (clean.length >= 8) { stopRef.current = true; onDetect(clean); return; }
      setMessage("No decoder could read that image — the digits under the barcode can be typed below instead.");
    } catch (e) {
      setMessage("Could not read that photo: " + String(e?.message || e));
    }
  }

  const applyZoom = async (z) => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    setZoom(z);
    try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch { /* unsupported */ }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torchOn }] }); setTorchOn(v => !v); } catch {}
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#000",zIndex:10000,display:"flex",flexDirection:"column"}}>
      <div style={{position:"relative",flex:1,overflow:"hidden"}}>
        <video ref={videoRef} muted playsInline style={{width:"100%",height:"100%",objectFit:"cover"}}/>

        {/* Aiming guide */}
        {status === "scanning" && (
          <>
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
              <div style={{width:"min(78vw,320px)",height:170,border:"2px solid rgba(255,255,255,0.9)",borderRadius:14,boxShadow:"0 0 0 100vmax rgba(0,0,0,0.45)"}}/>
            </div>
            <div style={{position:"absolute",left:0,right:0,bottom:isMobile?24:32,textAlign:"center",color:"#fff",fontSize:13,textShadow:"0 1px 3px rgba(0,0,0,0.6)",padding:"0 24px"}}>
              Point the camera at the product barcode
            </div>
          </>
        )}

        {status === "starting" && (
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:13,gap:10}}>
            <span style={{display:"inline-block",width:14,height:14,border:"2px solid #fff",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>
            Starting the camera…
          </div>
        )}

        {status === "error" && (
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:28}}>
            <div style={{background:t.bg,borderRadius:14,padding:"22px 24px",maxWidth:360,textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:10}}>📷</div>
              <div style={{fontSize:13,color:t.text,lineHeight:1.65,marginBottom:16}}>{message}</div>
              <button onClick={onClose} style={{background:t.accent,border:"none",color:t.accentFg,padding:"10px 20px",borderRadius:9,cursor:"pointer",fontSize:13,fontWeight:600}}>Close</button>
            </div>
          </div>
        )}
      </div>

      {/* Last resort: the capture that no decoder could read, shown at size so
          the printed digits can be read off it. A person reading numerals is
          more reliable than any of the rungs above, and the image is already
          in hand — discarding it would have made the capture worthless. */}
      {failedShot && (
        <div style={{background:"#111",padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.15)"}}>
          <div style={{fontSize:11,color:"#fff",fontWeight:600,marginBottom:6}}>
            Couldn’t decode this — type the number printed under the barcode
          </div>
          <img src={failedShot.url} alt="captured barcode"
            style={{width:"100%",maxHeight:150,objectFit:"contain",background:"#000",borderRadius:8,marginBottom:8}}/>
          {/* Offered before the manual field, because it saves typing 13 digits
              off a screen — but it fills the field rather than searching, so the
              reader still confirms. */}
          <button onClick={readDigitsFromShot} disabled={readState?.busy}
            style={{width:"100%",padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,marginBottom:8,
              background:"rgba(255,255,255,0.15)",color:"#fff",
              border:"1px solid rgba(255,255,255,0.35)",cursor:readState?.busy?"default":"pointer"}}>
            {readState?.busy ? "Reading the digits…" : "Read the number from the photo"}
          </button>

          {readState && !readState.busy && (
            <div style={{fontSize:10,lineHeight:1.6,marginBottom:8,
              color: readState.error ? "#ff9b9b" : readState.checksumOk ? "#9be7b4" : "#ffd08a"}}>
              {readState.error
                ? `Could not read it automatically (${readState.error}). Type the digits below.`
                : !readState.digits
                  ? `No digits were legible. ${readState.note} Type them below.`
                  : readState.checksumOk
                    ? `Read ${readState.digits} — the check digit validates, so this is very likely correct. Compare it with the pack, then search.`
                    : `Read ${readState.digits} — but the check digit does NOT validate, so at least one digit is misread. Correct it against the pack before searching.`}
            </div>
          )}

          <div style={{display:"flex",gap:8}}>
            <input value={typedCode} onChange={e => { setTypedCode(e.target.value.replace(/\D/g, "")); setReadState(null); }}
              inputMode="numeric" placeholder="e.g. 8901234567890" maxLength={14}
              style={{flex:1,boxSizing:"border-box",fontSize:14,padding:"10px 12px",borderRadius:8,
                border:"1px solid rgba(255,255,255,0.3)",background:"rgba(255,255,255,0.1)",color:"#fff",
                letterSpacing:"0.06em"}}/>
            <button onClick={() => { if (typedCode.length >= 8) { stopRef.current = true; onDetect(typedCode); } }}
              disabled={typedCode.length < 8}
              style={{background:typedCode.length>=8?"#fff":"rgba(255,255,255,0.15)",border:"none",
                color:typedCode.length>=8?"#000":"rgba(255,255,255,0.5)",padding:"10px 18px",borderRadius:8,
                cursor:typedCode.length>=8?"pointer":"default",fontSize:13,fontWeight:700}}>
              Search
            </button>
          </div>
          <button onClick={() => { setFailedShot(null); setTypedCode(""); setReadState(null); setMessage(""); }}
            style={{marginTop:8,background:"none",border:"none",color:"rgba(255,255,255,0.6)",
              fontSize:11,cursor:"pointer",padding:0,textDecoration:"underline"}}>
            Dismiss and keep scanning
          </button>
        </div>
      )}

      {zoomCaps && status === "scanning" && (
        <div style={{background:"#000",padding:"8px 18px 0",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:11,color:"rgba(255,255,255,0.75)",fontWeight:600,flexShrink:0}}>Zoom</span>
          <input type="range" min={zoomCaps.min} max={zoomCaps.max} step={zoomCaps.step} value={zoom}
            onChange={e => applyZoom(parseFloat(e.target.value))}
            style={{flex:1,accentColor:"#fff"}}/>
          <span style={{fontSize:11,color:"rgba(255,255,255,0.75)",minWidth:32,textAlign:"right"}}>{zoom.toFixed(1)}×</span>
        </div>
      )}
      {trackInfo && status === "scanning" && (
        <div style={{background:"#000",padding:"6px 18px 0",fontSize:10,
                     color: trackInfo.downgraded ? "#ffb347" : "rgba(255,255,255,0.45)", lineHeight:1.5}}>
          Camera: {trackInfo.w}×{trackInfo.h} @ {trackInfo.fps}fps · focus {trackInfo.focus}
          {trackInfo.downgraded && " — your browser granted a low resolution, which is very likely the reason small barcodes fail here."}
        </div>
      )}
      {status === "scanning" && (
        <div style={{background:"#000",padding:"4px 18px 0",fontSize:10,color:"rgba(255,255,255,0.5)",lineHeight:1.5}}>
          Small barcode? Hold at 15–20 cm and {zoomCaps ? "use zoom" : "keep steady"} — closer than ~10 cm the lens cannot focus, so it blurs.
          Shiny or curved pack (bottles): turn the light OFF and tilt slightly — glare erases the bars faster than dimness does.
        </div>
      )}

      <div style={{padding:"14px 18px",background:"#000",display:"flex",gap:10,alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff",padding:"11px 16px",borderRadius:9,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button>

        {/* Manual capture: the user usually knows when the code is properly in
            frame before the decoder does. */}
        <button onClick={() => captureNowRef.current?.()} disabled={status !== "scanning"}
          style={{background:"#fff",border:"none",color:"#000",padding:"11px 18px",borderRadius:9,
            cursor:status==="scanning"?"pointer":"default",fontSize:13,fontWeight:700,opacity:status==="scanning"?1:0.5}}>
          Capture
        </button>

        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; decodeFile(f); }}/>
        <button onClick={() => fileRef.current?.click()}
          style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff",padding:"11px 16px",borderRadius:9,cursor:"pointer",fontSize:13,fontWeight:600}}>
          Photo
        </button>
        {canTorch && (
          <button onClick={toggleTorch} style={{background:torchOn?"#fff":"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:torchOn?"#000":"#fff",padding:"11px 18px",borderRadius:9,cursor:"pointer",fontSize:13,fontWeight:600}}>
            {torchOn ? "Light on" : "Light"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── RESPONSIVE ────────────────────────────────────────────────────────────────
// Styles here are inline, which CSS media queries cannot reach, so breakpoints
// are tracked in JS instead and fed into the style objects.
function useViewport() {
  const get = () => (typeof window === "undefined" ? 1200 : window.innerWidth);
  const [w, setW] = useState(get);
  useEffect(() => {
    let raf = null;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setW(window.innerWidth)); };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); window.removeEventListener("orientationchange", onResize); };
  }, []);
  return { w, isMobile: w < 760, isNarrow: w < 1040 };
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

// ─── FORMULATION CARD (cosmetics) ──────────────────────────────────────────────
// The four things the cosmetics engine assesses: the formulation as a whole,
// the pH it must sit at, how actives are delivered, and what stabilises it.
function FormulationCard({ analysis, t, dark }) {
  const form = analysis?.formulation;
  const { ph, delivery, stabilisers } = analysis || {};
  if (!form && !ph && !delivery?.length && !stabilisers) return null;

  const sec = { padding:"13px 20px", borderTop:`1px solid ${t.border}` };
  const hdr = { fontSize:10, fontWeight:600, color:t.textMuted, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:7 };
  const warn = (level) => ({
    marginTop:7, padding:"8px 11px",
    background: level==="high" ? (dark?"rgba(192,57,43,0.1)":"rgba(192,57,43,0.06)") : t.bgSub,
    border:`1px solid ${level==="high"?"rgba(192,57,43,0.3)":t.border}`,
    borderRadius:7, fontSize:11, color: level==="high"?"#c0392b":t.textSub, lineHeight:1.6,
  });

  return (
    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,overflow:"hidden"}}>
      {/* Overall formulation */}
      {form && (
        <div style={{padding:"16px 20px"}}>
          <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>Overall formulation</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:7}}>
            <span style={{fontSize:15,fontWeight:700,color:t.text}}>{form.base}</span>
            <span style={{fontSize:10,fontWeight:600,color:t.textSub,background:t.pill,border:`1px solid ${t.border}`,padding:"2px 8px",borderRadius:5}}>{form.complexity} complexity</span>
            <span style={{fontSize:10,color:t.textMuted}}>{form.total} ingredients</span>
          </div>
          <div style={{fontSize:11,color:t.textMuted,lineHeight:1.6,marginBottom:8}}>{form.note}</div>
          {form.leading?.length > 0 && (
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:form.flaggedLeading?.length?8:0}}>
              {form.leading.map((x,i) => (
                <span key={i} style={{fontSize:10,color:t.textSub,background:t.pill,border:`1px solid ${t.border}`,padding:"3px 9px",borderRadius:5,overflowWrap:"anywhere"}}>{i+1}. {x}</span>
              ))}
            </div>
          )}
          {form.flaggedLeading?.length > 0 && (
            <div style={warn("high")}>
              {form.flaggedLeading.length} restricted ingredient{form.flaggedLeading.length!==1?"s":""} appear{form.flaggedLeading.length===1?"s":""} in the first five entries, so {form.flaggedLeading.length===1?"it is":"they are"} present at a meaningful concentration: {form.flaggedLeading.map(h=>h.name||h.inci).join(", ")}.
            </div>
          )}
          {form.allergens?.length > 0 && (
            <div style={{marginTop:8,fontSize:11,color:t.textSub,lineHeight:1.6}}>
              <span style={{fontWeight:600}}>{form.allergens.length} declarable fragrance allergen{form.allergens.length!==1?"s":""}:</span> {form.allergens.slice(0,6).join(", ")}{form.allergens.length>6?` +${form.allergens.length-6}`:""}
            </div>
          )}
        </div>
      )}

      {/* pH */}
      {ph && (
        <div style={sec}>
          <div style={hdr}>pH requirement</div>
          {ph.known ? (
            <>
              <div style={{display:"flex",alignItems:"baseline",gap:9,marginBottom:6,flexWrap:"wrap"}}>
                <span style={{fontSize:17,fontWeight:800,color:t.text,fontFamily:"monospace"}}>{ph.range}</span>
                {ph.classification && <span style={{fontSize:11,fontWeight:600,color:t.textSub}}>{ph.classification}</span>}
              </div>
              <div style={{fontSize:11,color:t.textSub,lineHeight:1.6}}>{ph.note}</div>
              <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginTop:6}}>
                Inferred from the actives present — pH is almost never printed on a pack. Skin's own surface sits around 4.7–5.75.
              </div>
              {(ph.conflicts||[]).map((c,i) => <div key={i} style={warn("high")}>{c.detail}</div>)}
              {(ph.incompatibilities||ph.pairs||[]).map((c,i) => <div key={"p"+i} style={warn("high")}>{c}</div>)}
            </>
          ) : (
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.6}}>{ph.note}</div>
          )}
        </div>
      )}

      {/* Delivery */}
      {delivery?.length > 0 && (
        <div style={sec}>
          <div style={hdr}>Delivery system</div>
          {delivery.map((d,i) => (
            <div key={i} style={{marginBottom:i===delivery.length-1?0:9}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text}}>{d.name}</div>
              <div style={{fontSize:11,color:t.textMuted,lineHeight:1.55}}>{d.note}</div>
            </div>
          ))}
        </div>
      )}

      {/* Stabilisers */}
      {stabilisers && (
        <div style={sec}>
          <div style={hdr}>Stabiliser system</div>
          {stabilisers.present?.length > 0 ? stabilisers.present.map((x,i) => (
            <div key={i} style={{marginBottom:6}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text}}>{x.name}</div>
              <div style={{fontSize:11,color:t.textMuted,lineHeight:1.55}}>{x.note}</div>
            </div>
          )) : (
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.6}}>No stabiliser classes were identified in the ingredient list.</div>
          )}
          {(stabilisers.gaps||[]).map((g,i) => <div key={i} style={warn("high")}>{g}</div>)}
        </div>
      )}

      <div style={{padding:"10px 20px",borderTop:`1px solid ${t.border}`,background:t.bgSub,fontSize:10,color:t.textMuted,lineHeight:1.6}}>
        Assessed against <a href="https://health.ec.europa.eu/scientific-committees/scientific-committee-consumer-safety-sccs_en" target="_blank" rel="noopener noreferrer" style={{color:t.accent,textDecoration:"none"}}>SCCS</a> Opinions, which are binding in the EU, and <a href="https://www.cir-safety.org/" target="_blank" rel="noopener noreferrer" style={{color:t.accent,textDecoration:"none"}}>CIR</a> conclusions, which are advisory. These limits describe skin contact only and say nothing about ingestion. Educational purposes — not a substitute for a dermatologist.
      </div>
    </div>
  );
}

// ─── PRODUCT CREDIBILITY CARD ──────────────────────────────────────────────────
// Reports on THIS product: what it discloses, what it leaves out, and how
// complete the available data is. The brand's own score appears as a separate,
// stable figure so the two are never confused.
function ProductCredibilityCard({ cred, brandStat, brand, loading, enhanced, t, dark, onOpenBrand }) {
  if (loading) return (
    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"18px 20px"}}>
      <div style={{fontSize:12,fontWeight:600,color:t.textSub,marginBottom:12}}>Product Credibility</div>
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
  const impactColor = { positive:"#2e7d52", negative:"#c0392b", neutral:t.textMuted };
  const impactMark  = { positive:"✓", negative:"✕", neutral:"•" };

  return (
    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"16px 20px",borderBottom:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
        <div style={{minWidth:0}}>
          <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>Product Credibility</div>
          <div style={{fontSize:16,fontWeight:700,color:scoreColor}}>{cred.verdict}</div>
          <div style={{fontSize:11,color:t.textSub,marginTop:2}}>
            Label transparency: {cred.transparency} · {cred.dataCompleteness}% of product data available
          </div>
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

      {/* What drove the score, for this product */}
      <div style={{padding:"12px 20px"}}>
        {cred.factors.map((f,i) => (
          <div key={i} style={{display:"flex",gap:9,alignItems:"flex-start",marginBottom:i===cred.factors.length-1?0:9}}>
            <span style={{color:impactColor[f.impact],fontSize:11,lineHeight:1.5,flexShrink:0,fontWeight:700}}>{impactMark[f.impact]}</span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text,overflowWrap:"anywhere"}}>{f.label}</div>
              <div style={{fontSize:11,color:t.textMuted,lineHeight:1.55,overflowWrap:"anywhere"}}>{f.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Brand context — a separate, stable figure across the shared database */}
      {brand && (
        <div style={{padding:"11px 20px",borderTop:`1px solid ${t.border}`,background:t.bgSub,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase"}}>{brandStat?.isParent ? "Brand · Company" : "Brand"}</div>
            <div style={{fontSize:12,fontWeight:600,color:t.text,overflowWrap:"anywhere"}}>
              {brand}
              {brandStat?.isParent && <span style={{color:t.textMuted,fontWeight:500}}> · owned by {brandStat.identity}</span>}
            </div>
          </div>
          {brandStat ? (
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:13,fontWeight:800,color:brandStat.score>=8?"#2e7d52":brandStat.score>=6?"#b07d2b":brandStat.score>=4?"#a0622a":"#c0392b"}}>
                {brandStat.score}/10
              </div>
              <div style={{fontSize:10,color:t.textMuted}}>
                {brandStat.identity} · {brandStat.count} product{brandStat.count!==1?"s":""}
              </div>
            </div>
          ) : (
            <div style={{fontSize:10,color:t.textMuted,textAlign:"right",maxWidth:190,lineHeight:1.5}}>
              No brand rating yet — it appears once products from this brand are in the shared database.
            </div>
          )}
        </div>
      )}

      {/* Researched brand detail, Enhanced only — clearly marked as brand-level */}
      {enhanced && (cred.brandResearch?.summary || cred.brandResearch?.controversies?.length) && (
        <div style={{padding:"12px 20px",borderTop:`1px solid ${t.border}`}}>
          <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6}}>Company background</div>
          {cred.brandResearch.summary && <div style={{fontSize:11,color:t.textSub,lineHeight:1.65,marginBottom:cred.brandResearch.controversies?.length?8:0}}>{cred.brandResearch.summary}</div>}
          {(cred.brandResearch.controversies || []).slice(0,3).map((c,i) => (
            <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:4}}>
              <span style={{color:"#c0392b",fontSize:10,flexShrink:0}}>!</span>
              <span style={{fontSize:11,color:t.textSub,lineHeight:1.55}}>{c}</span>
            </div>
          ))}
        </div>
      )}
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
// parseOFF stores nutrients under short names; the condition checks use OFF's
// per-100g keys. Mapping here rather than renaming either side, because both
// names are load-bearing elsewhere. Without this every threshold check reads
// undefined and silently never fires — a failure that looks like "no alerts".
function nutFor(nut = {}) {
  return {
    "sugars_100g":        nut.sugars,
    "saturated-fat_100g": nut.saturated,
    "fat_100g":           nut.fat,
    "salt_100g":          nut.salt,
    "sodium_100g":        nut.sodium,
    "carbohydrates_100g": nut.carbs,
    "fiber_100g":         nut.fiber,
    "proteins_100g":      nut.protein,
    "energy-kcal_100g":   nut.energy_kcal,
  };
}

function RatingsPanel({ ratings, t, myStars, setMyStars, myReview, setMyReview, myReport, setMyReport, onSubmit,
                       freshness, onRefresh, refreshing, contributions, detailsOpen, setDetailsOpen,
                       myDetails, setMyDetails, onSubmitDetails,
                       profile, toggleSensitivity, profileOpen, setProfileOpen, communityRecord, photoUnverified, onAddIngredients, ingredientsFocus, onSaveIngredients }) {
  if (!ratings) return null;
  const { safety, expert, community } = ratings;
  const TIER_COLOR = { avoid:"#c0392b", caution:"#d97706", sensitive:"#b8860b", cutback:"#7a8b3a", safe:"#2e7d52" };
  const sHdr = { fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 };
  const box  = { background:t.surface, border:`1px solid ${t.border}`, borderRadius:10, padding:12, marginBottom:10 };
  const scoreColor = (v) => v >= 8 ? "#2e7d52" : v >= 6 ? "#7a8b3a" : v >= 4 ? "#d97706" : "#c0392b";

  return (
    <div style={{marginTop:14}}>
      {/* Three scores, never merged. Combining them would let a well-reviewed
          product mask a composition problem — the exact thing this app is for. */}
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        {[["Safety", safety.score, safety.unknown ? "no data" : "CSPI tiers"],
          ["Expert", expert.score, expert.count ? `${expert.count} source${expert.count!==1?"s":""}` : "none yet"],
          ["Community", community.score, community.count ? `${community.count} review${community.count!==1?"s":""}` : "none yet"]
        ].map(([label, val, sub]) => (
          <div key={label} style={{flex:1,textAlign:"center",background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,padding:"10px 6px"}}>
            <div style={{fontSize:19,fontWeight:700,color:val==null?t.textMuted:scoreColor(val)}}>{val == null ? "—" : val}</div>
            <div style={{fontSize:10,fontWeight:600,color:t.text,marginTop:1}}>{label}</div>
            <div style={{fontSize:9,color:t.textMuted,marginTop:1}}>{sub}</div>
          </div>
        ))}
      </div>
      {safety.unknown && (
        <div style={{fontSize:10,color:"#c0392b",fontWeight:600,lineHeight:1.6,marginBottom:6}}>
          Not scored. A product with no ingredient list cannot be rated — an empty score is not a
          good one.
        </div>
      )}
      <div style={{fontSize:9,color:t.textMuted,lineHeight:1.6,marginBottom:4}}>
        Scored 1–10. Kept separate on purpose: something can be award-winning and well liked
        and still contain an ingredient rated “Avoid”. Reviews never change the safety score.
      </div>

      {/* Shown whether or not a profile is set: a missing ingredient list is a
          gap in the data everyone should see, not only people with declared
          sensitivities. */}
      {!ratings.safety?.rated?.length && !ratings.safety?.unrated?.length && (
        <div style={{fontSize:10,color:"#d97706",background:"rgba(217,119,6,0.08)",
          border:"1px solid rgba(217,119,6,0.3)",borderRadius:8,padding:"9px 11px",lineHeight:1.6,marginTop:10}}>
          <strong>No ingredient list on record.</strong> Nothing could be analysed — additives,
          allergens and anything you avoid are all unknown for this product, not absent from it.
          {" "}
          <button onClick={onAddIngredients}
            style={{background:"none",border:"none",padding:0,color:"#d97706",fontWeight:700,
              textDecoration:"underline",cursor:"pointer",fontSize:10}}>
            Add it from the pack
          </button>
        </div>
      )}

      {/* Provenance, before the disclaimer. A community record is a stranger's
          transcription of a label — useful, and not the same thing as a curated
          database entry. Saying so is the minimum. */}
      {photoUnverified && (
        <div style={{fontSize:10,color:t.textMuted,background:t.bgSub,border:`1px solid ${t.border}`,
          borderRadius:8,padding:"8px 11px",lineHeight:1.6,marginTop:10}}>
          The photo for this product could not be matched to the label automatically, so it is
          shown as unverified.
        </div>
      )}

      {communityRecord && (
        <div style={{fontSize:10,color:"#d97706",background:"rgba(217,119,6,0.08)",
          border:"1px solid rgba(217,119,6,0.3)",borderRadius:8,padding:"9px 11px",lineHeight:1.6,marginTop:10}}>
          <strong>Added by a reader.</strong> This product is in no open database — the details were
          typed in from the pack by someone using this app, and have not been verified. Check it
          against the label in your hand.
        </div>
      )}

      {/* Directly under the scores — this is the moment a number is read as a
          verdict, so it is where the qualification belongs. */}
      <Disclaimer t={t}/>
      <div style={{height:12}}/>

      {/* ── For you ──
          Placed above the population scores on purpose. A general 8/10 is not
          the answer for someone the product can actually harm, and an "organic"
          badge is a farming claim, not a tolerability one. */}
      <div style={{...box, borderColor: ratings.personal?.hits?.length ? "#c0392b55" : t.border}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <div style={{...sHdr,color:t.textSub,marginBottom:0,flex:1}}>For you</div>
          <button onClick={() => setProfileOpen(o => !o)}
            style={{fontSize:10,fontWeight:600,padding:"4px 9px",borderRadius:6,cursor:"pointer",
              background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>
            {profileOpen ? "Done" : profile.length ? `${profile.length} set` : "Set sensitivities"}
          </button>
        </div>

        {!profileOpen && !ratings.personal?.checked && (
          <div style={{fontSize:10,color:t.textSub,lineHeight:1.6}}>
            Tell the app what you react to and it will check every product against it.
            Kept on this device only — never uploaded.
          </div>
        )}

        {/* The most important state in the app. With no ingredient list there is
            nothing to match a profile against, and saying "nothing matches"
            would read as a clearance for a product nobody has examined. */}
        {!profileOpen && ratings.personal?.checked && ratings.personal.insufficientData && (
          <div style={{fontSize:11,color:"#c0392b",lineHeight:1.6,background:"rgba(192,57,43,0.07)",
            border:"1px solid rgba(192,57,43,0.35)",borderRadius:8,padding:"10px 12px"}}>
            <strong>Cannot check this product.</strong> There is no ingredient list on record, so
            nothing was compared against your profile. This is <em>not</em> a clearance — a product
            with no data can still contain exactly what you are avoiding.
            <button onClick={onAddIngredients}
              style={{display:"block",marginTop:8,padding:"8px 12px",fontSize:11,fontWeight:600,
                borderRadius:7,background:"#c0392b",color:"#fff",border:"none",cursor:"pointer"}}>
              Add the ingredient list from the pack
            </button>
          </div>
        )}

        {!profileOpen && ratings.personal?.checked && ratings.personal.clear && !ratings.health?.length && (
          <div style={{fontSize:11,color:"#2e7d52",lineHeight:1.6}}>
            Nothing here matches your declared conditions or sensitivities.
            <span style={{color:t.textMuted}}> Based on the listed ingredients — an incomplete list can still hide something.</span>
          </div>
        )}

        {!profileOpen && ratings.health?.map(h => (
          <div key={h.key} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:7}}>
            <span style={{flexShrink:0,fontSize:8,fontWeight:700,color:"#fff",
              background:h.level==="high"?"#c0392b":"#d97706",padding:"3px 6px",borderRadius:4,marginTop:1}}>
              {h.short}
            </span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:t.text}}>{h.label}</div>
              <div style={{fontSize:10,color:t.textSub,lineHeight:1.5}}>{h.detail}</div>
            </div>
          </div>
        ))}

        {!profileOpen && ratings.personal?.hits?.map(h => (
          <div key={h.key} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:7}}>
            <span style={{flexShrink:0,fontSize:8,fontWeight:700,color:"#fff",background:"#c0392b",padding:"3px 6px",borderRadius:4,marginTop:1}}>FOR YOU</span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:t.text}}>{h.label}</div>
              <div style={{fontSize:10,color:t.textSub,lineHeight:1.5}}>{h.note} Found: {h.matched.join(", ")}.</div>
            </div>
          </div>
        ))}

        {!profileOpen && ratings.personal?.misleadingClaim && (
          <div style={{fontSize:10,color:"#d97706",lineHeight:1.6,marginTop:6,borderTop:`1px solid ${t.border}`,paddingTop:7}}>
            This product carries an organic or natural claim. That describes how it was
            produced, not whether you can tolerate it — the match above still applies.
          </div>
        )}

        {profileOpen && (
          <>
            <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginBottom:8}}>
              Select what you react to. This changes what you are warned about; it never
              changes the product's score for anyone else.
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {Object.entries(SENSITIVITY_GROUPS).map(([key, g]) => {
                const on = profile.includes(key);
                return (
                  <button key={key} onClick={() => toggleSensitivity(key)} title={g.note}
                    style={{fontSize:10,fontWeight:600,padding:"6px 10px",borderRadius:7,cursor:"pointer",
                      background:on?"#c0392b":t.pill, color:on?"#fff":t.textSub,
                      border:`1px solid ${on?"#c0392b":t.border}`}}>
                    {g.label}
                  </button>
                );
              })}
            </div>
            <div style={{fontSize:9,color:t.textMuted,marginTop:8,lineHeight:1.6}}>
              Not medical advice, and not a substitute for reading the pack. If you have a
              diagnosed allergy, treat the physical label as the authority.
            </div>
          </>
        )}
      </div>

      {/* ── CSPI breakdown ── */}
      <div style={box}>
        <div style={{...sHdr,color:t.textSub}}>CSPI Chemical Cuisine</div>
        {safety.rated.length === 0 && safety.unrated.length === 0 && (
          <div style={{fontSize:11,color:t.textSub}}>No additives listed for this product.</div>
        )}
        {(safety.rated || []).map(r => (
          <div key={r.additive} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:6}}>
            <span style={{flexShrink:0,fontSize:8,fontWeight:700,color:"#fff",background:TIER_COLOR[r.tier]||"#777",padding:"3px 6px",borderRadius:4,marginTop:1}}>
              {CSPI_TIERS[r.tier]?.short || "Unrated"}
            </span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:t.text}}>{r.name}</div>
              <div style={{fontSize:10,color:t.textSub,lineHeight:1.5}}>{r.why}</div>
            </div>
          </div>
        ))}
        {(safety.unrated || []).length > 0 && (
          <div style={{fontSize:10,color:t.textMuted,marginTop:8,lineHeight:1.6,borderTop:`1px solid ${t.border}`,paddingTop:8}}>
            Not in the curated CSPI subset, so not scored either way: {safety.unrated.join(", ")}.
            Coverage {Math.round(safety.coverage * 100)}% — an unrated additive is unknown, not cleared.
          </div>
        )}
      </div>

      {/* ── Reader-reported composition ── */}
      {ratings.reported?.count > 0 && (
        <div style={{...box, borderColor:"#d9770655"}}>
          <div style={{...sHdr,color:t.textSub}}>Reported by readers · unverified</div>
          <div style={{fontSize:10,color:t.textSub,lineHeight:1.6,marginBottom:8}}>
            Readers say these appear on the physical label but are missing from the source
            data. They are <strong>not</strong> counted in the score above.
          </div>
          {ratings.reported.reported.map(r => (
            <div key={r.additive} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:6}}>
              <span style={{flexShrink:0,fontSize:8,fontWeight:700,color:"#fff",background:TIER_COLOR[r.tier]||"#777",padding:"3px 6px",borderRadius:4,marginTop:1}}>
                {CSPI_TIERS[r.tier]?.short || "Unrated"}
              </span>
              <div style={{minWidth:0}}>
                <div style={{fontSize:11,fontWeight:600,color:t.text}}>{r.name}</div>
                <div style={{fontSize:10,color:t.textSub,lineHeight:1.5}}>{r.why}</div>
              </div>
            </div>
          ))}
          <div style={{fontSize:10,color:"#d97706",lineHeight:1.6,marginTop:8,borderTop:`1px solid ${t.border}`,paddingTop:8}}>
            If confirmed, the safety score would be {ratings.reported.wouldBe}/10 instead of {ratings.reported.current}/10.
            Shown so you can judge it yourself — one reader's transcription does not re-rate a
            product for everyone.
          </div>
        </div>
      )}

      {/* ── Expert accolades ── */}
      <div style={box}>
        <div style={{...sHdr,color:t.textSub}}>Expert scores &amp; awards</div>
        {expert.count === 0 ? (
          <div style={{fontSize:10,color:t.textSub,lineHeight:1.6}}>
            None recorded. Competition medals, critic scores and lab results have no
            open API — they are curated entries in the shared database, added by hand
            with a source. Nothing here is generated.
          </div>
        ) : (
          <>
            {expert.items.map((a, i) => (
              <div key={i} style={{display:"flex",gap:8,alignItems:"baseline",marginBottom:5}}>
                <span style={{fontSize:12,fontWeight:700,color:scoreColor(a.normalized.value),minWidth:26}}>{a.normalized.value}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:11,color:t.text}}>{a.name || a.sourceLabel} {a.year ? `(${a.year})` : ""}</div>
                  <div style={{fontSize:9,color:t.textMuted}}>{a.sourceLabel} · original “{a.normalized.raw}” · {a.normalized.note}</div>
                </div>
              </div>
            ))}
            {expert.thin && (
              <div style={{fontSize:9,color:t.textMuted,marginTop:6,lineHeight:1.6}}>
                Fewer than three sources — treat as indicative, not a verdict.
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Freshness ── */}
      {freshness && (
        <div style={{...box, display:"flex", gap:10, alignItems:"center",
                     borderColor: freshness.stale ? "#d9770655" : t.border}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:11,fontWeight:600,color:t.text}}>
              {!freshness.known ? "Source date unknown"
                : freshness.days === 0 ? "Read from source today"
                : `Read from source ${freshness.days} day${freshness.days !== 1 ? "s" : ""} ago`}
            </div>
            <div style={{fontSize:9,color:t.textMuted,lineHeight:1.6,marginTop:2}}>
              {/* Reformulations happen. A rating is only as current as the data
                  behind it, so the read date is shown rather than implied. */}
              Ratings are computed from the source data at that date. Recipes change —
              refresh to re-read and re-rate.
            </div>
          </div>
          <button onClick={onRefresh} disabled={refreshing}
            style={{flexShrink:0,fontSize:11,fontWeight:600,padding:"7px 12px",borderRadius:7,
              background:freshness.stale?"#d97706":t.pill, color:freshness.stale?"#fff":t.textSub,
              border:`1px solid ${freshness.stale?"#d97706":t.border}`,
              cursor:refreshing?"default":"pointer",opacity:refreshing?0.6:1}}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}

      {/* ── Add product details ── */}
      <div style={box}>
        <div style={{...sHdr,color:t.textSub,marginBottom:6}}>Add product details</div>
        {contributions?.length > 0 && (
          <div style={{fontSize:10,color:t.textSub,lineHeight:1.6,marginBottom:8}}>
            {contributions.length} contribution{contributions.length!==1?"s":""} from readers.
            Community-supplied and unverified — they fill gaps in the source data, never overwrite it.
          </div>
        )}
        {!detailsOpen ? (
          <button onClick={() => setDetailsOpen(true)}
            style={{width:"100%",padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
              background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>
            Something missing or wrong? Add details
          </button>
        ) : (
          <>
            <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginBottom:8}}>
              {ingredientsFocus
                ? "Copy the ingredient list exactly as printed on the pack. This is what the profile check reads, so it changes the verdict for you and for everyone who scans this product afterwards."
                : "Copy from the physical label. Reported additives are shown separately as unverified; the other fields are stored for other readers."}
            </div>
            {[["ingredients","Full ingredient list from the pack","textarea"],
              ["additives","Additives / E-numbers on the label (comma separated)","input"],
              ["quantity","Pack size, e.g. 500 g","input"],
              ["category","Category, e.g. greek yogurt","input"],
              ["note","Anything else worth knowing","textarea"]].map(([key,ph,kind]) => (
              kind === "textarea" ? (
                <textarea key={key} rows={2} value={myDetails[key]} placeholder={ph}
                  onChange={e => setMyDetails(d => ({...d, [key]: e.target.value}))}
                  style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"7px 9px",borderRadius:7,
                    border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,resize:"vertical",
                    fontFamily:"inherit",marginBottom:6}}/>
              ) : (
                <input key={key} value={myDetails[key]} placeholder={ph}
                  onChange={e => setMyDetails(d => ({...d, [key]: e.target.value}))}
                  style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"7px 9px",borderRadius:7,
                    border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,marginBottom:6}}/>
              )
            ))}
            <div style={{display:"flex",gap:6}}>
              <button onClick={ingredientsFocus ? onSaveIngredients : onSubmitDetails}
                style={{flex:1,padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                  background:t.accent,color:t.accentFg,border:"none"}}>
                {ingredientsFocus ? "Save and re-check against my profile" : "Save details"}
              </button>
              <button onClick={() => setDetailsOpen(false)}
                style={{padding:"9px 14px",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                  background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>Cancel</button>
            </div>
          </>
        )}
      </div>

      {/* ── Community ── */}
      <div style={box}>
        <div style={{...sHdr,color:t.textSub}}>Customer reviews</div>
        {community.count > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,color:t.text,marginBottom:4}}>
              {community.average}/5 from {community.count} review{community.count!==1?"s":""}
              {community.thin && <span style={{color:t.textMuted}}> · too few to be representative</span>}
            </div>
            {community.reports.length > 0 && (
              <div style={{fontSize:10,color:"#d97706",lineHeight:1.6,marginTop:5}}>
                Unverified substance reports: {community.reports.map(r => `${r.substance} (${r.count})`).join(", ")}.
                These are reader claims awaiting confirmation and do not affect the safety score.
              </div>
            )}
          </div>
        )}
        <div style={{display:"flex",gap:5,marginBottom:8}}>
          {[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => setMyStars(n)}
              style={{flex:1,padding:"7px 0",fontSize:13,borderRadius:7,cursor:"pointer",
                background:n<=myStars?"#d97706":t.pill,color:n<=myStars?"#fff":t.textSub,
                border:`1px solid ${n<=myStars?"#d97706":t.border}`,fontWeight:600}}>★</button>
          ))}
        </div>
        <textarea value={myReview} onChange={e => setMyReview(e.target.value)} rows={2} maxLength={500}
          placeholder="What did you think? (optional)"
          style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"7px 9px",borderRadius:7,border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,resize:"vertical",fontFamily:"inherit",marginBottom:6}}/>
        <input value={myReport} onChange={e => setMyReport(e.target.value)}
          placeholder="Ingredient on the label but missing from the data? (comma separated)"
          style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"7px 9px",borderRadius:7,border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,marginBottom:8}}/>
        <button onClick={onSubmit} disabled={!myStars}
          style={{width:"100%",padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:myStars?"pointer":"default",
            background:myStars?t.accent:t.pill,color:myStars?t.accentFg:t.textMuted,border:"none"}}>
          {myStars ? "Save review to shared database" : "Pick a rating first"}
        </button>
        <div style={{fontSize:9,color:t.textMuted,marginTop:7,lineHeight:1.6}}>
          One review per device; saving again replaces your previous one. Reviews are
          public. Substance reports are counted and shown as unverified — they are a
          prompt to check the label, not a change to the rating.
        </div>
      </div>
    </div>
  );
}

// A single disclaimer component, used everywhere a product judgement is shown.
// One definition rather than several copies, so the wording cannot drift apart
// between the result card, the alternatives list and the browse results.
//
// Deliberately domain-neutral: this app covers food and cosmetics, and the same
// point holds for both. A "100% pure", "vegan" or "organic" label describes how
// something was made, not whether it suits the person reading — pure essential
// oils burn skin, and organic wine still puts asthmatics in hospital.
function Disclaimer({ t, variant = "full" }) {
  const box = {
    fontSize: 10, color: t.textSub, lineHeight: 1.65,
    background: t.bgSub, border: `1px solid ${t.border}`,
    borderRadius: 8, padding: "10px 12px", marginTop: 10,
  };
  if (variant === "compact") {
    return (
      <div style={{ ...box, fontSize: 9.5, color: t.textMuted }}>
        Suggestions, not recommendations. “Pure”, “natural” or “organic” describes how
        something was made — not whether it suits you.
      </div>
    );
  }
  return (
    <div style={box}>
      <strong style={{ color: t.text, fontWeight: 700 }}>Choose wisely.</strong>{" "}
      This is a suggestion to help you decide, not a verdict. Labels like “pure”, “natural”,
      “organic” or “vegan” describe how something was made — not whether it is safe for
      <em> you</em>. Something entirely pure can still harm someone sensitive to it.
      <br /><br />
      Data can also be incomplete or out of date, and formulations differ by country. The pack
      in your hand is the authority — and for any diagnosed condition or allergy, your clinician
      comes first.
    </div>
  );
}

function OFFCard({ offData, aiSugarData, substances, insight, insightLoading, brandCred, brandStat, brandCredLoading, alternatives, altLoading, diet, t, dark, onOpen, cosmeticAnalysis, ratingsPanel, onAddPhoto, photoBusy }) {
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
              ? (
                <div style={{position:"relative",width:"100%",height:156}}>
                  <img src={offData.image} alt={offData.name} style={{width:"100%",height:156,objectFit:"contain",padding:10,boxSizing:"border-box"}}/>
                  {offData._localImage && (
                    <span style={{position:"absolute",left:6,bottom:6,fontSize:8,fontWeight:600,color:"#fff",
                      background:"rgba(217,119,6,0.9)",padding:"2px 6px",borderRadius:4}}>On this device only</span>
                  )}
                  <button onClick={onAddPhoto} disabled={photoBusy}
                    style={{position:"absolute",right:6,bottom:6,fontSize:9,fontWeight:600,padding:"3px 7px",
                      borderRadius:5,background:"rgba(0,0,0,0.55)",color:"#fff",border:"none",cursor:"pointer"}}>
                    {photoBusy ? "…" : "Replace"}
                  </button>
                </div>
              )
              : (
                // USDA records carry no photography at all and community records
                // start with none, so the empty state offers to fix itself
                // rather than just reporting the gap.
                <button onClick={onAddPhoto} disabled={photoBusy}
                  style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:14,textAlign:"center",
                    background:"none",border:"none",cursor:photoBusy?"default":"pointer",width:"100%",height:156,justifyContent:"center"}}>
                  <span style={{fontSize:30,opacity:0.25}}>📷</span>
                  <span style={{fontSize:9,color:t.textMuted,lineHeight:1.5}}>
                    {photoBusy ? "Saving…" : "No image\nAdd one"}
                  </span>
                </button>
              )
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

      {/* PRODUCT CREDIBILITY */}
      <ProductCredibilityCard cred={brandCred} brandStat={brandStat} brand={offData.brand} loading={brandCredLoading} enhanced={AI_MODE} t={t} dark={dark}/>

      {DOMAIN === "cosmetics" && <FormulationCard analysis={cosmeticAnalysis} t={t} dark={dark}/>}

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
      {ratingsPanel}

      {(altLoading || (alternatives && alternatives.length > 0)) && (
        <div style={{...card}}>
          <div style={{...sHdr,color:"#2e7d52"}}>Better Alternatives</div>
          {altLoading && !alternatives.length
            ? <div style={{padding:"18px 16px",display:"flex",alignItems:"center",gap:10,color:t.textSub,fontSize:12}}><span style={{display:"inline-block",width:12,height:12,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Finding better alternatives…</div>
            : <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                {alternatives.map((alt,i) => (
                  <div key={i} onClick={()=>onOpen?.(alt.name)} title={`Analyse ${alt.name}`} style={{background:t.bgSub,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:7,padding:"12px 14px",cursor:onOpen?"pointer":"default",transition:"background 0.15s"}} onMouseEnter={e=>{if(onOpen)e.currentTarget.style.background=t.surfaceHov;}} onMouseLeave={e=>{if(onOpen)e.currentTarget.style.background=t.bgSub;}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:5}}>
                      <div><div style={{fontSize:13,fontWeight:600,color:t.text}}>{alt.name}</div>{alt.brand&&<div style={{fontSize:10,color:t.textSub,marginTop:1}}>{alt.brand}</div>}</div>
                      <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
                        {alt.nutriScore&&alt.nutriScore!=="unknown"&&<span style={{fontSize:10,fontWeight:700,color:"#fff",background:NS_COLOR[alt.nutriScore]||"#999",padding:"2px 7px",borderRadius:4}}>{alt.nutriScore.toUpperCase()}</span>}
                        {/* Labelled rather than hidden: a widened result is
                            still useful, but the reader should know it may not
                            be on a shelf near them. */}
                        {alt.elsewhere && <span style={{fontSize:9,fontWeight:600,color:"#d97706",background:"rgba(217,119,6,0.1)",padding:"2px 8px",borderRadius:4}}>Other market</span>}
                        <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"2px 8px",borderRadius:4}}>Better</span>
                      </div>
                    </div>
                    <div style={{fontSize:12,color:t.textSub,lineHeight:1.6,marginBottom:6}}>{alt.reason}</div>
                    {alt.improvements?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:alt.sourceUrl?6:0}}>{alt.improvements.map((imp,j)=><span key={j} style={{fontSize:10,color:"#2e7d52",background:"rgba(46,125,82,0.08)",border:"1px solid rgba(46,125,82,0.18)",padding:"2px 9px",borderRadius:10}}>✓ {imp}</span>)}</div>}
                    {alt.sourceUrl&&<a href={alt.sourceUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:t.accent,textDecoration:"none",borderBottom:`1px solid ${t.accent}40`}}>↗ {alt.sourceName||"View"}</a>}
                  </div>
                ))}
                <Disclaimer t={t} variant="compact"/>
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
      <div style={{fontSize:9,color:t.textMuted,lineHeight:1.7,padding:"8px 0 4px"}}>
        Data from Open Food Facts, USDA FoodData Central and Open Beauty Facts · {AI_MODE?"Extended brand research":"Built-in safety engine"} · Educational purposes only.
      </div>
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [input,setInput]         = useState("");
  const [tracked,setTracked]     = useState([]);
  const [selected,setSelected]   = useState(null);
  const [scanning,setScanning]   = useState(false);
  const { isMobile, isNarrow }   = useViewport();
  const [dark,setDark]           = useState(false);
  const [aiMode,setAiMode]       = useState(AI_MODE);
  const [toasts,setToasts]       = useState([]);
  const [insight,setInsight]     = useState("");
  const [insightLoading,setInsightLoading] = useState(false);
  const [ratings,setRatings]     = useState(null);   // safety / expert / community
  const [myStars,setMyStars]     = useState(0);
  const [myReview,setMyReview]   = useState("");
  const [myReport,setMyReport]   = useState("");
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
  const [picker,setPicker]           = useState(null); // { query, results:{food,cosmetics}, tab }
  const [pickerLoading,setPickerLoading] = useState(null); // domain currently being fetched
  const [showPlan,setShowPlan]       = useState(false);
  const [cameraOpen,setCameraOpen]   = useState(false);
  const [inputFocus,setInputFocus]   = useState(false);
  const [refreshing,setRefreshing]   = useState(false);
  // The reader's declared sensitivities. Persisted locally, never uploaded —
  // health information belongs on the device, not in a shared database.
  const [profile,setProfile] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("hst_profile") || "[]"); } catch { return []; }
  });
  const [market,setMarketState] = useState(() => guessMarket());
  useEffect(() => { setMarketTag(market); }, [market]);
  function changeMarket(m) {
    setMarketState(m);
    setMarketTag(m);
    try { window.localStorage.setItem("hst_market", m); } catch { /* private mode */ }
    // Alternatives were fetched against the old market, so the cached list is
    // now wrong for this reader — drop it and refetch on next view.
    cache.current.alts = {};
    if (selected) loadAlts(selected, nk(selected.name));
  }
  const [photoNote,setPhotoNote] = useState("");
  const [photoBusy,setPhotoBusy] = useState(false);
  const photoRef = useRef(null);
  const [addPhoto,setAddPhoto] = useState(null);   // { dataUrl, base64 } for a new product
  const addPhotoRef = useRef(null);
  const [addOpen,setAddOpen] = useState(false);
  const [addPrompt,setAddPrompt] = useState(false);
  const [newPhoto,setNewPhoto]   = useState(null);
  const newPhotoRef = useRef(null);
  const [noListFor,setNoListFor] = useState(null);   // { name, label, key }
  const [noListText,setNoListText] = useState("");
  const [newProduct,setNewProduct] = useState({
    name:"", brand:"", code:"", domain:"food",
    ingredients:"", additives:"", allergens:"", labels:"", quantity:"", category:"",
  });
  const [marketOpen,setMarketOpen]     = useState(false);
  const [profilePanel,setProfilePanel] = useState(false);
  const [conditions,setConditions] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("hst_conditions") || "[]"); } catch { return []; }
  });
  function toggleCondition(key) {
    setConditions(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      try { window.localStorage.setItem("hst_conditions", JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }
  const [profileOpen,setProfileOpen] = useState(false);
  function toggleSensitivity(key) {
    setProfile(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      try { window.localStorage.setItem("hst_profile", JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }
  const [photoUnverified,setPhotoUnverified] = useState(false);
  const [communityRecord,setCommunityRecord] = useState(false);
  const [contributions,setContributions] = useState([]);
  const [detailsOpen,setDetailsOpen] = useState(false);
  const [ingredientsFocus,setIngredientsFocus] = useState(false);
  const [myDetails,setMyDetails]     = useState({ ingredients:"", additives:"", quantity:"", category:"", note:"" });
  const [discoverMore,setDiscoverMore] = useState(false); // loading another page
  const [diag,setDiag]               = useState(null);   // source diagnostics result
  const [diagRunning,setDiagRunning] = useState(false);
  const [discover,setDiscover]       = useState(null);
  const [discoverLoading,setDiscoverLoading] = useState(false);
  const [brandStat,setBrandStat]     = useState(null);
  const [domain,setDomainState]      = useState(DOMAIN);
  // Entitlement is intentionally session-only. A paid flag persisted in the
  // browser is trivially forged; the real one must come from the server.
  const [subscribed,setSubscribed]   = useState(false);
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

  // Turn Enhanced on and verify the service is actually reachable. Failures
  // otherwise fall back to Standard silently, which would look like it worked.
  const enableEnhanced = () => {
    AI_MODE = true; setAiMode(true);
    toast("scan", "Enhanced analysis enabled. Verifying service availability…");
    (async () => {
      const ok = await callAI("Reply with the single word OK.", 10, false).catch(() => "");
      if (ok && AI_MODE) toast("database", "Enhanced analysis service connected — scans will include extended research and generated insights.");
      else if (AI_MODE) toast("high", "Enhanced analysis service is not reachable in this deployment. Scans will use the standard engine until ANTHROPIC_API_KEY is configured on the server (see README).");
    })();
  };

  // Switching domain swaps the data source AND the scientific basis, so the
  // session's results are cleared rather than mixed across two rulebooks.
  // Domain is detected per product rather than chosen. This only syncs the
  // indicator and the copy after a lookup resolves.
  const noteDomain = (d) => {
    if (!d || d === DOMAIN) return;
    DOMAIN = d; setDomainState(d);
  };

  const toggleAI = () => {
    if (AI_MODE) {
      AI_MODE = false; setAiMode(false);
      toast("scan", "Standard analysis enabled. Product scans use the built-in safety engine and Open Food Facts data.");
      return;
    }
    // Enhanced is a paid tier — ask before switching on
    if (!subscribed) { setShowPlan(true); return; }
    enableEnhanced();
  };

  // Called when the plan is accepted. In production this must not enable the
  // feature directly: it should start a checkout session and only unlock after
  // the payment provider confirms the subscription server-side.
  const acceptPlan = () => {
    setShowPlan(false);
    setSubscribed(true);
    enableEnhanced();
  };

  const ck = (s) => cache.current;
  const fromCache = (store, key) => cache.current[store]?.[key] ?? null;
  const toCache   = (store, key, val) => { cache.current[store] = cache.current[store] || {}; cache.current[store][key] = val; };
  const dropCache = (store, key) => { if (cache.current[store]) delete cache.current[store][key]; };
  const nk        = (s) => normKey(s);

  // ── SCAN ────────────────────────────────────────────────────────────────────
  // Show a tracked entry and kick off its detail panels
  function showEntry(entry, key) {
    setTracked(p => [entry, ...p]);
    setSelected(entry);
    setScanning(false);
    loadRatings(entry, key);
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
      domain: rec.domain || DOMAIN,
      // Formulation detail for cosmetics; absent for food entries
      cosmetic: rec.domain === "cosmetics"
        ? { formulation:rec.formulation, ph:rec.ph, delivery:rec.delivery, stabilisers:rec.stabilisers }
        : (rec.cosmetic || null),
      ...extra,
    };
  }

  // Persist an analysis and announce what was found. Results with no product
  // data and no findings are deliberately NOT persisted — caching an empty
  // lookup would serve that same nothing back for 30 days.
  function commitScan(a, label) {
    const name = a.offData?.name || label;
    const key = nk(name);
    const payload = { offData:a.offData, aiSugarData:a.aiSugarData, allSubs:a.allSubs, risk:a.risk, diet:a.diet, undeclaredCount:a.undeclaredCount, hitCount:1, savedAt:Date.now(),
      // When the source data was actually fetched, as distinct from when the
      // record was last written. Products change — reformulations, corrected
      // ingredient lists — so a rating is only as current as its source read.
      fetchedAt: Date.now(),
      domain: a.domain || DOMAIN,
      ...(a.domain === "cosmetics" ? { formulation:a.formulation, ph:a.ph, delivery:a.delivery, stabilisers:a.stabilisers } : {}) };
    const history = a.offData?.brand ? brandHistory(a.offData.brand) : null;

    if (a.offData || a.allSubs.length > 0) {
      toCache("scan", key, payload);
      ghSet(key, payload, setDbCount).then(st => {
        if (st === "saved") toast("database", `"${name}" committed to the shared database.`);
        else if (st === "no-token" && !warnedReadOnly.current) {
          warnedReadOnly.current = true;
          toast("database", "Read-only mode: results are stored for this session only. Set VITE_GH_TOKEN and redeploy to enable shared database writes.");
        } else if (st === "error") toast("database", `Shared database write failed — ${_ghLastError || "see the browser console"}. The result is kept for this session.`);
      });
    }

    const entry = entryFrom({ ...a, offData:a.offData }, label);
    showEntry(entry, key);

    // Toast policy: the card already shows source, risk and undeclared counts,
    // so repeating them as popups was noise stacked over the thing the reader
    // is trying to read. Only states that are NOT visible on the card are
    // toasted — a service failure, or a write that did not happen.
    if (_offStatus === "ratelimited") toast("scan",
      `${domainLabel()} is rate-limiting requests (10 per minute). Wait a minute, then press ↻.`);
    else if (_offStatus === "network") toast("scan",
      `${domainLabel()} is unreachable from this browser — the analysis is name-based only. Press ↻ to retry.`);

    // Two different gaps, two different forms. Conflating them meant a product
    // that no database had at all was only ever asked for its ingredient list —
    // no name, brand, barcode or photo — so the record stayed a stub.
    const hasRecord = !!a.offData?.name && a.offData?.source !== "community-stub";
    const noList = !String(a.offData?.ingredients || "").trim();

    if (_offStatus === "unknown-code" || _offStatus === "nomatch" || !hasRecord) {
      // Nothing on file: ask for the whole product, prefilled with what is known.
      const digits = label.replace(/\D/g, "");
      setNewProduct(p => ({
        ...p,
        code: digits.length >= 8 ? digits : p.code,
        name: digits.length >= 8 ? p.name : (p.name || label),
        domain: a.domain === "cosmetics" ? "cosmetics" : "food",
      }));
      setAddPrompt(true);
    } else if (noList) {
      // Record exists but the ingredient list is missing — the narrower ask.
      setNoListFor({ name, label, key });
    }

    if (history) {
      // The rating is shown for every brand with any prior record, not only
      // bad ones — a brand with a clean record is information too. The record
      // it is based on is stated so the number is never taken on faith.
      const parts = [];
      if (history.undeclared > 0) parts.push(`${history.undeclared} undeclared-substance report${history.undeclared!==1?"s":""}`);
      if (history.high > 0) parts.push(`${history.high} high-risk product${history.high!==1?"s":""}`);
      toast("brand", `${a.offData.brand} — brand rating ${history.score}/10 (${history.verdict}), based on ${history.count} product${history.count!==1?"s":""} in the shared database${parts.length ? `: ${parts.join(", ")}` : " with nothing flagged"}.`);
    }

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
      const { candidates, analysis, domain } = await lookupAndAnalyze(label);
      noteDomain(domain);
      if (candidates) {
        // Ambiguous query — let the user choose rather than guessing wrong
        setScanning(false);
        setPicker({
          query: label,
          tab: domain === "cosmetics" ? "cosmetics" : "food",
          // null means "not fetched yet" — distinct from [] meaning "fetched,
          // nothing found". The other database is only queried if the user
          // actually opens that tab, so an unused tab costs no requests.
          results: { food: domain === "cosmetics" ? null : candidates,
                     cosmetics: domain === "cosmetics" ? candidates : null },
        });
        return;
      }
      if (!analysis) throw new Error("Lookup returned no analysis");
      commitScan(analysis, label);
    } catch (e) {
      console.warn("scan:", e);
      toast("scan", `The scan could not be completed: ${String(e?.message || e)}`);
    } finally {
      // Unconditional. The Search button is disabled while `scanning` is true,
      // so any path that left it set would make the button permanently dead —
      // a finally block removes that entire class of failure.
      setScanning(false);
    }
  }

  // One input, one action. A question is answered from what is already known;
  // anything that looks like a product is opened from cache if we have it and
  // scanned fresh if we do not. The user should not have to choose which.
  const QUESTION_RE = /^(who|what|why|how|which|are|is|do|does|show|find|list|tell|compare|any)\b|\?$/i;
  async function submitQuery(raw) {
    const q = (raw ?? input).trim();
    if (!q) return;
    setInputFocus(false);

    // An attribute query asks about the whole catalogue, so it is answered from
    // the live source. Answering it from the shared database would only return
    // the few products already scanned, which is not what was asked.
    if (CLOUD_FILTERS.some(f => f.m.test(q))) {
      setDiscoverLoading(true); setDiscover(null); setSelected(null);
      try {
        const res = await cloudSearch(q);
        setDiscover(res ? { ...res, query: q } : { applied: [], products: [], count: 0, query: q });
        if (res?.domain) noteDomain(res.domain);
      } catch (e) {
        console.warn("submitQuery/discover:", e);
        setDiscover({ applied: [], products: [], count: 0, failed: true, error: String(e?.message || e) });
      } finally {
        // Same reasoning: an unhandled rejection here left the panel stuck on
        // its loading skeleton with no way out.
        setDiscoverLoading(false);
      }
      return;
    }

    setDiscover(null);
    if (QUESTION_RE.test(q)) { setSearchQ(q); runSearch(q); return; }
    scan(q);   // checks session cache → shared database → fresh lookup
  }

  // Fetch the next page and append. Results accumulate rather than replace, so
  // "Show more" grows the list instead of paging the user away from what they
  // have already looked at.
  async function loadMoreDiscover() {
    if (!discover || discoverMore) return;
    setDiscoverMore(true);
    try {
      const next = await cloudSearch(discover.query, (discover.page || 1) + 1);
      if (next && next.products?.length) {
        // Dedupe on name+brand: paging backends can repeat a record across
        // page boundaries when the underlying sort is not fully stable.
        const seen = new Set(discover.products.map(p => nk(p.name) + "|" + nk(p.brand || "")));
        const fresh = next.products.filter(p => !seen.has(nk(p.name) + "|" + nk(p.brand || "")));
        setDiscover({ ...discover, page: next.page, hasMore: next.hasMore,
                      products: [...discover.products, ...fresh] });
      } else {
        setDiscover({ ...discover, hasMore: false });
      }
    } catch (e) {
      console.warn("loadMoreDiscover:", e);
      setDiscover(d => d && { ...d, hasMore: false, error: String(e?.message || e) });
    } finally {
      setDiscoverMore(false);
    }
  }

  const STALE_AFTER = 30 * 24 * 60 * 60 * 1000;   // 30 days

  function staleness(entry) {
    const at = entry?.offData?.fetchedAt || entry?.fetchedAt;
    if (!at) return { known: false, days: null, stale: true };
    const days = Math.floor((Date.now() - at) / 86400000);
    return { known: true, days, stale: Date.now() - at > STALE_AFTER };
  }

  // Re-fetch a product from source and recompute everything from the fresh
  // data. Cached records are otherwise served indefinitely, so a reformulation
  // or a corrected ingredient list would never reach an already-scanned
  // product — its rating would stay frozen at whatever was true when first seen.
  async function refreshProduct(entry) {
    if (!entry || refreshing) return;
    setRefreshing(true);
    const k = nk(entry.name);
    try {
      const code = entry.offData?.code;
      const { analysis } = await lookupAndAnalyze(code || entry.searchTerm || entry.name);
      if (!analysis) throw new Error("No fresh data returned");
      dropCache("scan", k); dropCache("alts", k); dropCache("brand", k);
      commitScan(analysis, entry.name);
      toast("refresh", `"${entry.name}" re-read from source and re-rated.`);
    } catch (e) {
      console.warn("refreshProduct:", e);
      toast("refresh", `Could not refresh: ${String(e?.message || e)}`);
    } finally {
      setRefreshing(false);
    }
  }

  // Re-run the personal check when the profile changes, without re-fetching.
  useEffect(() => {
    if (selected) loadRatings(selected, nk(selected.name));
  }, [profile, conditions]);

  // ── ADD A PRODUCT THAT IS IN NO DATABASE ──
  // Regional and small-brand products are missing from every open source. The
  // reader has the pack in their hand, which makes them a better source than
  // anything queryable — so they can create the record, and it is then found by
  // the next person who scans that barcode.
  //
  // Community records are marked as such and never silently pass as source
  // data: their provenance is shown wherever they are used.
  // Opens the details form focused on the ingredient list. Reached from the
  // "cannot check" warning, so the person who noticed the gap is one tap from
  // filling it while the pack is still in their hand.
  function openIngredientsForm() {
    setDetailsOpen(true);
    setIngredientsFocus(true);
    // Scroll is left to the browser; the form is already in view within the card.
  }

  // Re-runs the whole analysis from a reader-supplied ingredient list. This is
  // the point of the feature: adding the list must change the verdict
  // immediately, not merely store text for someone else later.
  // Shared by the dialog and the in-card form: takes a target and the text,
  // rather than reading component state, so it cannot act on a stale selection.
  async function saveIngredientsFor(target, text) {
    const key = target.key || nk(target.name);
    const rec = ghGet(key) || {};
    const clean = text.trim().slice(0, 4000);
    const contributions = Array.isArray(rec.contributions) ? [...rec.contributions] : [];
    const mine = { by: reviewerId(), ingredients: clean, additives: [], quantity: "", category: "", note: "", ts: Date.now() };
    const idx = contributions.findIndex(c => c.by && c.by === mine.by);
    if (idx >= 0) contributions[idx] = mine; else contributions.push(mine);

    setScanning(true);
    try {
      const base = (selected && nk(selected.name) === key ? selected.offData : rec.offData) || {};
      // Carry the barcode through. Without it a list added for a product no
      // database has is unreachable by scanning — the next person points their
      // camera at the same pack and gets nothing, which defeats the purpose.
      const scannedCode = String(target.label || "").replace(/\D/g, "");
      const offData = {
        ...base,
        name: target.name,
        code: base.code || (scannedCode.length >= 8 ? scannedCode : null),
        ingredients: clean,
        ingredientsSource: "community",
        ingredientsBy: reviewerId(),
        ingredientsAt: Date.now(),
      };
      const analysis = await analyzeProduct(offData, target.name);
      analysis.domain = rec.domain || selected?.domain || DOMAIN;
      await ghSet(key, { ...rec, contributions, offData }, setDbCount);
      dropCache("scan", key);
      commitScan(analysis, target.name);
      toast("details", "Ingredient list saved. The product has been re-analysed against your profile and the list is now shared.");
    } catch (e) {
      console.warn("saveIngredientsFor:", e);
      toast("details", `Could not re-analyse: ${String(e?.message || e)}`);
    } finally {
      setScanning(false);
    }
  }

  async function saveIngredientsAndReanalyse() {
    if (!selected || !myDetails.ingredients.trim()) {
      toast("details", "Add the ingredient list first.");
      return;
    }
    const key = nk(selected.name);
    const rec = ghGet(key) || {};
    const text = myDetails.ingredients.trim().slice(0, 4000);

    // Stored as a contribution AND merged into the product record, because the
    // hazard engine and the profile checks read offData.ingredients.
    const contributions = Array.isArray(rec.contributions) ? [...rec.contributions] : [];
    const mine = { by: reviewerId(), ingredients: text,
                   additives: myDetails.additives.split(",").map(x=>x.trim()).filter(Boolean),
                   quantity: "", category: "", note: "", ts: Date.now() };
    const idx = contributions.findIndex(c => c.by && c.by === mine.by);
    if (idx >= 0) contributions[idx] = mine; else contributions.push(mine);

    setDetailsOpen(false);
    setIngredientsFocus(false);
    setScanning(true);
    try {
      const offData = { ...(selected.offData || {}), name: selected.name,
                        ingredients: text, ingredientsSource: "community" };
      const analysis = await analyzeProduct(offData, selected.name);
      analysis.domain = selected.domain || DOMAIN;
      await ghSet(key, { ...rec, contributions, offData }, setDbCount);
      dropCache("scan", key);
      commitScan(analysis, selected.name);
      toast("details", "Ingredient list saved and the product re-analysed against your profile. Anyone scanning it now gets the same check.");
    } catch (e) {
      console.warn("saveIngredientsAndReanalyse:", e);
      toast("details", `Could not re-analyse: ${String(e?.message || e)}`);
    } finally {
      setScanning(false);
    }
  }

  async function submitNewProduct() {
    const f = newProduct;
    if (!f.name.trim()) { toast("add", "A product name is required."); return; }

    const additives = f.additives.split(",").map(x => x.trim()).filter(Boolean);
    const offData = {
      name: f.name.trim(),
      brand: f.brand.trim() || null,
      code: f.code.replace(/\D/g, "") || null,
      ingredients: f.ingredients.trim() || null,
      quantity: f.quantity.trim() || null,
      additives,
      allergens: f.allergens.split(",").map(x => x.trim()).filter(Boolean),
      labels: f.labels.split(",").map(x => x.trim()).filter(Boolean),
      categories: f.category.trim() ? [f.category.trim()] : [],
      nut: {},
      // Deliberately absent: Nutri-Score, NOVA and Eco-Score are computed by
      // Open Food Facts from data this form does not collect. Leaving them null
      // is truthful; guessing them would put a fabricated grade on the card.
      nutriScore: null, novaGroup: null, ecoScore: null,
      source: "community",
      _domain: f.domain,
      contributedBy: reviewerId(),
      contributedAt: Date.now(),
    };

    setAddOpen(false);
    setScanning(true);
    try {
      const analysis = await analyzeProduct(offData, offData.name);
      analysis.domain = f.domain;
      commitScan(analysis, offData.name);

      // Uploaded after the record exists, so a failed image never blocks the
      // product itself from being saved.
      if (addPhoto) {
        const key = nk(offData.name);
        const shared = await ghPutImage(key, addPhoto.base64);
        if (shared) {
          const rec = ghGet(key) || {};
          await ghSet(key, { ...rec, offData: { ...(rec.offData || offData), image: shared } }, setDbCount);
        } else {
          saveLocalImage(key, addPhoto.dataUrl);
        }
        setAddPhoto(null);
      }
      toast("add", `"${offData.name}" added to the shared database${offData.code ? ` under barcode ${offData.code}` : ""}. It will be found by anyone who scans it.`);
      // The photo goes through the same verification and quality gate as any
      // other upload, so a new product is not a way around those checks.
      if (newPhoto) {
        await attachPhoto(newPhoto, { name: offData.name, offData });
        setNewPhoto(null);
      }
      setNewProduct({ name:"", brand:"", code:"", domain:"food", ingredients:"", additives:"", allergens:"", labels:"", quantity:"", category:"" });
    } catch (e) {
      console.warn("submitNewProduct:", e);
      toast("add", `Could not add the product: ${String(e?.message || e)}`);
    } finally {
      setScanning(false);
    }
  }

  // Attach a photo to a product. Shared when the deployment can write, kept on
  // this device otherwise — and the UI says which, rather than implying a photo
  // reached everyone when it did not.
  // Scores an image already attached to a product, so a replacement can be
  // judged against it. Returns null when the existing photo cannot be read —
  // an old record with no stored score, or a fetch that fails — and the caller
  // treats that as "unknown" rather than assuming either is better.
  async function scoreExisting(rec, entry) {
    if (rec?.imageScore != null) return rec.imageScore;
    const url = rec?.offData?.image || entry?.offData?.image;
    if (!url || url.startsWith("data:")) return null;
    try {
      const r = await fetch(url, { mode: "cors" });
      if (!r.ok) return null;
      const s = await scoreImage(await createImageBitmap(await r.blob()));
      return s.score;
    } catch { return null; }
  }

  async function attachPhoto(file, entry) {
    if (!file || !entry) return;
    const key = nk(entry.name);           // database record key (by name)
    const imgKey = photoKeyFor(entry);    // image file key (by barcode)
    setPhotoBusy(true);
    try {
      // Score the ORIGINAL upload, not the compressed copy — compression is
      // applied to both photos equally, so judging before it compares what the
      // camera actually captured.
      const original = await createImageBitmap(file);
      const fresh = await scoreImage(original);

      const existingRec = ghGet(key) || {};
      const hasPhoto = !!(existingRec.offData?.image || entry.offData?.image);
      if (hasPhoto) {
        const prev = await scoreExisting(existingRec, entry);
        // A margin, not a bare comparison: two photos of the same pack score
        // within noise of each other, and churning the shared image on a 1%
        // difference is worse than leaving a good one alone.
        const MARGIN = 0.06;
        if (prev != null && fresh.score <= prev + MARGIN) {
          setPhotoBusy(false);
          toast("photo", `Kept the existing photo — it scores ${prev.toFixed(2)} against ${fresh.score.toFixed(2)} for yours (sharpness ${fresh.sharpness}, exposure ${fresh.exposure}). A sharper or better-lit shot will replace it.`);
          return;
        }
        if (prev == null) {
          toast("photo", "The existing photo could not be scored, so yours replaces it.");
        }
      }

      const img = await compressImage(file);

      // Verify the photo shows this product before it goes anywhere shared. A
      // sharp, well-lit photo of the wrong pack passes every quality check, so
      // this is the only step that catches it.
      setPhotoNote("Checking the photo matches this product…");
      // Barcode first: exact, free, offline. The label check is only reached
      // when no barcode is visible in the shot.
      let check = await verifyPhotoByBarcode(original, entry.offData?.code).catch(() => null);
      if (!check) check = await verifyPhotoMatches(img.base64, entry.name, entry.offData?.brand);
      setPhotoNote("");
      if (check.verdict === "mismatch") {
        setPhotoBusy(false);
        toast("photo", `That photo was not saved — it appears to show ${check.seen ? `“${check.seen}”` : "a different product"}, not ${entry.name}. ${check.reason}`);
        return;
      }

      const shared = await ghPutImage(imgKey, img.base64);
      if (shared) {
        const rec = ghGet(key) || {};
        const offData = { ...(rec.offData || entry.offData || {}), image: shared };
        // Stored so the next upload can be compared without re-downloading and
        // re-analysing the current photo.
        await ghSet(key, { ...rec, offData, imageScore: fresh.score,
                           imageMeta: { ...fresh, by: reviewerId(), at: Date.now(),
                                        imgKey, verified: check.verdict, seen: check.seen } }, setDbCount);
        setSelected(sel => sel && { ...sel, offData: { ...sel.offData, image: shared } });
        toast("photo", check.verdict === "match"
          ? `Photo ${hasPhoto ? "replaced" : "added"} and verified as ${entry.name} (quality ${fresh.score.toFixed(2)}, ${Math.round(img.bytes / 1024)} KB). One photo is kept per barcode.`
          : `Photo ${hasPhoto ? "replaced" : "added"} (quality ${fresh.score.toFixed(2)}) but not verified — ${check.reason} It is marked unverified for other readers.`);
      } else {
        const ok = saveLocalImage(key, img.dataUrl);
        setSelected(sel => sel && { ...sel, offData: { ...sel.offData, image: img.dataUrl, _localImage: true } });
        toast("photo", ok
          ? "Photo saved on this device only — this deployment has no write access, so it is not shared."
          : "Photo could not be saved: this browser's local storage is full.");
      }
    } catch (e) {
      console.warn("attachPhoto:", e);
      toast("photo", `Could not process that image: ${String(e?.message || e)}`);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function runDiagnostics() {
    setDiagRunning(true); setDiag(null);
    try { setDiag(await diagnoseSources()); }
    catch (e) { setDiag([{ label: "Diagnostics", ok: false, detail: String(e?.message || e), ms: 0 }]); }
    setDiagRunning(false);
  }

  // Switch picker tabs. The other database is queried on first open only, then
  // cached in picker state — reopening a tab never re-requests.
  // Checks a raw search hit against the profile, using only what the hit
  // carries. Returns a short label, or null. Deliberately conservative: no
  // ingredient text means no claim either way, never a reassurance.
  function profileFlagFor(hit) {
    if (!profile.length && !conditions.length) return null;
    const text = asText(hit.ingredients_text);
    const adds = asList(hit.additives_tags).map(a => String(a).replace(/^en:/, ""));
    if (!text && !adds.length) return null;
    const r = productRatings({
      additives: adds,
      ingredients: text,
      allergens: asList(hit.allergens_tags).map(a => String(a).replace(/^en:/, "")),
      labels: asList(hit.labels_tags),
      nutriments: {
        "sugars_100g": hit.nutriments?.["sugars_100g"],
        "salt_100g": hit.nutriments?.["salt_100g"],
        "saturated-fat_100g": hit.nutriments?.["saturated-fat_100g"],
      },
      profile, conditions,
    });
    if (r.personal.hits.length) return r.personal.hits[0].label;
    const high = r.health.find(h => h.level === "high");
    return high ? high.label : null;
  }

  async function selectPickerTab(d) {
    setPicker(p => p && { ...p, tab: d });
    setPicker(p => {
      if (p && !Array.isArray(p.results?.[d]) && pickerLoading !== d) {
        setPickerLoading(d);
        (d === "cosmetics" ? offSearch(p.query, 6, d) : foodSearchMerged(p.query, 6))
          .then(hits => setPicker(cur => cur && { ...cur, results: { ...cur.results, [d]: hits.map(h => ({ ...h, _domain: d })) } }))
          .catch(() => setPicker(cur => cur && { ...cur, results: { ...cur.results, [d]: [] } }))
          .finally(() => setPickerLoading(null));
      }
      return p;
    });
  }

  // A scanned barcode is an exact key — go straight to a scan, no picker needed
  function onBarcodeDetected(code) {
    setCameraOpen(false);
    setInput(code);
    toast("scan", `Barcode ${code} detected.`);
    scan(code);
  }

  // Continue after the user picks one of the ambiguous candidates
  async function scanCandidate(rawProduct) {
    const label = picker?.query || rawProduct.product_name || "";
    setPicker(null); setScanning(true);
    try {
      const offData = parseOFF(rawProduct);
      offData._domain = rawProduct._domain || DOMAIN;
      noteDomain(offData._domain);
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

  // Product credibility is deterministic, so it is computed rather than fetched.
  // Enhanced mode only appends researched company background — it never alters
  // the product score, which must stay reproducible.
  async function loadBrand(brand, productName, key, entry) {
    const k = key || nk(productName);
    const rec = entry || tracked.find(f => nk(f.name) === k) || fromCache("scan", k) || ghGet(k);
    if (!rec) { setBrandCred(null); setBrandCredLoading(false); return; }

    const cred = productCredibility(rec);
    setBrandCred(cred);
    // Brand figure comes from the shared database only, so it is identical
    // regardless of which product it is viewed from.
    setBrandStat(brandScoreStable(brand));

    if (!AI_MODE || !brand) { setBrandCredLoading(false); return; }

    // Company background is cached per BRAND, not per product — the same brand
    // must not be researched again for every one of its products.
    const bkey = "brand:" + (brand || "").toLowerCase().trim();
    const cachedResearch = fromCache("brand", bkey);
    if (cachedResearch !== undefined && cachedResearch !== null) {
      setBrandCred({ ...cred, brandResearch: cachedResearch });
      setBrandCredLoading(false);
      return;
    }
    setBrandCredLoading(true);
    const research = await aiBrandCredibility(brand, productName).catch(() => null);
    toCache("brand", bkey, research || {});
    setBrandCred({ ...cred, brandResearch: research || {} });
    setBrandCredLoading(false);
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
    // Always try the fallback when the primary returns nothing. A failed
    // category query is indistinguishable from a genuine no-match, and an empty
    // alternatives list helps nobody either way.
    return (await fallback()) || [];
  }

  async function resolveCalorieAlts(entry) {
    const nut = entry.offData?.nut || {};
    const viaOff = () => fetchOFFCalorieAlts(nut.energy_kcal).catch(() => []);
    const viaAssisted = () => aiCalorieAlts(entry.name, nut.energy_kcal, entry.offData?.categories?.[0], entry.risk, { fat:nut.fat, sugars:nut.sugars, protein:nut.protein, fiber:nut.fiber }).catch(() => []);
    const [primary, fallback] = AI_MODE ? [viaAssisted, viaOff] : [viaOff, viaAssisted];
    const first = await primary();
    if (first && first.length) return first;
    return (await fallback()) || [];   // same reasoning as resolveAlts
  }

  // Ratings live in the shared database alongside the scan record, so expert
  // accolades curated by one person and reviews left by another are visible to
  // everyone. Safety is recomputed locally from the additive list every time
  // rather than read from the record — a stored score could drift from the
  // CSPI table, and the table is the authority.
  function loadRatings(entry, key) {
    const k = key || nk(entry.name);
    const rec = ghGet(k) || {};
    const contributed = (rec.contributions || []).flatMap(c => c.additives || []);
    setRatings(productRatings({
      additives: entry.offData?.additives || [],     // source data only
      reportedAdditives: contributed,                // shown, never scored in
      allergens:   entry.offData?.allergens || [],
      ingredients: entry.offData?.ingredients || "",
      labels:      entry.offData?.labels || [],
      nutriments: nutFor(entry.offData?.nut),
      accolades: rec.accolades || [],
      reviews:   rec.reviews || [],
      profile, conditions,
    }));
    setCommunityRecord(entry.offData?.source === "community");
    setPhotoUnverified(!!(entry.offData?.image && rec.imageMeta && rec.imageMeta.verified !== "match"));
    // A device-only photo lives outside the shared record, so it is restored
    // here rather than arriving with the product data.
    if (!entry.offData?.image) {
      const localImg = getLocalImage(k);
      if (localImg) setSelected(sel => sel && { ...sel, offData: { ...sel.offData, image: localImg, _localImage: true } });
    }
    setContributions(rec.contributions || []);
    const mineD = (rec.contributions || []).find(c => c.by === reviewerId());
    setMyDetails({ ingredients: mineD?.ingredients || "", additives: (mineD?.additives || []).join(", "),
                   quantity: mineD?.quantity || "", category: mineD?.category || "", note: mineD?.note || "" });
    const mine = (rec.reviews || []).find(r => r.by === reviewerId());
    setMyStars(mine?.stars || 0);
    setMyReview(mine?.text || "");
    setMyReport("");
  }

  // A stable per-device id, so a person can amend their own review instead of
  // adding a second one. Not an identity claim — it only prevents one device
  // from voting repeatedly.
  function reviewerId() {
    try {
      let id = window.localStorage.getItem("hst_reviewer");
      if (!id) { id = "r" + Math.random().toString(36).slice(2, 10); window.localStorage.setItem("hst_reviewer", id); }
      return id;
    } catch { return null; }
  }

  // Product-detail contributions. Distinct from reviews: transcribing a label
  // is a factual claim about composition, not an opinion, so these CAN feed the
  // analysis — but only where the source data is missing, never overwriting it,
  // and always labelled as community-supplied and unverified.
  async function submitDetails() {
    if (!selected) return;
    const k = nk(selected.name);
    const rec = ghGet(k) || {};
    const clean = (v) => String(v || "").trim().slice(0, 2000);
    const detail = {
      by: reviewerId(),
      ingredients: clean(myDetails.ingredients),
      additives: myDetails.additives.split(",").map(x => x.trim()).filter(Boolean).slice(0, 30),
      quantity: clean(myDetails.quantity).slice(0, 60),
      category: clean(myDetails.category).slice(0, 80),
      note: clean(myDetails.note).slice(0, 500),
      ts: Date.now(),
    };
    if (!detail.ingredients && !detail.additives.length && !detail.quantity && !detail.category && !detail.note) {
      toast("details", "Nothing to add — fill at least one field.");
      return;
    }
    const contributions = Array.isArray(rec.contributions) ? [...rec.contributions] : [];
    const idx = contributions.findIndex(c => c.by && c.by === detail.by);
    if (idx >= 0) contributions[idx] = detail; else contributions.push(detail);

    await ghSet(k, { ...rec, contributions }, setDbCount);

    // Recompute safety including contributed additives, so a label transcription
    // immediately improves the rating's coverage rather than sitting unused.
    const contributed = contributions.flatMap(c => c.additives || []);
    setContributions(contributions);
    setRatings(productRatings({
      additives: selected.offData?.additives || [],
      reportedAdditives: contributed,
      allergens:   selected.offData?.allergens || [],
      ingredients: selected.offData?.ingredients || "",
      labels:      selected.offData?.labels || [],
      nutriments: nutFor(selected.offData?.nut),
      accolades: rec.accolades || [],
      reviews:   rec.reviews || [],
      profile, conditions,
    }));
    setDetailsOpen(false);
    toast("details", contributed.length
      ? "Details saved. Reported additives are shown separately as unverified — they do not change the safety score until confirmed."
      : "Details saved to the shared database.");
  }

  async function submitReview() {
    if (!selected || !myStars) return;
    const k = nk(selected.name);
    const rec = ghGet(k) || {};
    const reported = myReport.split(",").map(x => x.trim()).filter(Boolean);
    const updated = addReview(rec, { by: reviewerId(), stars: myStars, text: myReview, reportedSubstances: reported });
    await ghSet(k, { ...rec, ...updated }, setDbCount);
    setRatings(productRatings({
      additives: selected.offData?.additives || [],
      accolades: rec.accolades || [],
      reviews:   updated.reviews,
    }));
    toast("review", reported.length
      ? `Review saved. ${reported.length} substance report${reported.length !== 1 ? "s" : ""} queued for confirmation — reports are shown as unverified counts and do not change the safety score.`
      : "Review saved to the shared database.");
  }

  async function loadAlts(entry, key) {
    const k = key || nk(entry.name);
    const needsAlt = entry.risk==="high" || entry.risk==="medium" || ["c","d","e"].includes(entry.offData?.nutriScore||"");
    if (!needsAlt) return;
    const cached = fromCache("alts", k);
    if (cached) { setAlternatives(cached); return; }
    setAltLoading(true);
    const alts = await resolveAlts(entry);
    // An empty result is not worth caching — caching it meant a transient
    // failure permanently suppressed alternatives for that product.
    if (alts.length) toCache("alts", k, alts);
    setAlternatives(alts); setAltLoading(false);
    // Also persist alts to GitHub DB
    const rec = ghGet(k);
    if (rec) ghSet(k, {...rec, alts}, setDbCount);
  }

  // Open a previously-seen product instantly, without re-scanning. Checks the
  // layers in cost order: already tracked → session cache → shared database.
  // Only falls back to a live scan when the product is genuinely unknown.
  function openResult(name, opts = {}) {
    if (!name) return;
    const key = nk(name);
    const nameL = name.toLowerCase();
    setActiveTab("tracker");
    setSearchOpen(false);

    // 1. Already in this session's list — just select it
    const tracked_ = tracked.find(f =>
      nk(f.name) === key || nk(f.searchTerm || "") === key ||
      f.name.toLowerCase().includes(nameL) || nameL.includes(f.name.toLowerCase())
    );
    if (tracked_) { selectEntry(tracked_); return; }

    // 2. Session cache
    const cached = fromCache("scan", key);
    if (cached) {
      showEntry(entryFrom(cached, name, { fromCache:"session" }), key);
      toast("cache", "Session cache — instant result.");
      return;
    }

    // 3. Shared database
    const rec = ghGet(key);
    if (rec) {
      toCache("scan", key, rec);
      const entry = entryFrom(rec, name, { fromCache:"shared", hitCount:(rec.hitCount||0)+1 });
      showEntry(entry, key);
      if (rec.alts) setAlternatives(rec.alts);
      toast("shared", "From the shared database — instant result.");
      const und = undeclaredOf(rec);
      if (und > 0) toast("undeclared", `"${entry.name}" may contain ${und} substance${und!==1?"s":""} not listed on its label.`);
      return;
    }

    // 4. Not seen before — scan it, unless the caller only wants cached results
    if (opts.cachedOnly) { setInput(name); return; }
    scan(name);
  }

  function selectEntry(entry) {
    const k = nk(entry.name);
    setSelected(entry); setBrandCred(null); setBrandStat(null); setAlternatives([]); setAltLoading(false);
    loadInsight(entry.name, entry.substances, entry.offData?.nut, entry.offData, k);
    loadBrand(entry.offData?.brand, entry.name, k, entry);
    loadAlts(entry, k);
  }

  // Force-refresh: purge every cache layer (session, per-feature, shared record)
  // and rescan, so newly-added Open Food Facts data is picked up immediately.
  function rescan(e, entry) {
    if (e) e.stopPropagation();
    const term = entry.searchTerm || entry.name;
    [nk(term), nk(entry.name)].forEach(k => {
      ["scan","insight","brand","alts","calAlts","panelAlts"].forEach(store => { if (cache.current[store]) delete cache.current[store][k]; });
      if (_ghDb.products) delete _ghDb.products[k]; // a fresh result will re-save it
    });
    setTracked(p => p.filter(f => f.id !== entry.id));
    if (selected?.id === entry.id) { setSelected(null); setBrandCred(null); setBrandStat(null); }
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

  // Shortcut queries. Each maps to a real filter on the live product database,
  // so they return products the user has never scanned.
  const DISCOVERY_CHIPS = [
    { label: "No additives",     q: "products with no additives" },
    { label: "Nutri-Score A",    q: "products with good Nutri-Score" },
    { label: "Not ultra-processed", q: "unprocessed products" },
    { label: "Vegan",            q: "vegan products" },
    { label: "Organic",          q: "organic products" },
    { label: "Fragrance-free",   q: "fragrance-free products" },
  ];

  // ── SEARCH BAR ───────────────────────────────────────────────────────────────
  const SUGGESTIONS = [
    "products with good credibility","high risk products I scanned","vegan products I scanned",
    "vegetarian foods I tracked","foods with added sugars","products with E-numbers",
    "low Nutri-Score items","ultra-processed foods","brands with controversies",
  ];

  // Populate the shared database in the background when a search names a
  // product we have never analysed. One code path for both modes.
  async function bgScanFromSearch(query) {
    try {
      const { candidates, analysis, domain } = await lookupAndAnalyze(query);
      noteDomain(domain);
      // Ambiguous names are skipped rather than guessed — the user can scan
      // properly from the Hazard Tracker tab and choose the right variant.
      if (candidates) {
        setSearchRes(prev => prev ? { ...prev, savingToDb:false, answer:`Several products match "${query}". Scan it from the Tracker tab to pick the right one.` } : prev);
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

    // ── Category questions go to the live product database ──
    // "products with no additives" is a request to DISCOVER products, so it
    // must not be answered from the shared scan history — that would only ever
    // return things already seen.
    const intent = discoveryIntent(query);
    if (intent) {
      try {
        const found = await cloudDiscover(intent);
        noteDomain(intent.domain);
        if (found.length) {
          setSearchRes({
            answer: `${found.length} product${found.length!==1?"s":""} matching ${intent.labels.join(" + ")}${intent.term?` · "${intent.term}"`:""}, from ${intent.domain==="cosmetics"?"Open Beauty Facts":"Open Food Facts"}.`,
            matches: found.map(p => ({
              name: p.name + (p.brand ? ` (${p.brand})` : ""),
              reason: [
                p.nutriScore ? `Nutri-Score ${p.nutriScore.toUpperCase()}` : null,
                p.novaGroup ? `NOVA ${p.novaGroup}` : null,
                p.nut?.sugars != null ? `${p.nut.sugars}g sugar` : null,
                "not yet analysed",
              ].filter(Boolean).join(" · "),
              diet: "unknown",
            })),
            tip: "Tap any product to analyse it — the result is then saved for everyone.",
            category: "discover",
          });
          setSearchLoading(false); ghLogSearch(query, "discover");
          return;
        }
        setSearchRes({ answer:`Nothing in ${intent.domain==="cosmetics"?"Open Beauty Facts":"Open Food Facts"} matched ${intent.labels.join(" + ")}${intent.term?` for "${intent.term}"`:""}. Try a broader query.`, matches:[], tip:null, category:"discover" });
        setSearchLoading(false); ghLogSearch(query, "discover");
        return;
      } catch (e) {
        console.warn("cloudDiscover:", e);
        // Fall through to the local answer below rather than failing outright
      }
    }

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
  const filteredTracked = tracked;

  // Products already analysed — this session first, then the shared database.
  // Clicking one opens the stored result instantly instead of re-scanning.
  // Known products matching what is being typed — this is the "search" half of
  // the unified input, answered locally with no network request.
  const liveMatches = (() => {
    const q = input.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [], seen = new Set();
    const add = (name, risk, undeclared, where) => {
      const k = nk(name);
      if (seen.has(k) || !name.toLowerCase().includes(q)) return;
      seen.add(k); out.push({ key:k, name, risk, undeclared, where });
    };
    tracked.forEach(f => add(f.name, f.risk, f.undeclaredCount || 0, "this session"));
    Object.entries(_ghDb.products || {})
      .sort((a,b) => (b[1].savedAt||0) - (a[1].savedAt||0))
      .forEach(([k, rec]) => add(rec.offData?.name || k, rec.risk, undeclaredOf(rec), "shared"));
    return out.slice(0, 5);
  })();

  const recentResults = (() => {
    const out = [], seen = new Set();
    tracked.forEach(f => {
      const k = nk(f.name);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ key:k, name:f.name, risk:f.risk, undeclared:f.undeclaredCount || 0, where:"this session" });
    });
    Object.entries(_ghDb.products || {})
      .sort((a,b) => (b[1].savedAt||0) - (a[1].savedAt||0))
      .forEach(([k, rec]) => {
        const name = rec.offData?.name || k;
        const nkey = nk(name);
        if (seen.has(nkey)) return;
        seen.add(nkey);
        out.push({ key:k, name, risk:rec.risk, undeclared:undeclaredOf(rec), where:"shared" });
      });
    return out.slice(0, 6);
  })();

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
    <div style={{minHeight:"100vh",background:t.bg,color:t.text,fontFamily:"Inter,'Segoe UI',system-ui,sans-serif",overflow:isMobile?"visible":"hidden"}}>
      {/* ════ PRODUCT PICKER MODAL ════ */}
      {cameraOpen && <BarcodeScanner onDetect={onBarcodeDetected} onClose={()=>setCameraOpen(false)} t={t} isMobile={isMobile}/>}

      {/* ── ENHANCED PLAN ── */}
      {showPlan && (
        <div onClick={() => setShowPlan(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16}}>
          <div onClick={e => e.stopPropagation()} style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:16,padding:isMobile?"22px 20px":"26px 28px",width:"min(440px,100%)",maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.35)"}}>

            <div style={{fontSize:10,fontWeight:600,color:t.accent,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Enhanced analysis</div>
            <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:6}}>
              <span style={{fontSize:32,fontWeight:800,color:t.text,letterSpacing:"-1px"}}>$2</span>
              <span style={{fontSize:13,color:t.textSub}}>per week</span>
            </div>
            <div style={{fontSize:12,color:t.textSub,lineHeight:1.65,marginBottom:18}}>
              Standard analysis stays free and unlimited. Enhanced adds researched detail on top of it.
            </div>

            <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,padding:"14px 16px",marginBottom:16}}>
              {[
                ["Extended substance research", "Looks beyond the built-in database of 50 additives"],
                ["Researched brand profiles", "Company history, certifications and recall record"],
                ["Written safety summaries", "Tailored to the product rather than templated"],
                ["Wider alternative search", "Suggestions beyond the Open Food Facts category match"],
              ].map(([title, sub]) => (
                <div key={title} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:10}}>
                  <span style={{color:"#2e7d52",fontSize:13,lineHeight:1.4,flexShrink:0}}>✓</span>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:t.text}}>{title}</div>
                    <div style={{fontSize:11,color:t.textMuted,lineHeight:1.5}}>{sub}</div>
                  </div>
                </div>
              ))}
              <div style={{display:"flex",gap:10,alignItems:"flex-start",paddingTop:8,borderTop:`1px solid ${t.border}`}}>
                <span style={{color:t.textMuted,fontSize:13,flexShrink:0}}>•</span>
                <div style={{fontSize:11,color:t.textMuted,lineHeight:1.5}}>
                  Hazard detection, undeclared-substance alerts, sugar analysis and brand ratings are part of Standard and are not affected by this plan.
                </div>
              </div>
            </div>

            <div style={{display:"flex",gap:10,flexDirection:isMobile?"column-reverse":"row"}}>
              <button onClick={() => setShowPlan(false)} style={{flex:1,background:t.pill,border:`1px solid ${t.border}`,borderRadius:9,padding:"11px 16px",cursor:"pointer",fontSize:13,fontWeight:600,color:t.textSub}}>
                Stay on Standard
              </button>
              <button onClick={acceptPlan} style={{flex:1,background:t.accent,border:"none",borderRadius:9,padding:"11px 16px",cursor:"pointer",fontSize:13,fontWeight:600,color:t.accentFg}}>
                Continue — $2/week
              </button>
            </div>

            <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginTop:14,textAlign:"center"}}>
              Demonstration only — no payment is taken and no card details are collected.
            </div>
          </div>
        </div>
      )}

      {/* ── AMBIGUOUS MATCH PICKER ── */}
      {picker && (
        <div onClick={() => setPicker(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:20}}>
          <div onClick={e => e.stopPropagation()} style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:16,padding:"22px 24px",width:"min(520px,100%)",maxHeight:"80vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.35)"}}>
            {(() => {
            const results = picker.results || {};
            const rawList = results[picker.tab];
            const list = Array.isArray(rawList) ? rawList : rawList === null ? null : [];
            const loading = pickerLoading === picker.tab;
            const TABS = [{ id:"food", label:"Food", icon:"🍽️" }, { id:"cosmetics", label:"Cosmetics", icon:"🧴" }];
            return (<>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>
              {loading ? "Searching…" : `${(list || []).length} match${(list || []).length !== 1 ? "es" : ""}`}
            </div>
            <h2 style={{margin:"0 0 6px",fontSize:17,fontWeight:700,color:t.text}}>"{picker.query}"</h2>
            <div style={{fontSize:11,color:t.textSub,marginBottom:12,lineHeight:1.6}}>Browse what exists, then pick one to analyse. Food covers Open Food Facts and USDA FoodData Central; cosmetics is a separate database, so it is searched on its own tab.</div>

            {/* Food and cosmetics are different databases with different hazard
                engines, so they are tabs rather than one merged list. The
                inactive tab is only queried when opened. */}
            <div style={{display:"flex",gap:6,marginBottom:14}}>
              {TABS.map(tab => {
                const active = picker.tab === tab.id;
                const n = results[tab.id];
                return (
                  <button key={tab.id} onClick={() => selectPickerTab(tab.id)}
                    style={{flex:1,background:active?t.accent:t.pill,color:active?t.accentFg:t.textSub,border:`1px solid ${active?t.accent:t.border}`,borderRadius:8,padding:"7px 10px",cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                    <span>{tab.icon}</span>{tab.label}
                    {/* Array check, not `!== null`: an undefined slot also means
                        "not loaded", and `undefined !== null` is true — which
                        made this throw on `.length`. */}
                    {Array.isArray(n)
                      ? <span style={{opacity:0.7,fontWeight:500}}>({n.length})</span>
                      : <span style={{opacity:0.6,fontWeight:500,fontSize:10}}>· tap to search</span>}
                  </button>
                );
              })}
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {loading && <div style={{fontSize:11,color:t.textSub,padding:"14px 0",textAlign:"center"}}>Searching {picker.tab === "cosmetics" ? "Open Beauty Facts" : "Open Food Facts"}…</div>}
              {!loading && list !== null && list.length === 0 &&
                <div style={{fontSize:11,color:t.textSub,padding:"14px 0",textAlign:"center",lineHeight:1.6}}>
                  No {picker.tab} match for "{picker.query}". Try the other tab, or a more specific name.
                </div>}
              {!loading && (list || []).map((p, i) => {
                const ns = p.nutriscore_grade;
                const brand = asText(p.brands).split(",")[0].trim();
                return (
                  <button key={i} onClick={() => scanCandidate(p)} style={{textAlign:"left",background:t.surface,border:`1.5px solid ${t.border}`,borderRadius:10,padding:"11px 13px",cursor:"pointer",display:"flex",gap:12,alignItems:"center",width:"100%"}}>
                    {p.image_url
                      ? <img src={p.image_url} alt="" style={{width:44,height:44,borderRadius:6,objectFit:"contain",background:t.bgSub,flexShrink:0}}/>
                      : <div style={{width:44,height:44,borderRadius:6,background:t.bgSub,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{picker.tab === "cosmetics" ? "🧴" : "🍽️"}</div>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.product_name}</div>
                      <div style={{fontSize:10,color:t.textSub,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {brand || "Unknown brand"}{p.quantity ? ` · ${p.quantity}` : ""}
                      </div>
                      {(() => {
                        // Profile awareness in the RESULT LIST, not just after
                        // opening a product. Search was previously blind to the
                        // profile, so a reader avoiding gelatin had to open each
                        // candidate to find out. Flagged, never hidden — hiding
                        // a match could conceal the product actually in hand.
                        const hit = profileFlagFor(p);
                        if (!hit) return null;
                        return (
                          <div style={{fontSize:9,fontWeight:700,color:"#c0392b",marginTop:2}}>
                            ⚠ {hit}
                          </div>
                        );
                      })()}
                      {/* Named explicitly: a USDA record has no Nutri-Score by
                          design, and without this the missing grade looks like
                          a bug rather than a property of the source. */}
                      <div style={{fontSize:9,color:t.textMuted,marginTop:2}}>
                        {p._source === "usda" ? "USDA FoodData Central" : picker.tab === "cosmetics" ? "Open Beauty Facts" : "Open Food Facts"}
                      </div>
                    </div>
                    {ns && <span style={{fontSize:9,fontWeight:700,color:"#fff",background:NS_COLOR[ns]||"#999",padding:"2px 7px",borderRadius:4,flexShrink:0}}>{ns.toUpperCase()}</span>}
                    <span style={{fontSize:14,color:t.textMuted,flexShrink:0}}>→</span>
                  </button>
                );
              })}
            </div>
            </>);
            })()}

            <Disclaimer t={t} variant="compact"/>
            <button onClick={() => setPicker(null)} style={{marginTop:14,width:"100%",background:t.pill,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:t.textSub}}>Cancel</button>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{font-family:'Inter','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased;box-sizing:border-box}
        html,body{margin:0;padding:0;overscroll-behavior-y:none}
        button{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
        /* iOS zooms the page when a focused input is under 16px */
        @media (max-width:760px){ input,select,textarea{font-size:16px !important} button{min-height:38px} }
        @media (prefers-reduced-motion:reduce){ *{animation-duration:0.01ms !important;transition-duration:0.01ms !important} }
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
      {/* Offered exactly where the dead end happens, rather than hidden in a menu */}
      {addPrompt && !addOpen && (
        <div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:9998,padding:14,
          background:t.surface,borderTop:`1px solid ${t.border}`,boxShadow:"0 -4px 18px rgba(0,0,0,0.12)"}}>
          <div style={{maxWidth:560,margin:"0 auto",display:"flex",gap:10,alignItems:"center"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text}}>Not in any database yet</div>
              <div style={{fontSize:10,color:t.textSub,lineHeight:1.5,marginTop:2}}>
                You have the pack — adding it means the next person who scans it gets a real analysis.
              </div>
            </div>
            <button onClick={()=>{ setAddOpen(true); setAddPrompt(false); }}
              style={{flexShrink:0,padding:"9px 14px",fontSize:12,fontWeight:600,borderRadius:8,
                background:t.accent,color:t.accentFg,border:"none",cursor:"pointer"}}>Add it</button>
            <button onClick={()=>setAddPrompt(false)}
              style={{flexShrink:0,padding:"9px 10px",fontSize:12,borderRadius:8,
                background:"none",color:t.textMuted,border:"none",cursor:"pointer"}}>✕</button>
          </div>
        </div>
      )}

      <input ref={photoRef} type="file" accept="image/*" capture="environment" style={{display:"none"}}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; attachPhoto(f, selected); }}/>

      {/* ── NO INGREDIENT LIST ── raised immediately, fixable in place ── */}
      {noListFor && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10000,padding:20}}>
          <div style={{background:t.bg,borderRadius:14,padding:20,maxWidth:460,width:"100%",maxHeight:"85vh",overflowY:"auto",border:"1px solid rgba(192,57,43,0.4)"}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#c0392b",marginBottom:6}}>
              Cannot check this product
            </div>
            <h2 style={{margin:"0 0 6px",fontSize:16,fontWeight:700,color:t.text}}>
              No ingredient list for “{noListFor.name}”
            </h2>
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.65,marginBottom:12}}>
              Every check this app performs reads the ingredient list — additives, allergens, your
              conditions, everything you have chosen to avoid. Without it nothing was examined, so
              this product is <strong>unrated, not safe</strong>.
              {profile.length + conditions.length > 0 && (
                <> Your {profile.length + conditions.length} profile item{profile.length + conditions.length !== 1 ? "s" : ""} could not be checked at all.</>
              )}
            </div>

            <textarea value={noListText} onChange={e=>setNoListText(e.target.value)} rows={5}
              placeholder="Type or paste the ingredient list exactly as printed on the pack…"
              style={{width:"100%",boxSizing:"border-box",fontSize:12,padding:"10px 11px",borderRadius:8,
                border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,resize:"vertical",
                fontFamily:"inherit",lineHeight:1.5,marginBottom:8}}/>

            <div style={{fontSize:9.5,color:t.textMuted,lineHeight:1.6,marginBottom:12}}>
              Saving re-analyses the product straight away and stores the list for everyone who
              scans it afterwards. If you do not have the pack to hand, skip — the product stays
              marked unrated rather than being given a score it has not earned.
            </div>

            <div style={{display:"flex",gap:6}}>
              <button onClick={async ()=>{
                  const text = noListText.trim();
                  const target = noListFor;
                  setNoListFor(null); setNoListText("");
                  if (text) await saveIngredientsFor(target, text);
                }}
                disabled={!noListText.trim()}
                style={{flex:1,padding:"11px 0",fontSize:12,fontWeight:700,borderRadius:8,
                  cursor:noListText.trim()?"pointer":"default",
                  background:noListText.trim()?"#c0392b":t.pill,
                  color:noListText.trim()?"#fff":t.textMuted,border:"none"}}>
                Save and re-check
              </button>
              <button onClick={()=>{ setNoListFor(null); setNoListText(""); }}
                style={{padding:"11px 16px",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                  background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD A PRODUCT ── */}
      {addOpen && (
        <div onClick={()=>setAddOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:t.bg,borderRadius:14,padding:20,maxWidth:520,width:"100%",maxHeight:"88vh",overflowY:"auto",border:`1px solid ${t.border}`}}>
            <h2 style={{margin:"0 0 4px",fontSize:16,fontWeight:700,color:t.text}}>Add a product</h2>
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.6,marginBottom:14}}>
              For products no open database has yet — regional brands, small producers, local
              formulations. You have the pack in your hand, which makes you a better source than
              anything we can query. Copy the label as printed.
            </div>

            <div style={{display:"flex",gap:6,marginBottom:10}}>
              {[["food","🍽️ Food"],["cosmetics","🧴 Cosmetic"]].map(([k,l]) => (
                <button key={k} onClick={()=>setNewProduct(p=>({...p,domain:k}))}
                  style={{flex:1,padding:"8px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                    background:newProduct.domain===k?t.accent:t.pill,
                    color:newProduct.domain===k?t.accentFg:t.textSub,
                    border:`1px solid ${newProduct.domain===k?t.accent:t.border}`}}>{l}</button>
              ))}
            </div>

            {[["name","Product name (required)","input"],
              ["brand","Brand","input"],
              ["code","Barcode digits — lets others find it by scanning","input"],
              ["quantity","Pack size, e.g. 250 ml","input"],
              ["category","Category, e.g. greek yogurt / face cream","input"],
              ["ingredients","Full ingredient list, copied from the pack","textarea"],
              ["additives","E-numbers or additive names (comma separated)","input"],
              ["allergens","Declared allergens (comma separated)","input"],
              ["labels","Claims on the pack: organic, vegan, gluten-free…","input"],
            ].map(([k,ph,kind]) => kind==="textarea" ? (
              <textarea key={k} rows={3} value={newProduct[k]} placeholder={ph}
                onChange={e=>setNewProduct(p=>({...p,[k]:e.target.value}))}
                style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"8px 10px",borderRadius:7,
                  border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,resize:"vertical",
                  fontFamily:"inherit",marginBottom:7}}/>
            ) : (
              <input key={k} value={newProduct[k]} placeholder={ph}
                inputMode={k==="code"?"numeric":undefined}
                onChange={e=>setNewProduct(p=>({...p,[k]: k==="code" ? e.target.value.replace(/\D/g,"") : e.target.value}))}
                style={{width:"100%",boxSizing:"border-box",fontSize:11,padding:"8px 10px",borderRadius:7,
                  border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,marginBottom:7}}/>
            ))}

            <input ref={addPhotoRef} type="file" accept="image/*" capture="environment" style={{display:"none"}}
              onChange={async e => {
                const f = e.target.files?.[0]; e.target.value = "";
                if (!f) return;
                try { setAddPhoto(await compressImage(f)); } catch { /* ignore bad file */ }
              }}/>
            {addPhoto ? (
              <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
                <img src={addPhoto.dataUrl} alt="" style={{width:64,height:64,objectFit:"cover",borderRadius:8,border:`1px solid ${t.border}`}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,color:t.text,fontWeight:600}}>Photo attached</div>
                  <div style={{fontSize:9.5,color:t.textMuted}}>{addPhoto.w}×{addPhoto.h}, {Math.round(addPhoto.bytes/1024)} KB after compression</div>
                </div>
                <button onClick={()=>setAddPhoto(null)}
                  style={{fontSize:11,padding:"6px 10px",borderRadius:7,background:t.pill,color:t.textSub,border:`1px solid ${t.border}`,cursor:"pointer"}}>Remove</button>
              </div>
            ) : (
              <button onClick={()=>addPhotoRef.current?.click()}
                style={{width:"100%",padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                  background:t.pill,color:t.textSub,border:`1px dashed ${t.border}`,marginBottom:8}}>
                📷 Add a photo of the pack
              </button>
            )}

            {/* Photo, in the same form. Adding a product without one leaves an
                unidentifiable record, and the pack is in the user's hand now. */}
            <input ref={newPhotoRef} type="file" accept="image/*" capture="environment" style={{display:"none"}}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setNewPhoto(f); }}/>
            <button onClick={() => newPhotoRef.current?.click()}
              style={{width:"100%",padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                background:newPhoto?`${t.accent}18`:t.pill, color:newPhoto?t.accent:t.textSub,
                border:`1px solid ${newPhoto?t.accent:t.border}`,marginBottom:7}}>
              {newPhoto ? `✓ Photo attached (${Math.round(newPhoto.size/1024)} KB) — tap to change` : "📷 Add a photo of the pack"}
            </button>

            <div style={{fontSize:9.5,color:t.textMuted,lineHeight:1.6,margin:"6px 0 12px"}}>
              The ingredient list is what the hazard analysis reads, so it matters most. Nutri-Score
              and NOVA stay blank — those are computed by Open Food Facts from data this form does
              not collect, and a guessed grade would be worse than none.
              <br /><br />
              Consider also adding it to <strong>openfoodfacts.org</strong>. That benefits every app
              using the data, not just this one — here it lives only in this database.
            </div>

            <div style={{display:"flex",gap:6}}>
              <button onClick={submitNewProduct} disabled={!newProduct.name.trim()}
                style={{flex:1,padding:"10px 0",fontSize:12,fontWeight:600,borderRadius:8,
                  cursor:newProduct.name.trim()?"pointer":"default",
                  background:newProduct.name.trim()?t.accent:t.pill,
                  color:newProduct.name.trim()?t.accentFg:t.textMuted,border:"none"}}>
                Add and analyse
              </button>
              <button onClick={()=>setAddOpen(false)}
                style={{padding:"10px 16px",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                  background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── LOCATION PICKER ── */}
      {marketOpen && (
        <div onClick={()=>setMarketOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:t.bg,borderRadius:14,padding:20,maxWidth:420,width:"100%",maxHeight:"80vh",overflowY:"auto",border:`1px solid ${t.border}`}}>
            <h2 style={{margin:"0 0 4px",fontSize:16,fontWeight:700,color:t.text}}>Where do you shop?</h2>
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.6,marginBottom:14}}>
              Alternatives and discovery are drawn from this market. Open Food Facts began in
              France and its coverage still leans European, so without this the suggestions are
              products you cannot buy. If nothing local matches, the search widens and those
              results are labelled.
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {Object.entries(MARKETS).map(([k,m]) => {
                const on = market === k;
                return (
                  <button key={k} onClick={()=>{ changeMarket(k); setMarketOpen(false); }}
                    style={{textAlign:"left",padding:"9px 11px",borderRadius:8,fontSize:12,fontWeight:on?700:500,
                      background:on?t.accent:t.surface,color:on?t.accentFg:t.text,
                      border:`1px solid ${on?t.accent:t.border}`,cursor:"pointer"}}>
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── PROFILE ── */}
      {profilePanel && (
        <div onClick={()=>setProfilePanel(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:t.bg,borderRadius:14,padding:20,maxWidth:520,width:"100%",maxHeight:"85vh",overflowY:"auto",border:`1px solid ${t.border}`}}>
            <h2 style={{margin:"0 0 4px",fontSize:16,fontWeight:700,color:t.text}}>Your profile</h2>
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.6,marginBottom:16}}>
              Every product is checked against this. It changes what <em>you</em> are warned
              about and never changes a product's score for anyone else. Stored on this device
              only — health information is not uploaded to the shared database.
            </div>

            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:t.textSub,marginBottom:4}}>Health conditions</div>
            <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginBottom:8}}>
              These change which nutrient levels are flagged — sugar for diabetes, salt for blood
              pressure, phosphates for kidney disease — using the UK FSA per-100 g bands.
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:18}}>
              {Object.entries(HEALTH_CONDITIONS).map(([key,c]) => {
                const on = conditions.includes(key);
                return (
                  <button key={key} onClick={()=>toggleCondition(key)} title={c.note}
                    style={{fontSize:11,fontWeight:600,padding:"7px 12px",borderRadius:8,cursor:"pointer",
                      background:on?t.accent:t.pill,color:on?t.accentFg:t.textSub,
                      border:`1px solid ${on?t.accent:t.border}`}}>
                    {c.label}
                  </button>
                );
              })}
            </div>

            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:t.textSub,marginBottom:4}}>Allergies &amp; sensitivities</div>
            <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginBottom:8}}>
              Specific substances you react to. An “organic” or “natural” claim describes farming,
              not tolerability — these are flagged regardless of what the front of pack says.
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {Object.entries(SENSITIVITY_GROUPS).map(([key,g]) => {
                const on = profile.includes(key);
                return (
                  <button key={key} onClick={()=>toggleSensitivity(key)} title={g.note}
                    style={{fontSize:11,fontWeight:600,padding:"7px 12px",borderRadius:8,cursor:"pointer",
                      background:on?"#c0392b":t.pill,color:on?"#fff":t.textSub,
                      border:`1px solid ${on?"#c0392b":t.border}`}}>
                    {g.label}
                  </button>
                );
              })}
            </div>

            <div style={{fontSize:10,color:t.textMuted,lineHeight:1.6,marginTop:16,borderTop:`1px solid ${t.border}`,paddingTop:12}}>
              Guidance, not medical advice, and not a substitute for reading the pack. If you have
              a diagnosed allergy or a clinician's dietary limits, those take precedence over
              anything shown here.
            </div>
            <button onClick={()=>setProfilePanel(false)}
              style={{marginTop:12,width:"100%",padding:"10px 0",fontSize:12,fontWeight:600,borderRadius:8,
                background:t.accent,color:t.accentFg,border:"none",cursor:"pointer"}}>Done</button>
          </div>
        </div>
      )}

      <header style={{background:t.header,borderBottom:`1px solid ${t.border}`,padding:isMobile?"10px 14px":"12px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:isMobile?8:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,background:t.accent,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span style={{fontSize:13,fontWeight:800,color:"#fff",letterSpacing:"-0.5px"}}>HST</span>
          </div>
          <div>
            <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:2}}>Hazard Substance Tracker</div>
            <h1 style={{margin:0,fontSize:"clamp(14px,2vw,19px)",fontWeight:800,color:t.text,letterSpacing:"-0.4px"}}>{APP_TITLE_LEAD} <span style={{color:t.accent}}>{APP_TITLE_ACCENT}</span></h1>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>

          {/* DETECTED DOMAIN — reflects the last product, not a user choice */}
          <div title={domain==="cosmetics"?"Assessed against SCCS and CIR (cosmetics)":"Assessed against EFSA and JECFA (food)"} style={{display:"flex",alignItems:"center",gap:6,background:t.pill,border:`1px solid ${t.border}`,borderRadius:20,padding:isMobile?"5px 10px":"5px 12px"}}>
            <span style={{fontSize:12}}>{domain==="cosmetics"?"🧴":"🍽️"}</span>
            <span style={{fontSize:10,fontWeight:600,color:t.textSub}}>{domain==="cosmetics"?"SCCS · CIR":"EFSA · JECFA"}</span>
          </div>

          {/* LOCATION — sets which market alternatives are drawn from */}
          <button onClick={()=>setMarketOpen(true)} title={`Alternatives are drawn from ${MARKETS[market]?.label}`}
            style={{background:t.pill,border:`1px solid ${t.border}`,borderRadius:20,padding:isMobile?"5px 10px":"6px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:13}}>🌐</span>
            <span style={{fontSize:11,fontWeight:600,color:t.textSub}}>{MARKETS[market]?.label || "Anywhere"}</span>
          </button>

          {/* PROFILE — conditions and sensitivities, stored on this device */}
          <button onClick={()=>setProfilePanel(true)}
            title="Health conditions and sensitivities — checked against every product"
            style={{background:(conditions.length||profile.length)?`${t.accent}18`:t.pill,
              border:`1.5px solid ${(conditions.length||profile.length)?t.accent:t.border}`,
              borderRadius:20,padding:isMobile?"5px 10px":"6px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:13}}>🧬</span>
            <span style={{fontSize:11,fontWeight:600,color:(conditions.length||profile.length)?t.accent:t.textSub}}>
              {conditions.length+profile.length ? `Profile · ${conditions.length+profile.length}` : "Profile"}
            </span>
          </button>

          {/* ANALYSIS MODE TOGGLE */}
          <button onClick={toggleAI} title={aiMode?"Enhanced analysis: extended research and generated insights":"Standard analysis (free). Enhanced is $2/week."} style={{background:aiMode?`${t.accent}18`:t.pill,border:`1.5px solid ${aiMode?t.accent:t.border}`,borderRadius:20,padding:"6px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all 0.25s"}}>
            <span style={{fontSize:11,fontWeight:600,color:aiMode?t.accent:t.textSub}}>{aiMode?"Enhanced":"Standard"}</span>
            {!aiMode && !subscribed && <span style={{fontSize:9,fontWeight:600,color:t.textMuted,background:t.pill,border:`1px solid ${t.border}`,padding:"1px 5px",borderRadius:4}}>$2/wk</span>}
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
        {tabBtn("tracker","Tracker")}
        {tabBtn("alternatives","Alternatives")}
        {tabBtn("brands","Brand Rankings")}
      </div>

      {/* ════ TRACKER TAB ════ */}
      {activeTab==="tracker" && (
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"minmax(260px,320px) 1fr",height:isMobile?"auto":"calc(100vh - 109px)",minHeight:isMobile?"calc(100vh - 109px)":undefined}}>

          {/* LEFT PANEL */}
          <div style={{background:t.leftBg,borderRight:`1px solid ${t.border}`,display:"flex",flexDirection:"column",overflow:"hidden",position:"relative"}}>
            <div style={{padding:"16px 16px 10px"}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text,marginBottom:3}}>Search for a product</div>
              <div style={{fontSize:11,color:t.textMuted,marginBottom:10}}>Food and cosmetics — the type is detected automatically.</div>
              <div style={{display:"flex",gap:7,position:"relative"}}>
                <input value={input}
                  onChange={e=>{setInput(e.target.value); setInputFocus(true);}}
                  onFocus={e=>{e.target.style.borderColor=t.accent; setInputFocus(true);}}
                  onBlur={e=>{e.target.style.borderColor=t.inputBorder; setTimeout(()=>setInputFocus(false),150);}}
                  onKeyDown={e=>{ if(e.key==="Enter") submitQuery(); if(e.key==="Escape") setInputFocus(false); }}
                  disabled={scanning} placeholder="Product name or barcode…" style={{flex:1,minWidth:0,border:`1.5px solid ${t.inputBorder}`,borderRadius:9,padding:"10px 13px",fontSize:13,outline:"none",background:t.inputBg,color:t.inputText}}/>
                <button onClick={()=>setCameraOpen(true)} disabled={scanning} title="Scan a barcode with the camera" aria-label="Scan a barcode with the camera" style={{flexShrink:0,width:42,border:`1.5px solid ${t.inputBorder}`,borderRadius:9,background:t.inputBg,cursor:scanning?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:scanning?0.5:1}}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={t.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8V5.5A1.5 1.5 0 014.5 4H7M17 4h2.5A1.5 1.5 0 0121 5.5V8M21 16v2.5a1.5 1.5 0 01-1.5 1.5H17M7 20H4.5A1.5 1.5 0 013 18.5V16"/>
                    <path d="M7 8.5v7M10 8.5v7M13.5 8.5v7M17 8.5v7"/>
                  </svg>
                </button>
              </div>
              {/* Already-analysed matches, shown live so a known product opens
                  instantly instead of being re-scanned */}
              {inputFocus && liveMatches.length > 0 && (
                <div style={{marginTop:6,border:`1px solid ${t.border}`,borderRadius:9,background:t.surface,overflow:"hidden",maxHeight:210,overflowY:"auto"}}>
                  <div style={{padding:"7px 12px 4px",fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase"}}>Already analysed</div>
                  {liveMatches.map(r => (
                    <div key={r.key} onMouseDown={()=>{ setInput(""); setInputFocus(false); openResult(r.name); }}
                      style={{padding:"8px 12px",display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:t.text}}
                      onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov}
                      onMouseLeave={e=>e.currentTarget.style.background=""}>
                      <span style={{width:6,height:6,borderRadius:"50%",background:r.risk?RISK_CFG[r.risk]?.fg:t.borderMed,flexShrink:0}}/>
                      <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.name}>{r.name}</span>
                      {r.undeclared>0 && <span style={{fontSize:9,color:"#c0392b",flexShrink:0}}>⚠</span>}
                      <span style={{fontSize:9,color:t.textMuted,flexShrink:0}}>{r.where}</span>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={()=>submitQuery()} disabled={scanning||!input.trim()} style={{marginTop:8,width:"100%",background:scanning?t.pill:t.accent,border:"none",color:scanning?t.textMuted:t.accentFg,padding:"11px",borderRadius:9,cursor:scanning||!input.trim()?"default":"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:!input.trim()&&!scanning?0.45:1,transition:"all 0.2s"}}>
                {scanning?<><span style={{display:"inline-block",width:13,height:13,border:`2px solid ${t.textMuted}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Working…</>:"Search"}
              </button>
              {/* Discovery shortcuts — these query the live product database,
                  not just what has already been scanned */}
              <div style={{marginTop:11}}>
                <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:6}}>Discover</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {DISCOVERY_CHIPS.map(c => (
                    <button key={c.label} onClick={()=>{ setInput(c.q); submitQuery(c.q); }} disabled={scanning}
                      style={{fontSize:10,fontWeight:500,color:t.textSub,background:t.pill,border:`1px solid ${t.border}`,padding:"4px 10px",borderRadius:14,cursor:scanning?"default":"pointer",opacity:scanning?0.5:1}}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Data source check — reports each endpoint separately, so a
                  failure can be told apart from an empty result. */}
              <div style={{marginTop:11,borderTop:`1px solid ${t.border}`,paddingTop:10}}>
                <button onClick={runDiagnostics} disabled={diagRunning}
                  style={{fontSize:10,fontWeight:600,color:t.textSub,background:t.pill,border:`1px solid ${t.border}`,padding:"5px 11px",borderRadius:7,cursor:diagRunning?"default":"pointer",opacity:diagRunning?0.6:1}}>
                  {diagRunning ? "Checking data sources…" : "Check data sources"}
                </button>
                {diag && (
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                    {diag.map(d => (
                      <div key={d.label} style={{display:"flex",gap:7,alignItems:"flex-start",fontSize:10,lineHeight:1.5}}>
                        <span style={{flexShrink:0,color:d.ok?"#2e7d52":"#c0392b",fontWeight:700}}>{d.ok?"✓":"✕"}</span>
                        <div style={{minWidth:0}}>
                          <div style={{color:t.text,fontWeight:600}}>{d.label}</div>
                          <div style={{color:d.ok?t.textMuted:"#c0392b",wordBreak:"break-word"}}>{d.detail} · {d.ms}ms</div>
                        </div>
                      </div>
                    ))}
                    <div style={{fontSize:9,color:t.textMuted,marginTop:3,lineHeight:1.6}}>
                      Probes run one at a time to stay under the 10 requests/minute limit, so this takes a few seconds.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* PRODUCT LIST */}
            <div style={{flex:1,overflowY:isMobile?"visible":"auto",padding:"8px"}}>
              {scanning && (
                <div style={{padding:"12px",marginBottom:4,background:dark?"rgba(61,82,196,0.08)":"rgba(61,82,196,0.05)",border:`1px solid ${dark?"rgba(61,82,196,0.18)":"rgba(61,82,196,0.12)"}`,borderRadius:9,fontSize:11,color:t.accent,display:"flex",alignItems:"center",gap:8,animation:"pulse 1.2s infinite"}}>
                  <span style={{display:"inline-block",width:10,height:10,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite",flexShrink:0}}/>
                  <div><div>Scanning "{input}"…</div><div style={{fontSize:9,color:t.textMuted,marginTop:2}}>Shared DB → {domainLabel()} → {AI_MODE?"Enhanced analysis":"Safety engine"}</div></div>
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
                    <div key={i} onClick={()=>openResult(alt.name)} title={`Analyse ${alt.name}`} style={{background:t.cardBg,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:8,padding:"11px 12px",cursor:"pointer",transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov} onMouseLeave={e=>e.currentTarget.style.background=t.cardBg}>
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
          <div style={{overflowY:isMobile?"visible":"auto",padding:isMobile?"14px 14px 28px":"18px 22px",background:t.rightBg}}>
            {/* SEARCH / DISCOVERY RESULTS — shown above any selected product */}
            {(searchLoading || searchRes) && (
              <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,marginBottom:14,overflow:"hidden"}}>
                <div style={{padding:"12px 18px",borderBottom:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                  <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase"}}>
                    {searchRes?.category === "discover" ? "Discovered products" : "Search results"}
                  </div>
                  <button onClick={()=>{setSearchRes(null);setSearchQ("");}} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:15,lineHeight:1,padding:0}}>×</button>
                </div>
                {searchLoading ? (
                  <div style={{padding:"18px",display:"flex",alignItems:"center",gap:9,fontSize:12,color:t.textSub}}>
                    <span style={{display:"inline-block",width:13,height:13,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>
                    Searching the product database…
                  </div>
                ) : (
                  <>
                    <div style={{padding:"14px 18px"}}>
                      <p style={{margin:0,fontSize:13,color:t.text,lineHeight:1.7,overflowWrap:"anywhere"}}>{searchRes.answer}</p>
                      {searchRes.savingToDb && <div style={{marginTop:8,fontSize:11,color:t.textMuted,display:"flex",alignItems:"center",gap:7}}><span style={{display:"inline-block",width:10,height:10,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Analysing…</div>}
                    </div>
                    {searchRes.matches?.length > 0 && (
                      <div>
                        <div style={{padding:"4px 18px 6px",fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase"}}>
                          {searchRes.category === "discover" ? "Tap to analyse" : "Matching items"}
                        </div>
                        {searchRes.matches.slice(0,8).map((m,i) => (
                          <div key={i} onClick={()=>openResult((m.name||"").replace(/\s*\([^)]*\)\s*$/, "").trim())}
                            style={{padding:"9px 18px",borderTop:`1px solid ${t.tableBorder}`,cursor:"pointer",display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}
                            onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov}
                            onMouseLeave={e=>e.currentTarget.style.background=""}>
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:12,fontWeight:600,color:t.text,overflowWrap:"anywhere"}}>{m.name}</div>
                              <div style={{fontSize:11,color:t.textSub,lineHeight:1.5,overflowWrap:"anywhere"}}>{m.reason}</div>
                            </div>
                            <span style={{fontSize:13,color:t.textMuted,flexShrink:0}}>→</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchRes.tip && (
                      <div style={{padding:"10px 18px",borderTop:`1px solid ${t.border}`,background:t.bgSub,fontSize:11,color:t.textSub,lineHeight:1.6}}>{searchRes.tip}</div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Discovery results — live from the product catalogue, not from
                what has already been scanned */}
            {(discover || discoverLoading) && !selected ? (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:14}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:4}}>
                      From {discover?.domain === "cosmetics" ? "Open Beauty Facts" : "Open Food Facts"} — live catalogue
                    </div>
                    <div style={{fontSize:17,fontWeight:700,color:t.text,letterSpacing:"-0.3px"}}>
                      {discoverLoading ? "Searching the catalogue…" : `${discover?.count?.toLocaleString?.() || discover?.products?.length || 0} products match`}
                    </div>
                    {discover?.applied?.length > 0 && (
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:7}}>
                        {discover.applied.map(a => (
                          <span key={a} style={{fontSize:10,fontWeight:600,color:t.accent,background:`${t.accent}14`,border:`1px solid ${t.accent}30`,padding:"2px 9px",borderRadius:5}}>{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={()=>setDiscover(null)} style={{background:t.pill,border:`1px solid ${t.border}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:600,color:t.textSub,flexShrink:0}}>Clear</button>
                </div>

                {discoverLoading ? (
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {[0,1,2,3].map(i => <div key={i} style={{height:58,background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,animation:"shimmer 1.4s ease infinite"}}/>)}
                  </div>
                ) : (discover?.products?.length || 0) === 0 ? (
                  <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"36px 22px",textAlign:"center"}}>
                    <div style={{fontSize:13,fontWeight:600,color:t.text,marginBottom:5}}>
                      {discover?.failed ? "The catalogue could not be reached" : "No products matched those filters"}
                    </div>
                    <div style={{fontSize:11,color:t.textMuted,lineHeight:1.7}}>
                      {/* The real error is shown, not a generic line. "Check the
                          connection" was actively misleading when the cause was
                          a deprecated endpoint or an exhausted rate limit. */}
                      {discover?.failed
                        ? (discover.error || "The filter query failed and no fallback returned data.")
                        : "Try a broader query, or scan a specific product by name or barcode."}
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(260px,1fr))",gap:9}}>
                      {discover.products.map((p,i) => (
                        <div key={i} onClick={()=>{ setDiscover(null); scan(p.name); }} title={`Analyse ${p.name}`}
                          style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,padding:"11px 13px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}
                          onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov}
                          onMouseLeave={e=>e.currentTarget.style.background=t.surface}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12.5,fontWeight:600,color:t.text,overflowWrap:"anywhere",lineHeight:1.4}}>{p.name}</div>
                            {p.brand && <div style={{fontSize:10,color:t.textSub,marginTop:2}}>{p.brand}</div>}
                          </div>
                          {p.nutriScore && <span style={{fontSize:9,fontWeight:700,color:"#fff",background:NS_COLOR[p.nutriScore]||"#999",padding:"2px 7px",borderRadius:4,flexShrink:0}}>{p.nutriScore.toUpperCase()}</span>}
                          <span style={{fontSize:13,color:t.textMuted,flexShrink:0}}>→</span>
                        </div>
                      ))}
                    </div>
                    {discover.hasMore && (
                      <button onClick={loadMoreDiscover} disabled={discoverMore}
                        style={{width:"100%",marginTop:11,padding:"11px 0",fontSize:12,fontWeight:600,borderRadius:9,
                          background:t.pill,color:t.textSub,border:`1px solid ${t.border}`,
                          cursor:discoverMore?"default":"pointer",opacity:discoverMore?0.6:1}}>
                        {discoverMore ? "Loading…" : `Show more (${discover.products.length} of ${discover.count?.toLocaleString?.() || "?"} shown)`}
                      </button>
                    )}
                    <Disclaimer t={t} variant="compact"/>
                    <div style={{fontSize:10,color:t.textMuted,lineHeight:1.7,marginTop:12}}>
                      Filtered directly on {discover.domain === "cosmetics" ? "Open Beauty Facts" : "Open Food Facts"} — these are not limited to previously scanned products. Select one to run a full analysis.
                      {!discover.hasMore && discover.products.length > 12 && " That is every match for these filters."}
                    </div>
                  </>
                )}
              </div>
            ) : !selected ? (
              <div style={{position:"relative",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                <FoodBg/>
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",userSelect:"none"}}>
                  <span style={{fontSize:"clamp(100px,20vw,200px)",fontWeight:800,color:t.text,opacity:dark?0.03:0.04,letterSpacing:"-6px",lineHeight:1,animation:"hstFade 5s ease-in-out infinite"}}>HST</span>
                </div>
                <div style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:16,maxWidth:380,textAlign:"center"}}>
                  <div style={{width:68,height:68,background:t.accent,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 20px ${t.accent}35`}}>
                    <span style={{fontSize:22,fontWeight:800,color:"#fff",letterSpacing:"-1px"}}>HST</span>
                  </div>
                  <div><div style={{fontSize:20,fontWeight:700,color:t.text,marginBottom:5,letterSpacing:"-0.3px"}}>Hazard Substance Tracker</div><div style={{fontSize:12,color:t.textMuted,fontWeight:500}}>Open Food Facts · Hazard Analysis · Product Credibility · Shared Database</div></div>
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
              <OFFCard cosmeticAnalysis={selected?.cosmetic} brandStat={brandStat} onOpen={openResult} offData={selected.offData} aiSugarData={selected.aiSugarData} substances={selected.substances} insight={insight} insightLoading={insightLoading} brandCred={brandCred} brandCredLoading={brandCredLoading} alternatives={alternatives} altLoading={altLoading} diet={selected.diet||"unknown"} t={t} dark={dark}
                onAddPhoto={()=>photoRef.current?.click()} photoBusy={photoBusy}
                ratingsPanel={<RatingsPanel ratings={ratings} t={t} myStars={myStars} setMyStars={setMyStars}
                  myReview={myReview} setMyReview={setMyReview} myReport={myReport} setMyReport={setMyReport}
                  onSubmit={submitReview} communityRecord={communityRecord} photoUnverified={photoUnverified} onAddIngredients={openIngredientsForm}
                  ingredientsFocus={ingredientsFocus} onSaveIngredients={saveIngredientsAndReanalyse}
                  freshness={staleness(selected)} onRefresh={() => refreshProduct(selected)} refreshing={refreshing}
                  contributions={contributions} detailsOpen={detailsOpen} setDetailsOpen={setDetailsOpen}
                  myDetails={myDetails} setMyDetails={setMyDetails} onSubmitDetails={submitDetails}
                  profile={profile} toggleSensitivity={toggleSensitivity}
                  profileOpen={profileOpen} setProfileOpen={setProfileOpen}/>}/>
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
          <div style={{overflowY:"auto",height:isMobile?"auto":"calc(100vh - 109px)",minHeight:isMobile?"calc(100vh - 109px)":undefined,background:t.bg,padding:isMobile?"16px 14px":"20px 24px"}}>
            <div style={{maxWidth:1100,margin:"0 auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12,marginBottom:16}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Ranked by disclosure and hazard record across all known products</div>
                  <div style={{fontSize:19,fontWeight:800,color:t.text,letterSpacing:"-0.4px"}}>Brand Rankings</div>
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
                  <div style={{fontSize:12,color:t.textMuted,lineHeight:1.7}}>Scan branded products in the Tracker tab.<br/>Ratings build automatically from every scan — yours and everyone else's.</div>
                </div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
                  {brands.map((b, rank) => {
                    const sc = scoreColor(b.score);
                    const arc = (b.score/10)*251;
                    return (
                      <div key={b.brand} style={{background:t.surface,border:`1px solid ${t.border}`,borderLeft:`3px solid ${sc}`,borderRadius:12,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                        <div style={{padding:"14px 16px",borderBottom:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                          <div style={{minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:7,minWidth:0}}>
                              <span style={{fontSize:10,fontWeight:800,color:t.textMuted,fontFamily:"monospace",flexShrink:0}}>#{rank+1}</span>
                              <span style={{fontSize:15,fontWeight:700,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.brand}</span>
                            </div>
                            <div style={{fontSize:10,color:t.textSub,marginTop:2}}>Rated across {b.count} product{b.count!==1?"s":""}</div>
                            {b.subBrands?.length > 0 && (
                              <div style={{fontSize:10,color:t.textMuted,marginTop:3,overflowWrap:"anywhere"}}>
                                incl. {b.subBrands.slice(0,4).join(", ")}{b.subBrands.length>4?` +${b.subBrands.length-4}`:""}
                              </div>
                            )}
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
        <div style={{overflowY:"auto",height:isMobile?"auto":"calc(100vh - 109px)",minHeight:isMobile?"calc(100vh - 109px)":undefined,background:t.bg}}>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"minmax(280px,340px) 1fr",height:isMobile?"auto":"100%"}}>
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
                          <div key={i} onClick={()=>openResult(alt.name)} title={`Analyse ${alt.name}`} style={{background:t.surface,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:12,overflow:"hidden",cursor:"pointer"}}>
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
                              <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:8}}>
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

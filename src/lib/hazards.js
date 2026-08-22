// Food hazard engine: the curated additive/contaminant database and the
// deterministic rules that match it against an ingredient list. Free — no
// API calls, so this is the baseline every scan gets regardless of mode.
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


export { SEED, ADDITIVE_DB, CONTAMINANT_RULES, localHazards, GI_TABLE, localSugar, localInsight };

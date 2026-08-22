import { getRisk } from "../lib/theme.js";

// Cosmetics engine: INCI-list parsing and the CIR/SCCS-referenced hazard,
// pH, delivery-system and formulation analysis. Kept strictly apart from the
// food engine — topical limits must never be applied to ingestion.
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

export { COSMETIC_DB, FRAGRANCE_ALLERGENS, DELIVERY_SYSTEMS, STABILISER_CLASSES, splitINCI, cosmeticHazards, fragranceAllergensIn, phAnalysis, deliverySystemsIn, stabiliserAnalysis, formulationAnalysis, cosmeticCredibility, analyzeCosmetic };

// ─── RATINGS ───────────────────────────────────────────────────────────────────
// Three separate things that must never be mixed:
//
//   1. SAFETY   — what is in the product (CSPI Chemical Cuisine tiers).
//   2. QUALITY  — what experts judged (awards, critic scores, lab results).
//   3. OPINION  — what customers think (community reviews).
//
// They answer different questions and have different evidentiary weight. A
// product can be delicious, award-winning and still contain an additive CSPI
// rates "Avoid". Averaging those into one number would hide exactly the fact
// this app exists to surface, so they are computed and displayed separately.

// ─── 1. CSPI CHEMICAL CUISINE ──────────────────────────────────────────────────
// CSPI rates additives in five tiers: Safe, Cut back, Certain people should
// avoid, Caution, Avoid. Ratings are CSPI's editorial judgement of the
// scientific evidence, not a regulatory status — an additive can be legal in
// the US and still be rated "Avoid".
//
// This table is a CURATED SUBSET transcribed from CSPI's published ratings,
// covering the additives most common on labels. It is not the complete
// database, and CSPI revises ratings as evidence changes. `cspiTier` returns
// null for anything not listed rather than guessing a tier — an unknown
// additive is reported as unrated, never as safe.
export const CSPI_TIERS = {
  avoid:      { rank: 5, label: "Avoid",                       short: "Avoid" },
  caution:    { rank: 4, label: "Caution",                     short: "Caution" },
  sensitive:  { rank: 3, label: "Certain people should avoid", short: "Some should avoid" },
  cutback:    { rank: 2, label: "Cut back",                    short: "Cut back" },
  safe:       { rank: 1, label: "Safe",                        short: "Safe" },
};

export const CSPI_ADDITIVES = {
  // ── Avoid ──
  e123:  { tier: "avoid", name: "Amaranth (Red 2)", why: "Banned in the US; evidence of carcinogenicity." },
  e131:  { tier: "avoid", name: "Patent Blue V", why: "Allergic reactions; banned in some countries." },
  e142:  { tier: "avoid", name: "Green S", why: "Poorly tested dye." },
  e171:  { tier: "avoid", name: "Titanium dioxide", why: "Genotoxicity concerns; banned as a food additive in the EU." },
  e173:  { tier: "avoid", name: "Aluminium", why: "Neurotoxicity concerns at high intake." },
  e239:  { tier: "avoid", name: "Hexamethylene tetramine", why: "Releases formaldehyde." },
  e249:  { tier: "avoid", name: "Potassium nitrite", why: "Forms carcinogenic nitrosamines in cured meat." },
  e250:  { tier: "avoid", name: "Sodium nitrite", why: "Forms carcinogenic nitrosamines in cured meat." },
  e251:  { tier: "avoid", name: "Sodium nitrate", why: "Converts to nitrite; nitrosamine formation." },
  e252:  { tier: "avoid", name: "Potassium nitrate", why: "Converts to nitrite; nitrosamine formation." },
  e320:  { tier: "avoid", name: "BHA", why: "Reasonably anticipated to be a human carcinogen (US NTP)." },
  e321:  { tier: "caution", name: "BHT", why: "Related to BHA; evidence more mixed." },
  e924:  { tier: "avoid", name: "Potassium bromate", why: "Carcinogen; banned in many countries." },
  e952:  { tier: "avoid", name: "Cyclamate", why: "Banned in the US; cancer concerns." },
  e954:  { tier: "avoid", name: "Saccharin", why: "Bladder tumours in rodents." },
  e951:  { tier: "avoid", name: "Aspartame", why: "IARC classified as possibly carcinogenic (2B) in 2023." },
  e128:  { tier: "avoid", name: "Red 2G", why: "Banned in the EU; carcinogenicity concerns." },
  e110:  { tier: "avoid", name: "Sunset Yellow FCF (Yellow 6)", why: "Hyperactivity in children; contamination concerns." },
  e129:  { tier: "avoid", name: "Allura Red AC (Red 40)", why: "Hyperactivity in children; most-used US dye." },
  e102:  { tier: "avoid", name: "Tartrazine (Yellow 5)", why: "Hyperactivity in children; allergic reactions." },
  e133:  { tier: "avoid", name: "Brilliant Blue FCF (Blue 1)", why: "Poorly tested; hyperactivity concerns." },
  e132:  { tier: "avoid", name: "Indigotine (Blue 2)", why: "Poorly tested dye." },
  e127:  { tier: "avoid", name: "Erythrosine (Red 3)", why: "Thyroid tumours in rats; FDA revoked its use." },
  e104:  { tier: "avoid", name: "Quinoline Yellow", why: "Hyperactivity in children." },
  e122:  { tier: "avoid", name: "Carmoisine", why: "Hyperactivity in children." },
  e124:  { tier: "avoid", name: "Ponceau 4R", why: "Hyperactivity in children." },

  // ── Caution ──
  e150c: { tier: "caution", name: "Caramel colour III", why: "May contain 4-MEI, a carcinogen in animal studies." },
  e150d: { tier: "caution", name: "Caramel colour IV", why: "May contain 4-MEI, a carcinogen in animal studies." },
  e310:  { tier: "caution", name: "Propyl gallate", why: "Inadequately tested; possible tumour link." },
  e385:  { tier: "caution", name: "EDTA", why: "Binds minerals; limited long-term data." },
  e405:  { tier: "caution", name: "Propylene glycol alginate", why: "Limited testing." },
  e432:  { tier: "caution", name: "Polysorbate 20", why: "Emulsifier; gut microbiome concerns." },
  e433:  { tier: "caution", name: "Polysorbate 80", why: "Emulsifier; gut microbiome concerns." },
  e466:  { tier: "caution", name: "Carboxymethylcellulose", why: "Emulsifier; gut microbiome concerns." },
  e407:  { tier: "caution", name: "Carrageenan", why: "Intestinal inflammation in animal studies." },
  e950:  { tier: "caution", name: "Acesulfame potassium", why: "Inadequately tested." },
  e955:  { tier: "caution", name: "Sucralose", why: "Possible gut and genotoxicity signals." },
  e553b: { tier: "caution", name: "Talc", why: "Purity concerns." },
  e512:  { tier: "caution", name: "Stannous chloride", why: "Tin compound; limited data." },
  e284:  { tier: "caution", name: "Boric acid", why: "Toxicity at low doses." },

  // ── Certain people should avoid ──
  e220:  { tier: "sensitive", name: "Sulphur dioxide", why: "Severe reactions in asthmatics." },
  e221:  { tier: "sensitive", name: "Sodium sulphite", why: "Sulphite sensitivity, asthma." },
  e222:  { tier: "sensitive", name: "Sodium bisulphite", why: "Sulphite sensitivity, asthma." },
  e223:  { tier: "sensitive", name: "Sodium metabisulphite", why: "Sulphite sensitivity, asthma." },
  e224:  { tier: "sensitive", name: "Potassium metabisulphite", why: "Sulphite sensitivity, asthma." },
  e226:  { tier: "sensitive", name: "Calcium sulphite", why: "Sulphite sensitivity, asthma." },
  e621:  { tier: "sensitive", name: "Monosodium glutamate", why: "Headache and flushing in sensitive people." },
  e627:  { tier: "sensitive", name: "Disodium guanylate", why: "Purine source — relevant in gout." },
  e631:  { tier: "sensitive", name: "Disodium inosinate", why: "Purine source — relevant in gout." },
  e120:  { tier: "sensitive", name: "Carmine / cochineal", why: "Rare but severe allergic reactions." },
  e160b: { tier: "sensitive", name: "Annatto", why: "Allergic reactions in some people." },
  e330:  { tier: "safe", name: "Citric acid", why: "Widely used, well tolerated." },
  e953:  { tier: "sensitive", name: "Isomalt", why: "Laxative effect in quantity." },
  e965:  { tier: "sensitive", name: "Maltitol", why: "Laxative effect in quantity." },
  e420:  { tier: "sensitive", name: "Sorbitol", why: "Laxative effect in quantity." },
  e421:  { tier: "sensitive", name: "Mannitol", why: "Laxative effect in quantity." },
  e967:  { tier: "sensitive", name: "Xylitol", why: "Laxative effect; toxic to dogs." },

  // ── Cut back ──
  e211:  { tier: "cutback", name: "Sodium benzoate", why: "Can form benzene with vitamin C." },
  e202:  { tier: "cutback", name: "Potassium sorbate", why: "Generally well tolerated; limit exposure." },
  e621b: { tier: "cutback", name: "Salt", why: "Excess intake raises blood pressure." },
  e500:  { tier: "safe", name: "Sodium bicarbonate", why: "Well established." },

  // ── Safe (common, listed so they can be shown as cleared rather than unknown) ──
  e300:  { tier: "safe", name: "Ascorbic acid (vitamin C)", why: "Nutrient and antioxidant." },
  e306:  { tier: "safe", name: "Tocopherols (vitamin E)", why: "Natural antioxidant." },
  e322:  { tier: "safe", name: "Lecithin", why: "Common emulsifier from soy or sunflower." },
  e440:  { tier: "safe", name: "Pectin", why: "Fruit-derived gelling agent." },
  e412:  { tier: "safe", name: "Guar gum", why: "Plant thickener." },
  e415:  { tier: "safe", name: "Xanthan gum", why: "Fermentation-derived thickener." },
  e296:  { tier: "safe", name: "Malic acid", why: "Fruit acid." },
  e270:  { tier: "safe", name: "Lactic acid", why: "Fermentation acid." },
  e160a: { tier: "safe", name: "Beta-carotene", why: "Vitamin A precursor." },
  e100:  { tier: "safe", name: "Curcumin", why: "Turmeric-derived colour." },
  e162:  { tier: "safe", name: "Beetroot red", why: "Vegetable colour." },
  e14xx: { tier: "safe", name: "Modified starch", why: "Widely used thickener." },
};

// Normalises the many ways an additive can be written into the table's key.
export function additiveKey(raw) {
  const s = String(raw || "").toLowerCase().trim();
  const m = s.match(/e\s*-?\s*(\d{3}[a-z]?)/i);
  if (m) return "e" + m[1].toLowerCase();
  return s.replace(/[^a-z0-9]/g, "");
}

export function cspiTier(additive) {
  const rec = CSPI_ADDITIVES[additiveKey(additive)];
  return rec || null;   // null = not in the curated subset, NOT "safe"
}

// Assesses a product against the CSPI tiers.
// Returns a 1–10 score where 10 is cleanest, plus the reasoning behind it.
export function cspiAssess(additives = []) {
  const rated = [], unrated = [];
  for (const a of additives) {
    const rec = cspiTier(a);
    if (rec) rated.push({ additive: a, ...rec, rank: CSPI_TIERS[rec.tier].rank });
    else unrated.push(a);
  }

  const counts = { avoid: 0, caution: 0, sensitive: 0, cutback: 0, safe: 0 };
  rated.forEach(r => { counts[r.tier]++; });

  // Penalties are per-tier and additive, because two "Avoid" additives are
  // meaningfully worse than one. The worst single tier also sets a ceiling: a
  // product containing anything CSPI rates "Avoid" cannot score as clean
  // regardless of how many safe ingredients sit alongside it.
  let score = 10
    - counts.avoid     * 3.0
    - counts.caution   * 1.5
    - counts.sensitive * 0.7
    - counts.cutback   * 0.4;

  const ceiling = counts.avoid > 0 ? 4 : counts.caution > 0 ? 6.5 : counts.sensitive > 0 ? 8 : 10;
  score = Math.max(1, Math.min(score, ceiling));

  const worst = rated.length
    ? rated.reduce((w, r) => (r.rank > w.rank ? r : w), rated[0])
    : null;

  return {
    score: Math.round(score * 10) / 10,
    worstTier: worst?.tier || null,
    worstLabel: worst ? CSPI_TIERS[worst.tier].label : null,
    counts,
    rated: rated.sort((a, b) => b.rank - a.rank),
    unrated,
    // Confidence is about coverage, not correctness: many unrated additives
    // means the score reflects only part of what is in the product.
    coverage: additives.length ? rated.length / additives.length : 1,
  };
}

// ─── 2. SCORE NORMALISATION ────────────────────────────────────────────────────
// Expert scores arrive in incompatible formats. Everything is converted to a
// 1–10 scale so scores can sit side by side.
//
// Two conversions deserve explanation:
//  - Medals are ordinal, not interval. Gold is better than Silver, but "how
//    much" is undefined, so they map to representative points and are marked
//    lower-precision.
//  - 100-point critic scales are compressed in practice (almost nothing scores
//    below 50), so a linear map would make a mediocre 60 look like a 6/10. The
//    conversion rescales from a realistic floor instead.

const LETTER_SCALE = {
  "a+": 10, a: 9.5, "a-": 9, "b+": 8.5, b: 8, "b-": 7.5,
  "c+": 7, c: 6.5, "c-": 6, "d+": 5, d: 4.5, "d-": 4, f: 2,
};

const MEDAL_SCALE = {
  "grand gold": 10, "great gold": 10, platinum: 10,
  gold: 9, "silver gold": 8.5, silver: 7.5, bronze: 6.5,
  "3 star": 10, "3 stars": 10, "2 star": 8.5, "2 stars": 8.5, "1 star": 7,
  commended: 6, "highly commended": 7, finalist: 6, winner: 9,
  pass: 6, certified: 6, fail: 1,
};

export function normalizeScore(raw, format = "auto") {
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase().trim();

  const out = (value, precision, note) => ({
    value: Math.max(1, Math.min(10, Math.round(value * 10) / 10)),
    precision,          // "high" | "medium" | "low" — ordinal inputs are low
    note,
    raw: String(raw),
  });

  // Explicit "x/y" — the most common and least ambiguous form
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const [n, d] = [parseFloat(frac[1]), parseFloat(frac[2])];
    if (d === 100) return out(rescale100(n), "high", "100-point scale, rescaled from a 50-point floor");
    return out((n / d) * 10, "high", `${d}-point scale`);
  }

  // Stars: "4.5 stars", "★★★★"
  const starGlyphs = (s.match(/★/g) || []).length;
  if (starGlyphs) return out((starGlyphs / 5) * 10, "medium", "star rating out of 5");
  const starNum = s.match(/^(\d(?:\.\d)?)\s*(?:\/\s*5)?\s*stars?$/);
  if (starNum) return out((parseFloat(starNum[1]) / 5) * 10, "medium", "star rating out of 5");

  // Percentage
  const pct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) return out(rescale100(parseFloat(pct[1])), "high", "percentage, rescaled from a 50-point floor");

  // Letter grade
  if (LETTER_SCALE[s] != null) return out(LETTER_SCALE[s], "medium", "letter grade");

  // Medal / award tier
  for (const [k, v] of Object.entries(MEDAL_SCALE)) {
    if (s === k || s.startsWith(k + " ") || s.endsWith(" " + k)) {
      return out(v, "low", "award tier — ordinal, so the spacing between medals is indicative only");
    }
  }

  // Bare number: infer the scale from magnitude
  const num = parseFloat(s);
  if (!Number.isNaN(num)) {
    if (format === "100" || num > 20) return out(rescale100(num), "high", "assumed 100-point scale");
    if (format === "20" || num > 10) return out((num / 20) * 10, "high", "assumed 20-point scale");
    if (num <= 5 && format === "5") return out((num / 5) * 10, "medium", "assumed 5-point scale");
    return out(num, "high", "assumed 10-point scale");
  }

  return null;   // unrecognised — better than a wrong number
}

// Critic 100-point scales bottom out around 50 in practice. Mapping linearly
// would rate a genuinely poor 55 as 5.5/10, i.e. "average". Rescaling from a
// 50 floor keeps the output meaningful across the range actually used.
function rescale100(n) {
  if (n <= 50) return 1 + (n / 50) * 1;      // 0–50 compresses into 1–2
  return 2 + ((n - 50) / 50) * 8;            // 50–100 spans 2–10
}

// ─── 3. ACCOLADE AGGREGATION ───────────────────────────────────────────────────
// Sources differ in rigour. A blind laboratory panel is stronger evidence than
// a trade competition that awards a medal to most entrants, so sources carry
// weights. Weights are a judgement call and are shown to the user rather than
// hidden inside the number.
export const ACCOLADE_SOURCES = {
  lab:         { label: "Laboratory analysis",   weight: 1.0 },
  critic:      { label: "Professional critic",   weight: 0.8 },
  competition: { label: "Competition / medal",   weight: 0.6 },
  panel:       { label: "Consumer panel test",   weight: 0.7 },
  certifier:   { label: "Certification body",    weight: 0.5 },
};

export function aggregateAccolades(accolades = []) {
  const scored = accolades
    .map(a => {
      const n = normalizeScore(a.score, a.format);
      if (!n) return null;
      const src = ACCOLADE_SOURCES[a.sourceType] || { label: a.sourceType || "Other", weight: 0.5 };
      // Low-precision inputs (medals) are down-weighted again — an ordinal
      // award should not outvote a numeric lab result.
      const precisionFactor = n.precision === "high" ? 1 : n.precision === "medium" ? 0.85 : 0.7;
      return { ...a, normalized: n, sourceLabel: src.label, weight: src.weight * precisionFactor };
    })
    .filter(Boolean);

  if (!scored.length) return { score: null, count: 0, items: [] };

  const totalW = scored.reduce((s, a) => s + a.weight, 0);
  const score = scored.reduce((s, a) => s + a.normalized.value * a.weight, 0) / totalW;

  return {
    score: Math.round(score * 10) / 10,
    count: scored.length,
    items: scored.sort((a, b) => b.weight - a.weight),
    // One award is one opinion. Stated plainly so a single medal is not read
    // as a settled verdict.
    thin: scored.length < 3,
  };
}

// ─── 4. COMMUNITY REVIEWS ──────────────────────────────────────────────────────
// Customer ratings are opinion. They are aggregated and displayed, and they
// deliberately DO NOT alter the safety assessment: a product does not become
// safer because people enjoy it, and a CSPI "Avoid" additive is a fact about
// composition that a vote cannot change.
//
// What community input CAN do is flag a substance the label omits. That is a
// factual report, not a preference, so it is routed into the undeclared-
// substance queue for confirmation instead of into the score.

export const REVIEW_MIN = 1, REVIEW_MAX = 5;

export function addReview(existing, review) {
  const reviews = Array.isArray(existing?.reviews) ? [...existing.reviews] : [];
  const stars = Math.max(REVIEW_MIN, Math.min(REVIEW_MAX, Number(review.stars) || 0));
  if (!stars) return existing || { reviews: [] };

  // One review per reviewer per product: a resubmission replaces the old one
  // rather than stacking, so a single person cannot move the average by repeat
  // voting from the same device.
  const idx = reviews.findIndex(r => r.by && review.by && r.by === review.by);
  const entry = {
    by: review.by || null,
    stars,
    text: (review.text || "").slice(0, 500),
    reportedSubstances: (review.reportedSubstances || []).slice(0, 10),
    ts: Date.now(),
  };
  if (idx >= 0) reviews[idx] = entry; else reviews.push(entry);
  return { ...(existing || {}), reviews };
}

export function summariseReviews(reviews = []) {
  if (!reviews.length) return { count: 0, average: null, score: null, distribution: null, reports: [] };

  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviews.forEach(r => { if (dist[r.stars] != null) dist[r.stars]++; });
  const average = reviews.reduce((s, r) => s + r.stars, 0) / reviews.length;

  // Substance reports are tallied per substance. A single report is an
  // unverified claim; the count is surfaced so the threshold for taking it
  // seriously is the reader's to set, not hidden in a boolean.
  const tally = {};
  reviews.forEach(r => (r.reportedSubstances || []).forEach(sub => {
    const k = String(sub).toLowerCase().trim();
    if (k) tally[k] = (tally[k] || 0) + 1;
  }));

  return {
    count: reviews.length,
    average: Math.round(average * 10) / 10,
    score: Math.round((average / 5) * 10 * 10) / 10,   // on the shared 1–10 scale
    distribution: dist,
    reports: Object.entries(tally).map(([substance, n]) => ({ substance, count: n }))
                   .sort((a, b) => b.count - a.count),
    // Below this, an average is noise. Shown rather than suppressed, but
    // labelled, so a 5.0 from one reviewer is not mistaken for consensus.
    thin: reviews.length < 5,
  };
}

// ─── COMBINED VIEW ─────────────────────────────────────────────────────────────
// Returns the three scores side by side. Deliberately NOT a single number:
// combining safety with taste would let a well-reviewed product mask a
// composition problem, which is the failure mode this app exists to prevent.
export function productRatings({ additives = [], accolades = [], reviews = [] } = {}) {
  const safety = cspiAssess(additives);
  const expert = aggregateAccolades(accolades);
  const community = summariseReviews(reviews);
  return {
    safety, expert, community,
    // The headline stays safety-led. Quality and opinion sit alongside it.
    headline: { score: safety.score, basis: "CSPI Chemical Cuisine additive tiers" },
  };
}

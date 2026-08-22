import { DOMAIN } from "../lib/config.js";
import { cosmeticCredibility } from "./cosmetics.js";
import { _ghDb } from "../api/githubDb.js";

// Brand ownership, per-product credibility, and the stable brand score
// (computed only from the shared database, so it never drifts with what you
// have scanned this session).
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
  const { score, verdict, thin } = brandScoreOf(agg);
  return { ...agg, score, verdict, thin, identity, isParent: identity.toLowerCase() !== brand.toLowerCase().trim(), subBrands: [...subBrands] };
}

// ─── BRAND RATINGS (aggregate scoring) ─────────────────────────────────────
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
  // Same convention as Expert accolades (ratings.js: `thin: scored.length < 3`)
  // — a handful of graded items should not read with the same confidence as a
  // large sample. Without this, one product with a couple of undeclared
  // substances or a Nutri-Score E can swing an entire brand — including a
  // large, generally reputable one — to a flat 0/10 "Concerning" off a single
  // data point, which is a confidence problem, not a finding about the brand.
  return { score, verdict, thin: b.count < 3 };
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


export { PARENT_COMPANY, parentOf, ratingIdentity, brandChain, productCredibility, brandScoreStable, undeclaredOf, brandScoreOf, computeBrandStats, brandHistory };

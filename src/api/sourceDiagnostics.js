import { OFF_HOST, offJson, offSearch, offSearchSAL, offSearchLegacy, OffNotFound, OffRateLimited, asText } from "./openFoodFacts.js";
import { usdaSearch } from "./usda.js";
import { currentMarket, marketTag } from "./market.js";
import { filterSearch } from "./filteredSearch.js";

// Which sources to query for a given market, the merged OFF+USDA food
// search, and a diagnostic probe of every endpoint — so a dead endpoint, a
// rate limit and a genuinely empty catalogue are never reported the same way.

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

export { EUROPEAN_MARKETS, sourcePlan, foodSearchMerged, sleep, probeEndpoint, diagnoseSources };

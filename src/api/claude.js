import { lastText } from "../lib/theme.js";
import { AI_MODE } from "../lib/config.js";

// Enhanced-mode AI calls (Claude, via the direct API in-workspace or the
// /api/claude proxy on Vercel). Every one of these degrades to an empty/
// unknown result on failure — Enhanced mode only ever ADDS to the free
// deterministic baseline, never replaces it.
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

export { WEB, MODEL, callAI, aiHazards, aiSugar, aiBrandCredibility, aiDietClassify, aiInsight, aiAlternatives, aiCalorieAlts };

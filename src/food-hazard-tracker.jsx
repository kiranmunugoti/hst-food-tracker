import { useState, useRef } from "react";

// ─── HAZARD DB ────────────────────────────────────────────────────────────────
const SEED_DB = {
  glyphosate:{name:"Glyphosate",category:"Pesticide",risk:"high",eNumber:null,foods:["wheat","oats","corn","soybeans","barley"],effects:"Potential carcinogen (Group 2A), gut microbiome disruption",limit:"0.1 mg/kg (EU)"},
  lead:{name:"Lead",category:"Heavy Metal",risk:"high",eNumber:null,foods:["leafy greens","root vegetables","rice","canned foods","wine"],effects:"Neurotoxic, affects brain development",limit:"0.02 mg/kg"},
  mercury:{name:"Mercury",category:"Heavy Metal",risk:"high",eNumber:null,foods:["tuna","swordfish","shark","king mackerel"],effects:"Neurotoxin, dangerous for pregnant women",limit:"0.5 mg/kg"},
  arsenic:{name:"Arsenic",category:"Heavy Metal",risk:"high",eNumber:null,foods:["rice","apple juice","seafood","chicken"],effects:"Carcinogen, cardiovascular disease risk",limit:"0.01 mg/L"},
  acrylamide:{name:"Acrylamide",category:"Process Contaminant",risk:"high",eNumber:null,foods:["french fries","potato chips","coffee","toast","cookies"],effects:"Probable carcinogen, neurotoxic at high doses",limit:"No official limit (ALARA)"},
  aflatoxin:{name:"Aflatoxin B1",category:"Mycotoxin",risk:"high",eNumber:null,foods:["peanuts","corn","tree nuts","dried fruits","spices"],effects:"Potent carcinogen, liver damage",limit:"2 µg/kg (EU)"},
  bpa:{name:"Bisphenol A (BPA)",category:"Packaging Chemical",risk:"medium",eNumber:null,foods:["canned goods","plastic-packaged foods","bottled water"],effects:"Endocrine disruptor, developmental effects",limit:"0.04 µg/kg bw/day (EFSA)"},
  pfas:{name:"PFAS (Forever Chemicals)",category:"Packaging Chemical",risk:"high",eNumber:null,foods:["microwave popcorn","fast food wrappers","non-stick cookware"],effects:"Immune suppression, cancer risk, hormone disruption",limit:"4 ng/L (EPA)"},
  e102:{name:"Tartrazine",category:"Artificial Dye",risk:"medium",eNumber:"E102",foods:["soft drinks","candy","snacks","desserts"],effects:"Hyperactivity in children, allergic reactions",limit:"7.5 mg/kg bw/day"},
  e110:{name:"Sunset Yellow FCF",category:"Artificial Dye",risk:"medium",eNumber:"E110",foods:["orange drinks","candy","cereals","baked goods"],effects:"Hyperactivity, allergic reactions",limit:"4 mg/kg bw/day"},
  e211:{name:"Sodium Benzoate",category:"Preservative",risk:"medium",eNumber:"E211",foods:["soft drinks","fruit juices","condiments","pickles"],effects:"Reacts with Vit C to form benzene; hyperactivity",limit:"5 mg/kg (beverages)"},
  e249:{name:"Potassium Nitrite",category:"Preservative",risk:"high",eNumber:"E249",foods:["cured meats","bacon","ham","sausages"],effects:"Forms nitrosamines, linked to colorectal cancer",limit:"150 mg/kg"},
  e250:{name:"Sodium Nitrite",category:"Preservative",risk:"high",eNumber:"E250",foods:["hot dogs","bacon","deli meats","sausage"],effects:"Converts to nitrosamines; colorectal cancer risk",limit:"150 mg/kg"},
  e407:{name:"Carrageenan",category:"Thickener",risk:"medium",eNumber:"E407",foods:["dairy products","chocolate milk","infant formula","deli meats"],effects:"Intestinal inflammation, possible carcinogen (degraded form)",limit:"Not established"},
  e951:{name:"Aspartame",category:"Artificial Sweetener",risk:"medium",eNumber:"E951",foods:["diet sodas","sugar-free gum","low-calorie desserts"],effects:"Possible carcinogen (IARC Group 2B, 2023)",limit:"40 mg/kg bw/day"},
  e171:{name:"Titanium Dioxide",category:"Colour",risk:"high",eNumber:"E171",foods:["confectionery","chewing gum","chocolate","donuts"],effects:"Possible carcinogen (IARC Group 2B); banned in EU foods 2022",limit:"BANNED in EU (2022)"},
  e621:{name:"MSG",category:"Flavour Enhancer",risk:"low",eNumber:"E621",foods:["instant noodles","chips","fast food","soups"],effects:"Headaches in sensitive individuals; generally regarded as safe",limit:"No ADI (GRAS)"},
  bha:{name:"BHA",category:"Preservative",risk:"medium",eNumber:"E320",foods:["chips","crackers","cereals","butter"],effects:"Possible carcinogen, endocrine disruptor",limit:"0.02% of fat content"},
};

// ─── PALETTE — restrained, warm monochrome ────────────────────────────────────
// Accent: slate-indigo. Risk: muted earth tones instead of bold primaries.
const RISK = {
  high:   { fg:"#c0392b", bg:"rgba(192,57,43,0.08)",   border:"rgba(192,57,43,0.18)",   dot:"#c0392b" },
  medium: { fg:"#b07d2b", bg:"rgba(176,125,43,0.08)",  border:"rgba(176,125,43,0.18)",  dot:"#d4a017" },
  low:    { fg:"#2e7d52", bg:"rgba(46,125,82,0.08)",   border:"rgba(46,125,82,0.18)",   dot:"#2e7d52" },
  none:   { fg:"#3d6b99", bg:"rgba(61,107,153,0.08)",  border:"rgba(61,107,153,0.18)",  dot:"#3d6b99" },
};

const NS_COLOR = { a:"#2e7d52", b:"#4a9060", c:"#b07d2b", d:"#a0622a", e:"#c0392b" };
const NOVA_COLOR = { 1:"#2e7d52", 2:"#4a9060", 3:"#b07d2b", 4:"#c0392b" };
const NOVA_DESC = { 1:"Unprocessed / minimally processed", 2:"Processed culinary ingredients", 3:"Processed foods", 4:"Ultra-processed products" };

function tlColor(type, v){
  if(v===null||v===undefined) return "#999";
  const thresholds = {
    fat:    [17.5, 3],
    satfat: [5, 1.5],
    sugars: [22.5, 11.25],
    salt:   [1.5, 0.75],
  };
  const [hi, med] = thresholds[type] || [999,999];
  return v >= hi ? "#c0392b" : v >= med ? "#b07d2b" : "#2e7d52";
}
function tlLabel(type, v){
  if(v===null||v===undefined) return "";
  const thresholds = { fat:[17.5,3], satfat:[5,1.5], sugars:[22.5,11.25], salt:[1.5,0.75] };
  const [hi, med] = thresholds[type] || [999,999];
  return v >= hi ? "High" : v >= med ? "Medium" : "Low";
}
function fmt(v, d=1){
  if(v===null||v===undefined) return "—";
  return typeof v === "number" ? v.toFixed(v < 0.1 ? 2 : d) : v;
}
function getRisk(subs){
  if(subs.some(s=>s.risk==="high")) return "high";
  if(subs.some(s=>s.risk==="medium")) return "medium";
  if(subs.length===0) return null;
  return "low";
}

// ─── DIET CONFIG ──────────────────────────────────────────────────────────────
const DIET = {
  vegan:       { label:"Vegan",        icon:"🌱", fg:"#2d7a45", bg:"rgba(45,122,69,0.09)",  border:"rgba(45,122,69,0.22)",  accent:"#2d7a45" },
  vegetarian:  { label:"Vegetarian",   icon:"🥦", fg:"#4a8c2a", bg:"rgba(74,140,42,0.08)",  border:"rgba(74,140,42,0.2)",   accent:"#4a8c2a" },
  pescatarian: { label:"Pescatarian",  icon:"🐟", fg:"#1a6e8a", bg:"rgba(26,110,138,0.08)", border:"rgba(26,110,138,0.2)",  accent:"#1a6e8a" },
  meat:        { label:"Meat-based",   icon:"🥩", fg:"#8a3a1a", bg:"rgba(138,58,26,0.08)",  border:"rgba(138,58,26,0.2)",   accent:"#8a3a1a" },
  unknown:     { label:"Unknown",      icon:"❓", fg:"#7a7670", bg:"rgba(122,118,112,0.06)", border:"rgba(122,118,112,0.15)", accent:"#7a7670" },
};

// ─── THEME TOKENS ─────────────────────────────────────────────────────────────
function makeTheme(dark){
  return dark ? {
    bg:"#111213", bgSub:"#161819", surface:"#1c1e21", surfaceHov:"#202226",
    border:"#2a2d33", borderMed:"#353840", text:"#e8e9eb", textSub:"#8a8f9a",
    textMuted:"#555b68", accent:"#6b7cff", accentFg:"#fff",
    header:"#161819", tabBg:"#161819", leftBg:"#161819", rightBg:"#111213",
    inputBg:"#1c1e21", inputBorder:"#2a2d33", inputText:"#e8e9eb",
    cardBg:"#1c1e21", cardBorder:"#2a2d33", cardSel:"#1e2028", cardSelBorder:"#6b7cff",
    tableTh:"#1a1c20", tableBorder:"#252830", scoresBg:"#181a1e",
    pill:"#222530", pillText:"#6e7585", footerBg:"#161819",
    scanBtn:"#6b7cff", scanBtnHov:"#7d8cff",
  } : {
    bg:"#f6f5f3", bgSub:"#f0eeec", surface:"#ffffff", surfaceHov:"#fafaf9",
    border:"#e8e6e2", borderMed:"#d4d0cb", text:"#1a1917", textSub:"#6b6760",
    textMuted:"#a09c97", accent:"#3d52c4", accentFg:"#fff",
    header:"#ffffff", tabBg:"#ffffff", leftBg:"#ffffff", rightBg:"#f6f5f3",
    inputBg:"#ffffff", inputBorder:"#e0ddd8", inputText:"#1a1917",
    cardBg:"#fafaf9", cardBorder:"#e8e6e2", cardSel:"#f8f7ff", cardSelBorder:"#3d52c4",
    tableTh:"#f4f2ef", tableBorder:"#ece9e4", scoresBg:"#f9f8f6",
    pill:"#eeecea", pillText:"#7a7670", footerBg:"#f0eeec",
    scanBtn:"#3d52c4", scanBtnHov:"#4a60d4",
  };
}

// ─── OPEN FOOD FACTS proxy ────────────────────────────────────────────────────
// External image URLs (openfoodfacts.org, etc.) are blocked by egress policy.
// We ask Claude to fetch the product image and return it as a base64 data URL
// so it can be embedded directly without any browser network request.
async function fetchImageAsBase64(imageUrl){
  if(!imageUrl) return null;
  try{
    const r = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"claude-sonnet-4-20250514", max_tokens:2000,
        tools:[{"type":"web_search_20250305","name":"web_search"}],
        messages:[{role:"user",content:`Fetch the image at this URL and return it as a base64 data URL string I can use in an <img> src attribute: ${imageUrl}. Return ONLY the data URL string starting with "data:image/" — nothing else, no explanation, no markdown.`}]
      })
    });
    const d = await r.json();
    const txt = (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
    if(txt.startsWith("data:image/")) return txt;
    return null;
  }catch{ return null; }
}

async function fetchOFF(query){
  const isBarcode=/^\d{8,14}$/.test(query.trim());
  const nutFields = '{"energy-kcal_100g":null,"energy_100g":null,"fat_100g":null,"saturated-fat_100g":null,"carbohydrates_100g":null,"sugars_100g":null,"added-sugars_100g":null,"fiber_100g":null,"proteins_100g":null,"salt_100g":null,"sodium_100g":null,"sugars_serving":null,"added-sugars_serving":null,"energy-kcal_serving":null,"fat_serving":null,"carbohydrates_serving":null,"proteins_serving":null,"salt_serving":null}';
  const prompt = isBarcode
    ? `Look up the Open Food Facts product with barcode "${query.trim()}". Use web search to find it. Return ONLY a JSON object (no markdown): {"product_name":"","brands":"","image_url":"direct CDN image URL or null","nutriscore_grade":null,"nova_group":null,"ecoscore_grade":null,"quantity":null,"serving_size":null,"ingredients_text":null,"additives_tags":[],"allergens_tags":[],"labels_tags":[],"categories_tags":[],"nutriments":${nutFields}}`
    : `Search Open Food Facts for "${query}". Pick the best match. Return ONLY a JSON object (no markdown): {"product_name":"","brands":"","image_url":"direct CDN image URL or null","nutriscore_grade":null,"nova_group":null,"ecoscore_grade":null,"quantity":null,"serving_size":null,"ingredients_text":null,"additives_tags":[],"allergens_tags":[],"labels_tags":[],"categories_tags":[],"nutriments":${nutFields}}`;
  try{
    const r = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:2000,
        tools:[{"type":"web_search_20250305","name":"web_search"}],
        messages:[{role:"user",content:prompt}]
      })
    });
    const d = await r.json();
    const txt = (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
    const match = txt.match(/\{[\s\S]*\}/);
    if(!match) return null;
    const p = JSON.parse(match[0]);
    if(!p.product_name) return null;

    // Fetch image as base64 so it works despite egress restrictions
    let imageData = null;
    if(p.image_url){
      imageData = await fetchImageAsBase64(p.image_url);
    }

    return parseOFF({...p, image_url: imageData});
  }catch(e){ console.warn("OFF error",e); return null; }
}

function parseOFF(p){
  const n = p.nutriments||{};
  const g = (k,...alts) => { for(const key of[k,...alts]){ if(n[key]!==undefined&&n[key]!==null&&n[key]!=="") return Number(n[key]); } return null; };
  return {
    name: p.product_name||"Unknown",
    brand: (p.brands||"").split(",")[0].trim()||null,
    image: p.image_url||null,
    quantity: p.quantity||null,
    servingSize: p.serving_size||null,
    nutriScore: p.nutriscore_grade?.toLowerCase()||null,
    novaGroup: p.nova_group?Number(p.nova_group):null,
    ecoScore: p.ecoscore_grade?.toLowerCase()||null,
    ingredients: p.ingredients_text||null,
    additives: (p.additives_tags||[]).map(a=>a.replace(/^en:/,"")),
    allergens: (p.allergens_tags||[]).map(a=>a.replace(/^en:/,"")),
    labels: (p.labels_tags||[]).map(l=>l.replace(/^en:/,"")),
    categories: (p.categories_tags||[]).slice(0,4).map(c=>c.replace(/^en:/,"")),
    nut:{
      energy_kcal: g("energy-kcal_100g","energy-kcal"),
      energy_kj:   g("energy_100g","energy-kj_100g"),
      fat:         g("fat_100g"),
      saturated:   g("saturated-fat_100g"),
      carbs:       g("carbohydrates_100g"),
      sugars:      g("sugars_100g"),
      added_sugars:g("added-sugars_100g","added_sugars_100g"),
      fiber:       g("fiber_100g","fibers_100g"),
      protein:     g("proteins_100g"),
      salt:        g("salt_100g"),
      sodium:      g("sodium_100g"),
      sugars_srv:       g("sugars_serving"),
      added_sugars_srv: g("added-sugars_serving"),
      energy_srv:       g("energy-kcal_serving"),
      fat_srv:          g("fat_serving"),
      carbs_srv:        g("carbohydrates_serving"),
      protein_srv:      g("proteins_serving"),
      salt_srv:         g("salt_serving"),
    }
  };
}

// ─── AI HELPERS ───────────────────────────────────────────────────────────────
const WEB = [{"type":"web_search_20250305","name":"web_search"}];
function lastText(d){ return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).reverse()[0]||""; }

async function aiHazards(name, ingredients){
  try{
    const hasIngr = !!(ingredients && ingredients.trim().length > 10);
    const ctx = hasIngr
      ? `Product: "${name}". Ingredient list from label: "${ingredients.slice(0,800)}"`
      : `Product name only (no ingredient list): "${name}"`;
    const rule = hasIngr
      ? `STRICT RULE: Only flag substances ACTUALLY PRESENT in the ingredient list. Map each finding to a specific ingredient. Do NOT add theoretical or category-level concerns. If zero hazardous substances exist in the list, return [].`
      : `No ingredient list available. Only return substances documented in published sources for this specific product. Mark ingredientConfirmed as false for all.`;
    const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2000,tools:WEB,
        messages:[{role:"user",content:`${ctx} ${rule} Use web search to verify against EFSA/FDA/EWG sources. Return ONLY a JSON array (no markdown): [{"key":"snake_id","name":"Name","eNumber":"E211 or null","category":"Pesticide|Heavy Metal|Artificial Dye|Preservative|Artificial Sweetener|Flavour Enhancer|Thickener|Emulsifier|Antioxidant|Colour|Mycotoxin|Process Contaminant|Packaging Chemical|Other Additive","risk":"high|medium|low","effects":"1 sentence","limit":"regulatory limit or Not established","foundInIngredient":"exact ingredient or null","ingredientConfirmed":true,"sourceUrl":"https://... or null","sourceName":"EFSA or FDA or EWG etc or null"}]. Empty [] if none confirmed.`}]})
    });
    const txt = lastText(await r.json());
    const m = txt.match(/\[[\s\S]*?\]/s);
    if(!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr)?arr:[];
  }catch(e){ console.warn("aiHazards err",e); return []; }
}


async function aiSugar(name){
  try{
    const r = await fetch("https://api.anthropic.com/v1/messages",{ method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:400, tools:WEB,
        messages:[{role:"user",content:`Find nutritional sugar data for "${name}". Return ONLY JSON: {"total_sugars":number,"added_sugars":number_or_null,"natural_sugars":number_or_null,"gi":number,"diabeticRisk":"high|medium|low|none","servingSize":null,"confidence":"high|medium|low"}. Per 100g. No markdown.`}]})
    });
    const txt = lastText(await r.json());
    const match = txt.match(/\{[\s\S]*\}/);
    if(!match) return null;
    const p = JSON.parse(match[0]);
    return p.total_sugars!==undefined?p:null;
  }catch{ return null; }
}

async function aiBrandCredibility(brand, productName){
  if(!brand) return null;
  try{
    const r = await fetch("https://api.anthropic.com/v1/messages",{ method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:800, tools:WEB,
        messages:[{role:"user",content:`Research the food brand "${brand}" (product: "${productName}"). Return ONLY a JSON object: {"score":number_1_to_10,"verdict":"Excellent|Good|Average|Poor|Concerning","founded":year_or_null,"headquarters":"city, country or null","certifications":["cert1","cert2"],"controversies":["brief issue 1","brief issue 2"],"positives":["strength 1","strength 2"],"summary":"2 sentence brand overview","transparency":"High|Medium|Low","recallHistory":"Clean|Minor recalls|Major recalls|Unknown"}. Score 1-10 based on: ingredient transparency, recall history, ethical sourcing, regulatory compliance, certifications. No markdown.`}]})
    });
    const txt = lastText(await r.json());
    const match = txt.match(/\{[\s\S]*\}/);
    if(!match) return null;
    return JSON.parse(match[0]);
  }catch{ return null; }
}

async function aiInsightFn(name, subs, nut, offData){
  try{
    const confirmedSubs = subs.filter(s=>s.ingredientConfirmed!==false);
    const unconfirmedSubs = subs.filter(s=>s.ingredientConfirmed===false);
    const sl = confirmedSubs.map(s=>s.name).join(", ")||"none confirmed in ingredients";
    const sugar = nut?.sugars??null;
    const added = nut?.added_sugars??null;
    const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:900,
        messages:[{role:"user",content:`Food safety analysis for "${name}". Confirmed hazardous substances (from ingredient list): ${sl}${unconfirmedSubs.length>0?`. Unconfirmed/category-level concerns: ${unconfirmedSubs.map(s=>s.name).join(", ")}`:""}. Total sugars: ${sugar!==null?sugar+"g/100g":"unknown"}${added!==null?", added: "+added+"g/100g":""}. Nutri-Score: ${offData?.nutriScore?.toUpperCase()||"N/A"}, NOVA: ${offData?.novaGroup||"N/A"}. Write 3-4 sentences: (1) overall safety based on CONFIRMED ingredients only, (2) sugar concern if notable, (3) one practical tip. Be precise — do not conflate confirmed vs unconfirmed concerns. Do not alarm about substances not in the ingredient list.`}]})
    });
    return lastText(await r.json())||"Analysis unavailable.";
  }catch{ return "Analysis unavailable."; }
}

async function aiDietClassify(name, ingredients, labels, allergens){
  // Fast local classification first — avoids an API call for obvious cases
  const text = [(ingredients||""), ...(labels||[]), ...(allergens||[])].join(" ").toLowerCase();
  const hasAnimal = /beef|pork|chicken|lamb|turkey|duck|veal|bacon|ham|sausage|salami|pepperoni|lard|gelatin|gelatine|anchov|tuna|salmon|shrimp|prawn|crab|lobster|fish|seafood/.test(text);
  const hasDairy  = /milk|cream|butter|cheese|whey|lactose|casein|yogurt|yoghurt/.test(text);
  const hasEgg    = /egg|albumen|ovalbumin/.test(text);
  const hasMeat   = hasAnimal && /beef|pork|chicken|lamb|turkey|duck|veal|bacon|ham|sausage|salami|pepperoni|lard/.test(text);
  const hasFish   = /anchov|tuna|salmon|shrimp|prawn|crab|lobster|fish|seafood/.test(text);
  const isVeganLabel   = labels?.some(l=>/vegan/.test(l.toLowerCase()));
  const isVegLabel     = labels?.some(l=>/vegetarian/.test(l.toLowerCase()));
  const honeyOrBeeswax = /honey|beeswax|propolis|carmine|shellac|isinglass|lanolin/.test(text);

  // Clear local determination
  if(isVeganLabel && !hasAnimal && !hasDairy && !hasEgg && !honeyOrBeeswax) return "vegan";
  if(isVegLabel   && !hasAnimal && !hasFish)                                 return "vegetarian";
  if(hasMeat)                                                                return "meat";
  if(hasFish && !hasMeat)                                                    return "pescatarian";
  if(!hasAnimal && !hasDairy && !hasEgg && !honeyOrBeeswax && ingredients && ingredients.length>20) return "vegan";
  if(!hasAnimal && !hasFish   && (hasDairy || hasEgg))                       return "vegetarian";

  // Ambiguous — ask AI
  if(!ingredients && !labels?.length) return "unknown";
  try{
    const ctx = ingredients ? `Ingredients: "${ingredients.slice(0,500)}"` : "";
    const lbls = labels?.length ? `Labels: ${labels.join(", ")}` : "";
    const r = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:50,
        messages:[{role:"user",content:`Product: "${name}". ${ctx} ${lbls}. Classify the diet type. Return ONLY one word: vegan, vegetarian, pescatarian, meat, or unknown.`}]
      })
    });
    const d = await r.json();
    const ans = (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim().toLowerCase();
    if(["vegan","vegetarian","pescatarian","meat","unknown"].includes(ans)) return ans;
  }catch{}
  return "unknown";
}

async function aiAlternatives(name, brand, nutriScore, risk, ingredients){
  try{
    const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,tools:WEB,
        messages:[{role:"user",content:`The user scanned "${name}" by ${brand||"unknown brand"}. Nutri-Score: ${nutriScore?.toUpperCase()||"unknown"}, Risk: ${risk||"unknown"}. Ingredients summary: ${(ingredients||"not available").slice(0,300)}. Search for 2-3 healthier alternatives to this specific product that are: (1) similar in type/taste, (2) have better nutritional profile or fewer concerning additives, (3) are real, purchasable products. Return ONLY a JSON array (no markdown): [{"name":"Product name","brand":"Brand","reason":"Why it is better (1 sentence)","improvements":["improvement 1","improvement 2"],"nutriScore":"a|b|c|d|e|unknown","sourceUrl":"https://... or null","sourceName":"retailer, brand site, or review source"}]. Max 3 alternatives.`}]})
    });
    const txt = lastText(await r.json());
    const m = txt.match(/\[[\s\S]*?\]/s);
    if(!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr)?arr:[];
  }catch(e){ console.warn("aiAlternatives err",e); return []; }
}


async function aiCalorieAlternatives(name, calories, category, risk, nutrients){
  try{
    const calRange = calories ? `${Math.max(10,calories-30)}–${calories+30} kcal per 100g` : "similar calorie range";
    const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1500,tools:WEB,
        messages:[{role:"user",content:`The user scanned "${name}" (${calories||"unknown"} kcal/100g, risk: ${risk||"unknown"}, category: ${category||"food"}). Nutritional profile: ${JSON.stringify(nutrients||{})}. Find 5-7 healthier alternatives within ±30 kcal per 100g of ${calories||"the original"}. IMPORTANT RULES: (1) ALWAYS include fruits and vegetables in the calorie range — e.g. ~500 kcal consider avocado, dried fruits, nuts; ~50-150 kcal consider fresh fruits like apple, banana, berries, orange, grapes. (2) Mix natural whole foods (fruits, vegetables, legumes, nuts, seeds) AND minimally processed alternatives — do NOT limit to the same product category. (3) Prioritise in order: fresh fruits and vegetables > whole grains > minimally processed foods > healthier packaged alternatives. (4) Use web search to verify accurate calorie counts per 100g. Return ONLY a JSON array (no markdown): [{"name":"Specific food name e.g. Fresh Apple, Raw Almonds, Medjool Dates","calories":number,"caloriesPer":"100g","brand":null,"category":"Fruit|Vegetable|Nut|Legume|Grain|Dairy|Protein|Snack|Other","protein":number_or_null,"sugars":number_or_null,"fiber":number_or_null,"fat":number_or_null,"whyBetter":"1 sentence why healthier","benefits":["benefit 1","benefit 2"],"nutriScore":"a|b|c|d|e|unknown","sourceUrl":"https://... or null","sourceName":"source or null"}]. Sort healthiest first. Ensure at least 2-3 results are natural whole foods like fruits, vegetables or nuts.`}]})
    });
    const txt = lastText(await r.json());
    const m = txt.match(/\[[\s\S]*?\]/s);
    if(!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr)?arr:[];
  }catch(e){ console.warn("aiCalorieAlts err",e); return []; }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({items, onDismiss, t}){
  return(
    <div style={{position:"fixed",top:16,right:16,zIndex:9999,display:"flex",flexDirection:"column",gap:8,maxWidth:340,pointerEvents:"none"}}>
      {items.map(n=>{
        const colors = {
          off:"#2e7d52", high:"#c0392b", medium:"#b07d2b",
          sugar:"#3d6b99", db:"#6b7cff", scan:"#3d52c4", report:"#7c5cbf",
        };
        const c = colors[n.type]||colors.scan;
        return(
          <div key={n.id} style={{background:t.surface,borderLeft:`3px solid ${c}`,border:`1px solid ${t.border}`,borderLeftWidth:3,borderLeftColor:c,borderRadius:8,padding:"11px 14px",display:"flex",gap:10,alignItems:"flex-start",boxShadow:`0 4px 24px rgba(0,0,0,0.12)`,animation:"slideIn 0.28s ease",pointerEvents:"all"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:10,fontWeight:600,color:c,marginBottom:3,letterSpacing:"0.03em"}}>{n.type==="off"?"Open Food Facts":n.type==="high"?"High Risk Detected":n.type==="medium"?"Medium Risk":n.type==="sugar"?"Sugar Alert":n.type==="db"?"Database Updated":n.type==="report"?"Report Logged":"AI Scan"}</div>
              <div style={{fontSize:12,color:t.textSub,lineHeight:1.5}}>{n.message}</div>
            </div>
            <button onClick={()=>onDismiss(n.id)} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:16,padding:0,lineHeight:1}}>×</button>
          </div>
        );
      })}
    </div>
  );
}

// ─── FOOD ILLUSTRATION — empty state background ────────────────────────────────
function FoodIllustration({t}){
  const items = [
    {x:8,y:12,s:2.2,r:-15,e:"🥦"},{x:78,y:8,s:1.8,r:20,e:"🍎"},
    {x:45,y:5,s:2.0,r:0,e:"🥕"},{x:18,y:72,s:2.4,r:10,e:"🍋"},
    {x:85,y:65,s:2.1,r:-20,e:"🫐"},{x:62,y:78,s:1.9,r:15,e:"🧄"},
    {x:32,y:85,s:2.3,r:-8,e:"🥑"},{x:90,y:30,s:1.7,r:25,e:"🍊"},
    {x:5,y:45,s:1.6,r:-30,e:"🌽"},{x:55,y:90,s:2.0,r:12,e:"🍓"},
    {x:72,y:48,s:1.5,r:-18,e:"🥝"},{x:24,y:33,s:1.8,r:22,e:"🫑"},
    {x:48,y:58,s:1.4,r:-5,e:"🍇"},{x:88,y:85,s:1.6,r:18,e:"🧅"},
    {x:15,y:88,s:1.7,r:-12,e:"🥐"},
  ];
  return(
    <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",userSelect:"none"}}>
      {items.map((item,i)=>(
        <div key={i} style={{
          position:"absolute",left:`${item.x}%`,top:`${item.y}%`,
          fontSize:`${item.s}rem`,transform:`rotate(${item.r}deg)`,
          opacity:0.07,filter:"grayscale(100%)",
          animation:`foodFloat ${3+i*0.4}s ease-in-out infinite alternate`,
          animationDelay:`${i*0.3}s`,
        }}>{item.e}</div>
      ))}
    </div>
  );
}

// ─── BRAND CREDIBILITY CARD ───────────────────────────────────────────────────
function BrandCard({cred, brand, loading, t}){
  if(loading){
    return(
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"18px 20px"}}>
        <div style={{fontSize:12,fontWeight:600,color:t.textSub,marginBottom:12}}>Brand Credibility</div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <div style={{width:48,height:48,borderRadius:10,background:t.pill,animation:"shimmer 1.4s ease infinite"}}/>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
            <div style={{height:12,width:"60%",background:t.pill,borderRadius:4,animation:"shimmer 1.4s ease infinite"}}/>
            <div style={{height:10,width:"40%",background:t.pill,borderRadius:4,animation:"shimmer 1.4s ease infinite",animationDelay:"0.2s"}}/>
          </div>
        </div>
      </div>
    );
  }
  if(!cred) return null;

  const scoreColor = cred.score>=8?"#2e7d52":cred.score>=6?"#b07d2b":cred.score>=4?"#a0622a":"#c0392b";
  const verdictBg  = cred.score>=8?"rgba(46,125,82,0.08)":cred.score>=6?"rgba(176,125,43,0.08)":cred.score>=4?"rgba(160,98,42,0.08)":"rgba(192,57,43,0.08)";
  const arc = (cred.score/10)*251; // circumference of r=40 circle ≈ 251

  return(
    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,overflow:"hidden"}}>
      {/* Header row */}
      <div style={{padding:"16px 20px",borderBottom:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
        <div>
          <div style={{fontSize:11,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>Brand Credibility</div>
          <div style={{fontSize:16,fontWeight:700,color:t.text}}>{brand}</div>
          {cred.founded&&<div style={{fontSize:11,color:t.textSub,marginTop:2}}>Est. {cred.founded}{cred.headquarters?` · ${cred.headquarters}`:""}</div>}
        </div>
        {/* Score ring */}
        <div style={{position:"relative",width:64,height:64,flexShrink:0}}>
          <svg viewBox="0 0 90 90" width={64} height={64} style={{transform:"rotate(-90deg)"}}>
            <circle cx="45" cy="45" r="40" fill="none" stroke={t.border} strokeWidth="7"/>
            <circle cx="45" cy="45" r="40" fill="none" stroke={scoreColor} strokeWidth="7"
              strokeDasharray={`${arc} 251`} strokeLinecap="round"
              style={{transition:"stroke-dasharray 1s cubic-bezier(0.34,1.56,0.64,1)"}}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:16,fontWeight:800,color:scoreColor,lineHeight:1}}>{cred.score}</span>
            <span style={{fontSize:8,color:t.textMuted,lineHeight:1,marginTop:1}}>/10</span>
          </div>
        </div>
      </div>

      {/* Verdict badge + meta */}
      <div style={{padding:"12px 20px",background:verdictBg,borderBottom:`1px solid ${t.border}`,display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:12,fontWeight:700,color:scoreColor,letterSpacing:"0.04em"}}>{cred.verdict}</span>
        {cred.transparency&&<div style={{display:"flex",gap:5,alignItems:"center"}}>
          <span style={{fontSize:10,color:t.textMuted}}>Transparency:</span>
          <span style={{fontSize:10,fontWeight:600,color:cred.transparency==="High"?"#2e7d52":cred.transparency==="Medium"?"#b07d2b":"#c0392b"}}>{cred.transparency}</span>
        </div>}
        {cred.recallHistory&&<div style={{display:"flex",gap:5,alignItems:"center"}}>
          <span style={{fontSize:10,color:t.textMuted}}>Recalls:</span>
          <span style={{fontSize:10,fontWeight:600,color:cred.recallHistory==="Clean"?"#2e7d52":cred.recallHistory==="Minor recalls"?"#b07d2b":"#c0392b"}}>{cred.recallHistory}</span>
        </div>}
      </div>

      {/* Summary */}
      {cred.summary&&<div style={{padding:"12px 20px",borderBottom:`1px solid ${t.border}`}}>
        <p style={{margin:0,fontSize:12,color:t.textSub,lineHeight:1.7}}>{cred.summary}</p>
      </div>}

      {/* Certifications / Positives / Controversies */}
      <div style={{padding:"14px 20px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        {cred.certifications?.length>0&&(
          <div>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:7}}>Certifications</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {cred.certifications.slice(0,4).map(c=>(
                <div key={c} style={{display:"flex",gap:6,alignItems:"center"}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:"#2e7d52",flexShrink:0}}/>
                  <span style={{fontSize:11,color:t.textSub}}>{c}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {cred.positives?.length>0&&(
          <div>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:7}}>Strengths</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {cred.positives.slice(0,3).map(p=>(
                <div key={p} style={{display:"flex",gap:6,alignItems:"center"}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:t.accent,flexShrink:0}}/>
                  <span style={{fontSize:11,color:t.textSub}}>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {cred.controversies?.length>0&&(
          <div style={{gridColumn:"1 / -1"}}>
            <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:7}}>Known Concerns</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {cred.controversies.slice(0,3).map(c=>(
                <div key={c} style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:"#c0392b",flexShrink:0,marginTop:5}}/>
                  <span style={{fontSize:11,color:t.textSub,lineHeight:1.5}}>{c}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{padding:"8px 20px",background:t.bgSub,borderTop:`1px solid ${t.border}`,fontSize:9,color:t.textMuted}}>
        Credibility score based on AI research — certifications, recall history, transparency & sourcing practices.
      </div>
    </div>
  );
}

// ─── NUTRITION ROW ────────────────────────────────────────────────────────────
function NRow({label,val100,valSrv,unit,ri,bold,indent,type,hasSrv,t}){
  if(val100===null&&valSrv===null) return null;
  const pct = ri&&val100!==null ? Math.round((val100/ri)*100) : null;
  const col = type ? tlColor(type,val100) : (t?.text||"#1a1917");
  return(
    <tr style={{borderBottom:`1px solid ${t?.tableBorder||"#eee"}`}}>
      <td style={{padding:indent?"5px 12px 5px 26px":"8px 12px",fontSize:indent?11:12.5,color:t?.text||"#1a1917",fontWeight:bold?600:400}}>
        {indent&&<span style={{color:t?.textMuted,marginRight:5}}>—</span>}{label}
      </td>
      <td style={{padding:"8px 12px",fontSize:12.5,fontWeight:bold?600:500,color:col,textAlign:"right",fontFamily:"monospace",whiteSpace:"nowrap"}}>
        {val100!==null?`${fmt(val100)}${unit}`:"—"}
      </td>
      {hasSrv&&<td style={{padding:"8px 12px",fontSize:11.5,color:t?.textSub||"#6b6760",textAlign:"right",fontFamily:"monospace",whiteSpace:"nowrap"}}>
        {valSrv!==null?`${fmt(valSrv)}${unit}`:"—"}
      </td>}
      <td style={{padding:"8px 12px",fontSize:11,color:type?col:(t?.textMuted||"#aaa"),textAlign:"right",fontFamily:"monospace",whiteSpace:"nowrap"}}>
        {pct!==null?`${pct}%`:""}
      </td>
    </tr>
  );
}

// ─── OFF PRODUCT CARD ─────────────────────────────────────────────────────────
function OFFCard({offData, aiSugarData, substances, insight, insightLoading, brandCred, brandCredLoading, alternatives, altLoading, t, dark}){
  const [showIngr, setShowIngr] = useState(false);
  const n = offData.nut;
  const hasSrv = !!offData.servingSize;

  const totalSugars   = n.sugars        ?? aiSugarData?.total_sugars   ?? null;
  const addedSugars   = n.added_sugars  ?? aiSugarData?.added_sugars   ?? null;
  const naturalSugars = (totalSugars!==null&&addedSugars!==null) ? +(totalSugars-addedSugars).toFixed(1) : (aiSugarData?.natural_sugars??null);

  const riskLevel = getRisk(substances);
  const ns = offData.nutriScore;

  const card = {background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,overflow:"hidden"};
  const sectionHdr = {padding:"12px 16px",borderBottom:`1px solid ${t.border}`,fontSize:11,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase"};

  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* ── 1. PRODUCT HEADER ── */}
      <div style={{...card,boxShadow:`0 1px 8px rgba(0,0,0,${dark?0.3:0.07})`}}>
        <div style={{display:"flex",flexWrap:"wrap"}}>
          {/* Image — base64 data URL bypasses egress restrictions */}
          <div style={{width:156,minHeight:156,background:dark?"#1a1c20":"#f8f7f5",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,borderRight:`1px solid ${t.border}`,overflow:"hidden"}}>
            {offData.image&&offData.image.startsWith("data:image/")
              ?<img src={offData.image} alt={offData.name} style={{width:"100%",height:156,objectFit:"contain",padding:10,boxSizing:"border-box"}}/>
              :<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:14,textAlign:"center"}}>
                <span style={{fontSize:34,opacity:0.2}}>🛒</span>
                <span style={{fontSize:9,color:t.textMuted,lineHeight:1.5,maxWidth:100}}>No image available</span>
              </div>
            }
          </div>
          {/* Info */}
          <div style={{flex:1,padding:"16px 18px",minWidth:0}}>
            {offData.brand&&<div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:3}}>{offData.brand}</div>}
            <h2 style={{margin:"0 0 5px",fontSize:17,fontWeight:700,color:t.text,lineHeight:1.3,wordBreak:"break-word"}}>{offData.name}</h2>
            {offData.quantity&&<div style={{fontSize:11,color:t.textSub}}>{offData.quantity}{offData.servingSize?` · Serving: ${offData.servingSize}`:""}</div>}

            {/* Badges */}
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:10}}>
              <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",border:"1px solid rgba(46,125,82,0.2)",padding:"2px 8px",borderRadius:4,letterSpacing:"0.04em"}}>Open Food Facts</span>
              {riskLevel&&<span style={{fontSize:9,fontWeight:600,color:RISK[riskLevel].fg,background:RISK[riskLevel].bg,border:`1px solid ${RISK[riskLevel].border}`,padding:"2px 8px",borderRadius:4,letterSpacing:"0.04em"}}>{riskLevel.charAt(0).toUpperCase()+riskLevel.slice(1)} Risk</span>}
              {offData.labels.slice(0,3).map(l=><span key={l} style={{fontSize:9,color:t.textSub,background:t.pill,border:`1px solid ${t.border}`,padding:"2px 8px",borderRadius:4,textTransform:"capitalize"}}>{l.replace(/-/g," ")}</span>)}
            </div>

            {/* Diet badge */}
            {selected&&selected.diet&&selected.diet!=="unknown"&&(()=>{
              const dc=DIET[selected.diet]||DIET.unknown;
              return(
                <div style={{marginTop:8,display:"inline-flex",alignItems:"center",gap:7,background:dc.bg,border:`1px solid ${dc.border}`,borderRadius:8,padding:"5px 12px"}}>
                  <span style={{fontSize:15,lineHeight:1}}>{dc.icon}</span>
                  <span style={{fontSize:11,fontWeight:700,color:dc.fg}}>{dc.label}</span>
                  <span style={{fontSize:10,color:t.textSub,fontWeight:400}}>diet</span>
                </div>
              );
            })()}

            {/* Scores */}
            <div style={{display:"flex",gap:20,marginTop:14,flexWrap:"wrap",alignItems:"center"}}>
              {ns&&(()=>{
                const grades=["a","b","c","d","e"];
                return(
                  <div>
                    <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>Nutri-Score</div>
                    <div style={{display:"flex",alignItems:"flex-end",gap:2}}>
                      {grades.map(g=>{
                        const active=g===ns;
                        const col=NS_COLOR[g]||"#999";
                        return <div key={g} style={{width:active?32:24,height:active?32:24,borderRadius:active?7:4,background:active?col:(dark?"#2a2d33":"#e8e6e2"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:active?14:10,fontWeight:700,color:active?"#fff":(dark?"#555b68":"#a09c97"),marginBottom:active?0:4,transition:"all 0.2s"}}>{g.toUpperCase()}</div>;
                      })}
                    </div>
                    <div style={{fontSize:10,color:NS_COLOR[ns],marginTop:4,fontWeight:500}}>{["Excellent","Good","Average","Poor","Bad"][["a","b","c","d","e"].indexOf(ns)]} nutritional quality</div>
                  </div>
                );
              })()}
              {offData.novaGroup&&(
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>NOVA Group</div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:NOVA_COLOR[offData.novaGroup],display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff"}}>{offData.novaGroup}</div>
                    <div style={{fontSize:11,color:t.textSub,maxWidth:130,lineHeight:1.4}}>{NOVA_DESC[offData.novaGroup]}</div>
                  </div>
                </div>
              )}
              {offData.ecoScore&&!["unknown","not-applicable",""].includes(offData.ecoScore)&&(()=>{
                const ec={a:"#2e7d52",b:"#4a9060",c:"#b07d2b",d:"#a0622a",e:"#c0392b"};
                return(
                  <div>
                    <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>Eco-Score</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:32,height:32,borderRadius:7,background:ec[offData.ecoScore]||"#999",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff"}}>{offData.ecoScore.toUpperCase()}</div>
                      <div style={{fontSize:11,color:t.textSub}}>Environmental</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. BRAND CREDIBILITY ── */}
      <BrandCard cred={brandCred} brand={offData.brand} loading={brandCredLoading} t={t}/>

      {/* ── 3. NUTRITION FACTS ── */}
      {(n.energy_kcal!==null||totalSugars!==null)&&(
        <div style={{...card}}>
          <div style={{...sectionHdr,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Nutrition Facts</span>
            <span style={{fontSize:10,fontWeight:400,color:t.textMuted,textTransform:"none",letterSpacing:0}}>per 100g{hasSrv?` · per serving (${offData.servingSize})`:""}</span>
          </div>

          {/* Traffic light strip */}
          {[n.fat,n.saturated,totalSugars,n.salt].some(v=>v!==null)&&(
            <div style={{display:"flex",borderBottom:`1px solid ${t.border}`}}>
              {[{l:"Fat",v:n.fat,k:"fat"},{l:"Sat. fat",v:n.saturated,k:"satfat"},{l:"Sugars",v:totalSugars,k:"sugars"},{l:"Salt",v:n.salt,k:"salt"}].filter(x=>x.v!==null).map((x,i,arr)=>{
                const col=tlColor(x.k,x.v);
                return(
                  <div key={x.l} style={{flex:1,padding:"11px 8px",textAlign:"center",borderRight:i<arr.length-1?`1px solid ${t.border}`:"none",background:t.surface}}>
                    <div style={{fontSize:10,color:t.textSub,marginBottom:4}}>{x.l}</div>
                    <div style={{fontSize:17,fontWeight:700,color:t.text,fontFamily:"monospace"}}>{fmt(x.v)}g</div>
                    <div style={{marginTop:5,display:"inline-flex",alignItems:"center",gap:4}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:col}}/>
                      <span style={{fontSize:9,fontWeight:600,color:col}}>{tlLabel(x.k,x.v)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sugar spotlight */}
          {totalSugars!==null&&(
            <div style={{display:"grid",gridTemplateColumns:addedSugars!==null&&naturalSugars!==null?"1fr 1fr 1fr":addedSugars!==null?"1fr 1fr":"1fr",gap:10,padding:"14px 16px",background:dark?"rgba(176,125,43,0.05)":"rgba(176,125,43,0.04)",borderBottom:`1px solid ${t.border}`}}>
              {[
                {label:"Total Sugars",value:totalSugars,ri:90,riLabel:"RI",col:tlColor("sugars",totalSugars)},
                addedSugars!==null&&{label:"Added Sugars",value:addedSugars,ri:50,riLabel:"DV",col:tlColor("sugars",addedSugars)},
                naturalSugars!==null&&{label:"Natural Sugars",value:naturalSugars,ri:null,riLabel:null,col:"#2e7d52"},
              ].filter(Boolean).map(item=>(
                <div key={item.label} style={{background:t.surface,border:`1.5px solid ${item.col}30`,borderRadius:10,padding:"11px 12px",textAlign:"center"}}>
                  <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:4}}>{item.label}</div>
                  <div style={{fontSize:26,fontWeight:800,color:item.col,lineHeight:1,fontFamily:"monospace"}}>{fmt(item.value)}g</div>
                  <div style={{fontSize:10,color:t.textSub,marginTop:4}}>per 100g{item.ri?` · ${Math.round((item.value/item.ri)*100)}% ${item.riLabel}`:""}</div>
                  <div style={{marginTop:6,display:"inline-flex",alignItems:"center",gap:4,background:`${item.col}12`,borderRadius:20,padding:"2px 10px"}}>
                    <div style={{width:5,height:5,borderRadius:"50%",background:item.col}}/>
                    <span style={{fontSize:9,fontWeight:600,color:item.col}}>{item.label==="Natural Sugars"?"Natural":tlLabel("sugars",item.value)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Full table */}
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{background:t.tableTh,borderBottom:`2px solid ${t.border}`}}>
                {["Nutrient","Per 100g",hasSrv?"Per serving":null,"%RI"].filter(Boolean).map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:h==="Nutrient"?"left":"right",fontSize:10,fontWeight:600,color:t.textSub,letterSpacing:"0.04em"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <NRow label="Energy"          val100={n.energy_kcal} valSrv={n.energy_srv}     unit=" kcal" ri={2000} bold   hasSrv={hasSrv} t={t}/>
              <NRow label="Fat"             val100={n.fat}         valSrv={n.fat_srv}         unit="g"     ri={70}  bold   hasSrv={hasSrv} t={t} type="fat"/>
              <NRow label="Saturated fat"   val100={n.saturated}   valSrv={null}              unit="g"     ri={20}  indent hasSrv={hasSrv} t={t} type="satfat"/>
              <NRow label="Carbohydrates"   val100={n.carbs}       valSrv={n.carbs_srv}       unit="g"     ri={260} bold   hasSrv={hasSrv} t={t}/>
              <NRow label="Sugars (total)"  val100={totalSugars}   valSrv={n.sugars_srv}      unit="g"     ri={90}  indent hasSrv={hasSrv} t={t} type="sugars"/>
              {addedSugars!==null&&<NRow label="Added sugars" val100={addedSugars} valSrv={n.added_sugars_srv} unit="g" ri={50} indent hasSrv={hasSrv} t={t} type="sugars"/>}
              {naturalSugars!==null&&<NRow label="Natural sugars" val100={naturalSugars} valSrv={null} unit="g" indent hasSrv={hasSrv} t={t}/>}
              <NRow label="Dietary fibre"   val100={n.fiber}       valSrv={n.fiber_srv}       unit="g"     ri={30}        hasSrv={hasSrv} t={t}/>
              <NRow label="Protein"         val100={n.protein}     valSrv={n.protein_srv}     unit="g"     ri={50}  bold   hasSrv={hasSrv} t={t}/>
              <NRow label="Salt"            val100={n.salt}        valSrv={n.salt_srv}        unit="g"     ri={6}   bold   hasSrv={hasSrv} t={t} type="salt"/>
              {n.sodium!==null&&<NRow label="Sodium" val100={n.sodium} valSrv={null} unit="g" indent hasSrv={hasSrv} t={t}/>}
            </tbody>
          </table>
          <div style={{padding:"8px 14px",fontSize:9,color:t.textMuted,borderTop:`1px solid ${t.border}`}}>* Reference intake for an average adult (8400 kJ / 2000 kcal)</div>
        </div>
      )}

      {/* ── 4. ADDITIVES ── */}
      {offData.additives.length>0&&(
        <div style={{...card}}>
          <div style={{...sectionHdr}}>Additives · {offData.additives.length} detected</div>
          <div style={{padding:"14px 16px",display:"flex",flexWrap:"wrap",gap:6}}>
            {offData.additives.map(a=>{
              const e = a.replace("en:","").toUpperCase();
              const flagged = substances.some(s=>s.eNumber&&s.eNumber.replace(/[-\/]/g,"").toLowerCase()===e.replace(/[-\/]/g,"").toLowerCase());
              return <span key={a} style={{fontSize:11,fontFamily:"monospace",background:flagged?RISK.high.bg:t.pill,color:flagged?RISK.high.fg:t.pillText,padding:"4px 10px",borderRadius:5,border:`1px solid ${flagged?RISK.high.border:t.border}`,fontWeight:flagged?600:400}}>{e}{flagged?" ⚠":""}</span>;
            })}
          </div>
        </div>
      )}

      {/* ── 5. ALLERGENS ── */}
      {offData.allergens.length>0&&(
        <div style={{background:dark?"rgba(176,125,43,0.07)":"rgba(176,125,43,0.05)",border:`1px solid rgba(176,125,43,0.22)`,borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:11,fontWeight:600,color:"#b07d2b",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10}}>Allergens</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {offData.allergens.map(a=><span key={a} style={{fontSize:11,fontWeight:500,background:"rgba(176,125,43,0.1)",color:"#8a5e1a",padding:"4px 12px",borderRadius:5,border:"1px solid rgba(176,125,43,0.25)",textTransform:"capitalize"}}>{a.replace(/-/g," ")}</span>)}
          </div>
        </div>
      )}

      {/* ── 6. INGREDIENTS ── */}
      {offData.ingredients&&(
        <div style={{...card}}>
          <div style={{...sectionHdr}}>Ingredients</div>
          <div style={{padding:"14px 16px"}}>
            <p style={{margin:0,fontSize:12,color:t.textSub,lineHeight:1.8,display:showIngr?"block":"-webkit-box",WebkitLineClamp:showIngr?undefined:4,WebkitBoxOrient:"vertical",overflow:showIngr?"visible":"hidden"}}>{offData.ingredients}</p>
            {offData.ingredients.length>280&&<button onClick={()=>setShowIngr(p=>!p)} style={{marginTop:8,background:"none",border:"none",color:t.accent,cursor:"pointer",fontSize:11,padding:0,fontFamily:"inherit",fontWeight:500}}>{showIngr?"Show less":"Show all ingredients"}</button>}
          </div>
        </div>
      )}

      {/* ── 7. HAZARD ANALYSIS ── */}
      {substances.length>0&&(()=>{
        const confirmed = substances.filter(s=>s.ingredientConfirmed!==false);
        const unconfirmed = substances.filter(s=>s.ingredientConfirmed===false);
        return(
          <div style={{...card}}>
            <div style={{...sectionHdr,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
              <span style={{color:confirmed.length>0?RISK.high.fg:t.textSub}}>Hazard Analysis · {confirmed.length} confirmed{unconfirmed.length>0?`, ${unconfirmed.length} unverified`:""}</span>
              <span style={{fontSize:9,fontWeight:400,color:t.textMuted,textTransform:"none",letterSpacing:0}}>Only confirmed = present in ingredient list</span>
            </div>

            {confirmed.length===0&&unconfirmed.length===0&&(
              <div style={{padding:"18px 16px",fontSize:12,color:t.textSub}}>No hazardous substances confirmed in the ingredient list.</div>
            )}

            {confirmed.length>0&&(
              <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:7}}>
                {confirmed.map((s,i)=>(
                  <div key={s.id||i} style={{background:t.bgSub,border:`1px solid ${t.border}`,borderLeft:`3px solid ${RISK[s.risk]?.fg||"#999"}`,borderRadius:7,padding:"11px 14px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:8}}>
                      <div>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:3,alignItems:"center"}}>
                          {s.eNumber&&<span style={{fontSize:9,fontFamily:"monospace",fontWeight:600,color:"#b07d2b",background:"rgba(176,125,43,0.1)",padding:"1px 6px",borderRadius:3}}>{s.eNumber}</span>}
                          <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"1px 6px",borderRadius:3}}>✓ In ingredients</span>
                          {s.foundInIngredient&&<span style={{fontSize:9,color:t.textMuted}}>via "{s.foundInIngredient}"</span>}
                        </div>
                        <div style={{fontSize:13,fontWeight:600,color:t.text}}>{s.name}</div>
                        <div style={{fontSize:10,color:t.textMuted,marginTop:1}}>{s.category}</div>
                      </div>
                      <span style={{fontSize:9,fontWeight:700,color:RISK[s.risk]?.fg,background:RISK[s.risk]?.bg,border:`1px solid ${RISK[s.risk]?.border}`,padding:"3px 9px",borderRadius:4,whiteSpace:"nowrap",flexShrink:0}}>{s.risk.charAt(0).toUpperCase()+s.risk.slice(1)}</span>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:11,marginBottom:s.sourceUrl?8:0}}>
                      <div style={{color:t.textSub,lineHeight:1.55}}>{s.effects}</div>
                      <div style={{color:t.textMuted,fontFamily:"monospace",fontSize:10,lineHeight:1.55}}>{s.limit}</div>
                    </div>
                    {s.sourceUrl&&(
                      <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4}}>
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5L2 14M10 2h4v4M14 2l-6 6" stroke={t.accent} strokeWidth="1.5" strokeLinecap="round"/></svg>
                        <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer"
                          style={{fontSize:10,color:t.accent,textDecoration:"none",borderBottom:`1px solid ${t.accent}40`,lineHeight:1.3}}>
                          {s.sourceName||"View source"}
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {unconfirmed.length>0&&(
              <div style={{padding:"10px 12px",borderTop:`1px solid ${t.border}`}}>
                <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:8}}>Category-level concerns (not confirmed in this product's ingredients)</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {unconfirmed.map((s,i)=>(
                    <div key={i} style={{background:t.bgSub,border:`1px solid ${t.border}`,borderLeft:`3px solid ${t.borderMed}`,borderRadius:6,padding:"9px 12px",opacity:0.75}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          {s.eNumber&&<span style={{fontSize:9,fontFamily:"monospace",fontWeight:600,color:"#b07d2b",background:"rgba(176,125,43,0.1)",padding:"1px 6px",borderRadius:3}}>{s.eNumber}</span>}
                          <span style={{fontSize:12,fontWeight:500,color:t.textSub}}>{s.name}</span>
                          <span style={{fontSize:9,color:t.textMuted,background:t.pill,padding:"1px 6px",borderRadius:3}}>Not confirmed</span>
                        </div>
                        <span style={{fontSize:9,color:t.textMuted,background:t.pill,padding:"2px 8px",borderRadius:4,whiteSpace:"nowrap"}}>{s.risk} risk</span>
                      </div>
                      <div style={{fontSize:11,color:t.textMuted,lineHeight:1.5}}>{s.effects}</div>
                      {s.sourceUrl&&(
                        <div style={{display:"flex",alignItems:"center",gap:5,marginTop:5}}>
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5L2 14M10 2h4v4M14 2l-6 6" stroke={t.textMuted} strokeWidth="1.5" strokeLinecap="round"/></svg>
                          <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer"
                            style={{fontSize:10,color:t.textMuted,textDecoration:"none",borderBottom:`1px solid ${t.borderMed}`}}>
                            {s.sourceName||"View source"}
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── 8. BETTER ALTERNATIVES ── */}
      {(altLoading||(alternatives&&alternatives.length>0))&&(
        <div style={{...card}}>
          <div style={{...sectionHdr,color:"#2e7d52"}}>Healthier Alternatives</div>
          {altLoading&&!alternatives.length?(
            <div style={{padding:"18px 16px",display:"flex",alignItems:"center",gap:10,color:t.textSub,fontSize:12}}>
              <span style={{display:"inline-block",width:12,height:12,border:`2px solid ${t.accent}`,borderTop:"2px solid transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>
              Finding better alternatives…
            </div>
          ):(
            <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
              {alternatives.map((alt,i)=>(
                <div key={i} style={{background:t.bgSub,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:7,padding:"12px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:t.text}}>{alt.name}</div>
                      {alt.brand&&<div style={{fontSize:10,color:t.textSub,marginTop:1}}>{alt.brand}</div>}
                    </div>
                    <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
                      {alt.nutriScore&&alt.nutriScore!=="unknown"&&(
                        <span style={{fontSize:10,fontWeight:700,color:"#fff",background:NS_COLOR[alt.nutriScore]||"#999",padding:"2px 7px",borderRadius:4}}>{alt.nutriScore.toUpperCase()}</span>
                      )}
                      <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"2px 8px",borderRadius:4}}>Better choice</span>
                    </div>
                  </div>
                  <div style={{fontSize:12,color:t.textSub,lineHeight:1.6,marginBottom:6}}>{alt.reason}</div>
                  {alt.improvements?.length>0&&(
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:6}}>
                      {alt.improvements.map((imp,j)=>(
                        <span key={j} style={{fontSize:10,color:"#2e7d52",background:"rgba(46,125,82,0.08)",border:"1px solid rgba(46,125,82,0.18)",padding:"2px 9px",borderRadius:10}}>✓ {imp}</span>
                      ))}
                    </div>
                  )}
                  {alt.sourceUrl&&(
                    <div style={{display:"flex",alignItems:"center",gap:5,marginTop:4}}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5L2 14M10 2h4v4M14 2l-6 6" stroke={t.accent} strokeWidth="1.5" strokeLinecap="round"/></svg>
                      <a href={alt.sourceUrl} target="_blank" rel="noopener noreferrer"
                        style={{fontSize:10,color:t.accent,textDecoration:"none",borderBottom:`1px solid ${t.accent}40`}}>
                        {alt.sourceName||"View product"}
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 9. AI ANALYSIS ── */}
      <div style={{...card}}>
        <div style={{...sectionHdr}}>AI Safety Analysis</div>
        <div style={{padding:"14px 16px"}}>
          {insightLoading
            ?<div style={{color:t.textMuted,fontSize:12,fontStyle:"italic",animation:"pulse 1.4s ease infinite"}}>Generating analysis…</div>
            :insight
              ?<p style={{margin:0,fontSize:13,color:t.textSub,lineHeight:1.8}}>{insight}</p>
              :<div style={{color:t.textMuted,fontSize:12}}>Pending…</div>
          }
        </div>
      </div>

      <div style={{fontSize:9,color:t.textMuted,lineHeight:1.7,paddingBottom:4}}>Data from Open Food Facts · Brand research by AI · Educational purposes only.</div>
    </div>
  );
}

// ─── UNKNOWN MODAL ────────────────────────────────────────────────────────────
function UnknownModal({onClose, onSubmit, t}){
  const [form,setForm] = useState({food:"",substance:"",symptoms:"",source:""});
  const [done,setDone] = useState(false);
  function go(){ if(!form.food.trim()||!form.substance.trim()) return; onSubmit(form); setDone(true); setTimeout(()=>{setDone(false);onClose();},1800); }
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}>
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,padding:26,width:"min(460px,90vw)",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div><div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:4}}>Community Report</div><div style={{fontSize:17,fontWeight:700,color:t.text}}>Report Unknown Substance</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:20,lineHeight:1}}>×</button>
        </div>
        {done?<div style={{textAlign:"center",padding:28,color:"#2e7d52"}}><div style={{fontSize:32,marginBottom:8}}>✓</div><div style={{fontWeight:600}}>Report submitted!</div></div>:(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {[{k:"food",l:"Food item",p:"e.g. Fromage Blanc Nature",req:true},{k:"substance",l:"Substance or additive",p:"e.g. E407, Carrageenan",req:true},{k:"symptoms",l:"Reported symptoms (optional)",p:""},{k:"source",l:"Source or reference (optional)",p:""}].map(f=>(
              <div key={f.k}>
                <div style={{fontSize:11,fontWeight:500,color:t.textSub,marginBottom:5}}>{f.l}{f.req&&<span style={{color:RISK.high.fg}}> *</span>}</div>
                <input value={form[f.k]} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.p}
                  style={{width:"100%",background:t.inputBg,border:`1px solid ${t.inputBorder}`,borderRadius:8,padding:"9px 12px",color:t.inputText,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
              </div>
            ))}
            <button onClick={go} disabled={!form.food.trim()||!form.substance.trim()}
              style={{background:form.food&&form.substance?t.accent:t.pill,border:"none",color:form.food&&form.substance?t.accentFg:t.textMuted,padding:"12px",borderRadius:8,cursor:form.food&&form.substance?"pointer":"default",fontSize:13,fontWeight:600,marginTop:4,transition:"all 0.2s"}}>
              Submit Report
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DB MODAL ─────────────────────────────────────────────────────────────────
function DbModal({db, onClose, t}){
  const [q,setQ] = useState("");
  const entries = Object.entries(db).filter(([,s])=>!q||(s.name+s.category+(s.eNumber||"")).toLowerCase().includes(q.toLowerCase()));
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:700,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}>
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,width:"min(900px,96vw)",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>Hazard Database</div><div style={{fontSize:16,fontWeight:700,color:t.text}}>{Object.keys(db).length} substances indexed</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:22}}>×</button>
        </div>
        <div style={{padding:"10px 20px",borderBottom:`1px solid ${t.border}`}}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name, E-number or category…"
            style={{width:"100%",background:t.inputBg,border:`1px solid ${t.inputBorder}`,borderRadius:8,padding:"8px 12px",color:t.inputText,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{overflowY:"auto",flex:1}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:t.tableTh,position:"sticky",top:0}}>
              {["E-Number","Name","Category","Risk","Limit","Source"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:10,fontWeight:600,color:t.textSub,borderBottom:`1px solid ${t.border}`,letterSpacing:"0.04em"}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {entries.map(([k,s])=>(
                <tr key={k} style={{borderBottom:`1px solid ${t.tableBorder}`}} onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov} onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <td style={{padding:"8px 12px",fontFamily:"monospace",color:"#b07d2b",fontSize:10,fontWeight:600}}>{s.eNumber||"—"}</td>
                  <td style={{padding:"8px 12px",color:t.text,fontWeight:500}}>{s.name}</td>
                  <td style={{padding:"8px 12px",color:t.textSub,fontSize:11}}>{s.category}</td>
                  <td style={{padding:"8px 12px"}}><span style={{fontSize:9,fontWeight:600,color:RISK[s.risk]?.fg,background:RISK[s.risk]?.bg,border:`1px solid ${RISK[s.risk]?.border}`,padding:"2px 7px",borderRadius:3}}>{s.risk?.charAt(0).toUpperCase()+s.risk?.slice(1)}</span></td>
                  <td style={{padding:"8px 12px",color:t.textMuted,fontSize:10,fontFamily:"monospace",maxWidth:160}}>{s.limit}</td>
                  <td style={{padding:"8px 12px"}}><span style={{fontSize:9,fontWeight:500,color:s.source==="ai"?t.accent:s.source==="user"?"#7c5cbf":t.textMuted}}>{s.source==="ai"?"AI":s.source==="user"?"User":"Seed"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App(){
  const [input,setInput]       = useState("");
  const [tracked,setTracked]   = useState([]);
  const [selected,setSelected] = useState(null);
  const [insight,setInsight]   = useState("");
  const [insightLoading,setInsightLoading] = useState(false);
  const [brandCred,setBrandCred]           = useState(null);
  const [brandCredLoading,setBrandCredLoading] = useState(false);
  const [alternatives,setAlternatives]       = useState([]);
  const [altLoading,setAltLoading]           = useState(false);
  const [scanning,setScanning] = useState(false);
  const [filterRisk,setFilterRisk] = useState("all");
  const [toasts,setToasts]     = useState([]);
  const [reports,setReports]   = useState([]);
  const [showUnknown,setShowUnknown] = useState(false);
  const [showDb,setShowDb]     = useState(false);
  const [activeTab,setActiveTab] = useState("tracker");
  const [dark,setDark]         = useState(false);
  const [sugarLimit,setSugarLimit] = useState(25);
  const [hazardDb,setHazardDb] = useState(Object.fromEntries(Object.entries(SEED_DB).map(([k,v])=>([k,{...v,source:"seed"}]))));
  const inputRef = useRef();
  const tid = useRef(0);

  // ── SESSION CACHE ─────────────────────────────────────────────────────────
  // Keyed by normalised product name. Avoids re-calling APIs for the same product.
  const cache = useRef({
    scan:       {},   // key → { offData, aiSugarData, allSubs, risk }
    insight:    {},   // key → string
    brand:      {},   // key → credibility object
    alts:       {},   // key → alternatives array
    calAlts:    {},   // key → calorie alternatives array
    panelAlts:  {},   // key → panel alternatives array
    diet:       {},   // key → "vegan"|"vegetarian"|"pescatarian"|"meat"|"unknown"
  });

  function cacheKey(str){ return str.toLowerCase().trim().replace(/\s+/g," "); }

  function fromCache(store, key){ return cache.current[store]?.[key] ?? null; }
  function toCache(store, key, val){ if(!cache.current[store]) cache.current[store]={}; cache.current[store][key]=val; }
  const t = makeTheme(dark);

  function toast(type,msg){ const id=++tid.current; setToasts(p=>[...p,{id,type,message:msg}]); setTimeout(()=>setToasts(p=>p.filter(n=>n.id!==id)),6000); }

  function mergeDb(subs){
    setHazardDb(prev=>{
      const next={...prev}; let added=0;
      subs.forEach(s=>{ const k=s.key||s.id||(s.name?.toLowerCase().replace(/[^a-z0-9]/g,"_")); if(k&&!next[k]){next[k]={...s,source:"ai"};added++;} });
      if(added) toast("db",`${added} new substance${added>1?"s":""} added to database.`);
      return next;
    });
  }

  async function scan(rawName){
    const label = (rawName||input).trim();
    if(!label) return;
    setInput(""); setScanning(true); setBrandCred(null);

    const ck = cacheKey(label);

    // ── CHECK CACHE FIRST ────────────────────────────────────────────────────
    const cached = fromCache("scan", ck);
    if(cached){
      const cachedDiet = fromCache("diet", ck) || cached.diet || "unknown";
      const entry = { id:Date.now(), name:cached.offData?.name||label, searchTerm:label,
        substances:cached.allSubs, offData:cached.offData, aiSugarData:cached.aiSugarData,
        risk:cached.risk, diet:cachedDiet, date:new Date().toLocaleDateString(), fromCache:true };
      setTracked(p=>[entry,...p]); setSelected(entry); setScanning(false);
      toast("cache","Loaded from cache — instant result.");
      // Still reload insight + brand (cheap, fast) from cache if available
      const cachedInsight = fromCache("insight", ck);
      if(cachedInsight){ setInsight(cachedInsight); setInsightLoading(false); }
      else loadInsight(entry.name, cached.allSubs, cached.offData?.nut||null, cached.offData, ck);
      const cachedBrand = fromCache("brand", ck);
      if(cachedBrand){ setBrandCred(cachedBrand); setBrandCredLoading(false); }
      else if(cached.offData?.brand){ setBrandCredLoading(true); aiBrandCredibility(cached.offData.brand, entry.name).then(c=>{ setBrandCred(c); toCache("brand",ck,c); setBrandCredLoading(false); }).catch(()=>setBrandCredLoading(false)); }
      const cachedAlts = fromCache("alts", ck);
      if(cachedAlts){ setAlternatives(cachedAlts); setAltLoading(false); }
      return;
    }

    // Parallel: OFF data + hazard scan + sugar
    const [offData, aiSubs, aiSugarData] = await Promise.all([
      fetchOFF(label).catch(()=>null),
      aiHazards(label, null).catch(()=>[]),
      aiSugar(label).catch(()=>null),
    ]);

    // Merge ingredients into hazard scan if we got them from OFF
    let finalSubs = aiSubs;
    if(offData?.ingredients && aiSubs.length===0){
      finalSubs = await aiHazards(offData.name, offData.ingredients).catch(()=>[]);
    }
    const aiSubsMapped = finalSubs.filter(s=>s.key&&s.name).map(s=>({...s,id:s.key,source:"ai"}));
    if(aiSubsMapped.length) mergeDb(aiSubsMapped);

    // Local DB check
    const lower = (offData?.name||label).toLowerCase();
    const localMatches = Object.entries(hazardDb).filter(([,s])=>s.foods?.some(f=>lower.includes(f)||f.includes(lower))).map(([k,s])=>({...s,id:k}));
    const seen = new Set();
    const allSubs = [...aiSubsMapped,...localMatches].filter(s=>{ const k=s.id||s.name; if(seen.has(k)) return false; seen.add(k); return true; });

    // Diet classification (fast local + AI fallback, cached)
    const dietType = await aiDietClassify(
      offData?.name||label, offData?.ingredients||null,
      offData?.labels||[], offData?.allergens||[]
    ).catch(()=>"unknown");
    toCache("diet", ck, dietType);

    const entry = { id:Date.now(), name:offData?.name||label, searchTerm:label, substances:allSubs, offData, aiSugarData, risk:getRisk(allSubs), diet:dietType, date:new Date().toLocaleDateString() };
    // Save to session cache
    toCache("scan", ck, { offData, aiSugarData, allSubs, risk:getRisk(allSubs), diet:dietType });
    setTracked(p=>[entry,...p]);
    setSelected(entry);
    setScanning(false);

    if(offData) toast("off",`Found "${offData.name}" on Open Food Facts.`);
    if(aiSubsMapped.length) toast("scan",`${aiSubsMapped.length} hazardous substance${aiSubsMapped.length>1?"s":""} identified.`);
    const r = getRisk(allSubs);
    if(r==="high") toast("high",`High risk substances: ${allSubs.filter(s=>s.risk==="high").map(s=>s.name).slice(0,2).join(", ")}.`);
    else if(r==="medium") toast("medium",`Medium risk: ${allSubs.filter(s=>s.risk==="medium").map(s=>s.name).slice(0,2).join(", ")}.`);
    const sugar = offData?.nut?.sugars??aiSugarData?.total_sugars??null;
    if(sugar!==null&&sugar>22.5) toast("sugar",`High sugar content: ${sugar}g per 100g.`);

    // Load AI insight + brand credibility + alternatives in parallel
    setAlternatives([]); setAltLoading(false);
    loadInsight(entry.name, allSubs, offData?.nut||null, offData);
    if(offData?.brand){
      setBrandCredLoading(true);
      aiBrandCredibility(offData.brand, entry.name).then(c=>{ setBrandCred(c); toCache("brand",ck,c); setBrandCredLoading(false); }).catch(()=>setBrandCredLoading(false));
    }
    // Only suggest alternatives if the product has medium/high risk or poor Nutri-Score
    const needsAlt = getRisk(allSubs)==="high" || getRisk(allSubs)==="medium" || ["c","d","e"].includes(offData?.nutriScore||"");
    if(needsAlt){
      setAltLoading(true);
      aiAlternatives(entry.name, offData?.brand, offData?.nutriScore, getRisk(allSubs), offData?.ingredients).then(a=>{ const res=a||[]; setAlternatives(res); toCache("alts",ck,res); setAltLoading(false); }).catch(()=>setAltLoading(false));
    }
  }

  async function loadInsight(name, subs, nut, offData, ck){
    setInsightLoading(true); setInsight("");
    // Check insight cache
    const key = ck||cacheKey(name);
    const cached = fromCache("insight", key);
    if(cached){ setInsight(cached); setInsightLoading(false); return; }
    const txt = await aiInsightFn(name,subs,nut,offData);
    toCache("insight", key, txt);
    setInsight(txt); setInsightLoading(false);
  }

  function selectEntry(entry){
    const ck = cacheKey(entry.name);
    setSelected(entry); setBrandCred(null); setAlternatives([]); setAltLoading(false);
    // Insight cache
    loadInsight(entry.name, entry.substances, entry.offData?.nut||null, entry.offData, ck);
    // Brand cache
    const cachedBrand = fromCache("brand", ck);
    if(cachedBrand){ setBrandCred(cachedBrand); }
    else if(entry.offData?.brand){
      setBrandCredLoading(true);
      aiBrandCredibility(entry.offData.brand, entry.name).then(c=>{ setBrandCred(c); toCache("brand",ck,c); setBrandCredLoading(false); }).catch(()=>setBrandCredLoading(false));
    }
    // Alts cache
    const cachedAlts = fromCache("alts", ck);
    if(cachedAlts){ setAlternatives(cachedAlts); setAltLoading(false); }
    else {
      const needsAlt = getRisk(entry.substances)==="high"||getRisk(entry.substances)==="medium"||["c","d","e"].includes(entry.offData?.nutriScore||"");
      if(needsAlt&&entry.offData){
        setAltLoading(true);
        aiAlternatives(entry.name, entry.offData.brand, entry.offData.nutriScore, getRisk(entry.substances), entry.offData.ingredients).then(a=>{ const res=a||[]; setAlternatives(res); toCache("alts",ck,res); setAltLoading(false); }).catch(()=>setAltLoading(false));
      }
    }
  }

  function submitReport(form){
    setReports(p=>[{...form,id:Date.now(),date:new Date().toLocaleDateString()},...p]);
    const k = form.substance.toLowerCase().replace(/[^a-z0-9]/g,"_");
    setHazardDb(p=>({...p,[k]:{name:form.substance,category:"Other Additive",risk:"medium",eNumber:null,foods:[form.food.toLowerCase()],effects:form.symptoms||"User-reported",limit:"Under review",source:"user"}}));
    toast("report",`"${form.substance}" logged and added to database.`);
  }

  const filteredTracked = filterRisk==="all" ? tracked : tracked.filter(f=>f.risk===filterRisk);
  const totalSugarVal = tracked.reduce((a,f)=>a+(f.offData?.nut?.sugars??f.aiSugarData?.total_sugars??0),0);
  const sugarPct = Math.min((totalSugarVal/sugarLimit)*100,100);

  // SMART SEARCH
  const [searchQ,setSearchQ]             = useState("");
  const [searchOpen,setSearchOpen]       = useState(false);
  const [searchRes,setSearchRes]         = useState(null);
  const [searchLoading,setSearchLoading] = useState(false);
  const searchRef = useRef();

  const SUGGESTIONS = [
    "companies with good credibility",
    "high risk products I scanned",
    "vegan products I scanned",
    "vegetarian foods I tracked",
    "foods with added sugars",
    "products with E-numbers",
    "low Nutri-Score items",
    "ultra-processed foods",
    "products with allergens",
    "brands with controversies",
  ];

  async function runSearch(q){
    const query=(q||searchQ).trim();
    if(!query)return;
    setSearchLoading(true);setSearchRes(null);setSearchOpen(true);
    const summary=tracked.map(f=>({
      name:f.name,brand:f.offData?.brand||null,risk:f.risk,
      nutriScore:f.offData?.nutriScore||null,novaGroup:f.offData?.novaGroup||null,
      substances:f.substances.map(s=>s.name).slice(0,4),
      additives:f.offData?.additives?.slice(0,6)||[],
      sugars:f.offData?.nut?.sugars??f.aiSugarData?.total_sugars??null,
      allergens:f.offData?.allergens||[],
      diet:f.diet||"unknown",
    }));
    try{
      const r=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,tools:WEB,
          messages:[{role:"user",content:`HST food safety app. Scanned products: ${JSON.stringify(summary)}. User query: "${query}". Use web search for brand/food questions. Return ONLY JSON: {"answer":"2-4 sentence answer","matches":[{"name":"item","reason":"why it matches","diet":"vegan|vegetarian|pescatarian|meat|unknown"}],"tip":"one actionable tip","category":"credibility|risk|sugar|additives|nutrition|general|diet"}. No markdown.`}]})
      });
      const d=await r.json();
      const txt=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).reverse()[0]||"";
      const m=txt.match(/\{[\s\S]*\}/);
      if(m)setSearchRes(JSON.parse(m[0]));
      else setSearchRes({answer:"No results found.",matches:[],tip:null,category:"general"});
    }catch{setSearchRes({answer:"Search failed. Try again.",matches:[],tip:null,category:"general"});}
    setSearchLoading(false);
  }

  // ── OTHER OPTIONS PANEL ─────────────────────────────────────────────────────
  // ── ALTERNATIVE FOODS TAB ──────────────────────────────────────────────────
  const [altTabFood, setAltTabFood]           = useState(null);   // selected food entry for alt lookup
  const [altTabResults, setAltTabResults]     = useState([]);
  const [altTabLoading, setAltTabLoading]     = useState(false);

  async function lookupCalorieAlts(entry){
    setAltTabFood(entry);
    const ck = cacheKey(entry.name);
    // Check calorie alts cache
    const cached = fromCache("calAlts", ck);
    if(cached){ setAltTabResults(cached); setAltTabLoading(false); toast("cache","Calorie alternatives loaded from cache."); return; }
    setAltTabResults([]); setAltTabLoading(true);
    const kcal = entry.offData?.nut?.energy_kcal??null;
    const cat  = entry.offData?.categories?.[0]||null;
    const nut  = entry.offData?.nut||{};
    const alts = await aiCalorieAlternatives(entry.name, kcal, cat, entry.risk, {
      fat:nut.fat, sugars:nut.sugars, protein:nut.protein, fiber:nut.fiber, salt:nut.salt
    }).catch(()=>[]);
    toCache("calAlts", ck, alts);
    setAltTabResults(alts); setAltTabLoading(false);
  }

  const [showAltFor, setShowAltFor]     = useState(null);
  const [panelAlts, setPanelAlts]       = useState([]);
  const [panelAltLoading, setPanelAltLoading] = useState(false);

  function openAltPanel(e, entry){
    e.stopPropagation();
    // Toggle off if already open for this item
    if(showAltFor===entry.id){ setShowAltFor(null); setPanelAlts([]); return; }
    setShowAltFor(entry.id);
    const ck = cacheKey(entry.name);
    // Check panel alts cache (use alts cache too)
    const cached = fromCache("panelAlts", ck) || fromCache("alts", ck);
    if(cached){ setPanelAlts(cached); setPanelAltLoading(false); return; }
    setPanelAlts([]); setPanelAltLoading(true);
    aiAlternatives(entry.name, entry.offData?.brand, entry.offData?.nutriScore, entry.risk, entry.offData?.ingredients)
      .then(a=>{ const res=a||[]; setPanelAlts(res); toCache("panelAlts",ck,res); setPanelAltLoading(false); })
      .catch(()=>{ setPanelAltLoading(false); });
  }

  const tabBtn = (id,label) => (
    <button onClick={()=>setActiveTab(id)} style={{background:"none",border:"none",borderBottom:`2px solid ${activeTab===id?t.accent:"transparent"}`,color:activeTab===id?t.accent:t.textSub,padding:"11px 16px",cursor:"pointer",fontSize:11,fontWeight:activeTab===id?600:500,marginBottom:-2,whiteSpace:"nowrap",transition:"all 0.18s"}}>
      {label}
    </button>
  );

  return(
    <div style={{minHeight:"100vh",background:t.bg,color:t.text,fontFamily:"Inter,'Segoe UI',system-ui,sans-serif",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{font-family:'Inter','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased;box-sizing:border-box}
        @keyframes slideIn{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes shimmer{0%,100%{opacity:0.4}50%{opacity:0.8}}
        @keyframes foodFloat{from{transform:translateY(0) rotate(var(--r,0deg))}to{transform:translateY(-8px) rotate(var(--r,0deg))}}
        @keyframes hstFade{0%,100%{opacity:0.04}50%{opacity:0.08}}
        @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.2);border-radius:4px}
        input::placeholder{color:rgba(128,128,128,0.4);font-style:italic}
        button{font-family:inherit}
      `}</style>

      <Toast items={toasts} onDismiss={id=>setToasts(p=>p.filter(n=>n.id!==id))} t={t}/>
      {showUnknown&&<UnknownModal onClose={()=>setShowUnknown(false)} onSubmit={submitReport} t={t}/>}
      {showDb&&<DbModal db={hazardDb} onClose={()=>setShowDb(false)} t={t}/>}

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

          {/* ── SMART SEARCH BAR ── */}
          <div style={{position:"relative"}}>
            <div style={{display:"flex",alignItems:"center",background:t.inputBg,border:`1.5px solid ${searchOpen?t.accent:t.inputBorder}`,borderRadius:22,padding:"0 14px",gap:8,width:"clamp(180px,22vw,280px)",transition:"all 0.2s",boxShadow:searchOpen?`0 0 0 3px ${t.accent}18`:"none"}}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{flexShrink:0,opacity:0.4}}>
                <circle cx="6.5" cy="6.5" r="5.5" stroke={t.text} strokeWidth="1.5"/>
                <path d="M11 11l3.5 3.5" stroke={t.text} strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input ref={searchRef} value={searchQ} onChange={e=>setSearchQ(e.target.value)}
                onFocus={()=>setSearchOpen(true)}
                onKeyDown={e=>{if(e.key==="Enter")runSearch();if(e.key==="Escape"){setSearchOpen(false);setSearchQ("");}}}
                placeholder="Search anything…"
                style={{flex:1,background:"none",border:"none",outline:"none",fontSize:12,color:t.inputText,padding:"8px 0",minWidth:0}}/>
              {searchQ&&<button onClick={()=>{setSearchQ("");setSearchRes(null);}} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:16,padding:0,lineHeight:1,flexShrink:0}}>×</button>}
            </div>

            {/* Dropdown panel */}
            {searchOpen&&(
              <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,width:"clamp(300px,40vw,480px)",background:t.surface,border:`1px solid ${t.border}`,borderRadius:14,boxShadow:`0 12px 40px rgba(0,0,0,${dark?0.5:0.15})`,zIndex:500,overflow:"hidden"}}>

                {/* Suggestions (when no query typed) */}
                {!searchQ&&!searchRes&&!searchLoading&&(
                  <div style={{padding:"12px 0"}}>
                    <div style={{padding:"4px 16px 8px",fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase"}}>Suggested searches</div>
                    {SUGGESTIONS.map(s=>(
                      <div key={s} onClick={()=>{setSearchQ(s);runSearch(s);}}
                        style={{padding:"9px 16px",fontSize:12,color:t.textSub,cursor:"pointer",display:"flex",alignItems:"center",gap:10,transition:"background 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov}
                        onMouseLeave={e=>e.currentTarget.style.background=""}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{opacity:0.35,flexShrink:0}}>
                          <circle cx="6.5" cy="6.5" r="5.5" stroke={t.text} strokeWidth="1.5"/>
                          <path d="M11 11l3.5 3.5" stroke={t.text} strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                        {s}
                      </div>
                    ))}
                  </div>
                )}

                {/* Loading */}
                {searchLoading&&(
                  <div style={{padding:"24px 20px",display:"flex",alignItems:"center",gap:12,color:t.textSub,fontSize:13}}>
                    <span style={{display:"inline-block",width:14,height:14,border:`2px solid ${t.accent}`,borderTop:"2px solid transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite",flexShrink:0}}/>
                    Searching…
                  </div>
                )}

                {/* Results */}
                {searchRes&&!searchLoading&&(
                  <div>
                    {/* Answer */}
                    <div style={{padding:"16px 18px",borderBottom:`1px solid ${t.border}`}}>
                      <div style={{fontSize:10,fontWeight:600,color:t.accent,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:6}}>
                        {searchRes.category==="credibility"?"Brand Credibility":searchRes.category==="risk"?"Risk Assessment":searchRes.category==="sugar"?"Sugar Analysis":searchRes.category==="additives"?"Additives":searchRes.category==="nutrition"?"Nutrition":searchRes.category==="diet"?"Diet Classification":"Search Result"}
                      </div>
                      <p style={{margin:0,fontSize:13,color:t.text,lineHeight:1.7}}>{searchRes.answer}</p>
                    </div>

                    {/* Matches */}
                    {searchRes.matches?.length>0&&(
                      <div style={{borderBottom:`1px solid ${t.border}`}}>
                        <div style={{padding:"8px 18px 4px",fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase"}}>Matching items</div>
                        {searchRes.matches.slice(0,5).map((m,i)=>(
                          <div key={i} style={{padding:"9px 18px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,borderTop:`1px solid ${t.tableBorder}`,cursor:"pointer",transition:"background 0.15s"}}
                            onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov}
                            onMouseLeave={e=>e.currentTarget.style.background=""}
                            onClick={()=>{
                              const found=tracked.find(f=>f.name.toLowerCase().includes(m.name.toLowerCase())||f.offData?.brand?.toLowerCase().includes(m.name.toLowerCase()));
                              if(found){selectEntry(found);setActiveTab("tracker");setSearchOpen(false);}
                            }}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
                                <span style={{fontSize:12,fontWeight:600,color:t.text}}>{m.name}</span>
                                {(()=>{
                                  // Use diet from match result, or look it up from tracked products
                                  const dietVal = m.diet || tracked.find(f=>f.name.toLowerCase().includes(m.name.toLowerCase()))?.diet;
                                  if(!dietVal||dietVal==="unknown") return null;
                                  const dc = DIET[dietVal];
                                  if(!dc) return null;
                                  return(
                                    <span style={{display:"inline-flex",alignItems:"center",gap:4,background:dc.bg,border:`1px solid ${dc.border}`,borderRadius:5,padding:"1px 7px",flexShrink:0}}>
                                      <span style={{fontSize:11,lineHeight:1}}>{dc.icon}</span>
                                      <span style={{fontSize:9,fontWeight:600,color:dc.fg}}>{dc.label}</span>
                                    </span>
                                  );
                                })()}
                              </div>
                              <div style={{fontSize:11,color:t.textSub,lineHeight:1.5}}>{m.reason}</div>
                            </div>
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{flexShrink:0,opacity:0.3,marginTop:3}}>
                              <path d="M6 3l5 5-5 5" stroke={t.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tip */}
                    {searchRes.tip&&(
                      <div style={{padding:"12px 18px",background:dark?"rgba(61,82,196,0.08)":"rgba(61,82,196,0.04)",display:"flex",gap:10,alignItems:"flex-start"}}>
                        <div style={{width:18,height:18,borderRadius:"50%",background:t.accent,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                          <span style={{fontSize:10,color:"#fff",fontWeight:700}}>i</span>
                        </div>
                        <p style={{margin:0,fontSize:11,color:t.textSub,lineHeight:1.6}}>{searchRes.tip}</p>
                      </div>
                    )}

                    <div style={{padding:"8px 18px",display:"flex",justifyContent:"flex-end"}}>
                      <button onClick={()=>{setSearchOpen(false);setSearchRes(null);setSearchQ("");}} style={{background:"none",border:"none",fontSize:11,color:t.textMuted,cursor:"pointer",padding:0}}>Dismiss</button>
                    </div>
                  </div>
                )}

                {/* Click-outside close hint */}
                {!searchQ&&!searchRes&&!searchLoading&&<div style={{padding:"8px 16px",borderTop:`1px solid ${t.border}`,fontSize:10,color:t.textMuted}}>Press Esc to close</div>}
              </div>
            )}
          </div>


          <button onClick={()=>setDark(p=>!p)} style={{background:t.pill,border:`1px solid ${t.border}`,borderRadius:20,padding:"6px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:7,transition:"all 0.25s"}} onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHov} onMouseLeave={e=>e.currentTarget.style.background=t.pill}>
            <span style={{fontSize:13}}>{dark?"☀️":"🌙"}</span>
            <span style={{fontSize:11,fontWeight:600,color:t.textSub}}>{dark?"Light":"Dark"}</span>
          </button>
          {[["Tracked",tracked.length],["High risk",tracked.filter(f=>f.risk==="high").length],["Reports",reports.length]].map(([l,v])=>(
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
      </div>

      {/* ════ TRACKER TAB ════ */}
      {activeTab==="tracker"&&(
        <div style={{display:"grid",gridTemplateColumns:"minmax(260px,320px) 1fr",height:"calc(100vh - 109px)"}}>

          {/* LEFT PANEL */}
          <div style={{background:t.leftBg,borderRight:`1px solid ${t.border}`,display:"flex",flexDirection:"column",overflow:"hidden",position:"relative"}}>
            <div style={{padding:"16px 16px 10px"}}>
              <div style={{fontSize:12,fontWeight:600,color:t.text,marginBottom:3}}>Scan a product</div>
              <div style={{fontSize:11,color:t.textMuted,marginBottom:10}}>Open Food Facts + AI analysis</div>
              <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} disabled={scanning}
                placeholder="Product name or barcode…"
                style={{width:"100%",border:`1.5px solid ${t.inputBorder}`,borderRadius:9,padding:"10px 13px",fontSize:13,outline:"none",background:t.inputBg,color:t.inputText,transition:"border-color 0.18s",display:"block"}}
                onFocus={e=>e.target.style.borderColor=t.accent} onBlur={e=>e.target.style.borderColor=t.inputBorder}/>

              {/* ── SCAN BUTTON — refined, no symbols ── */}
              <button onClick={()=>scan()} disabled={scanning||!input.trim()}
                style={{marginTop:8,width:"100%",background:scanning?t.pill:t.accent,border:"none",color:scanning?t.textMuted:t.accentFg,padding:"11px 16px",borderRadius:9,cursor:scanning||!input.trim()?"default":"pointer",fontSize:13,fontWeight:600,letterSpacing:"0.01em",display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:!input.trim()&&!scanning?0.45:1,transition:"all 0.2s",boxShadow:!input.trim()||scanning?"none":`0 2px 12px ${t.accent}40`}}>
                {scanning
                  ?<><span style={{display:"inline-block",width:13,height:13,border:`2px solid ${t.textMuted}`,borderTop:`2px solid transparent`,borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Scanning…</>
                  :"Scan"
                }
              </button>


              <div style={{marginTop:9,padding:"8px 11px",background:dark?"rgba(61,82,196,0.1)":"rgba(61,82,196,0.05)",border:`1px solid ${dark?"rgba(61,82,196,0.25)":"rgba(61,82,196,0.15)"}`,borderRadius:8,fontSize:10,color:t.textSub,lineHeight:1.6}}>
                Fetches real data from Open Food Facts + AI hazard analysis. Repeat scans load instantly from cache.
              </div>
            </div>

            {/* Risk Filter */}
            <div style={{padding:"7px 14px 5px",display:"flex",gap:4}}>
              {[["all","All"],["high","High"],["medium","Med"],["low","Low"]].map(([r,l])=>(
                <button key={r} onClick={()=>setFilterRisk(r)} style={{flex:1,padding:"5px 3px",background:filterRisk===r?(r==="all"?t.accent:RISK[r].fg):t.pill,border:"none",color:filterRisk===r?"#fff":t.pillText,borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:600,transition:"all 0.18s"}}>
                  {l}
                </button>
              ))}
            </div>


            {/* List */}
            <div style={{flex:1,overflowY:"auto",padding:"8px"}}>
              {scanning&&(
                <div style={{padding:"12px",marginBottom:4,background:dark?"rgba(61,82,196,0.08)":"rgba(61,82,196,0.05)",border:`1px solid ${dark?"rgba(61,82,196,0.18)":"rgba(61,82,196,0.12)"}`,borderRadius:9,fontSize:11,color:t.accent,display:"flex",alignItems:"center",gap:8,animation:"pulse 1.2s infinite"}}>
                  <span style={{display:"inline-block",width:10,height:10,border:`2px solid ${t.accent}`,borderTop:"2px solid transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite",flexShrink:0}}/>
                  Scanning "{input}"…
                </div>
              )}
              {filteredTracked.length===0&&!scanning&&(
                <div style={{padding:"30px 14px",textAlign:"center",color:t.textMuted,fontSize:11,lineHeight:1.9}}>
                  No products scanned yet.
                </div>
              )}
              {filteredTracked.map(f=>{
                const sugar = f.offData?.nut?.sugars??f.aiSugarData?.total_sugars??null;
                const isSel = selected?.id===f.id;
                const isHighRisk = f.risk==="high"||f.risk==="medium"||["c","d","e"].includes(f.offData?.nutriScore||"");
                return(
                  <div key={f.id} style={{marginBottom:4}}>
                    <div onClick={()=>selectEntry(f)} style={{padding:"10px 12px",background:isSel?t.cardSel:t.cardBg,border:`1px solid ${isSel?t.cardSelBorder:t.cardBorder}`,borderLeft:`3px solid ${f.diet&&f.diet!=="unknown"?DIET[f.diet]?.fg:(f.risk?RISK[f.risk]?.fg:"transparent")}`,borderRadius:isHighRisk?"9px 9px 0 0":9,cursor:"pointer",transition:"all 0.18s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                          {f.offData?.brand&&<div style={{fontSize:10,color:t.textSub,marginTop:1}}>{f.offData.brand}</div>}
                        </div>
                        <div style={{display:"flex",gap:3,alignItems:"center",flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                          {f.offData&&<span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"1px 5px",borderRadius:3}}>OFF</span>}
                          {f.offData?.nutriScore&&<span style={{fontSize:9,fontWeight:700,color:"#fff",background:NS_COLOR[f.offData.nutriScore]||"#999",padding:"1px 6px",borderRadius:4}}>{f.offData.nutriScore.toUpperCase()}</span>}
                          {f.risk&&<span style={{fontSize:8,fontWeight:600,color:RISK[f.risk]?.fg,background:RISK[f.risk]?.bg,border:`1px solid ${RISK[f.risk]?.border}`,padding:"1px 6px",borderRadius:4}}>{f.risk.charAt(0).toUpperCase()+f.risk.slice(1)}</span>}
                        {f.diet&&f.diet!=="unknown"&&<span title={DIET[f.diet]?.label} style={{fontSize:11,display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,borderRadius:4,background:DIET[f.diet]?.bg,border:`1px solid ${DIET[f.diet]?.border}`}}>{DIET[f.diet]?.icon}</span>}
                        </div>
                      </div>
                      <div style={{marginTop:4,fontSize:9,color:t.textMuted,fontFamily:"monospace"}}>
                        {f.substances.length} hazard{f.substances.length!==1?"s":""}
                        {f.offData&&` · ${f.offData.additives.length} additives`}
                        {sugar!==null&&` · ${sugar}g sugar`}
                        {" · "}{f.date}
                      </div>
                      {f.diet&&f.diet!=="unknown"&&(
                        <div style={{marginTop:4,display:"inline-flex",alignItems:"center",gap:4,background:DIET[f.diet]?.bg,border:`1px solid ${DIET[f.diet]?.border}`,borderRadius:5,padding:"2px 7px"}}>
                          <span style={{fontSize:10,lineHeight:1}}>{DIET[f.diet]?.icon}</span>
                          <span style={{fontSize:9,fontWeight:600,color:DIET[f.diet]?.fg}}>{DIET[f.diet]?.label}</span>
                        </div>
                      )}
                    </div>
                    {/* Other Options button — shown for high/medium risk or poor Nutri-Score */}
                    {isHighRisk&&(
                      <button onClick={e=>openAltPanel(e,f)}
                        style={{width:"100%",background:showAltFor===f.id?t.accent:`${RISK[f.risk==="high"?"high":"medium"]?.fg}12`,border:`1px solid ${showAltFor===f.id?t.accent:RISK[f.risk==="high"?"high":"medium"]?.border}`,borderTop:"none",borderRadius:"0 0 9px 9px",padding:"7px 12px",cursor:"pointer",fontSize:10,fontWeight:600,color:showAltFor===f.id?t.accentFg:RISK[f.risk==="high"?"high":"medium"]?.fg,transition:"all 0.18s",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                        {panelAltLoading&&showAltFor===f.id
                          ?<><span style={{display:"inline-block",width:9,height:9,border:`1.5px solid currentColor`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Finding better options…</>
                          :<>{showAltFor===f.id?"Hide options":"See better options"}</>
                        }
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── OTHER OPTIONS SLIDE PANEL ── */}
          {showAltFor&&(
            <div style={{position:"absolute",bottom:0,left:0,width:"minmax(260px,320px)",zIndex:50,maxWidth:320,borderTop:`2px solid ${t.accent}`,background:t.surface,boxShadow:`0 -4px 24px rgba(0,0,0,${dark?0.4:0.12})`,maxHeight:"55vh",display:"flex",flexDirection:"column",animation:"slideUp 0.28s ease"}}>
              <div style={{padding:"12px 14px 8px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${t.border}`}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:t.accent,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:2}}>Better Options</div>
                  <div style={{fontSize:12,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}}>
                    {tracked.find(f=>f.id===showAltFor)?.name||""}
                  </div>
                </div>
                <button onClick={()=>{setShowAltFor(null);setPanelAlts([]);}} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",fontSize:18,lineHeight:1,padding:"2px 4px"}}>×</button>
              </div>
              <div style={{overflowY:"auto",flex:1,padding:"8px 10px",display:"flex",flexDirection:"column",gap:8}}>
                {panelAltLoading&&!panelAlts.length&&(
                  <div style={{padding:"20px",textAlign:"center",color:t.textSub,fontSize:12,display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
                    <span style={{display:"inline-block",width:18,height:18,border:`2px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>
                    Searching for healthier alternatives…
                  </div>
                )}
                {!panelAltLoading&&panelAlts.length===0&&(
                  <div style={{padding:"18px",textAlign:"center",color:t.textMuted,fontSize:12,lineHeight:1.7}}>No alternatives found. Try scanning a similar product.</div>
                )}
                {panelAlts.map((alt,i)=>(
                  <div key={i} style={{background:t.cardBg,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:8,padding:"11px 12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6,marginBottom:5}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:t.text,lineHeight:1.3}}>{alt.name}</div>
                        {alt.brand&&<div style={{fontSize:10,color:t.textSub,marginTop:1}}>{alt.brand}</div>}
                      </div>
                      <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
                        {alt.nutriScore&&alt.nutriScore!=="unknown"&&(
                          <span style={{fontSize:9,fontWeight:700,color:"#fff",background:NS_COLOR[alt.nutriScore]||"#999",padding:"2px 6px",borderRadius:4}}>{alt.nutriScore.toUpperCase()}</span>
                        )}
                        <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",padding:"1px 6px",borderRadius:4}}>Better</span>
                      </div>
                    </div>
                    <div style={{fontSize:11,color:t.textSub,lineHeight:1.55,marginBottom:alt.improvements?.length?6:0}}>{alt.reason}</div>
                    {alt.improvements?.length>0&&(
                      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:alt.sourceUrl?6:0}}>
                        {alt.improvements.slice(0,2).map((imp,j)=>(
                          <span key={j} style={{fontSize:9,color:"#2e7d52",background:"rgba(46,125,82,0.08)",border:"1px solid rgba(46,125,82,0.18)",padding:"1px 7px",borderRadius:8}}>✓ {imp}</span>
                        ))}
                      </div>
                    )}
                    {alt.sourceUrl&&(
                      <a href={alt.sourceUrl} target="_blank" rel="noopener noreferrer"
                        style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:t.accent,textDecoration:"none",borderBottom:`1px solid ${t.accent}40`,marginTop:2}}>
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5L2 14M10 2h4v4M14 2l-6 6" stroke={t.accent} strokeWidth="1.5" strokeLinecap="round"/></svg>
                        {alt.sourceName||"View product"}
                      </a>
                    )}
                  </div>
                ))}
                <div style={{padding:"6px 2px",fontSize:9,color:t.textMuted,lineHeight:1.6,borderTop:`1px solid ${t.border}`,marginTop:4}}>
                  Alternatives suggested by AI — verify availability in your region.
                </div>
              </div>
            </div>
          )}

          {/* RIGHT PANEL */}
          <div style={{overflowY:"auto",padding:"18px 22px",background:t.rightBg}}>
            {!selected ? (
              /* ── EMPTY STATE with food illustrations ── */
              <div style={{position:"relative",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                <FoodIllustration t={t}/>
                {/* Giant HST watermark */}
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",userSelect:"none"}}>
                  <span style={{fontSize:"clamp(100px,20vw,200px)",fontWeight:800,color:t.text,opacity:dark?0.03:0.04,letterSpacing:"-6px",lineHeight:1,animation:"hstFade 5s ease-in-out infinite"}}>HST</span>
                </div>
                {/* Center content */}
                <div style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:16,maxWidth:380,textAlign:"center"}}>
                  <div style={{width:68,height:68,background:t.accent,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 20px ${t.accent}35`}}>
                    <span style={{fontSize:22,fontWeight:800,color:"#fff",letterSpacing:"-1px"}}>HST</span>
                  </div>
                  <div>
                    <div style={{fontSize:20,fontWeight:700,color:t.text,marginBottom:5,letterSpacing:"-0.3px"}}>Hazard Substance Tracker</div>
                    <div style={{fontSize:12,color:t.textMuted,fontWeight:500}}>Open Food Facts · AI Hazard Analysis · Brand Credibility</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,width:"100%",marginTop:4}}>
                    {[["Real product data","Open Food Facts database"],["Hazard detection","AI + curated database"],["Full sugar profile","Total, added & natural"],["Brand credibility","Research & scoring"]].map(([title,sub])=>(
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
              <OFFCard offData={selected.offData} aiSugarData={selected.aiSugarData} substances={selected.substances} insight={insight} insightLoading={insightLoading} brandCred={brandCred} brandCredLoading={brandCredLoading} alternatives={alternatives} altLoading={altLoading} t={t} dark={dark}/>
            ) : (
              /* Fallback when no OFF data */
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{background:t.surface,borderRadius:12,padding:"16px 18px",border:`1px solid ${t.border}`}}>
                  <div style={{fontSize:10,fontWeight:600,color:RISK.medium.fg,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>No Open Food Facts data</div>
                  <h2 style={{margin:"0 0 5px",fontSize:18,fontWeight:700,color:t.text}}>{selected.name}</h2>
                  <div style={{fontSize:11,color:t.textSub}}>{selected.substances.length} substances detected · {selected.date}</div>
                  {selected.aiSugarData&&(
                    <div style={{marginTop:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {[{l:"Total Sugars",v:selected.aiSugarData.total_sugars},{l:"Added Sugars",v:selected.aiSugarData.added_sugars}].filter(x=>x.v!==null).map(x=>(
                        <div key={x.l} style={{textAlign:"center",padding:"10px 8px",background:t.bgSub,borderRadius:9,border:`1.5px solid ${tlColor("sugars",x.v)}30`}}>
                          <div style={{fontSize:9,fontWeight:600,color:t.textMuted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:4}}>{x.l}</div>
                          <div style={{fontSize:24,fontWeight:800,color:tlColor("sugars",x.v),fontFamily:"monospace"}}>{x.v}g</div>
                          <div style={{fontSize:10,color:t.textSub}}>per 100g</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {selected.substances.map((s,i)=>(
                  <div key={i} style={{background:t.surface,borderLeft:`3px solid ${RISK[s.risk]?.fg||"#999"}`,borderRadius:9,padding:"11px 14px",border:`1px solid ${t.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                      <div>{s.eNumber&&<span style={{fontSize:9,fontFamily:"monospace",fontWeight:600,color:"#b07d2b",background:"rgba(176,125,43,0.1)",padding:"1px 6px",borderRadius:3,marginBottom:3,display:"inline-block"}}>{s.eNumber}</span>}<div style={{fontSize:13,fontWeight:600,color:t.text,marginTop:2}}>{s.name}</div><div style={{fontSize:10,color:t.textMuted}}>{s.category}</div></div>
                      <span style={{fontSize:9,fontWeight:600,color:RISK[s.risk]?.fg,background:RISK[s.risk]?.bg,border:`1px solid ${RISK[s.risk]?.border}`,padding:"3px 9px",borderRadius:4}}>{s.risk?.charAt(0).toUpperCase()+s.risk?.slice(1)}</span>
                    </div>
                    <div style={{fontSize:11,color:t.textSub,lineHeight:1.6}}>{s.effects}</div>
                  </div>
                ))}
                <div style={{background:t.surface,borderRadius:10,padding:"14px 16px",border:`1px solid ${t.border}`}}>
                  <div style={{fontSize:12,fontWeight:600,color:t.text,marginBottom:8}}>AI Safety Analysis</div>
                  {insightLoading?<div style={{color:t.textMuted,fontSize:12,fontStyle:"italic",animation:"pulse 1.4s ease infinite"}}>Generating…</div>:insight?<p style={{margin:0,fontSize:12,color:t.textSub,lineHeight:1.8}}>{insight}</p>:null}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════ ALTERNATIVE FOODS TAB ════ */}
      {activeTab==="alternatives"&&(
        <div style={{overflowY:"auto",height:"calc(100vh - 109px)",background:t.bg}}>
          <div style={{display:"grid",gridTemplateColumns:"minmax(280px,340px) 1fr",height:"100%"}}>

            {/* LEFT — product picker */}
            <div style={{background:t.leftBg,borderRight:`1px solid ${t.border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:"16px 16px 12px",borderBottom:`1px solid ${t.border}`}}>
                <div style={{fontSize:12,fontWeight:600,color:t.text,marginBottom:3}}>Alternative Foods</div>
                <div style={{fontSize:11,color:t.textMuted,lineHeight:1.6}}>Select a scanned product to find healthier alternatives with the same calorie count.</div>
              </div>
              <div style={{flex:1,overflowY:"auto",padding:"8px"}}>
                {tracked.length===0?(
                  <div style={{padding:"32px 14px",textAlign:"center",color:t.textMuted,fontSize:11,lineHeight:1.9}}>No products scanned yet.<br/>Scan a product first to find alternatives.</div>
                ):tracked.map(f=>{
                  const kcal = f.offData?.nut?.energy_kcal??null;
                  const isSel = altTabFood?.id===f.id;
                  return(
                    <div key={f.id} onClick={()=>lookupCalorieAlts(f)}
                      style={{padding:"11px 12px",marginBottom:4,background:isSel?t.cardSel:t.cardBg,border:`1px solid ${isSel?t.cardSelBorder:t.cardBorder}`,borderLeft:`3px solid ${f.risk?RISK[f.risk]?.fg:"transparent"}`,borderRadius:9,cursor:"pointer",transition:"all 0.18s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                          {f.offData?.brand&&<div style={{fontSize:10,color:t.textSub,marginTop:1}}>{f.offData.brand}</div>}
                        </div>
                        <div style={{display:"flex",gap:3,alignItems:"center",flexShrink:0}}>
                          {f.offData?.nutriScore&&<span style={{fontSize:9,fontWeight:700,color:"#fff",background:NS_COLOR[f.offData.nutriScore]||"#999",padding:"1px 6px",borderRadius:4}}>{f.offData.nutriScore.toUpperCase()}</span>}
                          {f.risk&&<span style={{fontSize:8,fontWeight:600,color:RISK[f.risk]?.fg,background:RISK[f.risk]?.bg,border:`1px solid ${RISK[f.risk]?.border}`,padding:"1px 5px",borderRadius:3}}>{f.risk.charAt(0).toUpperCase()+f.risk.slice(1)}</span>}
                        </div>
                      </div>
                      <div style={{marginTop:5,display:"flex",alignItems:"center",gap:8}}>
                        {kcal!==null&&(
                          <span style={{fontSize:10,fontFamily:"monospace",fontWeight:600,color:t.accent}}>{kcal} kcal</span>
                        )}
                        <span style={{fontSize:9,color:t.textMuted}}>per 100g</span>
                        {isSel&&<span style={{fontSize:9,fontWeight:600,color:t.accent,marginLeft:"auto"}}>Selected</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT — calorie-matched alternatives */}
            <div style={{overflowY:"auto",padding:"20px 24px",background:t.rightBg}}>
              {!altTabFood?(
                <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",gap:14,color:t.textMuted,position:"relative",overflow:"hidden"}}>
                  <FoodIllustration t={t}/>
                  <div style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
                    <div style={{width:56,height:56,background:t.accent,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 16px ${t.accent}30`}}>
                      <span style={{fontSize:22,color:"#fff"}}>🥗</span>
                    </div>
                    <div style={{fontSize:17,fontWeight:700,color:t.text,letterSpacing:"-0.3px"}}>Find Calorie-Matched Alternatives</div>
                    <div style={{fontSize:12,color:t.textMuted,maxWidth:320,lineHeight:1.75}}>Select any scanned product to find healthier alternatives — fruits, vegetables, whole foods and better packaged options — all matched to the same calorie count.</div>
                  </div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  {/* Header */}
                  <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"16px 18px"}}>
                    <div style={{fontSize:10,fontWeight:600,color:t.textMuted,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:4}}>Finding alternatives for</div>
                    <div style={{fontSize:17,fontWeight:700,color:t.text,marginBottom:3}}>{altTabFood.name}</div>
                    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
                      {altTabFood.offData?.nut?.energy_kcal&&(
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          <span style={{fontSize:22,fontWeight:800,color:t.accent,fontFamily:"monospace"}}>{altTabFood.offData.nut.energy_kcal}</span>
                          <span style={{fontSize:11,color:t.textSub}}>kcal / 100g</span>
                        </div>
                      )}
                      {altTabFood.risk&&<span style={{fontSize:10,fontWeight:600,color:RISK[altTabFood.risk]?.fg,background:RISK[altTabFood.risk]?.bg,border:`1px solid ${RISK[altTabFood.risk]?.border}`,padding:"3px 10px",borderRadius:5}}>{altTabFood.risk.charAt(0).toUpperCase()+altTabFood.risk.slice(1)} Risk</span>}
                      {altTabFood.offData?.nutriScore&&<span style={{fontSize:11,fontWeight:700,color:"#fff",background:NS_COLOR[altTabFood.offData.nutriScore]||"#999",padding:"3px 10px",borderRadius:5}}>{altTabFood.offData.nutriScore.toUpperCase()}</span>}
                    </div>
                    {altTabFood.offData?.nut?.energy_kcal&&(
                      <div style={{marginTop:8,fontSize:10,color:t.textMuted,padding:"6px 10px",background:dark?"rgba(61,82,196,0.08)":"rgba(61,82,196,0.05)",borderRadius:6,border:`1px solid ${dark?"rgba(61,82,196,0.2)":"rgba(61,82,196,0.12)"}`}}>
                        Showing foods within ±50 kcal of {altTabFood.offData.nut.energy_kcal} kcal per 100g
                      </div>
                    )}
                  </div>

                  {/* Loading */}
                  {altTabLoading&&(
                    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"32px",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
                      <span style={{display:"inline-block",width:22,height:22,border:`2.5px solid ${t.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>
                      <div style={{fontSize:13,color:t.textSub}}>Searching for calorie-matched alternatives…</div>
                      <div style={{fontSize:11,color:t.textMuted}}>Looking for foods with similar calories but better nutritional profile</div>
                    </div>
                  )}

                  {/* Results */}
                  {!altTabLoading&&altTabResults.length===0&&altTabFood&&(
                    <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:"32px",textAlign:"center",color:t.textMuted,fontSize:12,lineHeight:1.8}}>
                      No alternatives found. Try scanning another product.
                    </div>
                  )}

                  {altTabResults.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      <div style={{fontSize:11,fontWeight:600,color:t.textSub,letterSpacing:"0.04em"}}>{altTabResults.length} healthier alternatives found · sorted by nutritional quality</div>
                      {altTabResults.map((alt,i)=>{
                        const calDiff = alt.calories&&altTabFood.offData?.nut?.energy_kcal
                          ? alt.calories - altTabFood.offData.nut.energy_kcal : null;
                        return(
                          <div key={i} style={{background:t.surface,border:`1px solid ${t.border}`,borderLeft:"3px solid #2e7d52",borderRadius:12,overflow:"hidden"}}>
                            {/* Alt header */}
                            <div style={{padding:"14px 16px",borderBottom:`1px solid ${t.border}`}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:8}}>
                                <div style={{flex:1}}>
                                  <div style={{fontSize:14,fontWeight:700,color:t.text,marginBottom:2}}>{alt.name}</div>
                                  {alt.brand&&<div style={{fontSize:11,color:t.textSub}}>{alt.brand}</div>}
                                </div>
                                <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
                                  {alt.nutriScore&&alt.nutriScore!=="unknown"&&(
                                    <span style={{fontSize:10,fontWeight:700,color:"#fff",background:NS_COLOR[alt.nutriScore]||"#999",padding:"3px 9px",borderRadius:5}}>{alt.nutriScore.toUpperCase()}</span>
                                  )}
                                  <span style={{fontSize:9,fontWeight:600,color:"#2e7d52",background:"rgba(46,125,82,0.1)",border:"1px solid rgba(46,125,82,0.2)",padding:"2px 8px",borderRadius:4}}>Better choice</span>
                                </div>
                              </div>
                              {/* Calorie comparison */}
                              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                                <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                                  <span style={{fontSize:20,fontWeight:800,color:t.accent,fontFamily:"monospace"}}>{alt.calories}</span>
                                  <span style={{fontSize:10,color:t.textSub}}>kcal / {alt.caloriesPer||"100g"}</span>
                                </div>
                                {calDiff!==null&&(
                                  <span style={{fontSize:10,fontWeight:600,color:Math.abs(calDiff)<=10?"#2e7d52":t.textSub,background:Math.abs(calDiff)<=10?"rgba(46,125,82,0.08)":t.pill,padding:"2px 8px",borderRadius:5}}>
                                    {calDiff===0?"Same calories":calDiff>0?`+${calDiff} kcal`:`${calDiff} kcal`}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Nutrition comparison mini-table */}
                            <div style={{padding:"12px 16px",borderBottom:`1px solid ${t.border}`}}>
                              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                                {[["Protein",alt.protein,"g","#3d6b99"],["Sugars",alt.sugars,"g",tlColor("sugars",alt.sugars)],["Fibre",alt.fiber,"g","#2e7d52"],["Fat",alt.fat,"g",tlColor("fat",alt.fat)]].map(([label,val,unit,col])=>(
                                  <div key={label} style={{textAlign:"center",padding:"8px 4px",background:t.bgSub,borderRadius:7}}>
                                    <div style={{fontSize:9,color:t.textMuted,marginBottom:3,fontWeight:500}}>{label}</div>
                                    <div style={{fontSize:14,fontWeight:700,color:val!==null?col:t.textMuted,fontFamily:"monospace"}}>{val!==null?`${fmt(val)}${unit}`:"—"}</div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Why better + benefits */}
                            <div style={{padding:"12px 16px"}}>
                              <div style={{fontSize:12,color:t.textSub,lineHeight:1.65,marginBottom:8}}>{alt.whyBetter}</div>
                              {alt.benefits?.length>0&&(
                                <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:alt.sourceUrl?8:0}}>
                                  {alt.benefits.map((b,j)=>(
                                    <span key={j} style={{fontSize:10,color:"#2e7d52",background:"rgba(46,125,82,0.07)",border:"1px solid rgba(46,125,82,0.18)",padding:"2px 9px",borderRadius:10}}>✓ {b}</span>
                                  ))}
                                </div>
                              )}
                              {alt.sourceUrl&&(
                                <a href={alt.sourceUrl} target="_blank" rel="noopener noreferrer"
                                  style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,color:t.accent,textDecoration:"none",borderBottom:`1px solid ${t.accent}40`,marginTop:4}}>
                                  <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5L2 14M10 2h4v4M14 2l-6 6" stroke={t.accent} strokeWidth="1.5" strokeLinecap="round"/></svg>
                                  {alt.sourceName||"View product"}
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <div style={{fontSize:9,color:t.textMuted,lineHeight:1.7,padding:"4px 2px"}}>Alternatives suggested by AI with web search · calorie counts verified · availability may vary by region.</div>
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
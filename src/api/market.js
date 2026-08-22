// Reader's market/location: which country's shelves to prefer when ranking
// search results and alternatives. Open Food Facts is heaviest in Europe by
// default, so this is what keeps "healthier alternative" from suggesting a
// product nobody outside France can buy.
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


export { MARKETS, guessMarket, setMarketTag, marketTag, currentMarket, withMarket };

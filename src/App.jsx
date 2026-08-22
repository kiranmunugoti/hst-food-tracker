import { useState, useRef, useEffect } from "react";
import { productRatings, addReview, SENSITIVITY_GROUPS, HEALTH_CONDITIONS } from "./ratings.js";
import { APP_TITLE_LEAD, APP_TITLE_ACCENT } from "./brand.js";
// Native barcode scanning (Capacitor + Google ML Kit). Safe to import into the
// plain website build: @capacitor/core is a universal no-op-safe shim
// (Capacitor.isNativePlatform() simply returns false in a browser).
import { Capacitor } from "@capacitor/core";

import { GH_OWNER, GH_REPO, GH_BRANCH, GH_FILE, GH_RAW, AI_MODE, DOMAIN, setAiModeFlag, setDomainFlag } from "./lib/config.js";
import { RISK_CFG, DIET_CFG, NS_COLOR, fmt, tlColor, normKey, makeTheme } from "./lib/theme.js";
import { SEED } from "./lib/hazards.js";
import { localInsight } from "./lib/hazards.js";
import { productCredibility, brandScoreStable, undeclaredOf, computeBrandStats, brandHistory } from "./engine/brandScoring.js";
import { fetchOFFAlternatives, fetchOFFCalorieAlts, analyzeProduct, lookupAndAnalyze } from "./engine/analysis.js";

import { callAI, aiInsight, aiAlternatives, aiCalorieAlts, aiBrandCredibility } from "./api/claude.js";
import { asText, asList, domainLabel, offSearch, _offStatus } from "./api/openFoodFacts.js";
import { MARKETS, guessMarket, setMarketTag } from "./api/market.js";
import { discoveryIntent, cloudDiscover, cloudSearch, CLOUD_FILTERS, parseOFF } from "./api/discovery.js";
import { foodSearchMerged, diagnoseSources } from "./api/sourceDiagnostics.js";
import {
  _ghDb, _ghLastError, ghLoad, ghGet, ghSet, ghLogSearch,
  compressImage, ghPutImage, saveLocalImage, getLocalImage, photoKeyFor,
} from "./api/githubDb.js";

import { verifyPhotoByBarcode, verifyPhotoMatches, scoreImage } from "./scanning/photoVerification.js";
import { scanNative, DECODE_URL, serverReadText, ocrText, looksLikeGibberish } from "./scanning/decode.js";
import { BarcodeScanner } from "./scanning/BarcodeScanner.jsx";

import { useViewport } from "./components/useViewport.js";
import { FoodBg } from "./components/FoodBg.jsx";
import { Toast } from "./components/Toast.jsx";
import { RatingsPanel } from "./components/RatingsPanel.jsx";
import { Disclaimer } from "./components/Disclaimer.jsx";
import { nutFor } from "./components/NutritionRow.jsx";
import { OFFCard } from "./components/OFFCard.jsx";
import { DishBuilder } from "./components/DishBuilder.jsx";

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
  const [ocrState,setOcrState]     = useState(null);
  const ocrFileRef = useRef(null);
  // Which field the next OCR result should fill — the dialog and the add form
  // share one hidden file input, so the target is set at click time.
  const ocrTargetRef = useRef(null);
  const [newProduct,setNewProduct] = useState({
    name:"", brand:"", code:"", domain:"food",
    ingredients:"", additives:"", allergens:"", labels:"", quantity:"", category:"",
  });
  const [marketOpen,setMarketOpen]     = useState(false);
  const [marketQuery,setMarketQuery]   = useState("");
  const [marketDraft,setMarketDraft]   = useState(() => guessMarket());
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
    setAiModeFlag(true); setAiMode(true);
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
    setDomainFlag(d); setDomainState(d);
  };

  const toggleAI = () => {
    if (AI_MODE) {
      setAiModeFlag(false); setAiMode(false);
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
      toast("brand", `${a.offData.brand} — brand rating ${history.score}/10 (${history.verdict}), based on ${history.count} product${history.count!==1?"s":""} in the shared database${parts.length ? `: ${parts.join(", ")}` : " with nothing flagged"}.${history.thin ? " Too few products to be a verdict on the brand — treat it as indicative." : ""}`);
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
  // Photograph an ingredient list instead of typing it. This is the single
  // biggest barrier to contributing: a pack's ingredient list runs to dozens of
  // words in tiny print, and nobody types that on a phone.
  //
  // OCR runs on the device, so it needs no API key and the photo never leaves
  // the phone. The result lands in an EDITABLE box, not straight into the
  // database — OCR on curved, glossy packaging misreads, and a wrong ingredient
  // list is worse than none. The reader corrects it against the pack.
  async function scanIngredientsFromPhoto(file, into) {
    if (!file) return;
    setOcrState({ busy: true, step: "preparing" });
    try {
      const bmp = await createImageBitmap(file);
      const r = await ocrText(bmp, (step, p) =>
        setOcrState({ busy: true, step: `${step}${p ? ` ${Math.round(p * 100)}%` : ""}` }));

      // Tidy the usual OCR artefacts on ingredient panels without changing words.
      const cleaned = r.text
        .replace(/\r/g, "")
        .replace(/[|]/g, "I")
        .replace(/\s*\n\s*/g, " ")     // lists wrap mid-word across lines
        .replace(/-\s+/g, "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.;:])/g, "$1")
        .trim();

      const gibberish = looksLikeGibberish(cleaned, r.confidence);

      if ((!cleaned || gibberish) && DECODE_URL) {
        // The server pipeline preprocesses far more aggressively than the
        // browser can, so it is worth one attempt before giving up — but its
        // output goes through the same gate, since a second OCR engine can
        // fail the same way the first one did.
        setOcrState({ busy: true, step: "trying the decode service" });
        try {
          const r2 = await serverReadText(file);
          if (r2?.text && !looksLikeGibberish(r2.text, null)) {
            into(r2.text);
            setOcrState({ done: true, note: "Read by the decode service. Check every line against the pack before saving." });
            return;
          }
        } catch (e) { console.warn("serverReadText:", e); }
      }
      if (!cleaned || gibberish) {
        // Never hand a scrambled read to the reader as if it were the
        // ingredient list — a garbled string that gets waved through into the
        // shared database is worse than an honest "try again".
        setOcrState({ error: "This didn't read clearly — the text came out scrambled rather than misspelled. Hold the ingredient panel flat and fill the frame with just that panel, avoid glare and shadows, and make sure it's in focus, then capture again." });
        return;
      }
      into(cleaned);
      setOcrState({ done: true, confidence: r.confidence,
        note: "Check every line against the pack before saving — OCR misreads small print, and an ingredient it drops is one nobody gets warned about." });
    } catch (e) {
      setOcrState({ error: String(e?.message || e) });
    }
  }

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

  // Opens the scanner. Inside a packaged native app (Capacitor.isNativePlatform()
  // is only ever true there — never on the plain website) this reaches the
  // camera through Google ML Kit instead of the browser: a direct OS camera
  // feed and an on-device recognition model, the same category of access the
  // commercial scanner apps use, rather than getUserMedia piped through a
  // <video> element and a JS/WASM decoder. That gap — browser camera API vs.
  // native camera API — is the one no amount of tuning the in-browser
  // BarcodeScanner (below) can close; this is the free way to actually close
  // it. The website deployment never takes this branch and is unaffected.
  async function openScanner() {
    if (!Capacitor.isNativePlatform()) { setCameraOpen(true); return; }
    try {
      const code = await scanNative();
      // null = the sheet closed with nothing decoded (iOS rejects that case
      // with "scan canceled." instead — caught below). Either way, that is
      // the person deliberately backing out, not a failure — same as
      // dismissing the in-browser scanner does today, so nothing further.
      if (code) onBarcodeDetected(code);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/cancel/i.test(msg)) return;
      // A real failure — permission denied, the Google Play Services barcode
      // module still installing on first run — falls back to the in-browser
      // scanner rather than dead-ending; it still works (just slower) inside
      // a Capacitor WebView.
      toast("scan", msg);
      setCameraOpen(true);
    }
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

      {/* One hidden file input for all OCR entry points, mounted unconditionally.
          It previously lived inside the no-list dialog, so the add-product form's
          button found a null ref and did nothing. */}
      <input ref={ocrFileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = "";
                         scanIngredientsFromPhoto(f, ocrTargetRef.current || ((txt) => setNoListText(txt))); }}/>

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

            <button onClick={() => { ocrTargetRef.current = (txt) => setNoListText(txt); ocrFileRef.current?.click(); }} disabled={ocrState?.busy}
              style={{width:"100%",padding:"10px 0",fontSize:12,fontWeight:700,borderRadius:8,marginBottom:8,
                background:t.accent,color:t.accentFg,border:"none",cursor:ocrState?.busy?"default":"pointer"}}>
              {ocrState?.busy ? `${ocrState.step}…` : "📷 Photograph the ingredient list"}
            </button>
            {ocrState && !ocrState.busy && (
              <div style={{fontSize:10,lineHeight:1.6,marginBottom:8,
                color: ocrState.error ? "#c0392b" : "#d97706"}}>
                {ocrState.error || ocrState.note}
              </div>
            )}
            <div style={{fontSize:9.5,color:t.textMuted,marginBottom:6}}>
              First use downloads the text reader (~10 MB), then it works offline. Nothing is
              uploaded — the photo is read on your device.
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
        <div onClick={()=>setAddOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:isMobile?"flex-start":"center",justifyContent:"center",zIndex:9999,padding:isMobile?"10px 10px 0":20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:t.bg,borderRadius:14,padding:"20px 20px 14px",maxWidth:520,width:"100%",maxHeight:isMobile?"96vh":"88vh",display:"flex",flexDirection:"column",border:`1px solid ${t.border}`}}>
            <h2 style={{margin:"0 0 4px",fontSize:16,fontWeight:700,color:t.text}}>Add a product</h2>
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.5,marginBottom:12}}>
              Not in the database yet? Copy the ingredient list exactly as printed on the pack.
            </div>

            <div style={{flex:1,overflowY:"auto",minHeight:0,paddingRight:2}}>

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

            <button onClick={() => { ocrTargetRef.current = (txt) => setNewProduct(p => ({ ...p, ingredients: txt })); ocrFileRef.current?.click(); }} disabled={ocrState?.busy}
              style={{width:"100%",padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,marginBottom:7,
                background:t.pill,color:t.textSub,border:`1px solid ${t.border}`,
                cursor:ocrState?.busy?"default":"pointer"}}>
              {ocrState?.busy ? `${ocrState.step}…` : "📷 Photograph the ingredient list instead of typing"}
            </button>

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

            <div style={{fontSize:9.5,color:t.textMuted,lineHeight:1.5,margin:"6px 0 4px"}}>
              The ingredient list matters most — it's what gets analysed. Nutri-Score/NOVA stay
              blank (those come from Open Food Facts, not this form). Consider also adding it at{" "}
              <strong>openfoodfacts.org</strong> so other apps benefit too.
            </div>

            </div>

            <div style={{display:"flex",gap:6,paddingTop:10,marginTop:2,borderTop:`1px solid ${t.border}`}}>
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

      {/* ── LOCATION PICKER ── search, select, then Save ── */}
      {marketOpen && (
        <div onClick={()=>{ setMarketOpen(false); setMarketDraft(market); setMarketQuery(""); }}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:t.bg,borderRadius:14,padding:20,maxWidth:440,width:"100%",maxHeight:"85vh",display:"flex",flexDirection:"column",border:`1px solid ${t.border}`}}>
            <h2 style={{margin:"0 0 4px",fontSize:16,fontWeight:700,color:t.text}}>Where do you shop?</h2>
            <div style={{fontSize:11,color:t.textSub,lineHeight:1.6,marginBottom:12}}>
              Alternatives, discovery and search results are drawn from this market. If nothing
              local matches, the search widens and those results are labelled.
            </div>

            <input autoFocus value={marketQuery} onChange={e=>setMarketQuery(e.target.value)}
              placeholder="Search countries…"
              style={{width:"100%",boxSizing:"border-box",fontSize:12,padding:"9px 11px",borderRadius:8,
                border:`1px solid ${t.border}`,background:t.bgSub,color:t.text,marginBottom:8}}/>

            {/* Selection is held in a DRAFT until Save, so closing the dialog or
                tapping around never silently changes which market is in force. */}
            <div style={{flex:1,overflowY:"auto",minHeight:120,marginBottom:10,
              border:`1px solid ${t.border}`,borderRadius:8}}>
              {Object.entries(MARKETS)
                .filter(([k,m]) => !marketQuery.trim() ||
                  m.label.toLowerCase().includes(marketQuery.trim().toLowerCase()) ||
                  k.toLowerCase() === marketQuery.trim().toLowerCase())
                .map(([k,m]) => {
                  const on = marketDraft === k;
                  return (
                    <button key={k} onClick={()=>setMarketDraft(k)}
                      style={{width:"100%",textAlign:"left",padding:"10px 12px",fontSize:12,
                        fontWeight:on?700:500,background:on?`${t.accent}1e`:"transparent",
                        color:on?t.accent:t.text,border:"none",borderBottom:`1px solid ${t.border}`,
                        cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
                      <span style={{width:14,flexShrink:0}}>{on ? "✓" : ""}</span>{m.label}
                    </button>
                  );
                })}
              {Object.entries(MARKETS).filter(([k,m]) =>
                  m.label.toLowerCase().includes(marketQuery.trim().toLowerCase())).length === 0 && (
                <div style={{padding:"14px 12px",fontSize:11,color:t.textSub}}>
                  No market called “{marketQuery}”. Choose <strong>Anywhere</strong> to search without
                  a location filter.
                </div>
              )}
            </div>

            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <button onClick={()=>{ changeMarket(marketDraft); setMarketOpen(false); setMarketQuery(""); }}
                disabled={marketDraft === market}
                style={{flex:1,padding:"11px 0",fontSize:12,fontWeight:700,borderRadius:8,
                  cursor:marketDraft===market?"default":"pointer",
                  background:marketDraft===market?t.pill:t.accent,
                  color:marketDraft===market?t.textMuted:t.accentFg,border:"none"}}>
                {marketDraft === market ? "Saved" : `Save — ${MARKETS[marketDraft]?.label}`}
              </button>
              <button onClick={()=>{ setMarketOpen(false); setMarketDraft(market); setMarketQuery(""); }}
                style={{padding:"11px 16px",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                  background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>Cancel</button>
            </div>
            <div style={{fontSize:9,color:t.textMuted,marginTop:8,lineHeight:1.6}}>
              Saved on this device and kept after a refresh. Currently in force: {MARKETS[market]?.label}.
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
            {/* Selections save as you tap them and survive a refresh, so the
                missing control was a way to clear them, not a way to keep them. */}
            <div style={{display:"flex",gap:6,marginTop:12}}>
              <button onClick={()=>setProfilePanel(false)}
                style={{flex:1,padding:"10px 0",fontSize:12,fontWeight:600,borderRadius:8,
                  background:t.accent,color:t.accentFg,border:"none",cursor:"pointer"}}>Done</button>
              {(conditions.length || profile.length) > 0 && (
                <button onClick={()=>{
                    setConditions([]); setProfile([]);
                    try { window.localStorage.removeItem("hst_conditions"); window.localStorage.removeItem("hst_profile"); } catch { /* private mode */ }
                    toast("profile", "Profile cleared. Products are no longer checked against conditions or sensitivities.");
                  }}
                  style={{padding:"10px 14px",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                    background:t.pill,color:t.textSub,border:`1px solid ${t.border}`}}>Clear all</button>
              )}
            </div>
            <div style={{fontSize:9,color:t.textMuted,marginTop:8,lineHeight:1.6}}>
              Saved as you tap and kept after a refresh — closing this panel does not undo it.
            </div>
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
          <button onClick={()=>{ setMarketDraft(market); setMarketQuery(""); setMarketOpen(true); }}
            title={`Alternatives are drawn from ${MARKETS[market]?.label}`}
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
        {tabBtn("dish","Build a Dish")}
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
                <button onClick={openScanner} disabled={scanning} title="Scan a barcode with the camera" aria-label="Scan a barcode with the camera" style={{flexShrink:0,width:42,border:`1.5px solid ${t.inputBorder}`,borderRadius:9,background:t.inputBg,cursor:scanning?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:scanning?0.5:1}}>
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
              <OFFCard cosmeticAnalysis={selected?.cosmetic} brandStat={brandStat} onOpen={openResult} offData={selected.offData} aiSugarData={selected.aiSugarData} substances={selected.substances} insight={insight} insightLoading={insightLoading} brandCred={brandCred} brandCredLoading={brandCredLoading} alternatives={alternatives} altLoading={altLoading} diet={selected.diet||"unknown"} ratings={ratings} t={t} dark={dark}
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
        // A brand rated on one or two products (b.thin) is excluded from this
        // headline count on purpose — "Concerning: 3" reads as three
        // well-documented bad actors, not three brands each carrying a single
        // flagged product. Thin brands still show in the grid below, just
        // visually de-emphasised, so the data is never hidden — only kept out
        // of a summary stat that implies more confidence than it has.
        const concerning = brands.filter(b=>b.score<4 && !b.thin).length;
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
                    // Same convention as Expert accolades (ratings.js:
                    // `thin: scored.length < 3`) — a score built from one or
                    // two products should not read with the same visual
                    // confidence as one built from dozens. Without this, a
                    // large, generally reputable brand can land on a flat,
                    // alarming red "Concerning" off a single flagged product,
                    // which looks like an app error more than a finding.
                    const sc = b.thin ? (t.textMuted || "#8a8680") : scoreColor(b.score);
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
                            {b.thin && (
                              <div style={{fontSize:9,color:"#d97706",fontWeight:600,marginTop:5,lineHeight:1.4}}>
                                Too few products to be a verdict — indicative only
                              </div>
                            )}
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

      {/* ════ DISH BUILDER TAB ════ */}
      {activeTab==="dish" && <DishBuilder t={t} isMobile={isMobile}/>}

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

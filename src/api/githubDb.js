import { GH_OWNER, GH_REPO, GH_BRANCH, GH_FILE, GH_RAW, GH_TOKEN } from "../lib/config.js";
import { normKey } from "../lib/theme.js";

// The shared community database: read/write against a GitHub-hosted
// db.json, plus per-product image storage (as separate repo files, never
// embedded in db.json — see the comment below on why).
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

export { _ghDb, _ghSha, _ghLastError, ghLoad, ghGetByCode, ghGet, IMG_MAX_DIM, IMG_QUALITY, compressImage, ghPutImage, localImageKey, saveLocalImage, getLocalImage, ghWrite, ghSet, photoKeyFor, ghLogSearch, flushSearchLog };

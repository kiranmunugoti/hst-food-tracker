import { Capacitor } from "@capacitor/core";
import { BarcodeScanner as NativeBarcodeScanner, BarcodeFormat as NativeBarcodeFormat } from "@capacitor-mlkit/barcode-scanning";

// Barcode/OCR decoding: native scan (Capacitor + ML Kit), the optional
// server-side decode pipeline, on-device OCR, and the full image-enhancement
// ladder (contrast, rotation, cropping, tiled sweep) shared by every decode
// path, whether that path has a native BarcodeDetector or falls back to
// ZXing.
// ─── BARCODE SCANNING ──────────────────────────────────────────────────────────
// A barcode is an exact product key, so scanning one skips fuzzy search
// entirely: no ambiguity, no picker, one network request.
//
// Two decoders, tried in order:
//   1. BarcodeDetector — built into Chrome/Edge on Android and desktop. Native,
//      fast, nothing to download.
//   2. ZXing (via CDN, loaded only on first use) — covers Safari/iOS and
//      Firefox, which have no BarcodeDetector.
const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"];

// ─── NATIVE SCAN (Capacitor / Google ML Kit) ────────────────────────────────
// Only reachable from openScanner() when Capacitor.isNativePlatform() is
// true, i.e. inside a packaged iOS/Android build — never from the website.
// ML Kit's on-device barcode model runs against the OS's own camera feed, the
// same category of access commercial scanner apps get, which is the actual
// gap between "this app on a phone" and "this app on a website in a phone's
// browser" that no amount of tuning the browser-based decoder below can
// close. Trusted on a single read: unlike the browser decoders, there is no
// "wait for two agreeing frames" workaround here, because that workaround
// exists to cover for a weaker decoder, not because it is good practice.
async function scanNative() {
  const perm = await NativeBarcodeScanner.checkPermissions();
  if (perm.camera !== "granted" && perm.camera !== "limited") {
    const req = await NativeBarcodeScanner.requestPermissions();
    if (req.camera !== "granted" && req.camera !== "limited") {
      throw new Error("Camera permission was denied. Allow camera access in Settings, or type the barcode number.");
    }
  }
  // Android's barcode recognition ships as a separate Google Play Services
  // module, downloaded on first use rather than bundled into the app — so the
  // very first scan on a fresh install can find it not yet installed.
  if (Capacitor.getPlatform() === "android") {
    const mod = await NativeBarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!mod.available) {
      await NativeBarcodeScanner.installGoogleBarcodeScannerModule();
      throw new Error("Preparing the scanner for first use — this only happens once. Try again in a moment.");
    }
  }
  const { barcodes } = await NativeBarcodeScanner.scan({
    formats: [
      NativeBarcodeFormat.Ean13, NativeBarcodeFormat.Ean8,
      NativeBarcodeFormat.UpcA, NativeBarcodeFormat.UpcE,
      NativeBarcodeFormat.Code128, NativeBarcodeFormat.Itf,
    ],
  });
  const raw = barcodes?.[0]?.rawValue || barcodes?.[0]?.displayValue || "";
  const clean = String(raw).replace(/\D/g, "");
  return clean.length >= 8 ? clean : null;
}
let _zxingPromise = null;

function loadZXing() {
  if (_zxingPromise) return _zxingPromise;
  _zxingPromise = new Promise((resolve, reject) => {
    if (window.ZXingBrowser) return resolve(window.ZXingBrowser);
    const el = document.createElement("script");
    el.src = "https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js";
    el.async = true;
    el.onload = () => window.ZXingBrowser ? resolve(window.ZXingBrowser) : reject(new Error("ZXing failed to initialise"));
    el.onerror = () => reject(new Error("Could not load the barcode library"));
    document.head.appendChild(el);
  });
  return _zxingPromise;
}

// ─── SERVER-SIDE DECODE (optional) ─────────────────────────────────────────────
// A container-hosted OpenCV + ZBar + Tesseract service. See server/README.md.
//
// Set VITE_DECODE_URL to enable it. Left unset, none of this runs and the app
// behaves exactly as it did — it is a final rung on the ladder, never a
// dependency. Every browser strategy is tried first, because a local decode is
// instant and free while this costs a round trip with the photo attached.
const DECODE_URL = __DECODE_URL__;

async function serverDecode(blob) {
  if (!DECODE_URL) return null;
  const fd = new FormData();
  fd.append("file", blob, "capture.jpg");
  const r = await fetch(`${DECODE_URL.replace(/\/$/, "")}/decode`, { method: "POST", body: fd });
  if (!r.ok) throw new Error("decode service HTTP " + r.status);
  return r.json();   // { code, symbology, via, attempts, digits, checksum_ok }
}

async function serverReadText(blob) {
  if (!DECODE_URL) return null;
  const fd = new FormData();
  fd.append("file", blob, "panel.jpg");
  const r = await fetch(`${DECODE_URL.replace(/\/$/, "")}/read-text`, { method: "POST", body: fd });
  if (!r.ok) throw new Error("read-text service HTTP " + r.status);
  return r.json();   // { text, raw }
}

// ─── ON-DEVICE OCR ─────────────────────────────────────────────────────────────
// Tesseract, loaded from a CDN on first use. This replaces the Anthropic API as
// the primary way to turn a photo into text, for three reasons:
//
//   - no API key, so it works on any deployment
//   - no per-request cost, so reading a long ingredient list is free
//   - the image never leaves the device
//
// The cost is a one-off download of the engine and English data (~10 MB), which
// the browser then caches. That is why it is loaded lazily and never on startup.
let _ocrPromise = null;
function loadOCR() {
  if (_ocrPromise) return _ocrPromise;
  _ocrPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const el = document.createElement("script");
    el.src = "https://unpkg.com/tesseract.js@7.0.0/dist/tesseract.min.js";
    el.async = true;
    el.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("OCR failed to initialise"));
    el.onerror = () => reject(new Error("Could not load the OCR library"));
    document.head.appendChild(el);
  });
  return _ocrPromise;
}

// Upscales and hard-thresholds before recognition. Tesseract is far more
// accurate on high-contrast black-on-white text than on a photograph of a
// curved, shadowed pack, and ingredient lists are printed small.
async function prepForOCR(bitmap, { maxEdge = 1600 } = {}) {
  const scale = Math.min(2, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const th = otsuThreshold(d);
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    // Softer than the barcode threshold: text strokes are thin, so pushing
    // everything to pure black/white erodes them. A mid-grey floor preserves
    // letter shapes while still lifting contrast.
    const v = g > th ? 255 : Math.max(0, g * 0.35);
    d[i] = d[i+1] = d[i+2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Characters that legitimately appear on an ingredient panel. Anything else —
// ©, ¥, \, =, ^ and the like, all of which showed up in real captures — is
// almost never real text; it is a logo, a border or a barcode's printed
// digits bleeding into the read. Whitelisting cuts that noise off at the
// source instead of trying to strip it back out afterwards.
const OCR_TEXT_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 " +
  ",.()%:;&/'-";

async function ocrText(bitmap, onProgress) {
  const T = await loadOCR();
  const canvas = await prepForOCR(bitmap, { maxEdge: 2000 });
  const worker = await T.createWorker("eng", 1, {
    logger: (m) => { if (m.status && onProgress) onProgress(m.status, m.progress || 0); },
  });
  try {
    // PSM 6 = "assume a single uniform block of text". The default (fully
    // automatic layout analysis) tries to split the photo into regions first,
    // which is what turns a curved pack — logo in one corner, barcode in
    // another, ingredient paragraph in the middle — into interleaved noise.
    // An ingredient panel is one block of text, so saying so directly is a
    // large accuracy gain on exactly the kind of photo that produced garbage.
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      tessedit_char_whitelist: OCR_TEXT_WHITELIST,
    });
    const { data } = await worker.recognize(canvas);
    return { text: String(data?.text || "").trim(), confidence: data?.confidence ?? null };
  } finally {
    await worker.terminate();
  }
}

// A quality gate, not a spellchecker. It exists to tell apart two failure
// modes that used to look identical to the reader: "misread a word" (still
// worth showing — corrected against the pack in the editable field) versus
// "read noise as text" (worth blocking outright — dumping symbol soup into an
// editable field just moves the garbage into the shared database the moment
// someone doesn't notice and taps save).
function looksLikeGibberish(text, confidence) {
  const body = String(text || "").replace(/\s+/g, "");
  if (!body) return true;
  if (confidence != null && confidence < 35) return true;
  const letters = (body.match(/[A-Za-z]/g) || []).length;
  if (letters / body.length < 0.55) return true;
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    const singles = words.filter(w => w.replace(/[^A-Za-z0-9]/g, "").length <= 1).length;
    if (singles / words.length > 0.35) return true;
  }
  return false;
}

// Digits only — a much easier problem than free text, so the character set is
// restricted, which stops Tesseract "helpfully" reading O for 0 and S for 5.
async function ocrDigits(bitmap, onProgress) {
  const T = await loadOCR();
  const canvas = await prepForOCR(bitmap, { maxEdge: 2000 });
  const worker = await T.createWorker("eng", 1, {
    logger: (m) => { if (m.status && onProgress) onProgress(m.status, m.progress || 0); },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789" });
    const { data } = await worker.recognize(canvas);
    const runs = String(data?.text || "").match(/\d{6,14}/g) || [];
    // Prefer a run whose check digit validates; a GTIN that checks out is
    // almost certainly the right reading.
    const valid = runs.find(r => /^\d{8}$|^\d{12,14}$/.test(r) && validBarcodeChecksum(r));
    const best = valid || runs.sort((a, b) => b.length - a.length)[0] || "";
    return { digits: best, checksumOk: !!valid, candidates: runs, confidence: data?.confidence ?? null };
  } finally {
    await worker.terminate();
  }
}

// A valid EAN/UPC has a check digit; verifying it rejects most misreads.
function validBarcodeChecksum(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return /^\d{8,14}$/.test(code);
  const d = code.split("").map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

// Camera overlay. Streams the rear camera, decodes continuously, and calls
// onDetect with the first checksum-valid barcode. Always stops the stream on
// unmount — a live camera left running is both a privacy and battery problem.
// Contrast-boosts a bitmap for a second decode attempt: grayscale, then hard
// black/white. Barcodes are binary by nature, so thresholding sharpens the bar
// edges a faded or badly-lit photo blurs.
//
// The scale factor is capped by total pixels, NOT fixed at 2x. ImageCapture
// returns the sensor's full resolution — a 12MP photo upscaled 2x is a 186 MB
// canvas and a 48MP one is 732 MB, which throws or gets the tab killed on a
// phone. Small frames still get the upscale that helps them; large ones are
// already detailed enough and are only thresholded.
const MAX_DECODE_PIXELS = 12e6;

// Draws a bitmap through a transform, returning a new bitmap. Used to retry a
// failed decode at a different orientation or crop rather than giving up.
async function transformBitmap(bitmap, { rotate = 0, crop = null, scale = 1 } = {}) {
  const src = crop
    ? { x: bitmap.width * crop.x, y: bitmap.height * crop.y,
        w: bitmap.width * crop.w, h: bitmap.height * crop.h }
    : { x: 0, y: 0, w: bitmap.width, h: bitmap.height };

  const swap = rotate === 90 || rotate === 270;
  const outW = Math.round((swap ? src.h : src.w) * scale);
  const outH = Math.round((swap ? src.w : src.h) * scale);

  const c = document.createElement("canvas");
  c.width = outW; c.height = outH;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(bitmap, src.x, src.y, src.w, src.h,
    -(src.w * scale) / 2, -(src.h * scale) / 2, src.w * scale, src.h * scale);
  return createImageBitmap(c);
}

// The decode ladder. A single failed attempt says almost nothing — decoders
// fail for different reasons, so each rung addresses a different cause:
//
//   1. plain          — the common case
//   2. contrast       — faded print, poor light
//   3. rotations      — a barcode read sideways or upside down; the native
//                       detector is orientation-sensitive in practice
//   4. centre crop    — background clutter, or the code small in a wide frame
//   5. second decoder — ZXing uses a different algorithm to BarcodeDetector,
//                       so it succeeds on images the native one rejects
//
// Only after ALL of these fail is the image genuinely unreadable — and then
// the still is kept rather than discarded, so the reader can type the digits
// they can plainly see.
function bitmapToDataUrl(bitmap) {
  const c = document.createElement("canvas");
  c.width = bitmap.width; c.height = bitmap.height;
  c.getContext("2d").drawImage(bitmap, 0, 0);
  return c.toDataURL("image/png");
}

// Restricting ZXing to the formats a product actually carries is a real speed
// win — unrestricted, it tries every 1D and 2D symbology (QR, Data Matrix,
// Aztec, PDF417…) on every attempt, none of which a grocery barcode ever is.
// `@zxing/browser`'s UMD build does not export `DecodeHintType`, only
// `BarcodeFormat` — so this goes through the reader's own `possibleFormats`
// setter (public API, confirmed present on `BrowserMultiFormatReader` in the
// pinned 0.1.5 build) rather than constructing a hints Map by hand against an
// enum that is not actually available on the global. Defensive regardless: if
// a future CDN version changes this, the catch leaves the unrestricted reader
// in place rather than breaking barcode reading entirely.
function makeZXingReader(ZX) {
  const reader = new ZX.BrowserMultiFormatReader();
  try {
    if (ZX.BarcodeFormat) {
      reader.possibleFormats = [
        ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8,
        ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E,
        ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.ITF,
      ];
    }
  } catch { /* unrestricted reader already assigned above */ }
  return reader;
}

async function decodeLadder(bitmap, detector, onProgress, { fast = false } = {}) {
  const attempts = [
    ["reading", async () => bitmap],
    ["boosting contrast", async () => enhanceForDecode(bitmap)],
    ["rotating 90°", async () => transformBitmap(bitmap, { rotate: 90 })],
    ["rotating 270°", async () => transformBitmap(bitmap, { rotate: 270 })],
    ["rotating 180°", async () => transformBitmap(bitmap, { rotate: 180 })],
    ["zooming in", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.1, y: 0.25, w: 0.8, h: 0.5 } }))],

    // Horizontal bands. A barcode wrapped round a bottle is curved, so the bars
    // are only parallel across a narrow strip — the full-height image never
    // decodes, but a single band often does. Three bands cover the code sitting
    // high, centred or low in the frame.
    ["scanning upper band", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.05, y: 0.20, w: 0.9, h: 0.22 } }))],
    ["scanning middle band", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.05, y: 0.40, w: 0.9, h: 0.22 } }))],
    ["scanning lower band", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.05, y: 0.60, w: 0.9, h: 0.22 } }))],

    // Narrow centre strip at high magnification.
    ["magnifying centre", async () => enhanceForDecode(await transformBitmap(bitmap, { crop: { x: 0.25, y: 0.38, w: 0.5, h: 0.24 }, scale: 3 }))],

    // Tiled sweep — the rung that finds small codes on small packs. Nine
    // overlapping tiles, each magnified, so a code occupying a ninth of the
    // frame is decoded as though it filled it.
    //
    // Skipped in fast mode. Twenty rungs over a full-resolution photo takes
    // seconds, and the background loop runs every two seconds — so the slow
    // path belongs on a deliberate Capture, not on autopilot.
    ...(fast ? [] : tileRegions().map((crop, i) => [
      `sweeping area ${i + 1}/9`,
      async () => enhanceForDecode(await transformBitmap(bitmap, { crop, scale: 2.5 })),
    ])),
  ];

  // A native BarcodeDetector (Chrome/Android) runs the whole ladder cheaply,
  // so ZXing there is only the last-resort "second decoder" rung below.
  //
  // Without one — every iPhone and every Firefox user, which is most of this
  // app's reported scanning trouble — ZXing previously got a single attempt
  // on the raw, unmodified photo. None of the contrast, rotation, crop or
  // tile rungs above ever ran for those readers, which is the actual gap
  // between "Chrome/Android scans reliably" and "iOS struggles": not a
  // weaker decoder so much as a decoder that only ever saw the easy case.
  // ZXing now shares the same ladder, capped shorter in fast mode (an
  // automatic background attempt still has to fit inside ~2s) and full-length
  // on a deliberate Capture.
  const zxRungs = detector ? 0 : Math.min(attempts.length, fast ? 3 : 14);
  let zxReaderPromise = null;
  const zxReader = () => {
    if (!zxReaderPromise) zxReaderPromise = loadZXing().then(makeZXingReader).catch(() => null);
    return zxReaderPromise;
  };
  const tryZXing = async (variantBitmap) => {
    const reader = await zxReader();
    if (!reader) return null;
    try {
      const res = await reader.decodeFromImageUrl(bitmapToDataUrl(variantBitmap));
      return res?.getText?.() || null;
    } catch { return null; }
  };

  for (let i = 0; i < attempts.length; i++) {
    const [label, make] = attempts[i];
    onProgress?.(label);
    let variant;
    try { variant = await make(); } catch { continue; }

    if (detector) {
      try {
        const found = await detector.detect(variant);
        if (found?.length) return { code: found[0].rawValue, via: label };
      } catch { /* next rung */ }
    } else if (i < zxRungs) {
      const text = await tryZXing(variant);
      if (text) return { code: text, via: label };
    }
  }

  if (fast) return null;

  // Different decoder, same original image — the rung that most often rescues
  // a still a native detector has already refused. Only meaningful when a
  // native detector exists; without one, ZXing has already seen every rung
  // above.
  if (detector) {
    onProgress?.("trying a second decoder");
    const text = await tryZXing(bitmap);
    if (text) return { code: text, via: "second decoder" };
  }

  return null;
}

// Otsu's method: computes the threshold that best separates dark from light
// for THIS image, instead of assuming 128. On a foil or glossy wrapper the
// lighting is uneven across the label — one end blown out, the other in shadow
// — and a fixed threshold turns the bright end entirely white and the dark end
// entirely black, erasing the bars at both. Otsu adapts to the actual histogram.
function otsuThreshold(data) {
  const hist = new Array(256).fill(0);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const g = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) | 0;
    hist[g]++; n++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = i; }
  }
  return threshold;
}

// Splits a frame into overlapping tiles. A small barcode — a single KitKat
// finger, a two-cup Reese's pack — occupies a fraction of the frame, so the
// decoder is working with a code that is tiny relative to everything around it.
// In its own tile the same code is close to full width, which is the condition
// decoders are built for. Overlap prevents a code from being cut in half by a
// tile boundary.
function tileRegions(cols = 3, rows = 3, overlap = 0.35) {
  const w = 1 / cols, h = 1 / rows;
  const ow = w * overlap, oh = h * overlap;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: Math.max(0, c * w - ow), y: Math.max(0, r * h - oh),
        w: Math.min(1, w + ow * 2), h: Math.min(1, h + oh * 2),
      });
    }
  }
  return out;
}

async function enhanceForDecode(bitmap) {
  const base = bitmap.width * bitmap.height;
  const scale = base * 4 <= MAX_DECODE_PIXELS ? 2 : base <= MAX_DECODE_PIXELS ? 1 : Math.sqrt(MAX_DECODE_PIXELS / base);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;      // keep bar edges hard
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const th = otsuThreshold(d);
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    const v = g > th ? 255 : 0;
    d[i] = d[i+1] = d[i+2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return createImageBitmap(c);
}


export { BARCODE_FORMATS, scanNative, DECODE_URL, serverDecode, serverReadText, loadOCR, prepForOCR, OCR_TEXT_WHITELIST, ocrText, looksLikeGibberish, ocrDigits, validBarcodeChecksum, MAX_DECODE_PIXELS, transformBitmap, bitmapToDataUrl, makeZXingReader, decodeLadder, otsuThreshold, tileRegions, enhanceForDecode, loadZXing };

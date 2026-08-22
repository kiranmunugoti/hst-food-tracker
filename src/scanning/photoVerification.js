import { BARCODE_FORMATS, decodeLadder, validBarcodeChecksum } from "./decode.js";

// AI-assisted checks run against an uploaded/captured photo: does it show
// the expected barcode, does it match the record's name/brand, and how
// good is the shot (sharpness/exposure/size), so "better" is decided by the
// image rather than by whoever uploaded most recently.
async function verifyPhotoByBarcode(bitmap, expectedCode) {
  const want = String(expectedCode || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!want) return null;
  let detector = null;
  if ("BarcodeDetector" in window) {
    try { detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS }); } catch { /* none */ }
  }
  const found = await decodeLadder(bitmap, detector, null, { fast: true }).catch(() => null);
  if (!found?.code) return null;
  const got = String(found.code).replace(/\D/g, "").replace(/^0+/, "");
  if (!got) return null;
  return got === want
    ? { verdict: "match", reason: `Barcode ${got} in the photo matches the record.`, seen: got }
    : { verdict: "mismatch", reason: `The photo shows barcode ${got}, but this record is ${want}.`, seen: got };
}

// Reads the human-readable digits printed under a barcode.
//
// This is the last resort after every decode strategy has failed. A barcode's
// bars can be unreadable — foil glare, curvature, damage — while the digits
// beside them are perfectly legible, so a photo that no decoder can parse often
// still carries the number in plain type.
//
// The result is always PROPOSED, never applied. OCR confuses 8/B, 5/S, 1/7, and
// a wrong barcode silently returns a different product's analysis — which for
// someone checking for gelatin is worse than no answer at all. So the digits are
// filled into the field for the reader to check against the pack, with the
// checksum result shown as evidence.
async function readBarcodeDigits(base64) {
  const prompt = `This photo shows a product barcode. Read ONLY the human-readable digits printed beside or beneath the bars.

Reply with ONLY a JSON object, no other text:
{"digits":"<the digits, no spaces or dashes>","confidence":"high"|"low","note":"<what you could and could not read>"}

Rules:
- Return digits exactly as printed, including any leading zero and any digit set apart from the main block.
- Typical lengths are 8, 12, 13 or 14 digits.
- If any digit is uncertain or obscured, set confidence to "low" and still return your best reading.
- If no digits are legible at all, return {"digits":"","confidence":"low","note":"not legible"}.`;

  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
      { type: "text", text: prompt },
    ]}],
  };

  const call = async (url) => {
    const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error?.message || ("HTTP " + r.status));
    return (d.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  };

  let text = "";
  try { text = await call("https://api.anthropic.com/v1/messages"); }
  catch { text = await call("/api/claude"); }

  const parsed = JSON.parse(String(text).replace(/```json|```/g, "").trim());
  const digits = String(parsed.digits || "").replace(/\D/g, "");
  return {
    digits,
    confidence: parsed.confidence === "high" ? "high" : "low",
    note: String(parsed.note || ""),
    // Independent evidence the reader can weigh: a GTIN check digit that
    // validates means the reading is almost certainly correct.
    checksumOk: digits.length >= 8 ? validBarcodeChecksum(digits) : false,
  };
}

async function verifyPhotoMatches(base64, name, brand) {
  const prompt = `You are checking whether a product photo matches a database record.

Record name: ${name}
Record brand: ${brand || "(unknown)"}

Look at the image and read any product name, brand or packaging text you can see.
Reply with ONLY a JSON object, no other text:
{"verdict":"match"|"mismatch"|"unclear","seen":"<product/brand text you can read, or empty>","reason":"<one short sentence>"}

Rules:
- "match" only if the visible branding is plausibly the same product.
- "mismatch" if the packaging clearly shows a different product or brand.
- "unclear" if no label text is legible, the image is not a product, or you cannot tell.
- A different flavour, size or language variant of the SAME brand and product line is a match.`;

  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        { type: "text", text: prompt },
      ],
    }],
  };

  const call = async (url) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error?.message || ("HTTP " + r.status));
    return (d.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  };

  let text = "";
  try { text = await call("https://api.anthropic.com/v1/messages"); }
  catch { try { text = await call("/api/claude"); } catch { return { verdict: "unclear", reason: "Verification is unavailable in this deployment.", seen: "" }; } }

  try {
    const parsed = JSON.parse(String(text).replace(/```json|```/g, "").trim());
    const v = ["match", "mismatch", "unclear"].includes(parsed.verdict) ? parsed.verdict : "unclear";
    return { verdict: v, reason: String(parsed.reason || ""), seen: String(parsed.seen || "") };
  } catch {
    // An unparseable reply must not be read as approval.
    return { verdict: "unclear", reason: "The verification reply could not be read.", seen: "" };
  }
}

// Measurable photo quality, so "better" is decided by the image rather than by
// whoever uploaded most recently.
//
//   sharpness — variance of a Laplacian. A blurred photo has little
//               high-frequency detail, so its variance collapses. This is the
//               single most useful signal for a label photo.
//   exposure  — fraction of pixels crushed to pure black or blown to pure
//               white. Detail lost that way cannot be recovered.
//   size      — resolution, with sharply diminishing returns; a huge blurry
//               photo should not beat a modest sharp one.
async function scoreImage(bitmap) {
  const MAX = 720;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  const gray = new Float32Array(w * h);
  let clipped = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    gray[p] = g;
    if (g <= 4 || g >= 251) clipped++;
  }

  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i-1] - gray[i+1] - gray[i-w] - gray[i+w];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  const variance = n ? (sumSq / n) - (sum / n) ** 2 : 0;

  // Dynamic range from the 5th/95th percentiles rather than min/max, so a few
  // stray pixels do not make a flat, murky photo look well exposed.
  const hist = new Array(256).fill(0);
  for (let p = 0; p < gray.length; p++) hist[Math.max(0, Math.min(255, gray[p] | 0))]++;
  const total = gray.length;
  let acc = 0, p5 = 0, p95 = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.05) { p5 = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.05) { p95 = i; break; } }
  const range = p95 - p5;

  // Sharpness: the divisor is set high enough that the metric does not saturate.
  // At a low divisor every in-focus photo pegged at 1.0 and a slightly soft one
  // scored identically to a crisp one, which made the comparison useless.
  const sharpness = Math.min(1, Math.sqrt(variance) / 45);

  // Exposure combines two failures that look different but both destroy detail:
  // clipping (blown highlights, crushed blacks) and low contrast. A dark photo
  // with nothing clipped scored a perfect 1.0 before the range term was added.
  const clipPenalty = Math.max(0, 1 - (clipped / (w * h)) * 4);
  const rangeScore  = Math.min(1, range / 140);
  const exposure    = clipPenalty * 0.5 + rangeScore * 0.5;

  const size = Math.min(1, Math.sqrt((bitmap.width * bitmap.height) / (1280 * 960)));

  const score = +(sharpness * 0.55 + exposure * 0.25 + size * 0.20).toFixed(3);
  return { score, sharpness: +sharpness.toFixed(3), exposure: +exposure.toFixed(3),
           size: +size.toFixed(3), range, w: bitmap.width, h: bitmap.height };
}


export { verifyPhotoByBarcode, readBarcodeDigits, verifyPhotoMatches, scoreImage };

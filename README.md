# HST — Hazard Substance Tracker

Scan or search a product and get its additives, contaminants and **undeclared
substances** — things present in a product that the label does not mention.

Version 8.0.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run dev` and `npm run preview` both serve the `/api/*` routes locally via
middleware in `vite.config.js`, so local development behaves the same as the
deployed app. Without that middleware those routes fall through to the SPA
fallback and return `index.html`, which breaks every lookup in a way that is
hard to spot — the requests still return HTTP 200.

---

## Data sources

| Source | Used for | Notes |
|---|---|---|
| **Open Food Facts** | food, primary | Nutri-Score, NOVA, additive tags, Eco-Score |
| **Search-a-licious** | food full-text + filters | OFF's Elasticsearch index; replaces the deprecated `search.pl` |
| **USDA FoodData Central** | food, supplement | Strong US branded coverage and ingredient statements. No Nutri-Score or NOVA — those stay blank rather than being invented |
| **Open Beauty Facts** | cosmetics | Separate database, own picker tab |

### Source order depends on the selected market

American brands sell widely outside the US and OFF's coverage of those shelves
is thin, so FoodData Central is queried **in parallel with OFF almost
everywhere**:

| Market | Name search | Barcode lookup |
|---|---|---|
| United States | USDA + OFF in parallel, **USDA leads** | USDA → OFF → OBF |
| India, Australia, Canada, Japan, UAE, Singapore, Brazil, South Africa, Mexico, NZ, Anywhere | USDA + OFF in parallel, **OFF leads** | OFF → OBF → USDA |
| UK, Ireland, Germany, France, Spain, Italy, Netherlands, Belgium, Switzerland | OFF only | OFF → OBF |

Europe is the exception: OFF originated there, its European coverage is its
strongest, and European formulations genuinely differ from US ones — different
permitted additives, different recipes under the same brand — so an FDC record
would describe a product that is not on the shelf.

Which source leads differs by market. In the US, FDC is the likelier match.
Elsewhere OFF leads because it carries local brands FDC has never indexed, with
FDC interleaved to surface the imported American products.

FDC has its own budget (1,000/hour) separate from OFF's 10/minute, so parallel
calls cost OFF nothing and halve the wait.

**Known limitation:** an FDC record always describes the US formulation. Where a
brand sells a locally-made variant, the additive list may differ from the pack in
hand — which is why the disclaimer states that formulations differ by country.

The cosmetics tab is queried only when opened.

### Deduplication

When a product appears in both food sources, barcode wins if both sides have
one; otherwise a normalised name + brand key is used. The OFF record is kept
because it carries scores that FDC has no equivalent for.

---

## Environment variables

| Variable | Where | Purpose | If unset |
|---|---|---|---|
| `USDA_API_KEY` | Vercel env var, or `.env` | FoodData Central access | Falls back to `DEMO_KEY` (~30 req/hour, shared) |
| `VITE_GH_TOKEN` | Vercel env var | Writes to the shared scan database | Reads still work; writes cleanly disabled |

Free USDA key: <https://fdc.nal.usda.gov/api-key-signup.html>

Local use — put them in `hst-app/.env` (already gitignored):

```
USDA_API_KEY=your_key_here
VITE_GH_TOKEN=your_token_here
```

---

## Layout

```
hst-app/
├── api/
│   ├── off.js        proxy for OFF / OBF / Search-a-licious (CORS + rate limits)
│   ├── usda.js       proxy for FoodData Central (keeps the API key server-side)
│   └── claude.js     optional AI-assisted analysis
├── public/sw.js      service worker — caches the app shell only, never API data
├── src/
│   ├── App.jsx       the entire application
│   └── main.jsx      entry point + error boundary
└── vite.config.js    build config + dev/preview API middleware
```

`src/App.jsx` is the only component file. Anything else left in `src/` is not
imported and does not run.

---

## Diagnosing problems

**"Check data sources"** under the Discover chips probes each endpoint
independently and reports what each returned. Probes run one at a time to stay
under the rate limit, so it takes a few seconds. Use it before assuming a lookup
bug: an empty result, a rate limit and a dead endpoint otherwise look identical
from the outside.

**Blank page.** `main.jsx` wraps the app in an error boundary, so a render crash
shows the error and component stack on screen instead of an empty page.

**Changes not taking effect.** The service worker caches the app shell. After
deploying, hard-reload once (or unregister the worker in DevTools →
Application). Bump `CACHE` in `public/sw.js` whenever shell caching changes.

**Case-sensitive filenames.** `main.jsx` imports `./App.jsx`. macOS and Windows
do not care about case; Vercel builds on Linux, which does. `APP.jsx` builds
locally and fails on deploy.

---

## Known limits

- Search-a-licious field names are inferred from its documentation. If a filter
  returns nothing where results are expected, that is the first place to look —
  the legacy fallback means it degrades rather than breaks.
- USDA contributes to name and barcode lookups only. FDC has no vegan, organic
  or NOVA tagging, so attribute queries stay OFF-only.
- Nutri-Score, NOVA and Eco-Score are absent on USDA records by design.
- Undeclared-substance detection reads ingredient text. A product with no
  ingredient list yields category-level inference only, which is weaker.

---

## Ratings (v8.1)

Three scores, computed and shown separately. They are never averaged together.

| Score | Basis | Can it be changed by users? |
|---|---|---|
| **Safety** | CSPI Chemical Cuisine additive tiers | No |
| **Expert** | Curated awards, critic scores, lab results | Only by adding a sourced accolade |
| **Community** | Customer star reviews | Yes — this is the opinion score |

### Why they are not combined

A product can win a gold medal, be loved by customers, and still contain an
additive CSPI rates "Avoid". A single blended number would let popularity mask
composition, which is the failure this app exists to prevent. Safety stays the
headline; the others sit beside it.

### CSPI tiers

Safe · Cut back · Certain people should avoid · Caution · Avoid.

`src/ratings.js` holds a **curated subset** of CSPI's published ratings covering
common label additives — not the full database. Anything not in the table is
reported as *unrated*, never as safe, and the panel shows coverage as a
percentage so a partial assessment is visible as partial.

### Adding expert accolades

There is no public API for competition medals, critic scores or lab panels —
that data is proprietary. Accolades are curated entries on the product's record
in the shared database:

```json
"accolades": [
  { "name": "Great Taste Awards", "sourceType": "competition", "score": "2 stars", "year": 2025 },
  { "name": "Which? taste test",  "sourceType": "lab",         "score": "82/100",  "year": 2024 }
]
```

`sourceType` sets the weight: `lab` 1.0, `critic` 0.8, `panel` 0.7,
`competition` 0.6, `certifier` 0.5. Low-precision inputs (medals are ordinal)
are down-weighted again so an award cannot outvote a numeric lab result.

### Score conversion

`normalizeScore` accepts `4.5 stars`, `★★★★`, `92/100`, `B+`, `85%`, `17/20`,
`Gold`, `Grand Gold`, bare numbers, and returns a 1–10 value plus a precision
flag. Unrecognised input returns `null` rather than a guess.

100-point critic scales are **not** mapped linearly. In practice almost nothing
scores below 50, so a linear map would rate a poor 55 as 5.5/10 — "average".
The conversion rescales from a 50 floor: 55/100 becomes 2.8, 95/100 becomes 9.2.

### Personal sensitivity profiles

An "organic" label describes how something was farmed, not whether a given
person can tolerate it — organic wine still contains sulphites, organic cashews
still cause anaphylaxis. CSPI encodes part of this in its "Certain people should
avoid" tier: additives that are fine for most people and genuinely dangerous for
some. A single population-level score cannot express that.

So sensitivity is a **profile the reader sets** (14 groups: sulphites,
glutamates, artificial colours, benzoates, nitrites, polyols, carrageenan,
carmine, gluten, milk, nuts, soy, caffeine, salicylates). Products are checked
against it and matches are shown in a "For you" panel above the population
scores. Where a product carries an organic or natural claim *and* matches the
profile, that is called out explicitly, because it is the claim most likely to
be misread as "safe for me".

The profile is stored in `localStorage` and **never uploaded** — health
information belongs on the device, not in a shared database. It changes what the
reader is warned about; it never changes the product's score for anyone else.

### Community reviews

One review per device (a local id, replaced on resubmission, so one device
cannot vote repeatedly). Reviews below five are labelled as too few to be
representative rather than suppressed.

Reviewers can report an ingredient that appears on the physical label but is
missing from the database. These are tallied per substance and shown as
**unverified counts** — a prompt to check the label, not a change to the score.
A vote cannot make a nitrite disappear.

### Reader-reported composition

Additives transcribed from a physical label are shown in their own panel with
their CSPI tier, and **do not move the safety score**. A transcription is
plausible but unverified, and one person's reading should not silently re-rate a
product for everyone. The panel states what the score *would* be if confirmed —
information without assertion, leaving the judgement with the reader.


---

## Disclaimer placement (v9.1)

One `Disclaimer` component, used in four places: the product card (full), the
alternatives list, the browse picker and discovery results (compact). Single
definition so the wording cannot drift apart between surfaces.

The specific claim it counters: a label reading "vegan", "organic", "natural" or
"100% pure" describes how a product was made or what it excludes — it is not a
statement that the product is safe for the person reading. Cyanide is vegan.
Sulphites in organic wine still send asthmatics to hospital. A general score
cannot capture an allergen, an interaction or a personal limit.

It also states plainly that source data can be incomplete, out of date, or wrong
for a local version of a product, since recipes differ between countries and
change without notice. The physical pack is the authority.

---

## Adding products (v9.6)

Regional brands, small producers and local formulations are missing from every
open database. A reader holding the pack is a better source than anything
queryable, so they can create the record.

**Where it appears:** a prompt at the dead end — an unknown barcode or a
no-match search — with the barcode or name prefilled. Not buried in a menu.

**What it captures:** name, brand, barcode, food/cosmetic, pack size, category,
full ingredient list, additives, allergens and pack claims. The ingredient list
matters most: it is what the hazard analysis reads.

**What it deliberately does not capture:** Nutri-Score, NOVA and Eco-Score stay
null. Those are computed by Open Food Facts from data this form does not
collect, and a guessed grade would be worse than none.

**Discovery:** community records live in the same shared database as scanned
ones and are checked by barcode *before* any remote source — free, instant, and
the only place a product absent from every open database can be found. Leading
zeros are normalised, so GTIN-12 and GTIN-13 forms of the same code match.

**Provenance:** a community record shows an amber banner above the scores saying
it was typed in from a pack by a reader and is unverified. It never passes as
curated source data.

The form also suggests adding the product to openfoodfacts.org, which benefits
every app using that data rather than only this one.

---

## Product photos (v9.7)

USDA records carry no photography at all, and community-added products start
with none, so readers can attach a photo — from the camera or the gallery.

**Storage: separate repository files, never inside `db.json`.** `ghWrite()`
rewrites the entire database file on every save, so an embedded base64 image
would be re-uploaded on every subsequent write by anyone. At 640px that is
~75 KB per product — 1,000 products would mean a 74 MB upload each time a single
review is saved, past what GitHub's contents API accepts. One file per image
under `images/<key>.jpg` keeps the database holding a ~90-byte URL.

**Compression before upload** — 640px longest edge, JPEG quality 0.72:

| source | before | after |
|---|---|---|
| iPhone 12MP | 3.4 MB | ~33 KB |
| Android 48MP | 7.8 MB | ~33 KB |

**Without a write token** the photo is saved to `localStorage` for that device
and labelled "On this device only", rather than silently appearing shared. If
local storage is full the failure is reported rather than swallowed.

The image upload happens *after* the product record is saved, so a failed photo
never blocks the product itself.

## Product photos (v9.7)

Photos are stored one file per product under `images/` in the database repo, not
inside the shared JSON. `ghWrite` rewrites the whole database file on every save,
so an embedded base64 image would be re-uploaded on every subsequent write by
anyone — at 640px that is ~75 KB per product, and 1,000 products would mean a
74 MB upload each time someone saves a review.

### Replacing a duplicate

A second upload for a product that already has a photo does **not** simply
overwrite it. Both are scored and the better one wins:

| Signal | Weight | What it catches |
|---|---|---|
| Sharpness | 0.55 | Variance of a Laplacian — blur collapses it |
| Exposure | 0.25 | Clipping **and** dynamic range (p5–p95) |
| Resolution | 0.20 | Diminishing returns, so it cannot outweigh blur |

The new photo must beat the existing one by a margin of 0.06, because two shots
of the same pack score within noise of each other and churning the shared image
on a 1% difference is worse than leaving a good one alone. When it loses, the
user is told both scores and why.

Scores are stored with the record so the next comparison needs no re-download.
Where an old record has no stored score, the existing image is fetched and
scored; if that fails the state is treated as unknown and the new photo wins,
which is stated rather than silently assumed.

Both photos are scored **before** compression, so the comparison reflects what
the cameras captured rather than the encoder.

### One photo per barcode, verified against the record

Images are keyed by **barcode**, not product name (`images/code-<gtin>.jpg`).
Two differently-named records for the same pack therefore share one image, and a
re-upload targets the same file instead of accumulating duplicates. Leading zeros
are normalised, so GTIN-12 and GTIN-13 forms resolve to the same file. Products
with no barcode fall back to the name key.

Before an image is shared it is checked against the record: the label in the
photo is read and compared with the product name and brand. Quality scoring
cannot do this — a sharp, well-lit photo of the wrong pack scores perfectly.

| Verdict | Result |
|---|---|
| `match` | Accepted, subject to the quality gate |
| `mismatch` | **Refused**, naming what was seen instead |
| `unclear` | Accepted but marked unverified for other readers |

A mismatch is refused regardless of quality — a better photo of the wrong
product is still the wrong product. An unparseable or unavailable verification
returns `unclear`, never `match`, so a failed check cannot read as approval.

Verification requires `ANTHROPIC_API_KEY` on the server. Without it every photo
is `unclear`: still accepted, still labelled unverified.

## Missing ingredient lists (v9.9)

### The bug this fixes

`personalAlerts` previously returned `clear: true` when a product had no
ingredient list, because zero matches was treated as zero risk. The panel then
said "Nothing here matches your declared sensitivities" — a clearance for a
product nobody had examined. Someone avoiding gelatin would have been told a
Moon Pie was fine.

Absence of evidence is not evidence of absence. There is now a third state:

| state | meaning | shown as |
|---|---|---|
| `hits.length > 0` | matched something in the profile | red per-item alerts |
| `clear` | checked against real data, nothing matched | green, with a caveat |
| `insufficientData` | nothing to check against | **red "Cannot check this product"** |

`clear` can no longer be true when `insufficientData` is. The same distinction
was added to `conditionAlerts`.

### Adding a missing list

The "cannot check" warning carries a button straight to the ingredient field,
and a matching notice appears on the card whether or not a profile is set —
a missing list is a data gap everyone should see.

Saving **re-runs the whole analysis immediately**: hazards, CSPI tiers,
conditions and profile checks all recompute from the supplied text, and the list
is written to the shared record so the next person scanning it gets the same
check. Adding the list has to change the verdict now, not just store text for
someone else later.

### New sensitivity groups

- **Gelatin** — matches `gelatin`, `gelatine`, `gelling agent (gelatin)`,
  hydrolysed collagen, isinglass and E441, without false-positiving on "gelato".
- **Animal-derived additives** — E441, E120 carmine, E542 bone phosphate,
  E901 beeswax, E904 shellac, E913 lanolin, E920 L-cysteine, plus rennet, lard,
  tallow and suet. E471 and E570 are included because they may be either plant
  or animal and the label rarely says which.
- **Pork derivatives** — for the common case where gelatin and enzymes are
  porcine but not labelled as such.

## v10.0

### An unrated product no longer scores 10/10

`cspiAssess` returned 10 for an empty additive list, which is correct for a
clean label and badly wrong for a product with no data — an unexamined product
ranked level with a genuinely clean one. It now takes `hasIngredients`:

| additives | ingredient list | score |
|---|---|---|
| none | present | 10 — genuinely clean |
| none | **absent** | **null — not scored** |
| present | either | scored normally |

`null` renders as "—" with "Not scored. A product with no ingredient list cannot
be rated — an empty score is not a good one."

### Fewer popups, one that matters

Toasts confirming the source, risk level and undeclared counts were removed: the
card already shows all of it, so the popups were noise over the thing being read.
What remains is only what the card cannot show — a rate limit, an unreachable
service, a failed database write.

A **missing ingredient list now raises a dialog** with a text box in it. Every
check the app performs reads that list, and the reader is holding the pack, so it
is worth interrupting for. Saving re-analyses immediately and shares the list.
"Not now" leaves the product marked unrated rather than scored.

### Search is now profile- and location-aware

Previously neither applied to search — only to alternatives and discovery.

- **Location:** results are **reordered** so products sold in the selected market
  come first. Reordered, not filtered: a product sold elsewhere is still a valid
  answer to "what is this", and dropping it could hide the item in hand.
- **Profile:** each result carries a ⚠ flag naming the first conflict, so a
  reader avoiding gelatin sees it in the list instead of opening each candidate.
  Flagged, never hidden. A hit with no ingredient data gets no flag and no
  reassurance either.

## v10.1 — record merging (data-loss fix)

`ghSet` assigned records wholesale: `_ghDb.products[key] = { ...data }`. Any
writer that did not carry every field destroyed the rest. `commitScan` writes
only the scan payload — offData, substances, risk — so **a single rescan wiped
every review, contribution, accolade and photo score** attached to that product.

It now merges: `{ ...prior, ...data }`. Scan fields still overwrite, which is
intended — a fresh analysis should replace a stale one. Only keys absent from the
write are preserved.

### Where a contributed ingredient list goes

1. Merged into the product's `offData.ingredients`, with `ingredientsSource:
   "community"` and the contributor id and timestamp.
2. Also stored as a `contributions` entry, so the original transcription survives
   even if a later source refresh overwrites `offData`.
3. Written to the shared database via `ghSet` → `ghWrite`, so the next person who
   scans that barcode gets the same analysis.
4. The barcode is carried onto the record. Without it a list added for a product
   no database has would be unreachable by scanning — the next person points the
   camera at the same pack and gets nothing.

**Requires `VITE_GH_TOKEN`.** Without it the list is kept for the session only and
the app says so ("Read-only mode"); it is not silently discarded, but it is not
shared either.

## Renaming the app

Edit **`src/brand.js`** only:

```js
export const APP_NAME  = "HST — Safety Monitor";  // tab title, PWA install prompt
export const APP_SHORT = "HST";                   // home-screen icon label
export const APP_TITLE_LEAD   = "Safety";         // header, first word
export const APP_TITLE_ACCENT = "Monitor";        // header, coloured word
```

A Vite plugin injects these into `index.html` and rewrites
`dist/manifest.webmanifest` at build time. The name previously appeared in five
places with four different values — tab title, manifest, Capacitor config,
header, iOS home-screen title — which is why they had drifted apart.

The one exception is `capacitor.config.json` (`appName`, `appId`): native app
stores read it at package time, not build time, so edit it by hand if you ship a
native build.

## v10.4 — capture, add-product and verification fixes

### The Capture button did nothing

Manual capture and the background auto-capture shared one `capturingRef` flag.
The background loop held it for the duration of each attempt, and the button's
handler returned immediately when it was set — so a press during an auto attempt
was silently discarded. With attempts every ~2s and each running all 20 decode
rungs over a full-resolution photo (~3.6s), the flag was set most of the time.

Fixed three ways:
- Separate flags. `autoBusyRef` for background attempts, `capturingRef` for
  manual only. A press now guards only against a second press, and says so.
- Auto attempts use a **fast ladder** (6 rungs, no tiled sweep, no second
  decoder) so they fit inside their interval. The full 20-rung sweep is reserved
  for a deliberate Capture, which is what makes the button worth pressing.
- Pressing Capture stands the auto loop down — the user has taken over.

Auto attempts also no longer pop the type-the-digits panel; only a deliberate
capture does.

### A not-found product now asks for everything

Any product with no record routes to the **full add-product form** — name, brand,
barcode, food/cosmetic, pack size, category, ingredients, additives, allergens,
claims **and a photo** — prefilled with the scanned barcode or search term.
Previously an unknown barcode only ever raised the ingredient-list dialog, so the
record stayed a stub with no name or photo. The narrower dialog is now used only
where a record exists but its ingredient list is missing.

### Photo verification by barcode, not by API

Verification now tries the **barcode in the photo** first: decode it and compare
with the record's code. Exact, free, offline, no API key. A barcode is an
identifier — matching codes prove the same product, where reading a brand name
can only say "plausibly".

The label-text check is reached only when no barcode is legible in the shot
(common when framing the front of a pack). Order: barcode → label text →
`unclear`.

## v10.5 — reading the printed digits

When every decode strategy fails, the kept photo now has a **"Read the number
from the photo"** button. A barcode's bars can be unreadable — foil glare,
curvature, damage — while the digits beside them are perfectly legible, so a
photo no decoder can parse often still carries the number in plain type.

**The reading is proposed, never applied.** It fills the field for the reader to
check against the pack; it does not search. OCR confuses 8/6, 5/S, 1/7, and a
wrong barcode silently returns a *different product's* analysis — for someone
checking for gelatin, worse than no answer.

The **GTIN check digit** is shown as independent evidence:

| result | message |
|---|---|
| checksum validates | "very likely correct — compare with the pack, then search" |
| checksum fails | "at least one digit is misread — correct it before searching" |
| nothing legible | "type them below" |

Tested against plausible misreads of a real KitKat barcode: the check digit
caught 3/3 single-digit and transposition errors. It cannot catch a
compensating pair of errors, which is why the pack remains the authority.

Requires `ANTHROPIC_API_KEY` on the server. Without it the button reports that it
is unavailable and the manual field still works — reading is a convenience over
typing, never the only route.

## v10.6 — on-device OCR, searchable location

### Reading text without the Anthropic API

Tesseract is loaded from a CDN on first use and runs **on the device**:

- no API key, so it works on any deployment
- no per-request cost, so reading a long ingredient list is free
- the photo never leaves the phone

Cost: a one-off ~10 MB download of the engine and English data, cached
afterwards. Loaded lazily, never at startup.

**Two entry points.** "Photograph the ingredient list" appears in the no-list
dialog and the add-product form — typing a pack's ingredient panel on a phone is
the single biggest barrier to contributing. And barcode digits are now read
on-device first, with the Anthropic path used only if on-device OCR finds nothing
*and* a key is configured.

Both land in an **editable field**, never straight into the database. OCR on
curved, glossy packaging misreads, and an ingredient it drops is one nobody gets
warned about. Post-processing rejoins lines wrapped mid-word, repairs hyphen
breaks and `|`-as-`I`, and collapses whitespace, without altering words.

For digits the character set is restricted to `0123456789`, which stops Tesseract
reading O for 0, and the run whose **GTIN check digit validates** is preferred over
the longest one.

### Location picker

Searchable list, with the selection held in a **draft until Save** — closing the
dialog or tapping around no longer silently changes which market is in force. The
footer states what is currently applied.

### Profile persistence

Conditions and sensitivities save as you tap and survive a refresh, in
`localStorage`, never uploaded. What was missing was a way to *clear* them, so the
profile panel now has **Clear all**.

## v10.7 — optional server-side decode

`server/` holds a FastAPI service using **OpenCV + ZBar + Tesseract**, for the
barcodes browsers cannot read. Measured on realistic degradations of a real
EAN-13, through the running API:

| image | plain ZBar | pipeline | via |
|---|---|---|---|
| clean | ✓ | ✓ | as-is, 1 attempt |
| small in a wide frame | ✗ | ✓ | adaptive mean, 4 attempts |
| foil glare | ✗ | ✓ | upscale ×2, 2 attempts |
| dark + blurred | ✗ | ✓ | CLAHE, 5 attempts |

Ingredient-panel OCR transcribed a five-line panel **including GELATIN**
correctly under clean, glare and blur conditions.

The decisive technique is **adaptive** thresholding: a single threshold cannot
handle a label blown out at one end and shadowed at the other, which is exactly
what foil does. `cv2.adaptiveThreshold` computes one per neighbourhood.

**Entirely optional.** Set `VITE_DECODE_URL` in Vercel to enable it; leave it
unset and none of the code runs. It is the last rung — all twenty browser
strategies are tried first, because a local decode is instant and free while this
costs a round trip with the photo attached. If the service is down the app
degrades to its previous behaviour.

Deploy on a container host (Fly.io, Render, Railway). **Not Vercel** — ZBar and
OpenCV need system libraries its Python runtime cannot install. See
`server/README.md`.

## v10.8 — a score card, and an OCR result that refuses to be gibberish

### On-device ingredient OCR was passing noise through as text

A photo of a curved, glossy pack (foil toothpaste tube, a can with a seam)
could come back with symbols that never appear on an ingredient panel — ©, ¥,
`\`, stray `=` and `^` — mixed in with real words. Two causes, both in
`ocrText`:

- Tesseract's default page-segmentation mode (fully automatic layout
  analysis) tries to split the photo into separate regions before reading
  them, so a logo in one corner and a barcode in another get interleaved with
  the ingredient paragraph instead of skipped. An ingredient panel is one
  block of text, so it is now told that directly: `tessedit_pageseg_mode:
  "6"` ("assume a single uniform block of text").
- Nothing restricted which characters a read could contain. `OCR_TEXT_WHITELIST`
  now limits recognition to letters, digits, spaces and the punctuation that
  actually appears in an ingredient list (`,.():;%&/'-`) — the same technique
  already used for barcode digits, applied to free text.

**A quality gate, not a spellchecker.** `looksLikeGibberish()` catches what
the whitelist doesn't: low Tesseract confidence, a low letter-to-character
ratio, or a run of one-character "words" — the shape of noise read as text,
as opposed to a genuine misread word. A result that fails the gate is never
handed to the reader as if it were the ingredient list; `scanIngredientsFromPhoto`
falls back to the server decode pipeline where configured (§ v10.7), and if
that also fails, reports plainly that the photo didn't read clearly and asks
for a flatter, better-lit, closer shot — rather than filling the field with
scrambled text someone could miss and save. Legitimate misreads (a wrong
letter in a real word) still pass through as before, since that is exactly
what the editable field and the "check every line against the pack" note
exist to catch.

### An at-a-glance score card

`ScoreSummaryCard`, shown above the existing detailed panels, gives a product
a single number out of 100 with a colour and a label (Bad / Poor / Good /
Excellent), then a **Negatives** and **Positives** list — additives, saturated
fat, sugar, calories, protein, fibre, sodium — each with a coloured dot and a
tap-to-expand detail line. Visually this is the layout readers already know
from the popular ingredient-scanner apps.

It is deliberately not a new number. `ratings.js` never averages Safety,
Expert and Community together — a product can be well reviewed and still
contain an ingredient CSPI rates "Avoid", and blending would let the former
mask the latter. Safety is already the headline of the three (see "Ratings"
above), so the card's score *is* the Safety score, just rendered the way
readers expect a single score to look, and it inherits that score's `null`
handling: no ingredient list means "—, not enough data", never a guessed
number. Every row is read off figures the app already computes for the
Nutrition Facts table and the CSPI assessment — a second view of existing
data, not a second source of truth. Hidden entirely for the cosmetics domain,
where `FormulationCard` already covers this ground.

## v10.9 — closing the iOS/Firefox scanning gap

### What the popular scanner apps actually do differently

A side-by-side against one of them showed their camera view decoding a
barcode within a second, with no capture button at all — the corner-bracket
viewfinder carries a `SCANDIT` watermark, meaning that speed comes from a
commercial native barcode SDK (Scandit), not from anything achievable in a
browser tab. That is a paid, licensed dependency and out of scope here — but
comparing the two surfaced a real, fixable gap in this app's own pipeline.

### The gap: two camera code paths, only one of them capable

`BarcodeScanner` has always had two branches: `BarcodeDetector` (Chrome and
Android — a native, hardware-accelerated API) and ZXing (everyone else —
every iPhone, since Safari has no `BarcodeDetector`, and Firefox). Only the
`BarcodeDetector` branch got the good parts:

- **The 20-rung decode ladder** (`decodeLadder`: contrast boost, four
  rotations, a zoomed crop, three curved-label bands, a magnified centre crop,
  a 9-tile sweep for a code that is small in the frame) ran against every
  rung for `BarcodeDetector`. For ZXing it ran once, against the raw,
  unmodified photo — none of the enhancement that makes the ladder worth
  having applied to it.
- **Automatic still-capture escalation** — after ~1.5s of live decoding
  finding nothing, silently grab a sharper still and try harder, repeating up
  to 4 times — existed only in the `BarcodeDetector` branch. The ZXing branch
  had no equivalent: live video decoding, indefinitely, with a manual
  "Capture" button as the only way out.
- **The manual Capture button itself**, on the ZXing branch, called
  `decodeFromImageUrl` once on a single raw frame — again, none of the ladder.

None of this was ZXing being a worse decoder in principle. It was ZXing never
being given the preprocessing that makes the difference on a real photo —
curved packaging, small print, a glare spot — and it is exactly why the
scanner behaved so differently between an Android phone and an iPhone.

### The fix

`decodeLadder` now runs ZXing itself against the same rung variants when no
native detector is present — 3 rungs for a fast/automatic attempt (so it
still fits inside the ~2s auto-scan cadence), up to 14 for a deliberate
Capture. `BarcodeScanner`'s ZXing branch now schedules the same escalation
(first look at 1.5s, then every 2.5s, up to 4 tries) that the
`BarcodeDetector` branch already had, and its Capture button now goes through
the shared `decodeStill`/`decodeLadder` path instead of a single raw-frame
attempt — so iOS and Firefox get the full pipeline Chrome/Android already
had. ZXing is also now constructed via `makeZXingReader`, which restricts
recognition to the formats a grocery product actually carries (EAN-13/8,
UPC-A/E, Code 128, ITF) through the reader's own `possibleFormats` setter —
a real per-frame speed win, and the reason it goes through that setter rather
than a hand-built hints map is that the pinned `@zxing/browser` build does not
export `DecodeHintType` on its global, only `BarcodeFormat`; verified against
the actual shipped UMD bundle rather than assumed.

Verified end-to-end against a synthetic camera feed (a generated EAN-13,
fed in as a fake video device) in both a large-and-centred and a
small-and-off-centre framing — both decoded correctly through this path with
no native `BarcodeDetector` present, confirming the ZXing branch's ladder and
escalation logic actually runs, not just that it compiles.

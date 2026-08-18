# HST decode service

Server-side image processing for barcodes the browser cannot read.

## Why it exists

`BarcodeDetector` and ZXing handle a clean, flat, well-lit barcode. They fail on
the ones that actually cause trouble: a small code on a foil wrapper, a curved
bottle label, a dark or blurred shot. Measured on realistic degradations of a real
EAN-13 (`7613034626844`):

| image | plain ZBar | with this pipeline |
|---|---|---|
| clean | ✓ | ✓ as-is |
| small in a wide frame | ✗ | ✓ adaptive mean threshold |
| foil glare | ✗ | ✓ upscale ×2 |
| curved (bottle) | ✓ | ✓ |
| dark + blurred | ✗ | ✓ CLAHE |
| rotated 12° | ✓ | ✓ |

The important one is **adaptive** thresholding. A single threshold for the whole
image cannot handle a label blown out at one end and shadowed at the other, which
is what foil does — adaptive computes a value per neighbourhood instead.

## This is a fallback

The frontend tries every browser strategy first and calls here only when they all
fail. If the service is down, unreachable, or simply not deployed, the app
degrades to its previous behaviour rather than breaking.

## Run locally

```bash
docker build -t hst-decode .
docker run -p 8000:8000 hst-decode
curl -F file=@barcode.jpg http://localhost:8000/decode
```

Or without Docker (needs `libzbar0` and `tesseract-ocr` installed):

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Deploy

Any container host — Fly.io, Render, Railway. **Not Vercel**: ZBar and OpenCV
need system libraries its Python runtime cannot install.

```bash
fly launch --dockerfile Dockerfile     # or connect the repo on Render
```

Then set `VITE_DECODE_URL` in the frontend's Vercel project to the service URL
and redeploy. Leave it unset and the frontend never calls out.

Set `ALLOWED_ORIGINS` on the service to your frontend's origin — an open decode
endpoint is an invitation to use the host as free image processing.

## Endpoints

| | |
|---|---|
| `GET /health` | readiness, OCR availability, OpenCV version |
| `POST /decode` | barcode from an image; falls back to OCR of the printed digits |
| `POST /read-text` | OCR an ingredient panel |

`/decode` returns `via`, naming which variant succeeded, and `attempts` — useful
for telling "this image is hopeless" from "the easy path worked".

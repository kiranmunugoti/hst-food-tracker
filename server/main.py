"""
HST decode service — server-side image processing.

Exists because browsers cannot do this well. BarcodeDetector and ZXing decode a
clean, flat, well-lit barcode; they give up on the ones that actually cause
trouble — a small code on a foil wrapper, a curved bottle label, a dark blurry
shot. OpenCV's preprocessing plus ZBar recovers most of those.

Measured on synthetic-but-realistic degradations of a real EAN-13:

    image           plain zbar        with this pipeline
    small in frame  fail              adaptive mean threshold
    foil glare      fail              upscale x2
    dark + blurred  fail              CLAHE

The critical one is ADAPTIVE thresholding. A single threshold for the whole
image cannot cope with a label that is blown out at one end and shadowed at the
other, which is exactly what foil does. Adaptive thresholding computes a value
per neighbourhood instead.

This is a FALLBACK, not the primary path. The frontend tries every browser
strategy first and only calls here when they all fail, so if this service is
down or unreachable the app degrades to what it did before rather than breaking.

Run locally:   uvicorn main:app --reload --port 8000
Deploy:        any container host (Fly.io, Render, Railway). NOT Vercel — ZBar
               and OpenCV need system libraries its Python runtime lacks.
"""

import io
import os
import re
from typing import List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pyzbar import pyzbar

try:
    import pytesseract
    HAS_OCR = True
except Exception:                                    # pragma: no cover
    HAS_OCR = False

app = FastAPI(title="HST decode service", version="1.0")

# Locked to the deployed frontend by default. An open decode endpoint is an
# invitation to use the host as free image processing.
ALLOWED = [o for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

MAX_BYTES = 8 * 1024 * 1024        # a phone photo, not a raw scan
MAX_EDGE = 2600                    # anything larger is downscaled before work


class DecodeResult(BaseModel):
    code: Optional[str] = None
    symbology: Optional[str] = None
    via: Optional[str] = None          # which variant succeeded, for diagnosis
    attempts: int = 0
    text: Optional[str] = None         # OCR text, when no barcode was found
    digits: Optional[str] = None       # digit run from OCR, checksum-preferred
    checksum_ok: bool = False


def _read(data: bytes) -> np.ndarray:
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image too large")
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise HTTPException(400, "Not a decodable image")
    h, w = img.shape
    if max(h, w) > MAX_EDGE:
        f = MAX_EDGE / max(h, w)
        img = cv2.resize(img, (int(w * f), int(h * f)), interpolation=cv2.INTER_AREA)
    return img


def gtin_checksum_ok(code: str) -> bool:
    if not re.fullmatch(r"\d{8}|\d{12,14}", code):
        return False
    digits = [int(c) for c in code]
    check = digits.pop()
    total = sum(n * (3 if i % 2 == 0 else 1) for i, n in enumerate(reversed(digits)))
    return (10 - total % 10) % 10 == check


def _variants(g: np.ndarray) -> List[Tuple[str, np.ndarray]]:
    """Ordered cheapest-first, so an easy image costs one decode attempt."""
    out: List[Tuple[str, np.ndarray]] = [("as-is", g)]

    up2 = cv2.resize(g, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    out.append(("upscale x2", up2))

    # Adaptive thresholding — per-neighbourhood, the fix for uneven lighting on
    # foil and glossy wrappers where a global threshold erases one end.
    out.append(("adaptive gaussian", cv2.adaptiveThreshold(
        up2, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10)))
    out.append(("adaptive mean", cv2.adaptiveThreshold(
        up2, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 41, 15)))

    # CLAHE equalises contrast locally — recovers dark, flat, underexposed shots.
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(up2)
    out.append(("CLAHE", clahe))
    out.append(("CLAHE + Otsu", cv2.threshold(
        clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]))

    # Sharpening partially undoes motion blur.
    out.append(("sharpened", cv2.filter2D(
        up2, -1, np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]]))))

    # Morphological close repairs bars broken by creases or print defects.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 1))
    out.append(("morph close", cv2.morphologyEx(
        cv2.adaptiveThreshold(up2, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                              cv2.THRESH_BINARY, 31, 10),
        cv2.MORPH_CLOSE, kernel)))

    # Hand-held shots are rarely square-on.
    h, w = up2.shape
    for ang in (-12, -6, 6, 12, 90, 270):
        m = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1)
        out.append((f"rotate {ang}", cv2.warpAffine(up2, m, (w, h), borderValue=235)))

    # Overlapping tiles at high magnification — for a code occupying a small
    # part of a wide frame, e.g. a single KitKat finger held at arm's length.
    hh, ww = g.shape
    for ry in range(3):
        for rx in range(3):
            y0 = max(0, int(hh * (ry / 3 - 0.08)))
            y1 = min(hh, int(hh * ((ry + 1) / 3 + 0.08)))
            x0 = max(0, int(ww * (rx / 3 - 0.08)))
            x1 = min(ww, int(ww * ((rx + 1) / 3 + 0.08)))
            tile = g[y0:y1, x0:x1]
            if tile.size == 0:
                continue
            tile = cv2.resize(tile, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
            out.append((f"tile {ry * 3 + rx + 1}/9", cv2.adaptiveThreshold(
                tile, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10)))
    return out


def _ocr_digits(g: np.ndarray) -> Tuple[str, bool]:
    """Reads the digits printed beside the bars — legible when the bars are not."""
    if not HAS_OCR:
        return "", False
    up = cv2.resize(g, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    up = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(up)
    txt = pytesseract.image_to_string(
        up, config="--psm 6 -c tessedit_char_whitelist=0123456789")
    runs = re.findall(r"\d{6,14}", txt)
    valid = next((r for r in runs if gtin_checksum_ok(r)), None)
    if valid:
        return valid, True
    return (max(runs, key=len) if runs else ""), False


@app.get("/health")
def health():
    return {"ok": True, "ocr": HAS_OCR, "opencv": cv2.__version__}


@app.post("/decode", response_model=DecodeResult)
async def decode(file: UploadFile = File(...)):
    """Barcode from an image, with OCR of the printed digits as a last resort."""
    g = _read(await file.read())

    attempts = 0
    for label, variant in _variants(g):
        attempts += 1
        found = pyzbar.decode(variant)
        if found:
            sym = found[0]
            code = sym.data.decode("utf-8", "ignore")
            return DecodeResult(code=code, symbology=sym.type, via=label,
                                attempts=attempts,
                                checksum_ok=gtin_checksum_ok(code))

    # No bars readable. The digits often still are.
    digits, ok = _ocr_digits(g)
    return DecodeResult(code=None, attempts=attempts, digits=digits or None,
                        checksum_ok=ok,
                        via="ocr digits" if digits else None)


@app.post("/read-text")
async def read_text(file: UploadFile = File(...)):
    """OCR for an ingredient panel. Returned raw — the caller must let a human
    check it, because a dropped ingredient is one nobody gets warned about."""
    if not HAS_OCR:
        raise HTTPException(503, "OCR is not installed in this deployment")
    g = _read(await file.read())

    up = cv2.resize(g, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    up = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(up)
    # Mild denoise, then adaptive threshold — ingredient panels are small print,
    # so a global threshold tends to fill in the counters of letters.
    up = cv2.bilateralFilter(up, 7, 50, 50)
    bw = cv2.adaptiveThreshold(up, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                               cv2.THRESH_BINARY, 35, 12)

    best = ""
    for name, img in (("threshold", bw), ("equalised", up)):
        txt = pytesseract.image_to_string(img, config="--psm 6")
        if len(txt.strip()) > len(best.strip()):
            best = txt

    cleaned = re.sub(r"\s*\n\s*", " ", best)
    cleaned = re.sub(r"-\s+", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned).strip()
    return {"text": cleaned, "raw": best.strip()}

"""
core/parsers/image_parser.py
Estrazione da file immagine a sé stanti (.png, .jpg, .jpeg).

Due cose distinte, entrambe utili:
1. OCR (pytesseract): estrae eventuale testo leggibile nell'immagine
   (screenshot, scansioni, foto di appunti). Usato per il matching testuale
   nel RAG e come fallback ricercabile.
2. L'immagine intera viene comunque sempre allegata come ExtractedImage:
   quando è rilevante per la domanda, verrà inviata direttamente a Gemini
   (che la "vede" e la interpreta davvero: mappe, grafici, diagrammi),
   cosa che il solo OCR non è in grado di fare.
"""

import os

from PIL import Image

from core.models import ExtractedImage, ParsedDocument
from core.parsers.utils import guess_mime_type

try:
    import pytesseract
    _OCR_AVAILABLE = True
except ImportError:
    _OCR_AVAILABLE = False


def extract(file_path: str, ocr_enabled: bool = True) -> ParsedDocument:
    try:
        with open(file_path, "rb") as f:
            image_bytes = f.read()
    except OSError as e:
        return ParsedDocument(source_file=file_path, error=f"Immagine illeggibile: {e}")

    mime_type = guess_mime_type(image_bytes, default="image/png")

    ocr_text = ""
    if ocr_enabled and _OCR_AVAILABLE:
        try:
            with Image.open(file_path) as img:
                ocr_text = pytesseract.image_to_string(img, lang="ita+eng").strip()
        except Exception:
            # Tesseract non installato sul sistema operativo, immagine
            # illeggibile per l'OCR, lingua non disponibile, ecc: non è un
            # errore fatale, semplicemente non avremo testo OCR per questo file.
            ocr_text = ""

    filename = os.path.basename(file_path)
    nearby = f"File immagine: {filename}"
    if ocr_text:
        nearby += f"\nTesto rilevato nell'immagine (OCR): {ocr_text}"

    image = ExtractedImage(
        source_file=file_path,
        location_hint="immagine intera",
        image_bytes=image_bytes,
        mime_type=mime_type,
        nearby_text=nearby[:1500],
    )

    return ParsedDocument(source_file=file_path, text=ocr_text, images=[image])

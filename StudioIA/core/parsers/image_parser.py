"""
core/parsers/image_parser.py
Estrazione da file immagine a sé stanti (.png, .jpg, .jpeg).

Due cose distinte, entrambe utili:
1. OCR locale (OpenCV + Tesseract): estrae eventuale testo leggibile nell'immagine
   (screenshot, scansioni, foto di appunti). Usato per il matching testuale
   nel RAG e come fallback ricercabile.
2. L'immagine intera viene comunque sempre allegata come ExtractedImage:
   quando è rilevante per la domanda, verrà inviata al modello LLM locale
   (se supporta multimodalità) o usata come riferimento visivo.
"""

import os

from core.models import ExtractedImage, ParsedDocument
from core.parsers.utils import guess_mime_type
from core.ocr_processor import LocalOCR

# Cache del motore OCR per evitare di reinizializzarlo ogni volta
_ocr_engine = None


def _get_ocr_engine() -> LocalOCR:
    """Ottiene o crea il motore OCR locale."""
    global _ocr_engine
    if _ocr_engine is None:
        try:
            _ocr_engine = LocalOCR()
        except RuntimeError:
            # Tesseract non disponibile
            return None
    return _ocr_engine


def extract(file_path: str, ocr_enabled: bool = True) -> ParsedDocument:
    try:
        with open(file_path, "rb") as f:
            image_bytes = f.read()
    except OSError as e:
        return ParsedDocument(source_file=file_path, error=f"Immagine illeggibile: {e}")

    mime_type = guess_mime_type(image_bytes, default="image/png")

    ocr_text = ""
    if ocr_enabled:
        ocr_engine = _get_ocr_engine()
        if ocr_engine:
            try:
                # Usa OpenCV + Tesseract per l'OCR locale
                ocr_text = ocr_engine.extract_text_from_image(
                    file_path, 
                    lang='ita+eng',
                    preprocess=True
                ).strip()
            except Exception:
                # OCR fallito: non è un errore fatale
                ocr_text = ""

    filename = os.path.basename(file_path)
    nearby = f"File immagine: {filename}"
    if ocr_text:
        nearby += f"\nTesto rilevato nell'immagine (OCR locale): {ocr_text}"

    image = ExtractedImage(
        source_file=file_path,
        location_hint="immagine intera",
        image_bytes=image_bytes,
        mime_type=mime_type,
        nearby_text=nearby[:1500],
    )

    return ParsedDocument(source_file=file_path, text=ocr_text, images=[image])

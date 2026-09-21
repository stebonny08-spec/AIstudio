"""
OCR Module - Riconoscimento ottico dei caratteri usando OpenCV e Tesseract
Funziona completamente in locale senza AI.

Nota sul percorso di Tesseract
------------------------------
Su Windows, Tesseract di solito si installa in:
    C:\\Program Files\\Tesseract-OCR\\tesseract.exe
    C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe

Il percorso può essere forzato dall'esterno impostando la variabile
d'ambiente TESSERACT_CMD, oppure passando tesseract_cmd al costruttore
di LocalOCR. Se non viene trovato da nessuna parte, l'OCR viene
disabilitato con un warning (l'app continua a funzionare senza OCR).
"""

import os
import shutil
import sys
from pathlib import Path
from typing import List, Optional
import logging

import cv2
import numpy as np
import pytesseract

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ======================================================================
# RISOLUZIONE DEL PERCORSO DI TESSERACT
# ======================================================================

_CANDIDATE_TESSERACT_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    "/opt/homebrew/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/usr/bin/tesseract",
]


def _resolve_tesseract_cmd(explicit: Optional[str] = None) -> Optional[str]:
    """Trova il percorso di tesseract.exe nell'ordine:
        1. parametro esplicito
        2. variabile d'ambiente TESSERACT_CMD
        3. PATH di sistema (shutil.which)
        4. percorsi standard hardcoded
    """
    if explicit:
        p = Path(explicit)
        if p.is_file():
            return str(p)
        logger.warning(f"Percorso Tesseract esplicito non valido: {explicit}")

    env_path = os.environ.get("TESSERACT_CMD", "").strip()
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return str(p)
        logger.warning(f"TESSERACT_CMD impostata ma non valida: {env_path}")

    which = shutil.which("tesseract")
    if which:
        return which

    for candidate in _CANDIDATE_TESSERACT_PATHS:
        if Path(candidate).is_file():
            return candidate

    return None


# ======================================================================
# CLASSE PRINCIPALE
# ======================================================================

class LocalOCR:
    """Classe per l'elaborazione OCR locale di immagini e appunti."""

    def __init__(self, tesseract_cmd: Optional[str] = None):
        resolved = _resolve_tesseract_cmd(tesseract_cmd)
        if resolved:
            pytesseract.pytesseract.tesseract_cmd = resolved
            logger.info(f"Tesseract trovato in: {resolved}")
        else:
            logger.warning(
                "Tesseract non trovato in nessun percorso noto. "
                "L'OCR verrà disabilitato. Per abilitarlo: installa Tesseract "
                "o imposta TESSERACT_CMD con il percorso completo di tesseract.exe."
            )

        try:
            pytesseract.get_tesseract_version()
            logger.info("Tesseract OCR inizializzato con successo")
            self._available = True
        except Exception as e:
            logger.error(f"Tesseract non risponde: {e}")
            self._available = False

    def is_available(self) -> bool:
        """True se Tesseract è installato e risponde."""
        return self._available

    # ------------------------------------------------------------------
    def preprocess_image(self, image: np.ndarray) -> np.ndarray:
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()

        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        kernel = np.ones((1, 1), np.uint8)
        denoised = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        return denoised

    def detect_document_boundaries(self, image: np.ndarray) -> Optional[np.ndarray]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edged = cv2.Canny(blurred, 75, 200)
        contours, _ = cv2.findContours(edged.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)

        for contour in contours:
            perimeter = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
            if len(approx) == 4:
                x, y, w, h = cv2.boundingRect(approx)
                return image[y:y+h, x:x+w]
        return None

    # ------------------------------------------------------------------
    def extract_text_from_image(
        self,
        image_path: str,
        lang: str = 'ita+eng',
        preprocess: bool = True,
    ) -> str:
        if not self._available:
            logger.warning("OCR non disponibile: salto l'estrazione.")
            return ""
        try:
            image = cv2.imread(str(image_path))
            if image is None:
                raise ValueError(f"Impossibile caricare l'immagine: {image_path}")

            cropped = self.detect_document_boundaries(image)
            if cropped is not None:
                image = cropped
                logger.info("Documento rilevato e ritagliato")

            if preprocess:
                image = self.preprocess_image(image)

            text = pytesseract.image_to_string(image, lang=lang)
            logger.info(f"OCR completato: {len(text)} caratteri estratti")
            return text.strip()

        except Exception as e:
            logger.error(f"Errore OCR: {e}")
            return ""

    def extract_text_from_images(self, image_paths: List[str], lang: str = 'ita+eng') -> str:
        all_text = []
        for img_path in image_paths:
            text = self.extract_text_from_image(img_path, lang)
            if text:
                all_text.append(text)
        return "\n\n---\n\n".join(all_text)

    def extract_text_from_bytes(
        self,
        image_bytes: bytes,
        lang: str = 'ita+eng',
        preprocess: bool = True,
    ) -> str:
        if not self._available:
            return ""
        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if image is None:
                raise ValueError("Impossibile decodificare l'immagine")

            cropped = self.detect_document_boundaries(image)
            if cropped is not None:
                image = cropped

            if preprocess:
                image = self.preprocess_image(image)

            text = pytesseract.image_to_string(image, lang=lang)
            logger.info(f"OCR da bytes completato: {len(text)} caratteri")
            return text.strip()

        except Exception as e:
            logger.error(f"Errore OCR da bytes: {e}")
            return ""

    def get_confidence_map(
        self,
        image_path: str,
        lang: str = 'ita+eng',
        preprocess: bool = True,
    ) -> dict:
        if not self._available:
            return {}
        image = cv2.imread(str(image_path))
        if image is None:
            return {}
        if preprocess:
            image = self.preprocess_image(image)

        data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)
        results = {'text': [], 'conf': [], 'bbox': []}
        for i in range(len(data['text'])):
            if int(data['conf'][i]) > 0:
                results['text'].append(data['text'][i])
                results['conf'].append(data['conf'][i])
                results['bbox'].append({
                    'x': data['left'][i],
                    'y': data['top'][i],
                    'w': data['width'][i],
                    'h': data['height'][i],
                })
        return results


# ======================================================================
# UTILITY
# ======================================================================

def process_notes_batch(
    image_folder: str,
    output_file: Optional[str] = None,
    lang: str = 'ita+eng',
) -> str:
    ocr = LocalOCR()
    if not ocr.is_available():
        logger.warning("OCR non disponibile, nessun testo estratto.")
        return ""

    folder = Path(image_folder)
    image_extensions = ['*.jpg', '*.jpeg', '*.png', '*.bmp', '*.tiff']
    image_files = []
    for ext in image_extensions:
        image_files.extend(folder.glob(ext))

    if not image_files:
        logger.warning(f"Nessuna immagine trovata in {image_folder}")
        return ""

    combined_text = ocr.extract_text_from_images([str(f) for f in image_files], lang=lang)

    if output_file and combined_text:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(combined_text)
        logger.info(f"Testo salvato in {output_file}")

    return combined_text


if __name__ == "__main__":
    print("Test modulo OCR locale")
    print("=" * 50)
    try:
        ocr = LocalOCR()
        if ocr.is_available():
            print("✓ Tesseract OCR disponibile")
        else:
            print("✗ Tesseract non trovato o non funzionante")
            print("  Imposta TESSERACT_CMD o installa Tesseract.")
    except Exception as e:
        print(f"✗ Errore: {e}")
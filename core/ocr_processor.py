"""
OCR Module — riconoscimento ottico dei caratteri con OpenCV + Tesseract.

Tesseract può essere:
  1. incluso nel bundle dell'app (cartella tesseract/ accanto all'exe,
     o dentro _MEIPASS quando è frozen) → l'utente non deve installare nulla
  2. installato nel sistema → fallback per chi sviluppa

Risoluzione automatica, in ordine:
  - parametro esplicito (tesseract_cmd passato al costruttore)
  - variabile d'ambiente TESSERACT_CMD
  - bundle PyInstaller (sys._MEIPASS/tesseract/tesseract.exe)
  - accanto all'eseguibile (dist/NovaStudio/tesseract/tesseract.exe)
  - shutil.which (PATH di sistema)
  - percorsi standard di installazione
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

_STANDARD_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    "/opt/homebrew/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/usr/bin/tesseract",
]


def _find_bundled_tesseract() -> Optional[str]:
    """Cerca Tesseract dentro il bundle PyInstaller o accanto all'eseguibile."""
    candidates = []

    # 1. Bundle PyInstaller (una volta frozen)
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        candidates.append(base / "tesseract" / "tesseract.exe")
        # Alcune versioni di PyInstaller mettono i dati un livello sopra
        candidates.append(base / ".." / "tesseract" / "tesseract.exe")

        # 2. Accanto all'eseguibile (cartella dist/NovaStudio/)
        exe_dir = Path(sys.executable).parent
        candidates.append(exe_dir / "tesseract" / "tesseract.exe")

    # 3. Sviluppo: cartella tesseract/ nella root del progetto
    #    ocr_processor.py sta in core/, quindi risaliamo di uno
    here = Path(__file__).resolve()
    project_root = here.parent.parent
    candidates.append(project_root / "tesseract" / "tesseract.exe")

    for c in candidates:
        try:
            if c.is_file():
                return str(c.resolve())
        except (OSError, RuntimeError):
            continue
    return None


def _resolve_tesseract_cmd(explicit: Optional[str] = None) -> Optional[str]:
    """Trova il percorso di tesseract.exe seguendo l'ordine documentato."""
    # 1. Esplicito
    if explicit:
        p = Path(explicit)
        if p.is_file():
            return str(p)
        logger.warning(f"Percorso Tesseract esplicito non valido: {explicit}")

    # 2. Variabile d'ambiente
    env_path = os.environ.get("TESSERACT_CMD", "").strip()
    if env_path and Path(env_path).is_file():
        return env_path

    # 3. Bundle
    bundled = _find_bundled_tesseract()
    if bundled:
        return bundled

    # 4. PATH di sistema
    which = shutil.which("tesseract")
    if which:
        return which

    # 5. Percorsi standard
    for candidate in _STANDARD_PATHS:
        if Path(candidate).is_file():
            return candidate

    return None


def _configure_tessdata(tesseract_exe: str) -> None:
    """Imposta TESSDATA_PREFIX così Tesseract trova le lingue italiane
    anche quando è dentro il bundle (dove il path di default non funziona)."""
    tessdata = Path(tesseract_exe).parent / "tessdata"
    if tessdata.is_dir():
        os.environ["TESSDATA_PREFIX"] = str(tessdata)


# ======================================================================
# CLASSE PRINCIPALE
# ======================================================================

class LocalOCR:
    """OCR locale di immagini e appunti."""

    def __init__(self, tesseract_cmd: Optional[str] = None):
        resolved = _resolve_tesseract_cmd(tesseract_cmd)
        if resolved:
            pytesseract.pytesseract.tesseract_cmd = resolved
            _configure_tessdata(resolved)
            logger.info(f"Tesseract trovato in: {resolved}")
        else:
            logger.warning(
                "Tesseract non trovato. L'OCR sarà disabilitato."
            )

        try:
            pytesseract.get_tesseract_version()
            logger.info("Tesseract OCR inizializzato con successo")
            self._available = True
        except Exception as e:
            logger.error(f"Tesseract non risponde: {e}")
            self._available = False

    def is_available(self) -> bool:
        return self._available

    # ------------------------------------------------------------------
    def preprocess_image(self, image: np.ndarray) -> np.ndarray:
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        kernel = np.ones((1, 1), np.uint8)
        return cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)

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

    def extract_text_from_image(self, image_path, lang='ita+eng', preprocess=True) -> str:
        if not self._available:
            return ""
        try:
            image = cv2.imread(str(image_path))
            if image is None:
                raise ValueError(f"Impossibile caricare: {image_path}")
            cropped = self.detect_document_boundaries(image)
            if cropped is not None:
                image = cropped
            if preprocess:
                image = self.preprocess_image(image)
            text = pytesseract.image_to_string(image, lang=lang)
            return text.strip()
        except Exception as e:
            logger.error(f"Errore OCR: {e}")
            return ""

    def extract_text_from_images(self, image_paths: List[str], lang='ita+eng') -> str:
        all_text = []
        for p in image_paths:
            t = self.extract_text_from_image(p, lang)
            if t:
                all_text.append(t)
        return "\n\n---\n\n".join(all_text)

    def extract_text_from_bytes(self, image_bytes: bytes, lang='ita+eng', preprocess=True) -> str:
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
            return pytesseract.image_to_string(image, lang=lang).strip()
        except Exception as e:
            logger.error(f"Errore OCR da bytes: {e}")
            return ""

    def get_confidence_map(self, image_path, lang='ita+eng', preprocess=True) -> dict:
        if not self._available:
            return {}
        image = cv2.imread(str(image_path))
        if image is None:
            return {}
        if preprocess:
            image = self.preprocess_image(image)
        data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)
        out = {"text": [], "conf": [], "bbox": []}
        for i in range(len(data["text"])):
            if int(data["conf"][i]) > 0:
                out["text"].append(data["text"][i])
                out["conf"].append(data["conf"][i])
                out["bbox"].append({
                    "x": data["left"][i], "y": data["top"][i],
                    "w": data["width"][i], "h": data["height"][i],
                })
        return out


if __name__ == "__main__":
    ocr = LocalOCR()
    print("OCR disponibile:", ocr.is_available())
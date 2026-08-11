"""
ocr_engine.py
Motore OCR locale (EasyOCR) per l'estrazione del testo grezzo da foto di
appunti scritti a mano. Costo: 0 euro, esecuzione interamente in locale.
Usato esclusivamente nel FLUSSO A (Testo Continuo / Riassunto).
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from .config import OCR_LANGUAGES, OCR_USE_GPU, get_logger

logger = get_logger(__name__)


class OCREngineError(RuntimeError):
    """Errore generico sollevato dal motore OCR."""


class OCREngine:
    """
    Wrapper singleton attorno a EasyOCR.

    Il modello viene caricato in modo "lazy" (solo alla prima chiamata utile)
    perche' l'inizializzazione e' costosa: al primo avvio in assoluto EasyOCR
    scarica i pesi del modello (richiede una connessione internet), le volte
    successive li carica da cache locale in un paio di secondi.
    Il pattern singleton evita di ricaricare il modello ad ogni pagina elaborata.
    """

    _instance: Optional["OCREngine"] = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            instance = super().__new__(cls)
            instance._reader = None
            cls._instance = instance
        return cls._instance

    def _get_reader(self):
        if self._reader is None:
            try:
                import easyocr  # import ritardato: libreria pesante (torch)
            except ImportError as exc:
                raise OCREngineError(
                    "La libreria 'easyocr' non e' installata. Esegui: pip install easyocr"
                ) from exc

            logger.info("Inizializzazione EasyOCR (lingue=%s, gpu=%s)...", OCR_LANGUAGES, OCR_USE_GPU)
            try:
                self._reader = easyocr.Reader(OCR_LANGUAGES, gpu=OCR_USE_GPU)
            except Exception as exc:  # noqa: BLE001 - vogliamo intercettare qualsiasi errore di init
                raise OCREngineError(f"Impossibile inizializzare EasyOCR: {exc}") from exc
        return self._reader

    def extract_text(self, image_path: Path) -> str:
        """
        Estrae il testo grezzo da un'immagine di appunti scritti a mano.
        Restituisce una stringa vuota (senza sollevare eccezioni) se non viene
        rilevato alcun testo nell'immagine.
        """
        reader = self._get_reader()
        try:
            # paragraph=True raggruppa automaticamente le righe vicine in blocchi
            # coerenti, restituendoli in un ordine di lettura ragionevole (alto -> basso).
            results = reader.readtext(str(image_path), detail=1, paragraph=True)
        except Exception as exc:  # noqa: BLE001
            raise OCREngineError(f"Errore OCR sull'immagine '{image_path.name}': {exc}") from exc

        if not results:
            logger.warning("Nessun testo rilevato in '%s'.", image_path.name)
            return ""

        lines: List[str] = [entry[1].strip() for entry in results if entry[1] and entry[1].strip()]
        raw_text = "\n".join(lines)
        logger.info("OCR completato su '%s': %d caratteri estratti.", image_path.name, len(raw_text))
        return raw_text

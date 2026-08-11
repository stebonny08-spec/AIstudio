"""
config.py
Configurazione centralizzata dell'applicazione Appunti2PDF.
Tutti i parametri regolabili (chiavi API, modelli, lingue OCR, ecc.) vivono qui
o nel file .env, cosi' da non avere "magic values" sparsi nel codice.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# #region agent log
def _debug_log(location: str, message: str, data: dict, hypothesis_id: str) -> None:
    import json, time
    from pathlib import Path as _Path
    payload = {
        "sessionId": "cb680a",
        "runId": "pre-fix",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    try:
        log_path = _Path(__file__).resolve().parent.parent / "debug-cb680a.log"
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        pass
# #endregion

BASE_DIR = Path(__file__).resolve().parent.parent
_env_path = BASE_DIR / ".env"
_env_example_path = BASE_DIR / ".env.example"
_cwd = os.getcwd()

if not _env_path.exists() and _env_example_path.exists():
    import shutil
    shutil.copy(_env_example_path, _env_path)

# #region agent log
_debug_log(
    "config.py:load_dotenv",
    "paths before load_dotenv",
    {
        "cwd": _cwd,
        "env_exists": _env_path.exists(),
        "env_example_exists": _env_example_path.exists(),
        "env_key_in_os_before": bool(os.getenv("GEMINI_API_KEY", "").strip()),
    },
    "A",
)
# #endregion
load_dotenv(_env_path)
# #region agent log
_debug_log(
    "config.py:load_dotenv",
    "after load_dotenv(BASE_DIR/.env)",
    {
        "env_key_in_os_after": bool(os.getenv("GEMINI_API_KEY", "").strip()),
        "env_key_len_after": len(os.getenv("GEMINI_API_KEY", "").strip()),
    },
    "B",
)
# #endregion

# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)


def get_logger(name: str) -> logging.Logger:
    """Restituisce un logger configurato in modo uniforme per tutto il progetto."""
    return logging.getLogger(name)


# --------------------------------------------------------------------------- #
# Percorsi
# --------------------------------------------------------------------------- #
# BASE_DIR definito sopra, prima del caricamento .env


# --------------------------------------------------------------------------- #
# Impostazioni AI (Gemini)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class AISettings:
    """Parametri per le chiamate al modello Gemini (testo e visione)."""

    api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", "").strip())
    text_model: str = field(default_factory=lambda: os.getenv("GEMINI_TEXT_MODEL", "gemini-flash-latest"))
    vision_model: str = field(default_factory=lambda: os.getenv("GEMINI_VISION_MODEL", "gemini-flash-latest"))
    max_retries: int = field(default_factory=lambda: int(os.getenv("AI_MAX_RETRIES", "3")))
    temperature: float = field(default_factory=lambda: float(os.getenv("AI_TEMPERATURE", "0.2")))


AI_SETTINGS = AISettings()
# #region agent log
_debug_log(
    "config.py:AISettings",
    "AI_SETTINGS initialized",
    {
        "api_key_configured": bool(AI_SETTINGS.api_key),
        "api_key_len": len(AI_SETTINGS.api_key),
    },
    "C",
)
# #endregion


def is_ai_configured() -> bool:
    """
    Indica se la chiave API Gemini e' configurata (letta esclusivamente da
    variabili d'ambiente / file .env, MAI dall'interfaccia utente).
    Non restituisce ne' espone mai il valore della chiave stessa.
    """
    return bool(AI_SETTINGS.api_key)


def is_desktop_mode() -> bool:
    """True quando Streamlit e' avviato dalla shell desktop (pywebview)."""
    return os.getenv("APPUNTI2PDF_DESKTOP", "").strip().lower() in {"1", "true", "yes"}


def write_debug_log(location: str, message: str, data: dict, hypothesis_id: str, run_id: str = "download-debug") -> None:
    """Scrive una riga NDJSON nel file di log della sessione di debug."""
    _debug_log(location, message, {**data, "runId": run_id}, hypothesis_id)

# --------------------------------------------------------------------------- #
# Impostazioni OCR locale (EasyOCR) - usate solo nel Flusso A
# --------------------------------------------------------------------------- #
OCR_LANGUAGES = [lang.strip() for lang in os.getenv("OCR_LANGUAGES", "it,en").split(",") if lang.strip()]
OCR_USE_GPU = os.getenv("OCR_USE_GPU", "false").lower() in {"1", "true", "yes"}

# --------------------------------------------------------------------------- #
# Impostazioni file / immagini
# --------------------------------------------------------------------------- #
SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}
MAX_IMAGE_SIDE_PX = int(os.getenv("MAX_IMAGE_SIDE_PX", "2600"))  # ridimensionamento per contenere i costi/tempi AI

"""
data/config_manager.py
-----------------------
Gestisce la configurazione persistente dell'utente: chiave API Gemini,
percorso della cartella locale da indicizzare, opzioni varie (OCR on/off,
soglia di rilevanza RAG, ecc).

Scelta di design (concordata): la chiave API viene salvata in CHIARO in un
file config.json locale, senza cifratura. Per un'app desktop mono-utente
che gira solo sul PC del proprietario, la cifratura (es. tramite 'keyring')
introdurrebbe una dipendenza dal sistema operativo che può fallire in modi
poco chiari e non è giustificata dal rischio reale in questo contesto.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict


APP_NAME = "StudioIA"

DEFAULT_CONFIG: Dict[str, Any] = {
    "folder_path": "",
    "ocr_enabled": True,
    "search_mode_default": "automatica",   # automatica | solo_locale | solo_online
    "rag_top_k": 5,
    "window_geometry": "1180x760",
    # Configurazione per modello locale GGUF
    "local_model_path": "",                # Percorso del file .gguf
    "local_model_n_ctx": 4096,             # Context length
    "local_model_n_gpu_layers": -1,        # -1 = tutte le layer su GPU
    "local_model_n_threads": None,         # None = automatico
}


def get_app_data_dir() -> Path:
    """Ritorna la cartella dati dell'app, creandola se non esiste.
    Windows: %APPDATA%/StudioIA
    macOS:   ~/Library/Application Support/StudioIA
    Linux:   ~/.config/StudioIA
    """
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA", str(Path.home()))
        path = Path(base) / APP_NAME
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / APP_NAME
    else:
        base = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
        path = Path(base) / APP_NAME

    path.mkdir(parents=True, exist_ok=True)
    
    # Crea le cartelle per i vettori utente e database libri
    user_files_dir = path / "user_files"
    data_base_dir = path / "data_base"
    
    user_files_dir.mkdir(parents=True, exist_ok=True)
    data_base_dir.mkdir(parents=True, exist_ok=True)
    
    return path


def get_user_files_dir() -> Path:
    """Ritorna la cartella per i file vettorizzati dell'utente."""
    return get_app_data_dir() / "user_files"


def get_data_base_dir() -> Path:
    """Ritorna la cartella per il database di libri vettorizzati."""
    return get_app_data_dir() / "data_base"


class ConfigManager:
    """Carica/salva la configurazione utente su disco (config.json)."""

    def __init__(self):
        self.path = get_app_data_dir() / "config.json"
        self._data: Dict[str, Any] = dict(DEFAULT_CONFIG)
        self.load()

    def load(self) -> None:
        if self.path.exists():
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                # merge: eventuali chiavi mancanti nel file vecchio vengono
                # riempite con i default, così un aggiornamento dell'app
                # non rompe mai la configurazione esistente dell'utente.
                self._data = {**DEFAULT_CONFIG, **saved}
            except (json.JSONDecodeError, OSError):
                # file corrotto o illeggibile: non blocchiamo l'avvio,
                # ripartiamo dai default e sovrascriviamo al primo salvataggio.
                self._data = dict(DEFAULT_CONFIG)
        else:
            self._data = dict(DEFAULT_CONFIG)
            self.save()

    def save(self) -> None:
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2, ensure_ascii=False)
        except OSError as e:
            # Non facciamo crashare l'app per un errore di scrittura config;
            # chi chiama può controllare il valore di ritorno se vuole avvisare l'utente.
            print(f"[ConfigManager] Impossibile salvare la configurazione: {e}")

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value

    def update(self, **kwargs) -> None:
        self._data.update(kwargs)
        self.save()

    def is_configured(self) -> bool:
        """True se l'utente ha configurato il percorso del modello GGUF."""
        return bool(self._data.get("local_model_path", "").strip())

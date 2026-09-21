"""
data/config_manager.py
-----------------------
Gestisce la configurazione persistente dell'utente in un file config.json
locale nella cartella dati dell'app.

Scelta di design (concordata): la configurazione è salvata in CHIARO, senza
cifratura. Per un'app desktop mono-utente che gira solo sul PC del
proprietario, la cifratura (es. tramite 'keyring') introdurrebbe una
dipendenza dal sistema operativo che può fallire in modi poco chiari e non
è giustificata dal rischio reale in questo contesto.

Nota su 'local_model_path': questa chiave viene impostata automaticamente
dalla UI quando l'utente seleziona un modello dal menu "Seleziona modelli"
(vedi backend/api.py -> load_model). Il valore iniziale è vuoto; l'utente
esperto può comunque sovrascriverlo a mano in config.json per puntare a
un GGUF locale diverso da quelli del catalogo.

I parametri tecnici del modello (n_ctx, n_gpu_layers, n_threads) NON sono
esposti nella UI: vanno impostati a mano in config.json.

Valori di default calibrati su MiniCPM5-2B (modello di riferimento):
- n_ctx = 8192 (il modello supporta nativamente fino a 128K, ma 8K è un
  buon compromesso tra contesto disponibile e uso di RAM su macchine
  consumer; aumentare solo se si ha RAM sufficiente)
- n_gpu_layers = -1 (tutte le layer su GPU se disponibile, altrimenti CPU)
- n_threads = None (auto: usa os.cpu_count() - 1)
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict


APP_NAME = "NovaStudio"

DEFAULT_CONFIG: Dict[str, Any] = {
    "ocr_enabled": True,
    "rag_top_k": 5,
    # Configurazione per modello locale GGUF (MiniCPM5-2B di riferimento)
    "local_model_path": "",
    "local_model_n_ctx": 8192,
    "local_model_n_gpu_layers": -1,
    "local_model_n_threads": None,
}


def get_app_data_dir() -> Path:
    """Ritorna la cartella dati dell'app, creandola se non esiste.
    Windows: %APPDATA%/NovaStudio
    macOS:   ~/Library/Application Support/NovaStudio
    Linux:   ~/.config/NovaStudio
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
    return path


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
                # Merge: eventuali chiavi mancanti nel file vecchio vengono
                # riempite con i default, così un aggiornamento dell'app
                # non rompe mai la configurazione esistente dell'utente.
                self._data = {**DEFAULT_CONFIG, **saved}
            except (json.JSONDecodeError, OSError):
                self._data = dict(DEFAULT_CONFIG)
        else:
            self._data = dict(DEFAULT_CONFIG)
            self.save()

    def save(self) -> None:
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2, ensure_ascii=False)
        except OSError as e:
            print(f"[ConfigManager] Impossibile salvare la configurazione: {e}")

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value

    def update(self, **kwargs) -> None:
        self._data.update(kwargs)
        self.save()

    def get_config(self) -> Dict[str, Any]:
        return dict(self._data)

    def update_config(self, settings: Dict[str, Any]) -> None:
        self.update(**settings)

    def is_configured(self) -> bool:
        """True se esiste un percorso modello configurato (indipendentemente
        dal fatto che il file esista davvero: di quello si occupa
        StudioIAAPI._load_llm_client_from_config)."""
        return bool(self._data.get("local_model_path", "").strip())
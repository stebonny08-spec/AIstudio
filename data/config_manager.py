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

Su 'local_model_n_ctx': il valore di default è None, che significa
"rileva automaticamente in base alla RAM del PC" (vedi core/system_info.py).
L'utente esperto può forzarlo a un intero specifico in config.json.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional


APP_NAME = "NovaStudio"

DEFAULT_CONFIG: Dict[str, Any] = {
    "ocr_enabled": True,
    "rag_top_k": 5,
    # Configurazione modello locale (auto-rilevata se None)
    "local_model_path": "",
# R22: chiave del modello attivo (pro/base) - selezione persistita
"local_model_key": "",
    "local_model_n_ctx": None,          # None = rileva dalla RAM
    "local_model_n_gpu_layers": -1,
    "local_model_n_threads": None,
    # --- Sidecar / llama-server (T1) ---
    "llm.backend": "sidecar",            # 'sidecar' | 'inprocess' (rollback)
    "llama.server_path": "",             # llama-server.exe ('' = non configurato)
    "llama.engine": "auto",              # R23 X5: upstream | xhtoken | auto
    # P1b.1 - n-gram speculative draftless LONG-FORM (esito A/B qa/p1b_ngram.json:
    # ngram-map-k d5 = 3.073x pro / 2.343x base, acceptance 1.0, output identici
    # al greedy baseline; micro/standard restano OFF per regola)
    "spec.ngram_longform": True,
    "spec.ngram_variant": "ngram-map-k",
    "spec.ngram_draft_max": 5,
    "llama.model_path": os.path.expanduser(os.path.expandvars(
        "%APPDATA%/NovaStudio/models/MiniCPM5-2B-Q4_K_M.gguf")),
    "llama.idle_unload_sec": 300,        # scarico automatico dopo inattivita'
    "llama.n_ctx": 4096,                 # contesto llama-server (clamp 4096-8192)
    # --- H5: motore / autotune / speculazione (OPT-IN tranne prompt_lookup) ---
    "llm.engine": "llama.cpp",           # 'llama.cpp' | 'ik_llama.cpp'
    "llama.bench_path": "",              # percorso llama-bench ('' = assente)
    "autotune.done": False,              # autotune tok/s una tantum
    "autotune.result": {},               # {'pp_tok_s': .., 'tg_tok_s': ..}
    "spec.prompt_lookup": True,          # prompt lookup: ON di default
    "spec.draft_model": "",              # modello draft per speculazione
    "spec.eagle3": False,                # eAGLE-3 (OPT-IN)
    # --- R15b: gate precoce + stadio web (CHIAVI DI CONTRATTO, owner coordinator;
    # i blocchi G/W le LEGGONO, non le definiscono: vedi core/rag/contract.py) ---
    # R15b G: TARATURA su qa/gt_set_r15.json (18 casi reali, vec+FTS5/bm25 misurati):
    #   sweep (tp/fp/fn/tn): 0.30-0.60 -> 9/0/0/5 ma 0/4 parziali corretti;
    #   0.65 -> 9/0/0/5 con 3/4;  0.70 -> 9/0/0/5 con 4/4 (recall 1.0, prec 1.0);
    #   0.75 -> 9/0/0/5 con 4/4 (margine solo 0.024 sul positivo piu' debole);
    #   0.80 -> 8/0/1/5 (perde p4). SCELTA 0.70. Dettagli: qa/qa_r15_g_report.md
    "gate.threshold": 0.70,          # soglia gate (score fuso top-k); tarata da G su GT R15b
    "web.mode": "auto",             # escalation web: "auto" | "sempre" | "mai"
    "web.weight_appunti": 1.0,      # pesi fusione RRF a 3 stadi (W3)
    "web.weight_libri": 1.0,
    "web.weight_web": 0.8,
    "web.cache_ttl_days": 7,        # TTL cache URL persistente (W2)
    "web.searxng_url": "",          # SearXNG self-hosted opzionale (W1; "" = disattivo)
    "web.wikipedia": True,          # Wikipedia API opzionale per fattuale (W1)
    "rag.progress_events": True,    # eventi {"type":"progress"} per stadio (P3)
    # --- R13: draft SOLO long-form (F10/F13, classe/profile think, W2) ---
    # Policy: se spec.draft_model e' impostato, il draft viene caricato SOLO
    # per le richieste long-form; micro/standard partono SENZA draft.
    # Non rompe nulla: con spec.draft_model vuoto (default) nessun draft.
    # R13 S4 (qa/r13_spec_measures.json): misure reali draft ON vs OFF ->
    #   OFF motivato per TUTTI i profili (acceptance<0.70 o speedup<1.30x;
    #   think: acc 0.811 ok ma speedup 1.169x < 1.30x) e RAM con draft
    #   3.4-3.9GB > 2.9GB -> enforcement globale = spec.draft_model vuoto
    #   (immutato). Questa chiave resta il gate "solo long-form" per un
    #   eventuale re-attivazione esplicita dopo nuove misure.
    "spec.draft_longform": True,
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
        """True se esiste un percorso modello configurato."""
        return bool(self._data.get("local_model_path", "").strip())
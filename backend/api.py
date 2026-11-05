"""
backend/api.py
------------------
Bridge Python <-> JavaScript.

Reindex:
  L'indice non viene più aggiornato ad ogni query. Viene aggiornato:
  - All'avvio dell'app (dopo il caricamento del modello), in background
  - Quando l'utente carica un file (add_notes_material / add_library_material)
  Questo evita di bloccare ogni domanda per 5-15 secondi di scansione disco.

Caricamento modello:
  Viene avviato da main.py esplicitamente dopo create_window().
  Lo stato e il progresso reale sono esposti via get_model_status().
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import List, Optional

import webview

from core.local_llm_client import (
    LocalLLMClient, LocalLLMError, DEFAULT_STUDY_MODE, SYSTEM_PROMPTS,
)
try:
    from core.sidecar import AiUnavailable
except Exception:  # sidecar opzionale (T1): definizione minima locale
    class AiUnavailable(Exception):
        """AI non disponibile (per non far esplodere l'API)."""

from core.local_llm_client import maybe_wrap_sidecar
from core.local_search import LocalSearchEngine
from core.markdown_converter import MarkdownConverter
from core.rag.image_cache import cleanup_orphans
from core.rag.indexer import ensure_rag_layout, migrate_legacy_files
from core.rag.vector_store import VectorStore
from core.router import Router, extract_part_summary
from core.system_info import (
    get_system_info, recommended_n_ctx, recommended_rag_max_tokens,
    describe_auto_choice,
)
from data.config_manager import ConfigManager, get_app_data_dir
from data.db import Database
from data.models_manager import ModelsManager
from data.preselected_books_manager import PreselectedBooksManager
from backend.study_api import StudyAPI

# H13: runtime AI + tutor (import PROTETTI: mai far esplodere l'API)
try:
    from core.ai_cache import AiCache
except Exception:  # pragma: no cover — modulo opzionale
    AiCache = None
try:
    from core.ai_runtime import run_ai_function as _run_ai_function
    # R13 T1: telemetria runtime (stesso try/protetto di _run_ai_function)
    from core.ai_runtime import get_stats as _ai_runtime_get_stats
    from core.ai_runtime import reset_stats as _ai_runtime_reset_stats
except Exception:
    _run_ai_function = None
    _ai_runtime_get_stats = None
    _ai_runtime_reset_stats = None
try:
    from core.sidecar.queue import CodaPriorita
except Exception:  # pragma: no cover — modulo opzionale
    CodaPriorita = None
try:
    from core.tutor import TutorSession
except Exception:  # pragma: no cover — modulo opzionale
    TutorSession = None

# TTL delle sessioni tutor in memoria (dict con scadenza, vedi tutor_step)
TUTOR_SESSION_TTL_SEC = 1800

NOTES_FILE_TYPES = (
    "Tutti i file supportati (*.jpg;*.jpeg;*.png;*.bmp;*.tiff;*.pdf;*.docx;*.pptx;*.txt;*.md)",
    "Immagini e documenti (*.jpg;*.jpeg;*.png;*.bmp;*.tiff;*.pdf;*.docx;*.pptx)",
    "File di testo (*.txt;*.md)",
    "Tutti i file (*.*)",
)
LIBRARY_FILE_TYPES = (
    "File PDF (*.pdf)",
    "Tutti i file (*.*)",
)

USER_SETTINGS_KEYS = ("ocr_enabled", "rag_top_k")

APP_VERSION = "0.1.0"
UPDATE_REPO = ""
LIBRARY_WEBSITE_URL = ""


# ======================================================================
# Lettura Working Set del processo (cross-platform, senza psutil)
# ======================================================================
def _get_process_rss_mb() -> Optional[float]:
    try:
        if sys.platform.startswith("win"):
            import ctypes

            class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
                _fields_ = [
                    ("cb", ctypes.c_ulong),
                    ("PageFaultCount", ctypes.c_ulong),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                ]

            counters = PROCESS_MEMORY_COUNTERS()
            counters.cb = ctypes.sizeof(counters)
            ok = ctypes.windll.psapi.GetProcessMemoryInfo(
                ctypes.windll.kernel32.GetCurrentProcess(),
                ctypes.byref(counters),
                counters.cb,
            )
            if ok:
                return counters.WorkingSetSize / (1024 * 1024)
        else:
            import resource
            rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            if sys.platform == "darwin":
                return rss / (1024 * 1024)
            return rss / 1024.0
    except Exception:
        return None
    return None


def _parse_version(v: str):
    parts = []
    for p in v.split("."):
        digits = "".join(ch for ch in p if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts) or (0,)


def _is_newer_version(latest, current):
    try:
        return _parse_version(latest) > _parse_version(current)
    except Exception:
        return False


def _is_safe_url(url: str) -> bool:
    return isinstance(url, str) and url.startswith("https://")


def _normalize_study_mode(sm) -> str:
    if isinstance(sm, str) and sm in SYSTEM_PROMPTS:
        return sm
    return DEFAULT_STUDY_MODE


class StudioIAAPI(StudyAPI):
    def __init__(self):
        self.base_dir = Path(__file__).parent.parent
        self.db = Database()
        self.config = ConfigManager()
        self.models_manager = ModelsManager()

        self.system_info = get_system_info()
        self.effective_n_ctx = self._compute_n_ctx()
        self.effective_rag_max = recommended_rag_max_tokens(self.system_info["ram_gb"])
        print(f"[StudioIAAPI] {describe_auto_choice(self.system_info['ram_gb'])}")

        # Stato caricamento modello
        self._model_state_lock = threading.Lock()
        self._model_state = {
            "state": "not_configured",
            "progress": 0.0,
            "error": None,
            "ram_gb": self.system_info["ram_gb"],
            "_baseline_rss_mb": 0.0,
            "_expected_delta_mb": 0.0,
        }
        self._load_thread: Optional[threading.Thread] = None

        # Reindex in background (invece che ad ogni query)
        self._reindex_lock = threading.Lock()
        self._reindex_thread: Optional[threading.Thread] = None
        self._reindex_stop = threading.Event()
        self._reindex_interval_sec = 300   # ogni 5 minuti

        self._streams_lock = threading.Lock()
        self._streams: dict = {}

        self.rag_folder = self.base_dir / "file_AIstudio"
        self.rag_folder.mkdir(parents=True, exist_ok=True)
        self.vector_store = VectorStore(str(get_app_data_dir() / "vector_index"))
        self.local_search = LocalSearchEngine(self.db, self.vector_store)

        self.books_manager = PreselectedBooksManager()
        self.books_vector_store = VectorStore(str(get_app_data_dir() / "vector_index_books"))
        self.books_search = LocalSearchEngine(self.db, self.books_vector_store, self.local_search.embedder)

        # --- C1/C3: layout a due livelli (originals/ + rag_stage2/) ---
        # Ordine importante: la migrazione gira QUI in __init__, PRIMA di
        # cleanup_orphans e ben prima del primo reindex (che parte solo dopo
        # il caricamento del modello, _start_reindex_loop). Così i file in
        # radice sono già spostati in originals/ e copiati in rag_stage2/
        # quando il primo scan esegue il ciclo di rimozioni: i vecchi path in
        # radice escono dal DB e la copia in rag_stage2/ viene (ri)indicizzata.
        books_base = Path(self.books_manager.get_books_folder_path())
        self.rag_originals_folder, self.rag_stage2_folder = ensure_rag_layout(self.rag_folder)
        self.books_originals_folder, self.books_stage2_folder = ensure_rag_layout(books_base)
        for _base in (self.rag_folder, books_base):
            try:
                _stats = migrate_legacy_files(_base)
                if any(_stats.values()):
                    print(f"[StudioIAAPI] Migrazione layout RAG ({_base.name}): {_stats}")
            except Exception as e:
                print(f"[StudioIAAPI] Migrazione layout RAG fallita ({_base.name}): {e}")

        try:
            # cleanup_orphans legge i sidecar .images.json (rglob ricorsivo):
            # originals/ va INCLUSO perché i sidecar migrati in originals/
            # referenziano immagini nella cache — escluderla significherebbe
            # cancellare quelle immagini. Non si cancella mai nulla dentro
            # originals/: la pulizia agisce solo su images_cache.
            removed = cleanup_orphans([
                self.rag_folder,
                self.rag_originals_folder,
                self.rag_stage2_folder,
                books_base,
                self.books_originals_folder,
                self.books_stage2_folder,
            ])
            if removed:
                print(f"[StudioIAAPI] Rimosse {removed} immagini orfane dalla cache.")
        except Exception as e:
            print(f"[StudioIAAPI] Pulizia cache immagini fallita: {e}")

        self.llm_client: Optional[LocalLLMClient] = None
        self._prepare_llm_client()

        self.router = Router(
            lambda: self.llm_client,
            self.local_search,
            self.books_search,
            rag_top_k=self.config.get("rag_top_k", 5),
            rag_max_tokens=self.effective_rag_max,
        )
        self.converter: Optional[MarkdownConverter] = None

        # H13: singleton runtime AI. Il nome `coda_priorita` è quello già
        # cercato da coda_stato(); l'AiCache è quella usata da
        # ai_run_function (creati subito se i moduli sono disponibili,
        # altrimenti rimangono None e l'API risponde 'AI non disponibile').
        self.ai_cache = None
        self.coda_priorita = None
        self._tutor_sessions: dict = {}
        self._tutor_lock = threading.Lock()
        try:
            if AiCache is not None:
                self.ai_cache = AiCache()
        except Exception as e:
            print(f"[StudioIAAPI] AiCache non disponibile: {e}")
        try:
            if CodaPriorita is not None:
                self.coda_priorita = CodaPriorita()
        except Exception as e:
            print(f"[StudioIAAPI] CodaPriorita non disponibile: {e}")

    # ==================================================================
    # PREPARAZIONE CLIENT LLM
    # ==================================================================
    def _compute_n_ctx(self) -> int:
        user_value = self.config.get("local_model_n_ctx")
        if isinstance(user_value, int) and user_value > 0:
            print(f"[StudioIAAPI] n_ctx forzato manualmente: {user_value}")
            return user_value
        return recommended_n_ctx(self.system_info["ram_gb"])

    def _prepare_llm_client(self) -> None:
        model_path = self.config.get("local_model_path", "")
        if not model_path or not os.path.isfile(model_path):
            if model_path:
                print(f"[StudioIAAPI] Modello configurato ma non trovato: {model_path}")
                self.config.set("local_model_path", "")
                self.config.save()
            self.llm_client = None
            with self._model_state_lock:
                self._model_state["state"] = "not_configured"
                self._model_state["progress"] = 0.0
            return
        try:
            self.llm_client = LocalLLMClient(
                model_path=model_path,
                n_ctx=self.effective_n_ctx,
                n_gpu_layers=self.config.get("local_model_n_gpu_layers", -1),
                n_threads=self.config.get("local_model_n_threads"),
            )
            # T1: llm.backend='sidecar' -> wrap sull'adattore sidecar;
            # rollback: llm.backend='inprocess' -> nessun wrap (codice identico)
            self.llm_client = maybe_wrap_sidecar(self.llm_client)
            with self._model_state_lock:
                self._model_state["state"] = "loading"
                self._model_state["progress"] = 0.0
            print(f"[StudioIAAPI] Client pronto per il caricamento: {model_path}")
        except LocalLLMError as e:
            print(f"[StudioIAAPI] Impossibile preparare il modello: {e}")
            self.llm_client = None
            with self._model_state_lock:
                self._model_state["state"] = "error"
                self._model_state["error"] = str(e)

    # ==================================================================
    # CARICAMENTO IN BACKGROUND (chiamato da main.py)
    # ==================================================================
    def start_background_model_load(self) -> None:
        if self.llm_client is None:
            print("[StudioIAAPI] Nessun modello configurato, caricamento saltato.")
            return
        if self._load_thread is not None and self._load_thread.is_alive():
            print("[StudioIAAPI] Caricamento già in corso.")
            return

        self._load_thread = threading.Thread(
            target=self._load_model_worker, daemon=True
        )
        self._load_thread.start()

    def _load_model_worker(self) -> None:
        baseline_rss = _get_process_rss_mb() or 0.0
        try:
            model_size_mb = os.path.getsize(self.llm_client.model_path) / (1024 * 1024)
        except (OSError, AttributeError):
            model_size_mb = 1500.0
        expected_delta_mb = max(200.0, model_size_mb * 1.3)

        with self._model_state_lock:
            self._model_state["_baseline_rss_mb"] = baseline_rss
            self._model_state["_expected_delta_mb"] = expected_delta_mb
            self._model_state["progress"] = 0.02

        print(f"[StudioIAAPI] Caricamento modello in corso "
              f"(baseline RSS: {baseline_rss:.0f} MB, atteso: +{expected_delta_mb:.0f} MB)...")

        stop_monitor = threading.Event()

        def monitor():
            while not stop_monitor.is_set():
                rss = _get_process_rss_mb()
                if rss is not None and baseline_rss > 0:
                    delta = max(0.0, rss - baseline_rss)
                    progress = min(0.96, delta / expected_delta_mb)
                    with self._model_state_lock:
                        if progress > self._model_state["progress"]:
                            self._model_state["progress"] = progress
                stop_monitor.wait(0.35)

        monitor_thread = threading.Thread(target=monitor, daemon=True)
        monitor_thread.start()

        try:
            self.llm_client.load_model_blocking()
            with self._model_state_lock:
                self._model_state["state"] = "ready"
                self._model_state["progress"] = 1.0
                self._model_state["error"] = None
            print("[StudioIAAPI] Modello pronto per l'uso.")

            # Dopo che il modello è pronto, avvia il reindex in background
            self._start_reindex_loop()
        except Exception as e:
            print(f"[StudioIAAPI] Errore durante il caricamento del modello: {e}")
            with self._model_state_lock:
                self._model_state["state"] = "error"
                self._model_state["error"] = str(e)
        finally:
            stop_monitor.set()

    # ==================================================================
    # REINDEX IN BACKGROUND (sostituisce _reindex_before_query)
    # ==================================================================
    def _start_reindex_loop(self) -> None:
        """Avvia il thread che aggiorna l'indice periodicamente in background."""
        if self._reindex_thread is not None and self._reindex_thread.is_alive():
            return
        self._reindex_stop.clear()
        self._reindex_thread = threading.Thread(target=self._reindex_loop, daemon=True)
        self._reindex_thread.start()

    def _reindex_loop(self) -> None:
        # Primo reindex subito (dopo modello pronto)
        self._do_reindex_silent()
        while not self._reindex_stop.wait(self._reindex_interval_sec):
            self._do_reindex_silent()

    def _do_reindex_silent(self) -> None:
        if not self._reindex_lock.acquire(blocking=False):
            return  # già in corso, salta questo giro
        try:
            ocr_enabled = self.config.get("ocr_enabled", True)
            t0 = time.time()
            # C1: l'indice riflette SOLO rag_stage2/ (gli originali in
            # originals/ e i legacy in radice non vengono scansionati).
            self.local_search.ensure_index_updated(str(self.rag_stage2_folder), ocr_enabled=ocr_enabled)
            self.books_search.ensure_index_updated(
                str(self.books_stage2_folder), ocr_enabled=ocr_enabled
            )
            dt = time.time() - t0
            if dt > 0.5:
                print(f"[StudioIAAPI] Reindex background completato in {dt:.1f}s")
        except Exception as e:
            print(f"[StudioIAAPI] Errore reindex background: {e}")
        finally:
            self._reindex_lock.release()

    def get_model_status(self):
        with self._model_state_lock:
            return {
                "state": self._model_state["state"],
                "progress": round(self._model_state.get("progress", 0.0), 3),
                "error": self._model_state.get("error"),
                "ram_gb": self._model_state.get("ram_gb", 0),
                # R22: chiave modello in caricamento + RSS del processo
                # app misurati prima/dopo lo switch (report T2)
                "model_key": self._model_state.get("model_key", ""),
                "rss_before_mb": self._model_state.get("rss_before_mb"),
                "rss_after_mb": self._model_state.get("rss_after_mb"),
            }

    @staticmethod
    def _active_window():
        return webview.active_window()

    # ==================================================================
    # MODELLI
    # ==================================================================
    def list_models(self):
        models = self.models_manager.list_models()
        active_path = self.config.get("local_model_path", "") or ""
        active_norm = os.path.normpath(active_path) if active_path else ""
        with self._model_state_lock:
            state = self._model_state.get("state")
            loading_key = self._model_state.get("model_key", "")
        for m in models:
            dp = self.models_manager.get_downloaded_path(m["key"])
            m["active"] = bool(dp) and os.path.normpath(dp) == active_norm
            # R22: la voce in caricamento mostra "caricamento..." in menu
        # R23 X4.4: il flag draft e' True SOLO se il draft e' configurato
        # (spec.draft_model); default R23 = OFF (regola X4.2: acceptance
        # 0.8402 ok ma speedup 1.240 < 1.30, qa/x3_compare.json).
        draft_on = bool(str(self.config.get("spec.draft_model", "") or "").strip())
        for m in models:
            dp = self.models_manager.get_downloaded_path(m["key"])
            m["active"] = bool(dp) and os.path.normpath(dp) == active_norm
            # R22: la voce in caricamento mostra "caricamento..." in menu
            m["loading"] = (state == "loading" and m["key"] == loading_key)
            # R23 X4.4: presenza draft in catalogo + stato attivo/off
            m["draft_enabled"] = draft_on and bool(m.get("draft"))
        return models

    def download_model(self, model_key: str):
        if self.models_manager.is_downloading():
            return {"success": False, "error": "Un download è già in corso."}
        t = threading.Thread(target=self.models_manager.download, args=(model_key,), daemon=True)
        t.start()
        return {"success": True, "started": True}

    def get_download_progress(self):
        return self.models_manager.get_progress()

    def load_model(self, model_key: str):
        path = self.models_manager.get_downloaded_path(model_key)
        if not path:
            return {"success": False, "error": "Modello non scaricato."}
        # R22: selezione persistita (config.save) + sync del sidecar:
        # core/sidecar/server.py legge llama.model_path all'avvio di
        # llama-server, quindi va aggiornata ANCHE quella chiave.
        self.config.set("local_model_path", path)
        self.config.set("local_model_key", model_key)
        self.config.set("llama.model_path", path)
        self.config.save()

        self.llm_client = None
        rss_before = _get_process_rss_mb()
        with self._model_state_lock:
            self._model_state["state"] = "loading"
            self._model_state["progress"] = 0.0
            self._model_state["error"] = None
            self._model_state["model_key"] = model_key
            self._model_state["rss_before_mb"] = rss_before
            self._model_state["rss_after_mb"] = None
        self._prepare_llm_client()
        self._load_thread = None
        self.start_background_model_load()
        print(f"[models] caricamento modello '{model_key}' "
              f"(RSS prima: {rss_before if rss_before is not None else 'n/d'} MB)")
        # R22/R23: watcher -> misura RSS dopo lo switch e, se il load del
        # modello Spark FALLISCE (crash/timeout/errore), fallback
        # automatico al MiniCPM5-2B con log esplicito
        # "[models] fallback al modello MiniCPM5-2B: <motivo>".
        load_thread = self._load_thread
        threading.Thread(
            target=self._watch_model_load,
            args=(model_key, load_thread),
            daemon=True,
        ).start()
        return {"success": True, "loading": True}

    def _watch_model_load(self, requested_key: str, load_thread) -> None:
        """R22/R23: attende la fine del load, misura il RSS post-switch e
        gestisce il fallback automatico al MiniCPM5-2B se la richiesta
        NON era gia' il fallback ed il load e' terminato in errore."""
        if load_thread is not None:
            load_thread.join(timeout=1800)
        rss_after = _get_process_rss_mb()
        with self._model_state_lock:
            state = self._model_state.get("state")
            err = self._model_state.get("error")
            self._model_state["rss_after_mb"] = rss_after
        print(f"[models] RSS dopo switch {requested_key}: "
              f"{rss_after if rss_after is not None else 'n/d'} MB")
        if state != "error":
            return
        if requested_key == "fallback":
            print("[models] errore caricamento modello fallback (MiniCPM5-2B): "
                  f"{err or 'errore sconosciuto'} (nessun fallback possibile)")
            return
        from data.models_manager import apply_fallback_config
        reason = str(err or "errore sconosciuto")
        base_path = apply_fallback_config(self.config, reason)
        if not base_path:
            return
        self.llm_client = None
        with self._model_state_lock:
            self._model_state["state"] = "loading"
            self._model_state["progress"] = 0.0
            self._model_state["error"] = None
            self._model_state["model_key"] = "fallback"
            self._model_state["rss_before_mb"] = _get_process_rss_mb()
            self._model_state["rss_after_mb"] = None
        self._prepare_llm_client()
        self._load_thread = None
        self.start_background_model_load()

    def unload_model(self):
        self.config.set("local_model_path", "")
        self.config.set("local_model_key", "")
        self.config.save()
        self.llm_client = None
        with self._model_state_lock:
            self._model_state["state"] = "not_configured"
            self._model_state["progress"] = 0.0
            self._model_state["error"] = None
        return {"success": True}

    def get_system_status(self):
        return {
            "ram_gb": self.system_info["ram_gb"],
            "cpu_cores": self.system_info["cpu_cores"],
            "platform": self.system_info["platform"],
            "n_ctx_effective": self.effective_n_ctx,
            "rag_max_tokens": self.effective_rag_max,
        }

    # ==================================================================
    # CONVERSAZIONI
    # ==================================================================
    def get_conversations(self):
        return [{"id": r["id"], "title": r["titolo"], "date": r["data_creazione"],
                 "materia": r["materia"] or "",
                 "attivita": r["attivita"] or "",
                 "folder_id": (r["folder_id"] if "folder_id" in r.keys() else "") or "",
                 "preview": (r["anteprima"] or ""),
                 "n_messages": r["n_messaggi"] or 0}
                for r in self.db.get_chats()]

    def get_messages(self, conversation_id: int):
        return [{"id": r["id"], "role": r["ruolo"], "content": r["testo"], "source": r["fonte"]}
                for r in self.db.get_messages(conversation_id)]

    def delete_conversation(self, conversation_id: int):
        try:
            self.db.delete_chat(conversation_id)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ==================================================================
    # STREAMING CHAT
    # ==================================================================
    def send_message(self, message: str, conversation_id, mode: str,
                     thinking: bool = False, study_mode=None, topic: str = "",
                     web_override: str = ""):
        try:
            if not message or not message.strip():
                return {"error": "Messaggio vuoto"}

            study_mode = _normalize_study_mode(study_mode)

            with self._model_state_lock:
                current_state = self._model_state["state"]
            if current_state == "loading":
                return {
                    "error": "Il modello è ancora in caricamento. Attendi qualche secondo e riprova.",
                    "conversation_id": conversation_id,
                }

            if conversation_id is None:
                title = message.strip()[:50] or "Nuova conversazione"
                conversation_id = self.db.create_chat(title)

            with self._streams_lock:
                for _mid, s in list(self._streams.items()):
                    if s.get("conversation_id") == conversation_id and s.get("queue"):
                        s["queue"] = None
                        s["waiting_continue"] = False
                        s["done"] = True

            self.db.add_message(conversation_id, "user", message)

            message_id = uuid.uuid4().hex
            stop_event = threading.Event()
            topic = (topic or "").strip()
            if not topic and conversation_id:
                # Se non passato esplicitamente, usa l'argomento salvato in chat
                chat_row = self.db.get_chat(conversation_id)
                if chat_row is not None and "materia" in chat_row.keys():
                    topic = (chat_row["materia"] or "").strip()

            with self._streams_lock:
                self._streams[message_id] = {
                    "tokens": [],
                    "done": False,
                    "source": "nessuna",
                    "error": None,
                    "stop_event": stop_event,
                    "conversation_id": conversation_id,
                    "stopped": False,
                    "no_save": False,
                    "generation_active": True,
                    "waiting_continue": False,
                    "queue": None,
                    "topic": topic,
                }

            thread = threading.Thread(
                target=self._run_generation,
                args=(message_id, message, conversation_id, mode, thinking, study_mode, stop_event, topic, web_override),
                daemon=True,
            )
            thread.start()

            return {"message_id": message_id, "conversation_id": conversation_id}

        except Exception as e:
            print(f"[StudioIAAPI] Errore in send_message: {e}")
            return {"error": str(e), "conversation_id": conversation_id}

    def _run_generation(self, message_id, message, conversation_id, mode, thinking, study_mode, stop_event, topic: str = "", web_override: str = ""):
        try:
            if not self.llm_client:
                with self._streams_lock:
                    self._streams[message_id]["tokens"].append(
                        "Nessun modello attivo. Apri 'Seleziona modelli' in alto e "
                        "scarica/carica un modello prima di fare domande."
                    )
                    self._streams[message_id]["done"] = True
                    self._streams[message_id]["generation_active"] = False
                    self._streams[message_id]["no_save"] = True
                return

            # Timing: nessun reindex qui, si va diretti alla generazione
            t0 = time.time()

            # G2/H3: storia conversazionale REALE (turni interi, escluso il
            # messaggio corrente) per il prefisso stabile system->storia->query
            history_turns = []
            try:
                if conversation_id is not None:
                    history_turns = [
                        {"role": "user" if str(r["ruolo"]) == "user" else "assistant",
                         "content": r["testo"]}
                        for r in self.db.get_messages(conversation_id)
                        if r["id"] != message_id and (r["testo"] or "").strip()
                    ]
            except Exception:
                history_turns = []

            source = "nessuna"
            queue_state = None
            # R15b: web_override passato SOLO se il router lo supporta
            # (contratto P: process_query_stream(web_override=...) opzionale)
            _q_kwargs = {}
            try:
                import inspect as _inspect
                if "web_override" in _inspect.signature(self.router.process_query_stream).parameters:
                    _q_kwargs["web_override"] = web_override
            except Exception:
                _q_kwargs = {}
            generator = self.router.process_query_stream(
                message, mode=mode, thinking=thinking, study_mode=study_mode,
                stop_event=stop_event, topic=topic,
                history_turns=history_turns,
                **_q_kwargs,
            )

            first_token_time = None
            token_count = 0
            for event in generator:
                if stop_event.is_set():
                    try:
                        generator.close()
                    except Exception:
                        pass
                    break

                if event["type"] == "token":
                    if first_token_time is None:
                        first_token_time = time.time()
                        print(f"[StudioIAAPI] Primo token dopo {first_token_time - t0:.2f}s")
                    token_count += 1
                    with self._streams_lock:
                        self._streams[message_id]["tokens"].append(event["text"])
                elif event["type"] == "progress":
                    # R15b P3: avanzamento per stadio passa invariato al frontend
                    with self._streams_lock:
                        self._streams[message_id].setdefault("progress", []).append(
                            {k: event[k] for k in ("stage", "status", "ms", "note")
                             if k in event})
                elif event["type"] == "sources":
                    # R15b W3: fonti strutturate per il frontend; R18:
                    # stages = provenienza per la riga finale "Fonte: ..."
                    with self._streams_lock:
                        self._streams[message_id]["sources"] = list(event.get("items") or [])
                        if event.get("stages") is not None:
                            self._streams[message_id]["source_stages"] = \
                                list(event.get("stages") or [])
                elif event["type"] == "source":
                    source = event["value"]
                elif event["type"] == "reset":
                    # R16 (contratto): il client ha azzerato lo stream
                    # (retry/fallback dopo guardia output) -> i token gia'
                    # emessi NON devono restare: il retry SOSTITUISCE.
                    with self._streams_lock:
                        s = self._streams.get(message_id)
                        if s is not None:
                            s["tokens"] = []
                            s["reset_count"] = s.get("reset_count", 0) + 1
                elif event["type"] == "queue":
                    queue_state = {
                        "parts": event["parts"],
                        "query": event["query"],
                        "context_kind": event["context_kind"],
                        "study_mode": event["study_mode"],
                        "current_part": event["current_part"],
                        "total_parts": event["total_parts"],
                        "source": event["source"],
                        "parts_summaries": [],
                    }

            elapsed = time.time() - t0
            if token_count > 0 and first_token_time:
                gen_time = elapsed - (first_token_time - t0)
                tps = token_count / gen_time if gen_time > 0 else 0
                print(f"[StudioIAAPI] Generazione: {token_count} eventi, "
                      f"totale {elapsed:.2f}s, ~{tps:.1f} ev/s")

            with self._streams_lock:
                s = self._streams.get(message_id)
                if s is None:
                    return
                full_text = "".join(s["tokens"])
                s["source"] = source
                s["generation_active"] = False
                if stop_event.is_set():
                    s["stopped"] = True

                if queue_state is not None and queue_state["current_part"] < queue_state["total_parts"]:
                    queue_state["parts_summaries"].append(extract_part_summary(full_text))
                    s["queue"] = queue_state
                    s["waiting_continue"] = True
                    should_save = False
                else:
                    s["done"] = True
                    s["waiting_continue"] = False
                    s["queue"] = None
                    should_save = True

                skip_save = s.get("no_save", False)

            if should_save and full_text.strip() and not skip_save:
                self.db.add_message(conversation_id, "ai", full_text, fonte=source)

        except AiUnavailable as e:
            # AI non disponibile: risposta testuale + log, MAI eccezione cruda
            print(f"[StudioIAAPI] AI non disponibile (_run_generation): {e}")
            with self._streams_lock:
                s = self._streams.get(message_id)
                if s is not None:
                    s["tokens"].append("AI non disponibile")
                    s["done"] = True
                    s["generation_active"] = False
                    s["no_save"] = True

        except Exception as e:
            print(f"[StudioIAAPI] Errore in _run_generation: {e}")
            # R13 TTFT (IMPLEMENTER-TTFT): traceback completo su stdout per
            # la sonda; l'errore visibile a FE resta invariato (str(e)).
            traceback.print_exc()
            with self._streams_lock:
                s = self._streams.get(message_id)
                if s is not None:
                    s["error"] = str(e)
                    s["done"] = True
                    s["generation_active"] = False

    def continue_generation(self, message_id: str, study_mode=None):
        try:
            with self._streams_lock:
                s = self._streams.get(message_id)
                if not s:
                    return {"success": False, "error": "Sessione non trovata"}
                if s.get("generation_active"):
                    return {"success": False, "error": "Generazione già in corso"}
                if not s.get("waiting_continue"):
                    return {"success": False, "error": "Nessuna continuazione disponibile"}

                queue = s.get("queue")
                if not queue or not queue.get("parts"):
                    return {"success": False, "error": "Coda vuota"}

                if study_mode and isinstance(study_mode, str) and study_mode in SYSTEM_PROMPTS:
                    queue["study_mode"] = study_mode

                next_chunks = queue["parts"].pop(0)
                queue["current_part"] += 1
                is_last = len(queue["parts"]) == 0

                s["generation_active"] = True
                s["waiting_continue"] = False
                s["done"] = False

                params = {
                    "chunks": next_chunks,
                    "query": queue["query"],
                    "context_kind": queue["context_kind"],
                    "study_mode": queue["study_mode"],
                    "parts_summaries": list(queue["parts_summaries"]),
                    "part_index": queue["current_part"],
                    "is_last_part": is_last,
                    "source": queue["source"],
                    "conversation_id": s["conversation_id"],
                    "stop_event": s["stop_event"],
                }

            thread = threading.Thread(
                target=self._run_continuation,
                args=(message_id, params),
                daemon=True,
            )
            thread.start()
            return {"success": True}

        except Exception as e:
            print(f"[StudioIAAPI] Errore in continue_generation: {e}")
            return {"success": False, "error": str(e)}

    def _run_continuation(self, message_id, params):
        try:
            source = params["source"]
            # G2/H3: stessa storia reale della generazione principale
            history_turns = []
            try:
                cid = params.get("conversation_id")
                if cid is not None:
                    history_turns = [
                        {"role": "user" if str(r["ruolo"]) == "user" else "assistant",
                         "content": r["testo"]}
                        for r in self.db.get_messages(cid)
                        if r["id"] != message_id and (r["testo"] or "").strip()
                    ]
            except Exception:
                history_turns = []
            generator = self.router.continue_stream(
                chunks=params["chunks"],
                query=params["query"],
                context_kind=params["context_kind"],
                study_mode=params["study_mode"],
                parts_summaries=params["parts_summaries"],
                part_index=params["part_index"],
                is_last_part=params["is_last_part"],
                stop_event=params["stop_event"],
                source=source,
                history_turns=history_turns,
            )

            for event in generator:
                if params["stop_event"].is_set():
                    try:
                        generator.close()
                    except Exception:
                        pass
                    break
                if event["type"] == "token":
                    with self._streams_lock:
                        self._streams[message_id]["tokens"].append(event["text"])
                elif event["type"] == "progress":
                    with self._streams_lock:
                        self._streams[message_id].setdefault("progress", []).append(
                            {k: event[k] for k in ("stage", "status", "ms", "note")
                             if k in event})
                elif event["type"] == "sources":
                    with self._streams_lock:
                        self._streams[message_id]["sources"] = list(event.get("items") or [])
                elif event["type"] == "source":
                    source = event["value"]

            with self._streams_lock:
                s = self._streams.get(message_id)
                if s is None:
                    return
                full_text = "".join(s["tokens"])
                s["source"] = source
                s["generation_active"] = False
                if params["stop_event"].is_set():
                    s["stopped"] = True

                if params["is_last_part"]:
                    s["done"] = True
                    s["waiting_continue"] = False
                    s["queue"] = None
                    should_save = True
                else:
                    new_part_text = self._extract_latest_part_text(s["tokens"])
                    s["queue"]["parts_summaries"].append(extract_part_summary(new_part_text))
                    s["waiting_continue"] = True
                    should_save = False

                skip_save = s.get("no_save", False)

            if should_save and full_text.strip() and not skip_save:
                self.db.add_message(params["conversation_id"], "ai", full_text, fonte=source)

        except AiUnavailable as e:
            # AI non disponibile: risposta testuale + log, MAI eccezione cruda
            print(f"[StudioIAAPI] AI non disponibile (_run_continuation): {e}")
            with self._streams_lock:
                s = self._streams.get(message_id)
                if s is not None:
                    s["tokens"].append("AI non disponibile")
                    s["done"] = True
                    s["generation_active"] = False
                    s["no_save"] = True

        except Exception as e:
            print(f"[StudioIAAPI] Errore in _run_continuation: {e}")
            with self._streams_lock:
                s = self._streams.get(message_id)
                if s is not None:
                    s["error"] = str(e)
                    s["done"] = True
                    s["generation_active"] = False

    @staticmethod
    def _extract_latest_part_text(tokens: List[str]) -> str:
        full = "".join(tokens)
        idx = full.rfind("\n\n---\n\n")
        if idx >= 0:
            return full[idx + 9:]
        return full

    def coda_stato(self) -> dict:
        """Stato della coda a priorita' AI (API JS: `coda_stato`).

        Delegato a CodaPriorita se istanziata; default {running:0, queued:0}.
        """
        for attr in ("coda_priorita", "_coda_priorita", "coda", "_coda"):
            cand = getattr(self, attr, None)
            if cand is not None and hasattr(cand, "stato"):
                try:
                    st = dict(cand.stato())
                except Exception as e:
                    print(f"[StudioIAAPI] Errore in coda_stato: {e}")
                    break
                running = st.get("running", 0)
                if isinstance(running, bool):
                    running = 1 if running else 0
                out = {
                    "running": int(running),
                    "queued": int(st.get("queued", 0) or 0),
                }
                if st.get("by_priority") is not None:
                    out["by_priority"] = st["by_priority"]
                return out
        return {"running": 0, "queued": 0}

    def flag_wrong_answer(self, text: str, query: str = "") -> dict:
        """R16 follow-up: l'utente segna una risposta come SBAGLIATA ->
        le entry di answer_cache con quel testo sono eliminate (mai piu'
        riusate) e la segnalazione finisce in answer_feedback.jsonl."""
        removed = 0
        try:
            removed = int(self.router.answer_cache.invalidate_text(text))
        except Exception as exc:
            print(f"[StudioIAAPI] flag_wrong_answer cache: {exc}")
        try:
            import hashlib
            import json as _json
            from pathlib import Path as _P
            from data.config_manager import get_app_data_dir
            p = _P(get_app_data_dir()) / "answer_feedback.jsonl"
            with p.open("a", encoding="utf-8") as fh:
                fh.write(_json.dumps({
                    "ts": time.time(),
                    "query": str(query or ""),
                    "text_sha": hashlib.sha1(
                        str(text or "").encode("utf-8")).hexdigest()[:16],
                    "removed": removed,
                }, ensure_ascii=False) + "\n")
        except Exception as exc:
            print(f"[StudioIAAPI] flag_wrong_answer log: {exc}")
        return {"ok": True, "removed": removed}

    def poll_stream(self, message_id: str, from_index: int):
        with self._streams_lock:
            s = self._streams.get(message_id)
            if not s:
                return {"tokens": [], "done": True, "source": "nessuna",
                        "error": "Sessione non trovata", "total": 0, "stopped": False,
                        "generation_active": False, "waiting_continue": False,
                        "part_current": 0, "part_total": 0}
            tokens = s["tokens"][from_index:]
            queue = s.get("queue") or {}
            return {
                "tokens": tokens,
                "done": s["done"],
                "source": s["source"],
                "error": s["error"],
                "total": len(s["tokens"]),
                "conversation_id": s["conversation_id"],
                "stopped": s.get("stopped", False),
                # R16: contatore reset (retry guardia output) - FE svuota lo
                # stream quando cresce (retry sostituisce, non aggiunge)
                "reset_count": s.get("reset_count", 0),
                "generation_active": s.get("generation_active", False),
                "waiting_continue": s.get("waiting_continue", False),
                "part_current": queue.get("current_part", 0),
                "part_total": queue.get("total_parts", 0),
                # R15b P3: avanzamenti per stadio (lista completa; il client
                # deduplica per conteggio) — vedi core/rag/contract.py
                "progress": s.get("progress") or [],
                # R15b W3: fonti strutturate [{stage,title,url,source}...]
                "sources": s.get("sources") or [],
                # R18: provenienza per stadio per la riga piccola finale
                "source_stages": s.get("source_stages") or [],
            }

    def stop_generation(self, message_id: str):
        with self._streams_lock:
            s = self._streams.get(message_id)
            if s:
                s["stop_event"].set()
                return {"success": True}
        return {"success": False, "error": "Sessione non trovata"}

    def cleanup_stream(self, message_id: str):
        with self._streams_lock:
            self._streams.pop(message_id, None)
        return {"success": True}

    # ==================================================================
    # MATERIALE
    # ==================================================================
    def pick_notes_file(self):
        w = self._active_window()
        if not w:
            return None
        try:
            r = w.create_file_dialog(webview.FileDialog.OPEN, file_types=NOTES_FILE_TYPES)
        except Exception as e:
            print(f"[StudioIAAPI] pick_notes_file errore con filtri: {e}")
            try:
                r = w.create_file_dialog(webview.FileDialog.OPEN)
            except Exception as e2:
                print(f"[StudioIAAPI] pick_notes_file errore anche senza filtri: {e2}")
                return None
        if not r:
            return None
        return {"path": r[0], "name": Path(r[0]).name}

    def pick_library_pdf_file(self):
        w = self._active_window()
        if not w:
            return None
        try:
            r = w.create_file_dialog(webview.FileDialog.OPEN, file_types=LIBRARY_FILE_TYPES)
        except Exception as e:
            print(f"[StudioIAAPI] pick_library_pdf_file errore: {e}")
            try:
                r = w.create_file_dialog(webview.FileDialog.OPEN)
            except Exception:
                return None
        if not r:
            return None
        return {"path": r[0], "name": Path(r[0]).name}

    @staticmethod
    def _store_original(file_path: str, originals_folder) -> None:
        """C1: copia l'originale scelto dall'utente in originals/ (cartella
        MAI indicizzata). Se la copia esiste gia o fallisce l'upload prosegue:
        l'originale resta comunque nel suo path di provenienza (nessuna
        cancellazione, solo copia)."""
        try:
            src = Path(file_path)
            if not src.is_file():
                return
            originals = Path(originals_folder)
            originals.mkdir(parents=True, exist_ok=True)
            dst = originals / src.name
            if dst.exists():
                try:
                    if os.path.samefile(str(src), str(dst)):
                        return  # e gia l'originale stesso: niente da fare
                except OSError:
                    pass
                print(f"[StudioIAAPI] Originale {src.name} gia presente in originals/: copia saltata.")
                return
            shutil.copy2(str(src), str(dst))
        except Exception as e:
            print(f"[StudioIAAPI] Copia originale in originals/ fallita: {e}")

    def add_notes_material(self, file_path: str):
        try:
            # C1: originals/ (originale, non indicizzato) + rag_stage2/
            # (convertito .md, unico target dell'indicizzazione).
            originals, stage = ensure_rag_layout(self.rag_folder)
            self._store_original(file_path, originals)
            if self.converter is None:
                self.converter = MarkdownConverter()
            self.converter.convert_file_with_images(file_path, str(stage))
            self.local_search.ensure_index_updated(
                str(stage), ocr_enabled=self.config.get("ocr_enabled", True)
            )
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_library_material(self, file_path: str):
        try:
            src = Path(file_path)
            if src.suffix.lower() != ".pdf":
                raise ValueError("In questa modalità è accettato solo PDF")
            books_dir = Path(self.books_manager.get_books_folder_path())
            books_dir.mkdir(parents=True, exist_ok=True)
            # C1: stesse sottocartelle anche per i libri L2: originale in
            # originals/, convertito in rag_stage2/ (unico target di scan).
            originals, stage = ensure_rag_layout(books_dir)
            self._store_original(file_path, originals)
            if self.converter is None:
                self.converter = MarkdownConverter()
            self.converter.convert_file_with_images(file_path, str(stage))
            self.books_search.ensure_index_updated(
                str(stage), ocr_enabled=self.config.get("ocr_enabled", True)
            )
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ==================================================================
    # IMPOSTAZIONI
    # ==================================================================
    def get_settings(self):
        return {k: self.config.get(k) for k in USER_SETTINGS_KEYS}

    def save_settings(self, settings: dict):
        try:
            filtered = {k: v for k, v in settings.items() if k in USER_SETTINGS_KEYS}
            self.config.update_config(filtered)
            self.router.rag_top_k = self.config.get("rag_top_k", 5)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ==================================================================
    # AGGIORNAMENTI
    # ==================================================================
    def check_for_updates(self):
        if not UPDATE_REPO:
            return {"configured": False, "current_version": APP_VERSION, "update_available": False}
        try:
            import requests
            r = requests.get(f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest", timeout=5)
            r.raise_for_status()
            data = r.json()
            latest = (data.get("tag_name") or "").lstrip("v")
            url = None
            if data.get("assets"):
                url = data["assets"][0].get("browser_download_url")
            elif data.get("html_url"):
                url = data["html_url"]
            return {
                "configured": True, "current_version": APP_VERSION,
                "latest_version": latest,
                "update_available": _is_newer_version(latest, APP_VERSION),
                "download_url": url,
            }
        except Exception as e:
            return {"configured": True, "current_version": APP_VERSION,
                    "update_available": False, "error": str(e)}

    def download_update(self, url: str):
        if not url or not _is_safe_url(url):
            return {"success": False, "error": "URL non valido."}
        try:
            import webbrowser
            webbrowser.open(url)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def open_library_website(self):
        if not LIBRARY_WEBSITE_URL or not _is_safe_url(LIBRARY_WEBSITE_URL):
            return {"success": False, "error": "Non disponibile."}
        try:
            import webbrowser
            webbrowser.open(LIBRARY_WEBSITE_URL)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ==================================================================
    # H13 — RUNTIME AI + TUTOR (API js_api, esposte come le altre:
    # pywebview espone ogni metodo pubblico di questa classe)
    # ==================================================================
    def _ai_llm_fn(self):
        """llm_fn iniettabile per run_ai_function: None se nessun modello
        locale è pronto -> fallback deterministico 'AI non disponibile'."""
        client = self.llm_client
        if client is None:
            return None

        def _fn(prompt, max_tokens=None, classe=None, fid=None):
            # prompt già composto (sys + user) dal runtime
            return client.generate(str(prompt))

        return _fn

    def ai_run_function(self, fid: str, inputs_json="{}") -> dict:
        """API JS `ai_run_function`: wrapper di run_ai_function con i
        singleton (AiCache + CodaPriorita `coda_priorita`, stesso nome
        cercato da coda_stato()). Nessuna eccezione verso JS."""
        fallback = {
            "ok": False,
            "fallback": True,
            "data": None,
            "source": "fallback",
            "badge": "AI non disponibile",
            "approval_required": True,
            "error": None,
        }
        # 1) input: JSON lato JS oppure dict già pronto
        try:
            if isinstance(inputs_json, dict):
                inputs = dict(inputs_json)
            elif isinstance(inputs_json, str):
                inputs = json.loads(inputs_json) if inputs_json.strip() else {}
            else:
                inputs = {}
            if not isinstance(inputs, dict):
                raise ValueError("atteso un oggetto JSON con le chiavi del template")
        except Exception as e:
            out = dict(fallback)
            out["error"] = "inputs_json non valido: %s" % e
            return out
        if _run_ai_function is None:
            out = dict(fallback)
            out["error"] = "runtime AI non disponibile"
            return out
        # 2) singleton lazy: se mancano ancora, li crea ora
        if getattr(self, "ai_cache", None) is None:
            try:
                if AiCache is not None:
                    self.ai_cache = AiCache()
            except Exception:
                self.ai_cache = None
        if getattr(self, "coda_priorita", None) is None:
            try:
                if CodaPriorita is not None:
                    self.coda_priorita = CodaPriorita()
            except Exception:
                self.coda_priorita = None
        # 3) esecuzione (il runtime non solleva MAI: difensivo comunque)
        try:
            res = _run_ai_function(
                fid,
                inputs,
                coda=getattr(self, "coda_priorita", None),
                ai_cache=getattr(self, "ai_cache", None),
                llm_fn=self._ai_llm_fn(),
            )
            if isinstance(res, dict):
                return res
        except Exception as e:
            out = dict(fallback)
            out["error"] = str(e)
            return out
        return fallback

    # ==================================================================
    # R13 T1 - TELEMETRIA RUNTIME (api js_api: window.pywebview.api.*)
    #   Stile H13: docstring + wrapper difensivo, MAI eccezione verso JS.
    #   Delegano a core.ai_runtime.get_stats()/reset_stats(): il payload
    #   ESISTENTE resta invariato (solo chiavi NUOVE aggiunte dal runtime).
    # ==================================================================
    def ai_stats(self) -> dict:
        """API JS `ai_stats`: snapshot telemetria runtime AI (R13 T1).

        Delega a core.ai_runtime.get_stats() (contatori G7: calls_total,
        fids{...}, cache_hits, tutor_judgments, ai_cache) + eventuali chiavi
        NUOVE live/persist aggiunte in R13. Non muta lo stato. Ritorna un
        dict JSON-serializzabile; in caso di errore {"error": ...} (mai
        eccezione verso JS)."""
        if _ai_runtime_get_stats is None:
            return {"error": "telemetria runtime non disponibile"}
        try:
            out = _ai_runtime_get_stats()
            if isinstance(out, dict):
                return out
            return {"error": "payload telemetria non valido"}
        except Exception as e:
            return {"error": str(e)}

    def ai_stats_reset(self) -> dict:
        """API JS `ai_stats_reset`: azzera i contatori runtime (R13 T1).

        Delega a core.ai_runtime.reset_stats() (flag azzerabile, stessa
        persistenza R13 di get_stats()). Ritorna lo snapshot vuoto; in caso
        di errore {"error": ...} (mai eccezione verso JS)."""
        if _ai_runtime_reset_stats is None:
            return {"error": "telemetria runtime non disponibile"}
        try:
            out = _ai_runtime_reset_stats()
            if isinstance(out, dict):
                return out
            return {"error": "payload telemetria non valido"}
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def _parse_tutor_state(session_state) -> dict:
        """session_state: dict oppure stringa JSON (mai eccezione)."""
        if isinstance(session_state, dict):
            return dict(session_state)
        if isinstance(session_state, str) and session_state.strip():
            try:
                parsed = json.loads(session_state)
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}
        return {}

    # ==================================================================
    # R15b - IMPOSTAZIONI GENERICHE (contratto core/rag/contract.py)
    # Owner api.py per R15b = COORDINATORE (hook pre-implementati prima del
    # lancio parallelo): i blocchi G/W/P/I NON modificano questo file.
    # ==================================================================
    _APP_SETTING_KEYS = (
        "gate.threshold", "web.mode", "web.weight_appunti",
        "web.weight_libri", "web.weight_web", "web.cache_ttl_days",
        "rag.progress_events", "web.searxng_url", "web.wikipedia",
    )

    def app_settings_get(self, keys_json="{}") -> dict:
        """API JS: legge le chiavi impostazioni R15b (SETTING_KEYS del contratto)."""
        try:
            import json as _json
            req = _json.loads(keys_json or "{}")
            keys = req.get("keys") or list(self._APP_SETTING_KEYS)
            out = {}
            for k in keys:
                if k in self._APP_SETTING_KEYS:
                    out[k] = self.config.get(k)
            return {"ok": True, "settings": out}
        except Exception as e:
            return {"ok": False, "error": str(e), "settings": {}}

    def app_settings_set(self, settings_json="{}") -> dict:
        """API JS: salva chiavi impostazioni R15b (solo chiavi note)."""
        try:
            import json as _json
            data = _json.loads(settings_json or "{}")
            saved = []
            for k, v in (data.get("settings") or {}).items():
                if k in self._APP_SETTING_KEYS:
                    self.config.set(k, v)
                    saved.append(k)
            self.config.save()
            return {"ok": True, "saved": saved}
        except Exception as e:
            return {"ok": False, "error": str(e), "saved": []}

    def tutor_step(self, session_state=None, question="", answer="") -> dict:
        """API JS `tutor_step`: sessione tutor in memoria con TTL
        (TUTOR_SESSION_TTL_SEC). Confronto lato Python (llm_fn=None):
        giudizio deterministico anche senza AI. Lo stato FSRS viene
        serializzato in JSON nel campo `session_state` del payload.
        Fallback ovunque: badge 'AI non disponibile', MAI eccezioni."""
        try:
            state_in = self._parse_tutor_state(session_state)
        except Exception:
            state_in = {}
        sid = str(state_in.get("sid") or "") or uuid.uuid4().hex
        now = time.time()

        # lazy init difensivo (già fatto in __init__)
        if getattr(self, "_tutor_sessions", None) is None:
            self._tutor_sessions = {}
        if getattr(self, "_tutor_lock", None) is None:
            self._tutor_lock = threading.Lock()

        ttl = TUTOR_SESSION_TTL_SEC
        with self._tutor_lock:
            # purge lazy delle sessioni scadute
            scadute = [k for k, v in self._tutor_sessions.items()
                       if now - float(v.get("ts", 0)) > ttl]
            for k in scadute:
                self._tutor_sessions.pop(k, None)
            entry = self._tutor_sessions.get(sid)
            session = entry.get("session") if entry else None

        if session is None and TutorSession is not None:
            cards = state_in.get("cards")
            if not isinstance(cards, list):
                cards = []
            seed_back = state_in.get("back")
            if not cards and isinstance(seed_back, str) and seed_back:
                cards = [{"front": str(question), "back": seed_back}]
            try:
                session = TutorSession(cards=cards, llm_fn=None)
            except Exception as e:
                return {"ok": False, "fallback": True,
                        "badge": "AI non disponibile",
                        "error": "tutor non disponibile: %s" % e}

        if session is None:
            return {"ok": False, "fallback": True,
                    "badge": "AI non disponibile",
                    "error": "tutor non disponibile"}

        try:
            res = session.step(str(question), str(answer),
                               back=state_in.get("back"))
        except Exception as e:
            return {"ok": False, "fallback": True,
                    "badge": "AI non disponibile", "error": str(e)}

        # stato sessione/FSRS serializzato in JSON per il caller JS
        try:
            state_out = dict(session.state())
            state_out["sid"] = sid
            res["session_state"] = json.dumps(state_out, ensure_ascii=False)
        except Exception as e:
            res["session_state"] = json.dumps({"sid": sid})
            res["state_error"] = str(e)
        res["sid"] = sid

        with self._tutor_lock:
            self._tutor_sessions[sid] = {"session": session, "ts": time.time()}
        return res
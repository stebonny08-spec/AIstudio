"""
backend/api.py
------------------
Bridge Python <-> JavaScript per l'interfaccia HTML dell'applicazione.
Ogni metodo pubblico di StudioIAAPI è chiamabile da JS tramite
window.pywebview.api.<nome_metodo>(...): pywebview esegue ogni chiamata
su un thread dedicato, quindi anche una risposta LLM lenta non blocca
mai la finestra.

Questa classe orchestra la logica applicativa condivisa in core/ e data/
(RAG a 3 livelli, conversione appunti, configurazione, modalità di studio,
gestione modelli LLM).
"""

import os
import threading
from pathlib import Path
from typing import Optional

import webview

from core.local_llm_client import (
    LocalLLMClient,
    LocalLLMError,
    DEFAULT_STUDY_MODE,
    SYSTEM_PROMPTS,
)
from core.local_search import LocalSearchEngine
from core.markdown_converter import MarkdownConverter
from core.rag.image_cache import cleanup_orphans
from core.rag.vector_store import VectorStore
from core.router import Router
from data.config_manager import ConfigManager, get_app_data_dir
from data.db import Database
from data.models_manager import ModelsManager, MODELS_CATALOG
from data.preselected_books_manager import PreselectedBooksManager

NOTES_FILE_TYPES = (
    "Immagini e documenti (*.jpg;*.jpeg;*.png;*.bmp;*.tiff;*.pdf;*.docx)",
    "Tutti i file (*.*)",
)
LIBRARY_FILE_TYPES = ("File PDF (*.pdf)", "Tutti i file (*.*)")

USER_SETTINGS_KEYS = ("ocr_enabled", "rag_top_k")

APP_VERSION = "0.1.0"

UPDATE_REPO = ""
LIBRARY_WEBSITE_URL = ""


def _parse_version(version: str):
    parts = []
    for piece in version.split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts) or (0,)


def _is_newer_version(latest: str, current: str) -> bool:
    try:
        return _parse_version(latest) > _parse_version(current)
    except Exception:
        return False


def _is_safe_url(url: str) -> bool:
    return isinstance(url, str) and url.startswith("https://")


def _normalize_study_mode(study_mode) -> str:
    if isinstance(study_mode, str) and study_mode in SYSTEM_PROMPTS:
        return study_mode
    return DEFAULT_STUDY_MODE


class StudioIAAPI:
    def __init__(self):
        self.base_dir = Path(__file__).parent.parent
        self.db = Database()
        self.config = ConfigManager()
        self.models_manager = ModelsManager()

        # LIVELLO 1 del RAG: materiale personale dello studente
        self.rag_folder = self.base_dir / "file_AIstudio"
        self.rag_folder.mkdir(parents=True, exist_ok=True)
        self.vector_store = VectorStore(str(get_app_data_dir() / "vector_index"))
        self.local_search = LocalSearchEngine(self.db, self.vector_store)

        # LIVELLO 2 del RAG: libreria Markdown
        self.books_manager = PreselectedBooksManager()
        self.books_vector_store = VectorStore(str(get_app_data_dir() / "vector_index_books"))
        self.books_search = LocalSearchEngine(self.db, self.books_vector_store, self.local_search.embedder)

        # Pulizia immagini orfane (dopo setup cartelle RAG, passando entrambe)
        try:
            removed = cleanup_orphans([
                self.rag_folder,
                Path(self.books_manager.get_books_folder_path()),
            ])
            if removed:
                print(f"[StudioIAAPI] Rimosse {removed} immagini orfane dalla cache.")
        except Exception as e:
            print(f"[StudioIAAPI] Pulizia cache immagini fallita: {e}")

        self.llm_client: Optional[LocalLLMClient] = None
        self._load_llm_client_from_config()

        self.router = Router(
            lambda: self.llm_client,
            self.local_search,
            self.books_search,
            rag_top_k=self.config.get("rag_top_k", 5),
        )

        self.converter: Optional[MarkdownConverter] = None

    # ------------------------------------------------------------------
    def _load_llm_client_from_config(self) -> None:
        model_path = self.config.get("local_model_path", "")
        if not model_path:
            self.llm_client = None
            return
        if not os.path.isfile(model_path):
            print(f"[StudioIAAPI] Modello configurato non trovato: {model_path}. Reset.")
            self.config.set("local_model_path", "")
            self.config.save()
            self.llm_client = None
            return
        try:
            self.llm_client = LocalLLMClient(
                model_path=model_path,
                n_ctx=self.config.get("local_model_n_ctx", 8192),
                n_gpu_layers=self.config.get("local_model_n_gpu_layers", -1),
                n_threads=self.config.get("local_model_n_threads"),
            )
        except LocalLLMError as e:
            print(f"[StudioIAAPI] Impossibile caricare il modello: {e}")
            self.llm_client = None

    @staticmethod
    def _active_window():
        return webview.active_window()

    # ==================================================================
    # Modelli (catalogo + download + selezione)
    # ==================================================================
    def list_models(self):
        """Ritorna il catalogo con, per ogni voce, lo stato downloaded/active."""
        models = self.models_manager.list_models()
        active_path = self.config.get("local_model_path", "") or ""
        active_path_norm = os.path.normpath(active_path) if active_path else ""
        for m in models:
            downloaded_path = self.models_manager.get_downloaded_path(m["key"])
            m["active"] = bool(downloaded_path) and os.path.normpath(downloaded_path) == active_path_norm
        return models

    def download_model(self, model_key: str):
        """Avvia il download in un thread di background e ritorna subito.
        Lo stato è leggibile con get_download_progress()."""
        if self.models_manager.is_downloading():
            return {"success": False, "error": "Un download è già in corso."}
        t = threading.Thread(
            target=self.models_manager.download,
            args=(model_key,),
            daemon=True,
        )
        t.start()
        return {"success": True, "started": True}

    def get_download_progress(self):
        return self.models_manager.get_progress()

    def load_model(self, model_key: str):
        """Imposta il modello come attivo e lo rende disponibile al router."""
        path = self.models_manager.get_downloaded_path(model_key)
        if not path:
            return {"success": False, "error": "Modello non scaricato."}
        self.config.set("local_model_path", path)
        self.config.save()
        self.llm_client = None
        self._load_llm_client_from_config()
        return {"success": True, "active": self.llm_client is not None}

    def unload_model(self):
        """Rimuove il modello attivo (utile in fase di debug)."""
        self.config.set("local_model_path", "")
        self.config.save()
        self.llm_client = None
        return {"success": True}

    # ==================================================================
    # Conversazioni
    # ==================================================================
    def get_conversations(self):
        rows = self.db.get_chats()
        return [
            {"id": row["id"], "title": row["titolo"], "date": row["data_creazione"]}
            for row in rows
        ]

    def get_messages(self, conversation_id: int):
        rows = self.db.get_messages(conversation_id)
        return [
            {
                "id": row["id"],
                "role": row["ruolo"],
                "content": row["testo"],
                "source": row["fonte"],
            }
            for row in rows
        ]

    def send_message(
        self,
        message: str,
        conversation_id,
        mode: str,
        thinking: bool = False,
        study_mode=None,
    ):
        try:
            if not message or not message.strip():
                return {"conversation_id": conversation_id, "response": "", "source": "nessuna"}

            study_mode = _normalize_study_mode(study_mode)

            if conversation_id is None:
                title = message.strip()[:50] or "Nuova conversazione"
                conversation_id = self.db.create_chat(title)

            self.db.add_message(conversation_id, "user", message)

            if not self.llm_client:
                response_text = (
                    "Nessun modello attivo. Apri 'Seleziona modelli' in alto "
                    "e scarica/carica un modello prima di fare domande."
                )
                source = "nessuna"
            else:
                self._reindex_before_query(mode)
                answer = self.router.process_query(
                    message,
                    mode=mode,
                    thinking=thinking,
                    study_mode=study_mode,
                )
                response_text = answer.text
                source = answer.source

            self.db.add_message(conversation_id, "ai", response_text, fonte=source)

            return {"conversation_id": conversation_id, "response": response_text, "source": source}

        except Exception as e:
            print(f"[StudioIAAPI] Errore in send_message: {e}")
            return {
                "conversation_id": conversation_id,
                "response": f"Si è verificato un errore imprevisto: {e}",
                "source": "nessuna",
            }

    def _reindex_before_query(self, mode: str) -> None:
        if mode == "solo_online":
            return

        ocr_enabled = self.config.get("ocr_enabled", True)
        self.local_search.ensure_index_updated(str(self.rag_folder), ocr_enabled=ocr_enabled)
        self.books_search.ensure_index_updated(
            self.books_manager.get_books_folder_path(), ocr_enabled=ocr_enabled
        )

    def delete_conversation(self, conversation_id: int):
        try:
            self.db.delete_chat(conversation_id)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ==================================================================
    # Pannello "Aggiungi materiale"
    # ==================================================================
    def pick_notes_file(self):
        window = self._active_window()
        if not window:
            return None
        result = window.create_file_dialog(webview.FileDialog.OPEN, file_types=NOTES_FILE_TYPES)
        if not result:
            return None
        path = result[0]
        return {"path": path, "name": Path(path).name}

    def pick_library_pdf_file(self):
        window = self._active_window()
        if not window:
            return None
        result = window.create_file_dialog(webview.FileDialog.OPEN, file_types=LIBRARY_FILE_TYPES)
        if not result:
            return None
        path = result[0]
        return {"path": path, "name": Path(path).name}

    def add_notes_material(self, file_path: str):
        try:
            if self.converter is None:
                self.converter = MarkdownConverter()
            self.converter.convert_file_with_images(file_path, str(self.rag_folder))
            self.local_search.ensure_index_updated(
                str(self.rag_folder), ocr_enabled=self.config.get("ocr_enabled", True)
            )
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_library_material(self, file_path: str):
        try:
            src = Path(file_path)
            if src.suffix.lower() != ".pdf":
                raise ValueError("In questa modalità è accettato solo il formato PDF")

            books_dir = Path(self.books_manager.get_books_folder_path())
            books_dir.mkdir(parents=True, exist_ok=True)

            if self.converter is None:
                self.converter = MarkdownConverter()
            self.converter.convert_file_with_images(file_path, str(books_dir))

            self.books_search.ensure_index_updated(
                str(books_dir), ocr_enabled=self.config.get("ocr_enabled", True)
            )
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ==================================================================
    # Impostazioni
    # ==================================================================
    def get_settings(self):
        config = self.config.get_config()
        return {key: config.get(key) for key in USER_SETTINGS_KEYS}

    def save_settings(self, settings: dict):
        try:
            filtered = {k: v for k, v in settings.items() if k in USER_SETTINGS_KEYS}
            self.config.update_config(filtered)
            self.router.rag_top_k = self.config.get("rag_top_k", 5)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ==================================================================
    # Aggiornamenti
    # ==================================================================
    def check_for_updates(self):
        if not UPDATE_REPO:
            return {"configured": False, "current_version": APP_VERSION, "update_available": False}

        try:
            import requests
            response = requests.get(
                f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest",
                timeout=5,
            )
            response.raise_for_status()
            data = response.json()

            latest_version = (data.get("tag_name") or "").lstrip("v")
            download_url = None
            assets = data.get("assets") or []
            if assets:
                download_url = assets[0].get("browser_download_url")
            elif data.get("html_url"):
                download_url = data["html_url"]

            return {
                "configured": True,
                "current_version": APP_VERSION,
                "latest_version": latest_version,
                "update_available": _is_newer_version(latest_version, APP_VERSION),
                "download_url": download_url,
            }
        except Exception as e:
            print(f"[StudioIAAPI] Controllo aggiornamenti fallito: {e}")
            return {
                "configured": True,
                "current_version": APP_VERSION,
                "update_available": False,
                "error": str(e),
            }

    def download_update(self, url: str):
        if not url:
            return {"success": False, "error": "Nessun link di download disponibile."}
        if not _is_safe_url(url):
            return {"success": False, "error": "URL non valido."}
        try:
            import webbrowser
            webbrowser.open(url)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def open_library_website(self):
        if not LIBRARY_WEBSITE_URL:
            return {"success": False, "error": "Il sito delle librerie non è ancora disponibile."}
        if not _is_safe_url(LIBRARY_WEBSITE_URL):
            return {"success": False, "error": "URL non valido."}
        try:
            import webbrowser
            webbrowser.open(LIBRARY_WEBSITE_URL)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
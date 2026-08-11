"""
gui/app_window.py
--------------------
Il controller centrale dell'applicazione. Interfaccia moderna con:
- Barra di ricerca AI centrale
- Pannello laterale destro per cronologia conversazioni
- Pannello conversione file (foto/PDF/Word -> Markdown) accessibile tramite bottone +
- Tutto integrato con il sistema RAG a 3 livelli
"""

import os
import tkinter as tk
from pathlib import Path
from typing import Optional

import customtkinter as ctk

import theme
from core.local_llm_client import LocalLLMClient, LocalLLMError
from core.local_search import LocalSearchEngine
from core.rag.vector_store import VectorStore
from core.router import Router
from core.voice_input import listen_once
from core.markdown_converter import convert_to_markdown
from data.config_manager import ConfigManager, get_app_data_dir
from data.db import Database
from gui.chat_area import ChatArea
from gui.input_bar import InputBar
from gui.settings_view import SettingsView
from gui.sidebar import Sidebar

WINDOW_TITLE = "StudioIA — Assistente locale"


class App(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title(WINDOW_TITLE)
        self.configure(fg_color=theme.COLORS["bg_main"])

        # ------------------------------------------------------------
        # Stato e servizi di base (config, database, TaskRunner)
        # ------------------------------------------------------------
        self.config_manager = ConfigManager()
        self.geometry(self.config_manager.get("window_geometry", "1280x800"))
        self.minsize(1000, 650)

        self.db = Database()

        from utils.threading_utils import TaskRunner
        self.task_runner = TaskRunner(self)

        # Indice vettoriale + motore di ricerca locale (RAG)
        vector_store_dir = str(get_app_data_dir() / "vector_index")
        self.vector_store = VectorStore(vector_store_dir)
        self.local_search = LocalSearchEngine(self.db, self.vector_store)

        self._local_client = None
        self.router = Router(self._get_local_client, self.local_search, rag_top_k=self.config_manager.get("rag_top_k", 5))

        # Cartella RAG personale
        self.rag_folder = Path(__file__).parent.parent / "file_AIstudio"
        self.rag_folder.mkdir(parents=True, exist_ok=True)

        # ------------------------------------------------------------
        # Stato di navigazione
        # ------------------------------------------------------------
        self.current_env = "chat"
        self.active_chat_id = {"chat": None, "tutor": None}
        
        # Stato pannelli
        self.sidebar_open = False
        self.converter_panel_open = False

        # ------------------------------------------------------------
        # Layout principale
        # ------------------------------------------------------------
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # Header con bottone + e titolo
        self._create_header()
        
        # Area chat centrale
        self._create_chat_area()
        
        # Pannello laterale destro (cronologia)
        self._create_right_sidebar()
        
        # Pannello conversione file
        self._create_converter_panel()
        
        # Barra di input inferiore
        self._create_input_bar()

        self.protocol("WM_DELETE_WINDOW", self._on_close)

        # Avvio
        self.refresh_history()

        if not self.config_manager.is_configured():
            self.open_settings()
        else:
            self._maybe_start_indexing()

    # ======================================================================
    # Gestione client LLM Locale (creazione pigra / aggiornamento configurazione)
    # ======================================================================
    def _get_local_client(self):
        """Restituisce un client per il modello locale."""
        if self._local_client is None:
            self._local_client = LocalLLMClient(
                model_path=self.config_manager.get("local_model_path", ""),
                n_ctx=self.config_manager.get("local_model_n_ctx", 4096),
                n_gpu_layers=self.config_manager.get("local_model_n_gpu_layers", -1),
                n_threads=self.config_manager.get("local_model_n_threads", None),
            )
        return self._local_client

    def _invalidate_local_client(self) -> None:
        self._local_client = None

    # ======================================================================
    # Navigazione tra ambienti / viste
    # ======================================================================
    def _show_view(self, name: str) -> None:
        widget = {
            "chat": self.chat_area_normal,
            "tutor": self.chat_area_tutor,
            "settings": self.settings_view,
        }[name]
        widget.tkraise()

    def switch_environment(self, env: str) -> None:
        self.current_env = env
        self._show_view(env)
        self.refresh_history()

    def open_settings(self) -> None:
        self.settings_view.refresh_from_config()
        self._show_view("settings")

    # ======================================================================
    # Gestione chat / storico
    # ======================================================================
    def refresh_history(self) -> None:
        chats = self.db.get_chats(self.current_env)
        self.sidebar.populate_history(chats, active_chat_id=self.active_chat_id[self.current_env])

    def new_chat(self, env: str) -> None:
        self.current_env = env
        self._show_view(env)
        self.active_chat_id[env] = None
        self._active_chat_area().clear()
        self.refresh_history()

    def load_chat(self, chat_id: int) -> None:
        chat = self.db.get_chat(chat_id)
        if chat is None:
            return
        env = chat["ambiente"]
        self.current_env = env
        self.active_chat_id[env] = chat_id
        self._show_view(env)
        messages = self.db.get_messages(chat_id)
        self._active_chat_area().render_messages(messages)
        self.refresh_history()

    def _active_chat_area(self) -> ChatArea:
        return self.chat_area_tutor if self.current_env == "tutor" else self.chat_area_normal

    def _ensure_active_chat(self, first_message_text: str) -> int:
        """Se non c'è ancora una chat attiva per l'ambiente corrente, la crea
        usando le prime parole del primo messaggio come titolo."""
        chat_id = self.active_chat_id[self.current_env]
        if chat_id is not None:
            return chat_id

        titolo = first_message_text.strip()[:40]
        if len(first_message_text.strip()) > 40:
            titolo += "…"
        if not titolo:
            titolo = "Nuova conversazione"

        chat_id = self.db.create_chat(titolo, self.current_env)
        self.active_chat_id[self.current_env] = chat_id
        self.refresh_history()
        return chat_id

    # ======================================================================
    # Invio messaggi (con threading per non bloccare la GUI)
    # ======================================================================
    def handle_send(self, text: str, mode: str) -> None:
        if not self.config_manager.is_configured():
            self.open_settings()
            self.settings_view.set_status(
                "Configura il percorso del modello GGUF nelle Impostazioni.", 
                is_error=True
            )
            return

        env = self.current_env
        chat_area = self._active_chat_area()
        chat_id = self._ensure_active_chat(text)

        chat_area.add_message("user", text, None)
        self.db.add_message(chat_id, "user", text)
        chat_area.show_thinking()
        self.input_bar.set_enabled(False)

        self.task_runner.run(
            self._process_query_background,
            on_success=lambda result: self._on_answer_ready(result, chat_id, env),
            on_error=lambda err: self._on_answer_error(err, chat_id, env),
            query=text,
            ambiente=env,
            mode=mode,
        )

    def _process_query_background(self, query: str, ambiente: str, mode: str):
        # Prima di ogni ricerca, aggiorniamo l'indice in modo incrementale:
        # l'intero albero di cartelle viene ri-esplorato (economico), ma
        # solo i file nuovi/modificati vengono ri-processati (costoso).
        folder_path = self.config_manager.get("folder_path", "")
        if folder_path and mode != "solo_online":
            self.local_search.ensure_index_updated(
                folder_path,
                ocr_enabled=self.config_manager.get("ocr_enabled", True),
            )
        return self.router.process_query(query, ambiente=ambiente, mode=mode)

    def _on_answer_ready(self, result, chat_id: int, env: str) -> None:
        self.input_bar.set_enabled(True)
        chat_area = self.chat_area_tutor if env == "tutor" else self.chat_area_normal
        chat_area.hide_thinking()
        chat_area.add_message("ai", result.text, result.source)
        self.db.add_message(chat_id, "ai", result.text, result.source)

    def _on_answer_error(self, error: Exception, chat_id: int, env: str) -> None:
        self.input_bar.set_enabled(True)
        chat_area = self.chat_area_tutor if env == "tutor" else self.chat_area_normal
        chat_area.hide_thinking()
        message = str(error) if isinstance(error, LocalLLMError) else f"Si è verificato un errore imprevisto: {error}"
        chat_area.add_message("ai", f"Attenzione: {message}", None)
        self.db.add_message(chat_id, "ai", f"Attenzione: {message}", None)

    # ======================================================================
    # Input vocale
    # ======================================================================
    def handle_mic_click(self) -> None:
        self.input_bar.set_mic_listening(True)
        self.task_runner.run(
            listen_once,
            on_success=self._on_voice_result,
            on_error=self._on_voice_error,
        )

    def _on_voice_result(self, result) -> None:
        self.input_bar.set_mic_listening(False)
        if result.error:
            # Errori come "nessun suono rilevato" non sono critici: si
            # disattiva semplicemente il microfono, senza popup invasivi.
            self.sidebar.set_status(f"Microfono: {result.error}")
            self.after(4000, lambda: self.sidebar.set_status(""))
        elif result.text:
            self.input_bar.set_text(result.text)

    def _on_voice_error(self, error: Exception) -> None:
        self.input_bar.set_mic_listening(False)
        self.sidebar.set_status(f"Errore microfono: {error}")
        self.after(4000, lambda: self.sidebar.set_status(""))

    # ======================================================================
    # Impostazioni
    # ======================================================================
    def save_settings(
        self,
        local_model_path: str,
        local_model_n_ctx: int,
        local_model_n_gpu_layers: int,
        local_model_n_threads: int,
        folder_path: str,
        ocr_enabled: bool,
    ) -> None:
        path_changed = local_model_path != self.config_manager.get("local_model_path", "")
        
        self.config_manager.update(
            local_model_path=local_model_path,
            local_model_n_ctx=local_model_n_ctx,
            local_model_n_gpu_layers=local_model_n_gpu_layers,
            local_model_n_threads=local_model_n_threads,
            folder_path=folder_path,
            ocr_enabled=ocr_enabled,
        )

        if path_changed:
            self._invalidate_local_client()

        if folder_path and os.path.isdir(folder_path):
            self._maybe_start_indexing()
        elif folder_path:
            self.settings_view.set_status("Il percorso indicato non è una cartella valida.", is_error=True)

    def trigger_reindex(self) -> None:
        folder_path = self.config_manager.get("folder_path", "")
        if not folder_path or not os.path.isdir(folder_path):
            self.settings_view.set_status("Seleziona prima una cartella valida.", is_error=True)
            return
        self._maybe_start_indexing(force_status_updates=True)

    def _maybe_start_indexing(self, force_status_updates: bool = False) -> None:
        folder_path = self.config_manager.get("folder_path", "")
        if not folder_path or not os.path.isdir(folder_path):
            return

        def progress(msg: str) -> None:
            # Chiamata dal thread di background: NON tocchiamo mai i widget
            # direttamente da qui. task_runner.post() mette il messaggio in
            # coda in modo thread-safe; verrà consegnato al thread della GUI
            # dal ciclo di polling di TaskRunner.
            self.task_runner.post(lambda m: self._update_index_status(m, force_status_updates), msg)

        self.sidebar.set_status("Indicizzazione in corso...")
        self.task_runner.run(
            self.local_search.ensure_index_updated,
            on_success=lambda _r: self.sidebar.set_status("Indice aggiornato"),
            on_error=lambda e: self.sidebar.set_status(f"Errore indicizzazione: {e}"),
            folder_path=folder_path,
            ocr_enabled=self.config_manager.get("ocr_enabled", True),
            progress_callback=progress,
        )

    # ======================================================================
    # Funzionalità Appunti2PDF
    # ======================================================================
    def handle_appunti_to_pdf(self, image_folder: str, output_pdf: str) -> bool:
        """Converte una cartella di appunti (immagini) in PDF con OCR"""
        try:
            from appunti2pdf.converter import convert_appunti_to_pdf
            
            success = convert_appunti_to_pdf(
                input_path=image_folder,
                output_pdf=output_pdf,
                add_ocr=True
            )
            
            if success:
                self.sidebar.set_status(f"PDF creato: {output_pdf}")
            else:
                self.sidebar.set_status("Errore nella conversione PDF", is_error=True)
            
            return success
            
        except Exception as e:
            error_msg = f"Errore Appunti2PDF: {e}"
            self.sidebar.set_status(error_msg, is_error=True)
            return False

    def _update_index_status(self, msg: str, also_settings: bool) -> None:
        self.sidebar.set_status(f"{msg}")
        if also_settings:
            self.settings_view.set_status(msg)

    # ======================================================================
    def _on_close(self) -> None:
        self.config_manager.set("window_geometry", self.geometry())
        self.config_manager.save()
        self.destroy()

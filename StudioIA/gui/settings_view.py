"""
gui/settings_view.py
------------------------
Pagina di configurazione: percorso del modello GGUF locale, parametri del modello
(context length, GPU layers, threads), cartella locale da indicizzare
(con pulsante "Sfoglia"), opzione OCR on/off, pulsante di reindicizzazione
manuale.
"""

from tkinter import filedialog
import os

import customtkinter as ctk

import theme
from gui import icons


class SettingsView(ctk.CTkFrame):
    def __init__(self, parent, config_manager, on_save, on_reindex, **kwargs):
        super().__init__(parent, fg_color=theme.COLORS["bg_main"], corner_radius=0, **kwargs)

        self.config_manager = config_manager
        self._on_save = on_save
        self._on_reindex = on_reindex

        wrapper = ctk.CTkFrame(self, fg_color="transparent")
        wrapper.pack(fill="both", expand=True, padx=40, pady=30)

        header_row = ctk.CTkFrame(wrapper, fg_color="transparent")
        header_row.pack(anchor="w", pady=(0, 20))
        ctk.CTkLabel(header_row, text="", image=icons.get_icon("gear", theme.COLORS["text_primary"], 22)).pack(
            side="left", padx=(0, 10)
        )
        theme.label(header_row, "Impostazioni", size=20, weight="bold").pack(side="left")

        # --- Modello Locale ---
        theme.label(wrapper, "Modello AI Locale (GGUF)", size=13, weight="bold").pack(anchor="w")
        theme.label(
            wrapper,
            "Seleziona il file del modello in formato GGUF. Il modello verrà caricato direttamente "
            "dentro l'applicazione senza bisogno di server esterni come Ollama o LM Studio.",
            size=11,
            color="text_secondary",
        ).pack(anchor="w", pady=(0, 6))
        
        model_row = ctk.CTkFrame(wrapper, fg_color="transparent")
        model_row.pack(fill="x", pady=(0, 10))
        model_row.grid_columnconfigure(0, weight=1)
        
        self.model_path_entry = theme.entry(model_row, placeholder="Nessun modello selezionato")
        self.model_path_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        
        theme.primary_button(model_row, "Sfoglia...", command=self._browse_model, width=110).grid(row=0, column=1)
        
        theme.label(
            wrapper,
            "Dove scaricare modelli GGUF: HuggingFace (TheBloke, bartowski, lmstudio-community)",
            size=10,
            color="text_secondary",
        ).pack(anchor="w", pady=(0, 14))

        # --- Parametri avanzati modello ---
        theme.label(wrapper, "Parametri Avanzati", size=13, weight="bold").pack(anchor="w")
        theme.label(
            wrapper,
            "Configura le risorse da dedicare al modello. Lascia i valori predefiniti se non sei sicuro.",
            size=11,
            color="text_secondary",
        ).pack(anchor="w", pady=(0, 6))
        
        params_frame = ctk.CTkFrame(wrapper, fg_color="transparent")
        params_frame.pack(fill="x", pady=(0, 20))
        
        # Context Length
        theme.label(params_frame, "Context Length (n_ctx)", size=11).pack(anchor="w")
        self.n_ctx_entry = theme.entry(params_frame, placeholder="4096")
        self.n_ctx_entry.pack(fill="x", pady=(0, 10))
        theme.label(
            params_frame,
            "Numero massimo di token nel contesto. Valori più alti richiedono più RAM.",
            size=10,
            color="text_secondary",
        ).pack(anchor="w", pady=(0, 10))
        
        # GPU Layers
        theme.label(params_frame, "GPU Layers (n_gpu_layers)", size=11).pack(anchor="w")
        self.n_gpu_layers_entry = theme.entry(params_frame, placeholder="-1")
        self.n_gpu_layers_entry.pack(fill="x", pady=(0, 10))
        theme.label(
            params_frame,
            "Numero di layer da eseguire su GPU (-1 = tutti). Richiede GPU compatibile.",
            size=10,
            color="text_secondary",
        ).pack(anchor="w", pady=(0, 10))
        
        # Threads
        theme.label(params_frame, "CPU Threads (n_threads)", size=11).pack(anchor="w")
        self.n_threads_entry = theme.entry(params_frame, placeholder="Lascia vuoto per automatico")
        self.n_threads_entry.pack(fill="x", pady=(0, 14))
        theme.label(
            params_frame,
            "Numero di thread CPU. Lascia vuoto per usare automaticamente (cpu_count - 1).",
            size=10,
            color="text_secondary",
        ).pack(anchor="w", pady=(0, 14))

        # --- Cartella locale ---
        theme.label(wrapper, "Cartella locale da analizzare", size=13, weight="bold").pack(anchor="w")
        theme.label(
            wrapper,
            "L'app analizzerà questa cartella e tutte le sue sottocartelle (PDF, Word, PowerPoint, Excel, immagini, testo).",
            size=11,
            color="text_secondary",
        ).pack(anchor="w", pady=(0, 6))

        folder_row = ctk.CTkFrame(wrapper, fg_color="transparent")
        folder_row.pack(fill="x", pady=(0, 20))
        folder_row.grid_columnconfigure(0, weight=1)

        self.folder_entry = theme.entry(folder_row, placeholder="Nessuna cartella selezionata")
        self.folder_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))

        theme.primary_button(folder_row, "Sfoglia...", command=self._browse_folder, width=110).grid(row=0, column=1)

        # --- OCR ---
        self.ocr_switch = ctk.CTkSwitch(
            wrapper,
            text="Includi testo da immagini (OCR)",
            fg_color=theme.COLORS["bg_sidebar_item"],
            progress_color=theme.COLORS["accent_orange"],
            text_color=theme.COLORS["text_primary"],
            font=theme.font(13),
        )
        self.ocr_switch.pack(anchor="w", pady=(0, 6))
        theme.label(
            wrapper,
            "Se disattivato, l'indicizzazione delle immagini è più veloce ma non viene estratto testo scritto al loro interno.",
            size=11,
            color="text_secondary",
        ).pack(anchor="w", pady=(0, 24))

        # --- Pulsanti azione ---
        actions_row = ctk.CTkFrame(wrapper, fg_color="transparent")
        actions_row.pack(anchor="w")

        theme.primary_button(actions_row, "Salva impostazioni", command=self._save).pack(side="left", padx=(0, 10))
        theme.sidebar_button(actions_row, "Reindicizza ora", command=self._reindex).pack(side="left")

        self.status_label = theme.label(wrapper, "", size=12, color="success")
        self.status_label.pack(anchor="w", pady=(14, 0))

        self.refresh_from_config()

    def refresh_from_config(self) -> None:
        self.model_path_entry.delete(0, "end")
        self.model_path_entry.insert(0, self.config_manager.get("local_model_path", ""))
        
        self.n_ctx_entry.delete(0, "end")
        self.n_ctx_entry.insert(0, str(self.config_manager.get("local_model_n_ctx", 4096)))
        
        self.n_gpu_layers_entry.delete(0, "end")
        self.n_gpu_layers_entry.insert(0, str(self.config_manager.get("local_model_n_gpu_layers", -1)))
        
        n_threads = self.config_manager.get("local_model_n_threads", None)
        self.n_threads_entry.delete(0, "end")
        if n_threads is not None:
            self.n_threads_entry.insert(0, str(n_threads))

        self.folder_entry.delete(0, "end")
        self.folder_entry.insert(0, self.config_manager.get("folder_path", ""))

        if self.config_manager.get("ocr_enabled", True):
            self.ocr_switch.select()
        else:
            self.ocr_switch.deselect()

    def _browse_model(self) -> None:
        """Apre un dialog per selezionare il file del modello GGUF."""
        path = filedialog.askopenfilename(
            title="Seleziona il modello GGUF",
            filetypes=[("GGUF files", "*.gguf"), ("All files", "*.*")]
        )
        if path:
            self.model_path_entry.delete(0, "end")
            self.model_path_entry.insert(0, path)

    def _browse_folder(self) -> None:
        path = filedialog.askdirectory(title="Seleziona la cartella da analizzare")
        if path:
            self.folder_entry.delete(0, "end")
            self.folder_entry.insert(0, path)

    def _save(self) -> None:
        model_path = self.model_path_entry.get().strip()
        
        try:
            n_ctx = int(self.n_ctx_entry.get().strip() or "4096")
        except ValueError:
            n_ctx = 4096
            
        try:
            n_gpu_layers = int(self.n_gpu_layers_entry.get().strip() or "-1")
        except ValueError:
            n_gpu_layers = -1
            
        n_threads_str = self.n_threads_entry.get().strip()
        n_threads = int(n_threads_str) if n_threads_str else None
        
        folder_path = self.folder_entry.get().strip()
        ocr_enabled = bool(self.ocr_switch.get())

        self._on_save(
            local_model_path=model_path,
            local_model_n_ctx=n_ctx,
            local_model_n_gpu_layers=n_gpu_layers,
            local_model_n_threads=n_threads,
            folder_path=folder_path,
            ocr_enabled=ocr_enabled,
        )
        self.status_label.configure(text="Impostazioni salvate.", text_color=theme.COLORS["success"])

    def _reindex(self) -> None:
        self.status_label.configure(text="Reindicizzazione avviata...", text_color=theme.COLORS["text_secondary"])
        self._on_reindex()

    def set_status(self, text: str, is_error: bool = False) -> None:
        color = theme.COLORS["error"] if is_error else theme.COLORS["success"]
        self.status_label.configure(text=text, text_color=color)

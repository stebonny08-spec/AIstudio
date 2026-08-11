"""
gui/settings_view.py
------------------------
Pagina di configurazione: chiave API Gemini, cartella locale da indicizzare
(con pulsante "Sfoglia"), opzione OCR on/off, pulsante di reindicizzazione
manuale.
"""

from tkinter import filedialog

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

        # --- Chiave API ---
        theme.label(wrapper, "Chiave API Google Gemini", size=13, weight="bold").pack(anchor="w")
        theme.label(
            wrapper,
            "Necessaria per usare l'assistente. Si ottiene gratuitamente da Google AI Studio.",
            size=11,
            color="text_secondary",
        ).pack(anchor="w", pady=(0, 6))
        self.api_key_entry = theme.entry(wrapper, placeholder="Incolla qui la tua chiave API", show="*")
        self.api_key_entry.pack(fill="x", pady=(0, 20))

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
        self.api_key_entry.delete(0, "end")
        self.api_key_entry.insert(0, self.config_manager.get("api_key", ""))

        self.folder_entry.delete(0, "end")
        self.folder_entry.insert(0, self.config_manager.get("folder_path", ""))

        if self.config_manager.get("ocr_enabled", True):
            self.ocr_switch.select()
        else:
            self.ocr_switch.deselect()

    def _browse_folder(self) -> None:
        path = filedialog.askdirectory(title="Seleziona la cartella da analizzare")
        if path:
            self.folder_entry.delete(0, "end")
            self.folder_entry.insert(0, path)

    def _save(self) -> None:
        api_key = self.api_key_entry.get().strip()
        folder_path = self.folder_entry.get().strip()
        ocr_enabled = bool(self.ocr_switch.get())

        self._on_save(api_key, folder_path, ocr_enabled)
        self.status_label.configure(text="Impostazioni salvate.", text_color=theme.COLORS["success"])

    def _reindex(self) -> None:
        self.status_label.configure(text="Reindicizzazione avviata...", text_color=theme.COLORS["text_secondary"])
        self._on_reindex()

    def set_status(self, text: str, is_error: bool = False) -> None:
        color = theme.COLORS["error"] if is_error else theme.COLORS["success"]
        self.status_label.configure(text=text, text_color=color)

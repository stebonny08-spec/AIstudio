"""
gui/converter_panel.py
--------------------------
Pannello "Aggiungi materiale", con due modalità selezionabili da due
bottoni in alto:

- "Appunti personali" (LIVELLO 1 del RAG): l'utente carica una foto di
  appunti, un PDF o un documento Word. Viene convertito in Markdown e
  indicizzato SUBITO nella cartella del materiale personale dello
  studente.
- "Libri (Markdown)" (LIVELLO 2 del RAG): l'utente carica un file .md
  già pronto (es. un libro scaricato da un'altra app). Viene copiato e
  indicizzato SUBITO nella cartella dedicata dei materiali pre-selezionati.

In entrambi i casi tutta l'elaborazione avviene sotto al cofano: l'utente
vede solo un esito di successo/errore generico, mai un percorso file.
"""

from pathlib import Path
from tkinter import filedialog
from typing import Callable, Optional

import customtkinter as ctk

import theme

MODE_NOTES = "notes"
MODE_LIBRARY = "library"

NOTES_FILETYPES = [
    ("File supportati", "*.jpg *.jpeg *.png *.bmp *.tiff *.pdf *.docx"),
    ("Immagini", "*.jpg *.jpeg *.png *.bmp *.tiff"),
    ("PDF", "*.pdf"),
    ("Word", "*.docx"),
    ("Tutti i file", "*.*"),
]
LIBRARY_FILETYPES = [("File Markdown", "*.md"), ("Tutti i file", "*.*")]


class ConverterPanel(ctk.CTkFrame):
    def __init__(
        self,
        parent,
        task_runner,
        on_add_notes: Callable[[str], None],
        on_add_to_library: Callable[[str], None],
        **kwargs,
    ):
        super().__init__(parent, **kwargs)

        self._task_runner = task_runner
        self._on_add_notes = on_add_notes
        self._on_add_to_library = on_add_to_library
        self._mode = MODE_NOTES
        self._selected_path: Optional[str] = None

        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

        wrapper = ctk.CTkFrame(self, fg_color="transparent")
        wrapper.grid(row=0, column=0, sticky="new", padx=28, pady=28)
        wrapper.grid_columnconfigure(0, weight=1)

        theme.label(wrapper, "Aggiungi materiale", size=18, weight="bold").pack(anchor="w", pady=(0, 16))

        # --- Toggle modalità (2 bottoni) ---
        toggle_row = ctk.CTkFrame(wrapper, fg_color=theme.COLORS["bg_sidebar"], corner_radius=12)
        toggle_row.pack(fill="x", pady=(0, 16))
        toggle_row.grid_columnconfigure((0, 1), weight=1)

        self.notes_mode_btn = theme.sidebar_button(
            toggle_row, "Appunti personali", command=lambda: self._select_mode(MODE_NOTES), active=True,
        )
        self.notes_mode_btn.grid(row=0, column=0, sticky="ew", padx=4, pady=4)

        self.library_mode_btn = theme.sidebar_button(
            toggle_row, "Libri (Markdown)", command=lambda: self._select_mode(MODE_LIBRARY), active=False,
        )
        self.library_mode_btn.grid(row=0, column=1, sticky="ew", padx=4, pady=4)

        # --- Testo informativo (cambia con la modalità) ---
        self.info_label = theme.label(
            wrapper, "", size=11, color="text_secondary", wraplength=380, justify="left",
        )
        self.info_label.pack(anchor="w", pady=(0, 16))

        # --- Selezione file ---
        file_row = ctk.CTkFrame(wrapper, fg_color="transparent")
        file_row.pack(fill="x", pady=(0, 6))
        file_row.grid_columnconfigure(0, weight=1)

        self.file_entry = theme.entry(file_row, placeholder="Nessun file selezionato")
        self.file_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self.file_entry.configure(state="disabled")

        theme.primary_button(file_row, "Sfoglia...", command=self._browse_file, width=110).grid(row=0, column=1)

        self.formats_label = theme.label(wrapper, "", size=10, color="text_secondary")
        self.formats_label.pack(anchor="w", pady=(0, 22))

        # --- Azione ---
        self.action_button = theme.primary_button(wrapper, "", command=self._submit)
        self.action_button.configure(state="disabled")
        self.action_button.pack(anchor="w")

        self.status_label = theme.label(wrapper, "", size=12, color="success")
        self.status_label.pack(anchor="w", pady=(14, 0))

        self._apply_mode_texts()

    # ------------------------------------------------------------------
    def _select_mode(self, mode: str) -> None:
        if mode == self._mode:
            return
        self._mode = mode
        self._style_toggle_button(self.notes_mode_btn, mode == MODE_NOTES)
        self._style_toggle_button(self.library_mode_btn, mode == MODE_LIBRARY)
        self._reset_selection()
        self._apply_mode_texts()

    @staticmethod
    def _style_toggle_button(btn: ctk.CTkButton, active: bool) -> None:
        btn.configure(
            fg_color=theme.COLORS["bg_sidebar_item_active"] if active else theme.COLORS["bg_sidebar_item"],
            hover_color=theme.COLORS["accent_orange_hover"] if active else theme.COLORS["bg_sidebar_item_active"],
            font=theme.font(12, "bold" if active else "normal"),
        )

    def _apply_mode_texts(self) -> None:
        if self._mode == MODE_LIBRARY:
            self.info_label.configure(
                text="Carica qui file Markdown (.md) già pronti, ad esempio i libri scaricati dalla tua "
                     "app web: verranno aggiunti automaticamente alla libreria di studio (livello 2 del RAG)."
            )
            self.formats_label.configure(text="Formato supportato: .md")
            self.action_button.configure(text="Aggiungi alla libreria")
        else:
            self.info_label.configure(
                text="Carica una foto di appunti, un PDF o un documento Word: verrà elaborato "
                     "automaticamente e reso disponibile all'AI, senza passaggi manuali aggiuntivi "
                     "(livello 1 del RAG)."
            )
            self.formats_label.configure(text="Formati supportati: JPG, PNG, PDF, DOCX")
            self.action_button.configure(text="Aggiungi ai miei appunti")

    def _reset_selection(self) -> None:
        self._selected_path = None
        self.file_entry.configure(state="normal")
        self.file_entry.delete(0, "end")
        self.file_entry.configure(state="disabled")
        self.action_button.configure(state="disabled")
        self.status_label.configure(text="")

    def _browse_file(self) -> None:
        filetypes = LIBRARY_FILETYPES if self._mode == MODE_LIBRARY else NOTES_FILETYPES
        path = filedialog.askopenfilename(title="Seleziona il file", filetypes=filetypes)
        if not path:
            return

        if self._mode == MODE_LIBRARY and Path(path).suffix.lower() != ".md":
            self.status_label.configure(text="Seleziona un file .md.", text_color=theme.COLORS["error"])
            return

        self._selected_path = path
        self.file_entry.configure(state="normal")
        self.file_entry.delete(0, "end")
        self.file_entry.insert(0, Path(path).name)
        self.file_entry.configure(state="disabled")
        self.action_button.configure(state="normal")
        self.status_label.configure(text="")

    def _submit(self) -> None:
        if not self._selected_path:
            return
        self.action_button.configure(state="disabled")
        self.status_label.configure(text="Elaborazione in corso...", text_color=theme.COLORS["text_secondary"])

        callback = self._on_add_to_library if self._mode == MODE_LIBRARY else self._on_add_notes
        self._task_runner.run(
            callback,
            on_success=self._on_success,
            on_error=self._on_error,
            file_path=self._selected_path,
        )

    def _on_success(self, _result) -> None:
        mode = self._mode
        self._reset_selection()
        if mode == MODE_LIBRARY:
            self.status_label.configure(text="Libro aggiunto alla libreria di studio.", text_color=theme.COLORS["success"])
        else:
            self.status_label.configure(text="Appunti aggiunti ed elaborati.", text_color=theme.COLORS["success"])

    def _on_error(self, error: Exception) -> None:
        self.action_button.configure(state="normal")
        self.status_label.configure(text=f"Errore: {error}", text_color=theme.COLORS["error"])

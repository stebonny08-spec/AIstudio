"""
gui/chat_area.py
-------------------
Componente riutilizzabile per l'area messaggi. Sia la Chat Normale sia la
Modalità Insegnamento usano questo stesso componente, passando solo un
colore di bordo diverso: evita di duplicare la logica di rendering dei
messaggi in due file quasi identici (fonte comune di bug quando poi si
modifica una sola delle due copie e ci si dimentica dell'altra).
"""

import customtkinter as ctk

import theme
from gui import icons

FONTE_LABELS = {
    "locale": ("File locali", "folder"),
    "web": ("Ricerca web", "globe"),
    "nessuna": ("Nessuna fonte trovata", None),
}


class ChatArea(ctk.CTkFrame):
    def __init__(
        self,
        parent,
        border_color_key: str = "border_normal",
        header_text: str = "",
        header_icon: str = None,
        **kwargs,
    ):
        super().__init__(
            parent,
            fg_color=theme.COLORS["bg_main"],
            border_width=2,
            border_color=theme.COLORS[border_color_key],
            corner_radius=14,
            **kwargs,
        )

        self._thinking_bubble = None

        if header_text:
            header_row = ctk.CTkFrame(self, fg_color="transparent")
            header_row.pack(anchor="w", padx=16, pady=(12, 0))
            if header_icon:
                icon_label = ctk.CTkLabel(
                    header_row, text="", image=icons.get_icon(header_icon, theme.COLORS["text_primary"], 18)
                )
                icon_label.pack(side="left", padx=(0, 8))
            theme.label(header_row, header_text, size=15, weight="bold").pack(side="left")

        self.scroll_frame = ctk.CTkScrollableFrame(
            self,
            fg_color="transparent",
            scrollbar_button_color=theme.COLORS["border_normal"],
        )
        self.scroll_frame.pack(fill="both", expand=True, padx=10, pady=10)
        self.scroll_frame.grid_columnconfigure(0, weight=1)

        self._row_index = 0

    def clear(self) -> None:
        for widget in self.scroll_frame.winfo_children():
            widget.destroy()
        self._row_index = 0
        self._thinking_bubble = None

    def render_messages(self, messages) -> None:
        """messages: lista di righe sqlite3.Row con colonne ruolo, testo, fonte."""
        self.clear()
        for msg in messages:
            self.add_message(msg["ruolo"], msg["testo"], msg["fonte"])

    def add_message(self, ruolo: str, testo: str, fonte: str = None) -> None:
        is_user = ruolo == "user"
        bubble_color = theme.COLORS["bubble_user"] if is_user else theme.COLORS["bubble_ai"]
        anchor_side = "e" if is_user else "w"

        container = ctk.CTkFrame(self.scroll_frame, fg_color="transparent")
        container.grid(row=self._row_index, column=0, sticky="ew", pady=6, padx=4)
        container.grid_columnconfigure(0, weight=1)

        bubble = ctk.CTkFrame(container, fg_color=bubble_color, corner_radius=12)
        bubble.grid(row=0, column=0, sticky=anchor_side, padx=(80, 0) if is_user else (0, 80))

        label = ctk.CTkLabel(
            bubble,
            text=testo,
            text_color=theme.COLORS["text_primary"],
            font=theme.font(13),
            justify="left",
            anchor="w",
            wraplength=560,
        )
        label.pack(padx=14, pady=10, anchor="w")

        if fonte and not is_user:
            fonte_text, fonte_icon = FONTE_LABELS.get(fonte, (None, None))
            if fonte_text:
                fonte_row = ctk.CTkFrame(bubble, fg_color="transparent")
                fonte_row.pack(padx=14, pady=(0, 8), anchor="w")
                if fonte_icon:
                    fl_icon = ctk.CTkLabel(
                        fonte_row, text="", image=icons.get_icon(fonte_icon, theme.COLORS["text_muted"], 12)
                    )
                    fl_icon.pack(side="left", padx=(0, 4))
                ctk.CTkLabel(
                    fonte_row, text=fonte_text, text_color=theme.COLORS["text_muted"], font=theme.font(10, "bold"),
                ).pack(side="left")

        self._row_index += 1
        self._scroll_to_bottom()

    def show_thinking(self, testo: str = "Sto pensando...") -> None:
        self.hide_thinking()
        container = ctk.CTkFrame(self.scroll_frame, fg_color="transparent")
        container.grid(row=self._row_index, column=0, sticky="w", pady=6, padx=4)

        bubble = ctk.CTkFrame(container, fg_color=theme.COLORS["bg_card"], corner_radius=12)
        bubble.grid(row=0, column=0, sticky="w", padx=(0, 80))

        label = ctk.CTkLabel(
            bubble,
            text=testo,
            text_color=theme.COLORS["text_secondary"],
            font=theme.font(13, "italic"),
        )
        label.pack(padx=14, pady=10)

        self._thinking_bubble = container
        self._row_index += 1
        self._scroll_to_bottom()

    def hide_thinking(self) -> None:
        if self._thinking_bubble is not None:
            self._thinking_bubble.destroy()
            self._thinking_bubble = None

    def _scroll_to_bottom(self) -> None:
        # Piccolo trucco standard di Tkinter: dopo aver aggiunto un widget,
        # bisogna aspettare che il layout sia calcolato prima di scrollare.
        # _parent_canvas è un dettaglio interno di CustomTkinter (non
        # un'API pubblica garantita): lo usiamo con un try/except, così se
        # una futura versione della libreria lo rinomina l'app continua a
        # funzionare, semplicemente senza scroll automatico.
        def _do_scroll():
            try:
                self.scroll_frame._parent_canvas.yview_moveto(1.0)
            except (AttributeError, Exception):
                pass

        self.after(50, _do_scroll)

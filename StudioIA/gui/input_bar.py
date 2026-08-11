"""
gui/input_bar.py
--------------------
Barra di inserimento inferiore, in stile "chatbot" moderno: un'unica riga
alta e arrotondata con selettore di modalità compattato in un'icona,
campo di testo, microfono e invio.

Il selettore di modalità (Automatica / Solo locale / Solo online) è
un'icona sulla sinistra: cliccandola si apre un piccolo menu con le tre
opzioni, invece di occupare tutta la larghezza con tre pulsanti sempre visibili.
"""

import customtkinter as ctk

import theme
from gui import icons

MODE_OPTIONS = [
    ("automatica", "Automatica", "auto"),
    ("solo_locale", "Solo locale", "folder"),
    ("solo_online", "Solo online", "globe"),
]
MODE_ICON = {key: icon for key, _label, icon in MODE_OPTIONS}

ICON_COLOR = theme.COLORS["text_primary"]
ICON_COLOR_ON_ORANGE = theme.COLORS["text_on_orange"]

BAR_HEIGHT = 68
BUTTON_SIZE = 46


class InputBar(ctk.CTkFrame):
    def __init__(self, parent, on_send, on_mic_click, default_mode: str = "automatica", **kwargs):
        super().__init__(
            parent,
            fg_color=theme.COLORS["bg_sidebar"],
            corner_radius=22,
            border_width=1,
            border_color=theme.COLORS["border_normal"],
            height=BAR_HEIGHT,
            **kwargs,
        )
        self.grid_propagate(False)

        self._on_send = on_send
        self._on_mic_click = on_mic_click
        self._mode = default_mode
        self._menu_popup = None

        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.mode_button = ctk.CTkButton(
            self, text="", image=icons.get_icon(MODE_ICON.get(default_mode, "auto"), ICON_COLOR, 20),
            command=self._toggle_mode_menu, width=BUTTON_SIZE, height=BUTTON_SIZE, corner_radius=16,
            fg_color=theme.COLORS["bg_sidebar_item"], hover_color=theme.COLORS["bg_sidebar_item_active"],
        )
        self.mode_button.grid(row=0, column=0, padx=(10, 8), pady=10)

        self.entry = theme.entry(
            self, placeholder="Scrivi una domanda...", height=BUTTON_SIZE,
            font=theme.font(14), border_width=0, fg_color=theme.COLORS["bg_input"],
        )
        self.entry.grid(row=0, column=1, sticky="ew", pady=10)
        self.entry.bind("<Return>", lambda _e: self._send())

        self.mic_button = theme.primary_button(
            self, "", image=icons.get_icon("mic", ICON_COLOR_ON_ORANGE, 18),
            command=self._mic_click, width=BUTTON_SIZE, height=BUTTON_SIZE, corner_radius=16,
        )
        self.mic_button.grid(row=0, column=2, padx=(8, 8), pady=10)

        self.send_button = theme.primary_button(
            self, "", image=icons.get_icon("send", ICON_COLOR_ON_ORANGE, 18),
            command=self._send, width=BUTTON_SIZE, height=BUTTON_SIZE, corner_radius=16,
        )
        self.send_button.grid(row=0, column=3, padx=(0, 10), pady=10)

    # ------------------------------------------------------------------
    def get_mode(self) -> str:
        return self._mode

    def get_text(self) -> str:
        return self.entry.get().strip()

    def set_text(self, text: str) -> None:
        self.entry.delete(0, "end")
        self.entry.insert(0, text)

    def clear(self) -> None:
        self.entry.delete(0, "end")

    def set_enabled(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        self.entry.configure(state=state)
        self.send_button.configure(state=state)
        self.mic_button.configure(state=state)

    def _send(self) -> None:
        text = self.get_text()
        if text:
            self._on_send(text, self.get_mode())
            self.clear()

    def _mic_click(self) -> None:
        self._on_mic_click()

    def set_mic_listening(self, listening: bool) -> None:
        self.mic_button.configure(
            fg_color=theme.COLORS["error"] if listening else theme.COLORS["accent_orange"],
            hover_color=theme.COLORS["error"] if listening else theme.COLORS["accent_orange_hover"],
        )

    # ------------------------------------------------------------------
    # Menu a comparsa per la scelta della modalità di ricerca
    # ------------------------------------------------------------------
    def _toggle_mode_menu(self) -> None:
        if self._menu_popup is not None and self._popup_is_open():
            self._close_mode_menu()
        else:
            self._open_mode_menu()

    def _popup_is_open(self) -> bool:
        try:
            return bool(self._menu_popup.winfo_exists())
        except Exception:
            return False

    def _open_mode_menu(self) -> None:
        self._close_mode_menu()

        popup = ctk.CTkToplevel(self)
        popup.overrideredirect(True)
        try:
            popup.attributes("-topmost", True)
        except Exception:
            pass
        popup.configure(fg_color=theme.COLORS["bg_sidebar"])

        card = ctk.CTkFrame(
            popup, fg_color=theme.COLORS["bg_sidebar"], corner_radius=14,
            border_width=1, border_color=theme.COLORS["border_normal"],
        )
        card.pack(padx=2, pady=2)

        for mode_key, label_text, icon_name in MODE_OPTIONS:
            active = mode_key == self._mode
            btn = theme.sidebar_button(
                card, f"  {label_text}",
                image=icons.get_icon(icon_name, ICON_COLOR, 16),
                command=lambda mk=mode_key: self._select_mode(mk),
                active=active,
                width=170,
            )
            btn.pack(fill="x", padx=6, pady=(6, 0) if mode_key == MODE_OPTIONS[0][0] else (4, 0))
        # Un piccolo margine anche sotto l'ultimo pulsante
        ctk.CTkFrame(card, fg_color="transparent", height=6).pack()

        popup.update_idletasks()
        bx = self.mode_button.winfo_rootx()
        by = self.mode_button.winfo_rooty()
        popup_h = popup.winfo_height()
        popup.geometry(f"+{bx}+{by - popup_h - 8}")

        self._menu_popup = popup

    def _close_mode_menu(self) -> None:
        if self._menu_popup is not None:
            try:
                self._menu_popup.destroy()
            except Exception:
                pass
            self._menu_popup = None

    def _select_mode(self, mode_key: str) -> None:
        self._mode = mode_key
        self.mode_button.configure(image=icons.get_icon(MODE_ICON.get(mode_key, "auto"), ICON_COLOR, 20))
        self._close_mode_menu()

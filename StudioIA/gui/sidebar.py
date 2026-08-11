"""
gui/sidebar.py
------------------
Menu laterale fisso (stile ChatGPT): pulsanti per passare da Chat a
Modalità Insegnamento, elenco cliccabile dello storico chat dell'ambiente
corrente, pulsante "Nuova chat" e pulsante Impostazioni.

È "modulabile": un pulsante a freccia permette di richiuderla a una
sottile barra di sole icone, per chi preferisce più spazio per la chat.
"""

import customtkinter as ctk

import theme
from gui import icons

WIDTH_EXPANDED = 260
WIDTH_COLLAPSED = 72

ICON_COLOR = theme.COLORS["text_primary"]


class Sidebar(ctk.CTkFrame):
    def __init__(
        self,
        parent,
        on_switch_env,
        on_select_chat,
        on_new_chat,
        on_open_settings,
        **kwargs,
    ):
        super().__init__(parent, fg_color=theme.COLORS["bg_sidebar"], corner_radius=0, width=WIDTH_EXPANDED, **kwargs)
        self.pack_propagate(False)

        self._on_switch_env = on_switch_env
        self._on_select_chat = on_select_chat
        self._on_new_chat = on_new_chat
        self._on_open_settings = on_open_settings

        self._current_env = "chat"
        self._chat_buttons = []
        self._collapsed = False

        # --- Riga superiore: titolo + pulsante per richiudere ---
        top_row = ctk.CTkFrame(self, fg_color="transparent")
        top_row.pack(fill="x", padx=14, pady=(18, 10))
        top_row.grid_columnconfigure(0, weight=1)

        self.title_label = theme.label(top_row, "StudioIA", size=18, weight="bold")
        self.title_label.grid(row=0, column=0, sticky="w")

        self.collapse_button = ctk.CTkButton(
            top_row, text="", image=icons.get_icon("chevron_left", ICON_COLOR, 16),
            command=self.toggle_collapsed, width=28, height=28, corner_radius=8,
            fg_color="transparent", hover_color=theme.COLORS["bg_sidebar_item"],
        )
        self.collapse_button.grid(row=0, column=1, sticky="e")

        # --- Switch ambiente ---
        env_frame = theme.frame(self, bg="sidebar")
        env_frame.pack(fill="x", padx=14, pady=(0, 10))

        self.btn_chat = theme.sidebar_button(
            env_frame, "Chat", image=icons.get_icon("chat", ICON_COLOR, 18),
            command=lambda: self._switch("chat"), active=True,
        )
        self.btn_chat.pack(fill="x", pady=(0, 6))

        self.btn_tutor = theme.sidebar_button(
            env_frame, "Modalità Insegnamento", image=icons.get_icon("graduation_cap", ICON_COLOR, 18),
            command=lambda: self._switch("tutor"), active=False,
        )
        self.btn_tutor.pack(fill="x")

        # --- Nuova chat ---
        self.btn_new_chat = theme.primary_button(
            self, "Nuova chat", image=icons.get_icon("plus", theme.COLORS["text_on_orange"], 16),
            command=self._new_chat,
        )
        self.btn_new_chat.pack(fill="x", padx=14, pady=(4, 14))

        # --- Storico chat ---
        self.history_label = theme.label(self, "Storico conversazioni", size=11, weight="bold", color="text_secondary")
        self.history_label.pack(anchor="w", padx=18, pady=(0, 4))

        self.history_frame = ctk.CTkScrollableFrame(
            self, fg_color="transparent", scrollbar_button_color=theme.COLORS["bg_sidebar_item_active"],
        )
        self.history_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        # --- Stato indicizzazione ---
        self.status_label = theme.label(self, "", size=10, color="text_secondary")
        self.status_label.pack(anchor="w", padx=18, pady=(0, 4))

        # --- Impostazioni ---
        self.btn_settings = theme.sidebar_button(
            self, "Impostazioni", image=icons.get_icon("gear", ICON_COLOR, 18), command=self._open_settings,
        )
        self.btn_settings.pack(fill="x", padx=14, pady=(0, 16))

    # ------------------------------------------------------------------
    def toggle_collapsed(self) -> None:
        self._collapsed = not self._collapsed
        self._apply_collapsed_state()

    def _apply_collapsed_state(self) -> None:
        collapsed = self._collapsed
        self.configure(width=WIDTH_COLLAPSED if collapsed else WIDTH_EXPANDED)

        self.collapse_button.configure(
            image=icons.get_icon("chevron_right" if collapsed else "chevron_left", ICON_COLOR, 16)
        )

        if collapsed:
            self.title_label.grid_remove()
            self.history_label.pack_forget()
            self.history_frame.pack_forget()
            self.status_label.configure(text="")
        else:
            # Il titolo era stato nascosto con grid_remove() (era gestito da
            # grid dentro top_row): lo ripristiniamo con grid().
            self.title_label.grid(row=0, column=0, sticky="w")
            self.history_label.pack(anchor="w", padx=18, pady=(0, 4))
            self.history_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        for btn, text, icon_name in (
            (self.btn_chat, "Chat", "chat"),
            (self.btn_tutor, "Modalità Insegnamento", "graduation_cap"),
        ):
            is_active_env = (icon_name == "chat" and self._current_env == "chat") or (
                icon_name == "graduation_cap" and self._current_env == "tutor"
            )
            btn.configure(
                text="" if collapsed else text,
                anchor="center" if collapsed else "w",
                image=icons.get_icon(
                    icon_name,
                    theme.COLORS["text_on_orange"] if is_active_env else ICON_COLOR,
                    18,
                ),
            )

        self.btn_new_chat.configure(text="" if collapsed else "Nuova chat", anchor="center" if collapsed else "w")
        self.btn_settings.configure(text="" if collapsed else "Impostazioni", anchor="center" if collapsed else "w")

    # ------------------------------------------------------------------
    def _switch(self, env: str) -> None:
        self._current_env = env
        for btn, key in ((self.btn_chat, "chat"), (self.btn_tutor, "tutor")):
            active = env == key
            icon_name = "chat" if key == "chat" else "graduation_cap"
            btn.configure(
                fg_color=theme.COLORS["bg_sidebar_item_active"] if active else theme.COLORS["bg_sidebar_item"],
                font=theme.font(12, "bold" if active else "normal"),
                image=icons.get_icon(icon_name, theme.COLORS["text_on_orange"] if active else ICON_COLOR, 18),
            )
        self._on_switch_env(env)

    def _new_chat(self) -> None:
        self._on_new_chat(self._current_env)

    def _open_settings(self) -> None:
        self._on_open_settings()

    def set_status(self, text: str) -> None:
        if not self._collapsed:
            self.status_label.configure(text=text)

    def populate_history(self, chats, active_chat_id=None) -> None:
        """chats: lista di sqlite3.Row con colonne id, titolo."""
        for btn in self._chat_buttons:
            btn.destroy()
        self._chat_buttons = []

        if self._collapsed:
            return

        for chat in chats:
            is_active = chat["id"] == active_chat_id
            btn = theme.sidebar_button(
                self.history_frame,
                chat["titolo"][:34] + ("…" if len(chat["titolo"]) > 34 else ""),
                command=lambda cid=chat["id"]: self._on_select_chat(cid),
                active=is_active,
            )
            btn.pack(fill="x", pady=3)
            self._chat_buttons.append(btn)

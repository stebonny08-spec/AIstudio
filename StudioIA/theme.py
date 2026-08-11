"""
theme.py
--------
Unica fonte di verità per i colori e gli stili dell'applicazione.

Perché questo file esiste:
Invece di scrivere colori "a mano" sparsi in ogni file della GUI (rischio di
incoerenze e refactoring dolorosi), ogni widget prende i colori da qui.
Se in futuro si vuole cambiare la palette, si cambia SOLO questo file.

Nota tecnica: non usiamo un tema JSON custom di CustomTkinter (ctk.set_default_color_theme)
perché il suo schema è rigido e un errore al suo interno farebbe crashare l'app
all'avvio. Preferiamo passare i colori esplicitamente a ogni widget tramite le
funzioni helper qui sotto: più codice, ma molto più robusto e prevedibile.
"""

import customtkinter as ctk

# ---------------------------------------------------------------------------
# PALETTE
# ---------------------------------------------------------------------------
COLORS = {
    # Sfondi (azzurro pastello, diverse tonalità per creare profondità)
    "bg_main": "#DCEEF6",        # sfondo area centrale (chat)
    "bg_sidebar": "#BFE0EE",     # sfondo barra laterale
    "bg_card": "#EFF8FC",        # sfondo "carte" / bolle IA
    "bg_input": "#FFFFFF",       # sfondo campi di input
    "bg_sidebar_item": "#AED6E8",  # sfondo pulsanti storico chat (non selezionati)
    "bg_sidebar_item_active": "#94C9E0",  # pulsante storico chat selezionato / ambiente attivo

    # Bordi
    "border_normal": "#A9D3E5",  # bordo ambiente Chat Normale
    "border_tutor": "#E8C77E",   # bordo ambiente Tutor (tonalità calda, dedicata)

    # Arancione pastello (bottoni principali, azioni)
    "accent_orange": "#FFAD66",
    "accent_orange_hover": "#FF934D",
    "accent_orange_pressed": "#F0813A",

    # Testo
    "text_primary": "#28414D",
    "text_secondary": "#5C7A8A",
    "text_on_orange": "#FFFFFF",
    "text_muted": "#8AA6B3",

    # Bolle chat
    "bubble_user": "#FFFFFF",
    "bubble_ai": "#EAF6FC",
    "bubble_ai_tutor": "#FBF3E0",

    # Stati
    "success": "#7FC8A9",
    "error": "#E88989",
    "warning": "#F2C572",
}

FONT_FAMILY = "Segoe UI"


def font(size: int = 13, weight: str = "normal") -> ctk.CTkFont:
    """Ritorna un font coerente con il resto dell'app.
    Se 'Segoe UI' non è disponibile sul sistema, Tkinter ripiega
    automaticamente su un font di sistema simile: nessun crash.
    """
    return ctk.CTkFont(family=FONT_FAMILY, size=size, weight=weight)


# ---------------------------------------------------------------------------
# WIDGET HELPER
# Funzioni di fabbrica per creare widget già colorati in modo coerente.
# ---------------------------------------------------------------------------

def primary_button(parent, text, command=None, **kwargs) -> ctk.CTkButton:
    """Pulsante arancione pastello: azioni principali (Invia, Salva, Sfoglia, Microfono...)."""
    defaults = dict(
        fg_color=COLORS["accent_orange"],
        hover_color=COLORS["accent_orange_hover"],
        text_color=COLORS["text_on_orange"],
        corner_radius=10,
        font=font(13, "bold"),
        border_width=0,
    )
    defaults.update(kwargs)
    return ctk.CTkButton(parent, text=text, command=command, **defaults)


def sidebar_button(parent, text, command=None, active=False, **kwargs) -> ctk.CTkButton:
    """Pulsante per la sidebar (switch ambiente, voci storico chat)."""
    bg = COLORS["bg_sidebar_item_active"] if active else COLORS["bg_sidebar_item"]
    defaults = dict(
        fg_color=bg,
        hover_color=COLORS["accent_orange_hover"] if active else COLORS["bg_sidebar_item_active"],
        text_color=COLORS["text_primary"],
        corner_radius=8,
        anchor="w",
        font=font(12, "bold" if active else "normal"),
        border_width=0,
    )
    defaults.update(kwargs)
    return ctk.CTkButton(parent, text=text, command=command, **defaults)


def frame(parent, bg="main", **kwargs) -> ctk.CTkFrame:
    """Frame con sfondo coerente. bg può essere 'main', 'sidebar', 'card'."""
    key = {"main": "bg_main", "sidebar": "bg_sidebar", "card": "bg_card"}.get(bg, "bg_main")
    defaults = dict(fg_color=COLORS[key], corner_radius=0)
    defaults.update(kwargs)
    return ctk.CTkFrame(parent, **defaults)


def label(parent, text, size=13, weight="normal", color="text_primary", **kwargs) -> ctk.CTkLabel:
    defaults = dict(
        text=text,
        text_color=COLORS.get(color, color),
        font=font(size, weight),
        fg_color="transparent",
    )
    defaults.update(kwargs)
    return ctk.CTkLabel(parent, **defaults)


def entry(parent, placeholder="", **kwargs) -> ctk.CTkEntry:
    defaults = dict(
        fg_color=COLORS["bg_input"],
        text_color=COLORS["text_primary"],
        placeholder_text=placeholder,
        border_color=COLORS["border_normal"],
        corner_radius=8,
        font=font(13),
    )
    defaults.update(kwargs)
    return ctk.CTkEntry(parent, **defaults)

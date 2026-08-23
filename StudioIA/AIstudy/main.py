"""
main.py
--------
Punto d'ingresso dell'applicazione desktop StudioIA (interfaccia nativa
CustomTkinter, 100% locale).

Esecuzione: `python main.py`, lanciato dalla cartella principale del progetto.
"""

import sys
from pathlib import Path

# Aggiungi il percorso corrente al path di sistema
sys.path.insert(0, str(Path(__file__).parent))

import customtkinter as ctk

from gui.app_window import App


def main() -> None:
    ctk.set_appearance_mode("Light")
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()

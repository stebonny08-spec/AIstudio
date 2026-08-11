"""
main.py
--------
Punto d'ingresso dell'applicazione desktop.

Esecuzione: `python main.py`, lanciato dalla cartella principale del progetto.
"""

import customtkinter as ctk

from gui.app_window import App


def main() -> None:
    # Blocchiamo la modalità "Light" a prescindere dal tema del sistema
    # operativo: la palette azzurro/arancione pastello è pensata per
    # funzionare in modo coerente solo su sfondo chiaro.
    ctk.set_appearance_mode("Light")

    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()

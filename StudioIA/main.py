"""
main.py
--------
Punto d'ingresso dell'applicazione desktop ibrida.
Utilizza pywebview per mostrare un'interfaccia web moderna (HTML/CSS/JS)
comunicando con un backend Python tramite API locale.

Esecuzione: `python main.py`, lanciato dalla cartella principale del progetto.
"""

import sys
import os
from pathlib import Path

# Aggiungi il percorso corrente al path di sistema
sys.path.insert(0, str(Path(__file__).parent))

try:
    import webview
    
    from backend.api import StudioIAAPI
    
    def main() -> None:
        """Avvia l'applicazione desktop con interfaccia web"""
        
        # Crea l'istanza dell'API backend
        api = StudioIAAPI()
        
        # Ottieni il percorso del frontend
        frontend_dir = Path(__file__).parent / 'web_frontend' / 'html'
        index_path = frontend_dir / 'index.html'
        
        if not index_path.exists():
            print(f"Errore: file index.html non trovato in {frontend_dir}")
            return
        
        # Crea la finestra dell'applicazione
        window = webview.create_window(
            title='StudioIA - AI per lo Studio',
            url=f'file://{index_path}',
            js_api=api,
            width=1280,
            height=800,
            min_size=(800, 600),
            resizable=True,
            fullscreen=False,
            text_select=True,
            background_color='#FDFCF5'
        )
        
        # Avvia l'applicazione
        webview.start(
            debug=False,  # Imposta a True per abilitare gli strumenti di sviluppo
            gui='qt'  # Usa Qt per una migliore integrazione desktop
        )
    
    if __name__ == "__main__":
        main()

except ImportError as e:
    # Fallback a tkinter se pywebview non è disponibile
    print(f"pywebview non disponibile: {e}")
    print("Uso fallback su tkinter...")
    
    import customtkinter as ctk
    from gui.app_window import App
    
    def main() -> None:
        ctk.set_appearance_mode("Light")
        app = App()
        app.mainloop()
    
    if __name__ == "__main__":
        main()


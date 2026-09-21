"""
main.py
--------
Punto d'ingresso dell'applicazione desktop NovaStudio: apre una finestra
nativa (pywebview) che carica l'interfaccia in web_frontend/, collegata
al bridge Python in backend/api.py.

E' un'app desktop a tutti gli effetti: finestra propria con la sua icona
nella barra delle applicazioni, nessun browser coinvolto. L'interfaccia è
HTML/CSS/JS solo per la resa grafica; tutta la logica (LLM, RAG, database,
file) gira in Python, in locale, sul PC dell'utente.

Esecuzione: `python main.py`, lanciato dalla cartella principale del progetto.
"""

import sys
from pathlib import Path

# Aggiungi il percorso corrente al path di sistema
sys.path.insert(0, str(Path(__file__).parent))

import webview

from backend.api import StudioIAAPI

BASE_DIR = Path(__file__).parent
INDEX_HTML = BASE_DIR / "web_frontend" / "html" / "index.html"


def main() -> None:
    api = StudioIAAPI()

    webview.create_window(
        "NovaStudio — Assistente locale",
        url=str(INDEX_HTML),
        js_api=api,
        width=1180,
        height=760,
        min_size=(900, 600),
        background_color="#1a1f2e",
    )
    webview.start()


if __name__ == "__main__":
    main()

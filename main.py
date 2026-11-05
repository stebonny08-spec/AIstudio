"""
main.py
--------
Punto d'ingresso dell'applicazione desktop NovaStudio: apre una finestra
nativa (pywebview) che carica l'interfaccia in web_frontend/, collegata
al bridge Python in backend/api.py.

Il modello LLM viene caricato in memoria in un thread di background
subito dopo la creazione della finestra: la UI mostra una barra di
progresso reale mentre il modello viene caricato.

Esecuzione: `python main.py`, lanciato dalla cartella principale del progetto.
"""

import sys
from pathlib import Path

# Encoding stdout/stderr forzato a UTF-8: su Windows (cp1252) i print con
# frecce/simboli (es. "→" di describe_auto_choice) altrimenti lanciano
# UnicodeEncodeError e l'app crasha all'avvio. errors="replace" degrada
# in modo sicuro invece di interrompere l'esecuzione.
if getattr(sys.stdout, "reconfigure", None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).parent))

import webview

from backend.api import StudioIAAPI

BASE_DIR = Path(__file__).parent

if getattr(sys, "frozen", False):
    BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
else:
    BUNDLE_DIR = BASE_DIR

INDEX_HTML = BUNDLE_DIR / "web_frontend" / "html" / "index.html"


def main() -> None:
    api = StudioIAAPI()

    webview.create_window(
        "NovaStudio — Assistente locale",
        # Caricamento via file:// URI: con il path letterale pywebview6 serve
        # la pagina tramite il suo server HTTP locale, che con molti file
        # statici perde alcune richieste e la UI monta a volte parziale.
        url=INDEX_HTML.as_uri(),
        js_api=api,
        width=1180,
        height=760,
        min_size=(900, 600),
        background_color="#1a1f2e",
    )

    # Avvia il caricamento del modello in background DOPO che la finestra
    # è stata creata e PRIMA che parta il loop della GUI. Così la UI
    # può già pollare get_model_status() e mostrare la barra.
    api.start_background_model_load()

    webview.start()


if __name__ == "__main__":
    main()
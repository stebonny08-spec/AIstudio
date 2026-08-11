"""
ui_i18n.py
Traduzione in italiano, lato client, delle voci del menu nativo di Streamlit
(quello che si apre cliccando sui tre puntini "⋮" in alto a destra) e della
finestra "Impostazioni" collegata.

Streamlit non espone un'API per tradurre queste etichette (sono definite nel
frontend gia' compilato), quindi si usa uno script iniettato che osserva il
DOM della pagina e sostituisce il testo delle voci conosciute non appena
compaiono. Se una futura versione di Streamlit cambiasse le etichette
originali, la relativa voce smetterebbe semplicemente di essere tradotta
(nessun errore, nessun crash dell'app): basterebbe aggiornare la mappa qui
sotto.

Il pulsante "Deploy" NON viene gestito da questo modulo: viene rimosso in
modo nativo e ufficiale tramite l'opzione `client.toolbarMode = "viewer"` in
.streamlit/config.toml, molto piu' robusto di un intervento lato JavaScript.
"""
from __future__ import annotations

import json

# Mappa "testo originale (inglese)" -> "traduzione italiana".
# Il confronto avviene sul testo esatto (case-sensitive), dopo il trim degli spazi.
MENU_TRANSLATIONS = {
    # Voci del menu "⋮"
    "Rerun": "Riesegui",
    "Always rerun": "Riesegui sempre",
    "Settings": "Impostazioni",
    "Record a screencast": "Registra uno screencast",
    "Print": "Stampa",
    "About": "Informazioni",
    "Get help": "Assistenza",
    "Report a bug": "Segnala un problema",
    "Developer options": "Opzioni sviluppatore",
    "Clear cache": "Svuota cache",
    # Voci della finestra "Impostazioni"
    "Wide mode": "Modalità estesa",
    "Run on save": "Esegui al salvataggio",
    "Theme": "Tema",
    "Light": "Chiaro",
    "Dark": "Scuro",
    "Use system setting": "Usa impostazioni di sistema",
    "Custom theme": "Tema personalizzato",
    "Close": "Chiudi",
}


def get_menu_translation_script() -> str:
    """
    Restituisce un blocco HTML/JS da iniettare (via st.components.v1.html) per
    tradurre in italiano il menu nativo di Streamlit. Lo script:
    - accede al documento della pagina "padre" (la app gira in un iframe),
    - osserva il DOM con un MutationObserver e traduce i nodi di testo noti,
    - si auto-installa una sola volta per evitare osservatori duplicati ad
      ogni rerun di Streamlit.
    """
    translations_json = json.dumps(MENU_TRANSLATIONS, ensure_ascii=False)

    return f"""
    <script>
    (function() {{
        try {{
            const targetWin = (window.parent && window.parent !== window) ? window.parent : window;
            if (targetWin.__appunti2pdf_i18n_installed) {{
                return;
            }}

            const translations = {translations_json};

            function translateNode(node) {{
                if (!node) return;
                if (node.nodeType === 3) {{ // Node.TEXT_NODE
                    const trimmed = node.textContent.trim();
                    if (trimmed && Object.prototype.hasOwnProperty.call(translations, trimmed)) {{
                        node.textContent = node.textContent.replace(trimmed, translations[trimmed]);
                    }}
                    return;
                }}
                if (node.nodeType === 1 && node.childNodes) {{ // Node.ELEMENT_NODE
                    node.childNodes.forEach(translateNode);
                }}
            }}

            function translateAll(root) {{
                try {{
                    translateNode(root);
                }} catch (err) {{
                    // Una traduzione mancata e' puramente cosmetica: non deve mai rompere l'app
                    console.debug("Appunti2PDF: traduzione menu non riuscita", err);
                }}
            }}

            function attachObserver() {{
                const targetDoc = targetWin.document;
                if (!targetDoc || !targetDoc.body) {{
                    return false;
                }}
                translateAll(targetDoc.body);
                const observer = new MutationObserver(function(mutations) {{
                    mutations.forEach(function(mutation) {{
                        mutation.addedNodes.forEach(translateNode);
                    }});
                }});
                observer.observe(targetDoc.body, {{ childList: true, subtree: true }});
                targetWin.__appunti2pdf_i18n_installed = true;
                return true;
            }}

            if (!attachObserver()) {{
                const retryInterval = setInterval(function() {{
                    if (attachObserver()) {{
                        clearInterval(retryInterval);
                    }}
                }}, 300);
                // Non riprovare all'infinito se qualcosa va storto
                setTimeout(function() {{ clearInterval(retryInterval); }}, 15000);
            }}
        }} catch (err) {{
            console.debug("Appunti2PDF: inizializzazione traduzione menu non riuscita", err);
        }}
    }})();
    </script>
    """

"""
core/web_search.py
--------------------
Ricerca sul web tramite DuckDuckGo, usando la libreria 'ddgs' (il pacchetto
è stato rinominato da 'duckduckgo-search' a 'ddgs' dai suoi sviluppatori:
usiamo direttamente il nome nuovo per evitare l'avviso di deprecazione).
Gratuita, non richiede alcuna chiave API.
"""

from typing import List

from core.models import WebResult

DEFAULT_MAX_RESULTS = 5
DEFAULT_TIMEOUT_SECONDS = 10


def search_web(query: str, max_results: int = DEFAULT_MAX_RESULTS) -> List[WebResult]:
    """Esegue una ricerca testuale su DuckDuckGo. Ritorna una lista vuota
    (mai un'eccezione verso il chiamante) in caso di problemi di rete o
    servizio momentaneamente non disponibile: il router può così gestire
    con calma il caso "nessun risultato" invece di crashare.
    """
    if not query.strip():
        return []

    try:
        from ddgs import DDGS

        with DDGS(timeout=DEFAULT_TIMEOUT_SECONDS) as ddgs:
            raw_results = ddgs.text(query, max_results=max_results)
    except Exception as e:
        print(f"[web_search] Ricerca web fallita: {e}")
        return []

    results = []
    for item in raw_results or []:
        results.append(
            WebResult(
                title=item.get("title", ""),
                url=item.get("href", ""),
                snippet=item.get("body", ""),
            )
        )
    return results

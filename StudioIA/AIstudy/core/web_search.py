"""
core/web_search.py
--------------------
LIVELLO 3 del RAG: ricerca sul web tramite DuckDuckGo (libreria 'ddgs',
gratuita, nessuna chiave API), ma NON su tutto il web genericamente.

La ricerca è ristretta all'elenco di fonti affidabili predefinito in
core/trusted_sources.py (enciclopedie, motori accademici, siti di
fact-checking, risorse governative, piattaforme educative...). Una
singola query con troppi filtri "site:" in OR rischia di essere ignorata
o troncata dal motore di ricerca, quindi i domini vengono interrogati a
piccoli gruppi (batch): i risultati di ogni gruppo si accumulano finché
non se ne raccolgono abbastanza, rispettando l'ordine di priorità delle
categorie definito in trusted_sources.py.
"""

from typing import List

from core.models import WebResult
from core.trusted_sources import all_domains

DEFAULT_MAX_RESULTS = 5
DEFAULT_TIMEOUT_SECONDS = 10
DOMAINS_PER_BATCH = 6


def _batched(items: List[str], size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def search_web(query: str, max_results: int = DEFAULT_MAX_RESULTS) -> List[WebResult]:
    """Esegue una ricerca testuale su DuckDuckGo, ristretta ai domini
    definiti in core/trusted_sources.py. Ritorna una lista vuota (mai
    un'eccezione verso il chiamante) in caso di problemi di rete o
    servizio momentaneamente non disponibile: il router può così gestire
    con calma il caso "nessun risultato" invece di crashare.
    """
    if not query.strip():
        return []

    try:
        from ddgs import DDGS
    except Exception as e:
        print(f"[web_search] Libreria di ricerca non disponibile: {e}")
        return []

    results: List[WebResult] = []
    seen_urls = set()
    domains = all_domains()

    with DDGS(timeout=DEFAULT_TIMEOUT_SECONDS) as ddgs:
        for domain_batch in _batched(domains, DOMAINS_PER_BATCH):
            if len(results) >= max_results:
                break

            site_filter = " OR ".join(f"site:{d}" for d in domain_batch)
            batch_query = f"{query} ({site_filter})"

            try:
                raw_results = ddgs.text(batch_query, max_results=max_results)
            except Exception as e:
                # Un gruppo di domini che fallisce (timeout, rate limit) non
                # deve interrompere la ricerca sugli altri gruppi.
                print(f"[web_search] Ricerca fallita per un gruppo di fonti: {e}")
                continue

            for item in raw_results or []:
                url = item.get("href", "")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                results.append(
                    WebResult(
                        title=item.get("title", ""),
                        url=url,
                        snippet=item.get("body", ""),
                    )
                )
                if len(results) >= max_results:
                    break

    return results

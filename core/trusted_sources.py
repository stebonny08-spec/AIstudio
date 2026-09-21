"""
core/trusted_sources.py
--------------------------
Elenco curato dei siti che il LIVELLO 3 del RAG (ricerca online) può
consultare. La ricerca web NON è una ricerca generica su tutto il web:
è ristretta a queste fonti, organizzate per categoria.

Le categorie sono interrogate nell'ordine in cui compaiono qui sotto
(prima le enciclopedie, poi i motori accademici, ecc.): è un ordine di
priorità pensato per uno studente, non un vincolo tecnico rigido.

Per aggiungere, rimuovere o correggere un sito, modifica solo questa
lista: core/web_search.py la usa così com'è, senza bisogno di altre
modifiche altrove.

Nota: alcuni domini istituzionali cambiano nel tempo (es. ministeri che
vengono rinominati/riorganizzati). Se una fonte smette di restituire
risultati, è la prima cosa da controllare.
"""

from typing import NamedTuple, List


class TrustedSource(NamedTuple):
    name: str
    domain: str
    category: str


TRUSTED_SOURCES: List[TrustedSource] = [
    # --- Enciclopedie e dizionari ---
    TrustedSource("Treccani", "treccani.it", "Enciclopedie e dizionari"),
    TrustedSource("Sapere.it", "sapere.it", "Enciclopedie e dizionari"),
    TrustedSource("Enciclopedia Britannica", "britannica.com", "Enciclopedie e dizionari"),

    # --- Motori di ricerca accademici ---
    TrustedSource("Google Scholar", "scholar.google.com", "Motori di ricerca accademici"),
    TrustedSource("JSTOR", "jstor.org", "Motori di ricerca accademici"),

    # --- Fact-checking e verifica delle notizie (Italia) ---
    TrustedSource("Facta.news", "facta.news", "Fact-checking e verifica delle notizie"),
    TrustedSource("Pagella Politica", "pagellapolitica.it", "Fact-checking e verifica delle notizie"),
    TrustedSource("Bufale.net", "bufale.net", "Fact-checking e verifica delle notizie"),
    TrustedSource("IDMO - Italian Digital Media Observatory", "idmo.it", "Fact-checking e verifica delle notizie"),

    # --- Risorse governative e dati ufficiali (Italia) ---
    TrustedSource("Ministero dell'Istruzione", "istruzione.it", "Risorse governative e dati ufficiali"),
    TrustedSource("ISTAT", "istat.it", "Risorse governative e dati ufficiali"),

    # --- Motori di ricerca accademici e database internazionali ---
    TrustedSource("ERIC (Education Resources Information Center)", "eric.ed.gov", "Database accademici internazionali"),
    TrustedSource("PubMed", "pubmed.ncbi.nlm.nih.gov", "Database accademici internazionali"),
    TrustedSource("BASE (Bielefeld Academic Search Engine)", "base-search.net", "Database accademici internazionali"),
    TrustedSource("CORE", "core.ac.uk", "Database accademici internazionali"),

    # --- Fact-checking internazionali ---
    TrustedSource("Snopes", "snopes.com", "Fact-checking internazionali"),
    TrustedSource("PolitiFact", "politifact.com", "Fact-checking internazionali"),
    TrustedSource("FactCheck.org", "factcheck.org", "Fact-checking internazionali"),

    # --- Piattaforme educative e open access ---
    TrustedSource("Khan Academy", "khanacademy.org", "Piattaforme educative e open access"),
    TrustedSource("OpenStax", "openstax.org", "Piattaforme educative e open access"),
]


def all_domains() -> List[str]:
    """Tutti i domini, nell'ordine di priorità in cui sono definiti sopra."""
    return [s.domain for s in TRUSTED_SOURCES]

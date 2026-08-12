"""
core/online_search.py
----------------------
Ricerca online specializzata su siti autorevoli selezionati per il terzo layer del RAG.
Supporta diverse categorie di fonti:
- Enciclopedie e dizionari (Treccani, Sapere, Britannica)
- Motori di ricerca accademici (Google Scholar, JSTOR, ERIC, PubMed, BASE, CORE)
- Fact-checking (Facta.news, Pagella Politica, Bufale.net, IDMO, Snopes, PolitiFact, FactCheck.org)
- Risorse governative (MIUR, ISTAT)
- Piattaforme educative (Khan Academy, OpenStax)

Ogni categoria ha strategie di ricerca ottimizzate per il tipo di fonte.
"""

from typing import List, Dict, Optional
from dataclasses import dataclass
from enum import Enum
import requests
from urllib.parse import quote_plus, urlparse
import re
from bs4 import BeautifulSoup

from core.models import WebResult


class SourceCategory(Enum):
    """Categorie di fonti supportate."""
    ENCYCLOPEDIA = "encyclopedia"
    ACADEMIC = "academic"
    FACT_CHECKING = "fact_checking"
    GOVERNMENT = "government"
    EDUCATIONAL = "educational"


@dataclass
class SourceConfig:
    """Configurazione per una fonte specifica."""
    name: str
    base_url: str
    category: SourceCategory
    search_url_pattern: str  # URL con {query} come placeholder
    language: str = "it"
    description: str = ""
    enabled: bool = True


# Configurazione delle fonti supportate
SOURCES_CONFIG: List[SourceConfig] = [
    # Enciclopedie e dizionari
    SourceConfig(
        name="Treccani",
        base_url="https://www.treccani.it",
        search_url_pattern="https://www.treccani.it/enciclopedia/{query}/",
        category=SourceCategory.ENCYCLOPEDIA,
        language="it",
        description="Enciclopedia italiana curata da esperti"
    ),
    SourceConfig(
        name="Sapere.it",
        base_url="https://www.sapere.it",
        search_url_pattern="https://www.sapere.it/enciclopedia/{query}.html",
        category=SourceCategory.ENCYCLOPEDIA,
        language="it",
        description="Enciclopedia De Agostini"
    ),
    SourceConfig(
        name="Britannica",
        base_url="https://www.britannica.com",
        search_url_pattern="https://www.britannica.com/search?query={query}",
        category=SourceCategory.ENCYCLOPEDIA,
        language="en",
        description="Enciclopedia internazionale rispettata"
    ),
    
    # Motori di ricerca accademici
    SourceConfig(
        name="Google Scholar",
        base_url="https://scholar.google.com",
        search_url_pattern="https://scholar.google.com/scholar?q={query}",
        category=SourceCategory.ACADEMIC,
        language="en",
        description="Motore di ricerca per letteratura accademica"
    ),
    SourceConfig(
        name="JSTOR",
        base_url="https://www.jstor.org",
        search_url_pattern="https://www.jstor.org/action/doBasicSearch?Query={query}",
        category=SourceCategory.ACADEMIC,
        language="en",
        description="Biblioteca digitale di riviste accademiche"
    ),
    SourceConfig(
        name="ERIC",
        base_url="https://eric.ed.gov",
        search_url_pattern="https://eric.ed.gov/?q={query}",
        category=SourceCategory.ACADEMIC,
        language="en",
        description="Database di letteratura educativa"
    ),
    SourceConfig(
        name="PubMed",
        base_url="https://pubmed.ncbi.nlm.nih.gov",
        search_url_pattern="https://pubmed.ncbi.nlm.nih.gov/?term={query}",
        category=SourceCategory.ACADEMIC,
        language="en",
        description="Letteratura biomedica"
    ),
    SourceConfig(
        name="BASE",
        base_url="https://www.base-search.net",
        search_url_pattern="https://www.base-search.net/Search/Results?lookfor={query}",
        category=SourceCategory.ACADEMIC,
        language="en",
        description="Motore di ricerca per documenti accademici open access"
    ),
    SourceConfig(
        name="CORE",
        base_url="https://core.ac.uk",
        search_url_pattern="https://core.ac.uk/search?q={query}",
        category=SourceCategory.ACADEMIC,
        language="en",
        description="Articoli accademici da repository mondiali"
    ),
    
    # Fact-checking
    SourceConfig(
        name="Facta.news",
        base_url="https://facta.news",
        search_url_pattern="https://facta.news/?s={query}",
        category=SourceCategory.FACT_CHECKING,
        language="it",
        description="Fact-checking indipendente italiano"
    ),
    SourceConfig(
        name="Pagella Politica",
        base_url="https://pagellapolitica.it",
        search_url_pattern="https://pagellapolitica.it/search?q={query}",
        category=SourceCategory.FACT_CHECKING,
        language="it",
        description="Verifica dichiarazioni politiche"
    ),
    SourceConfig(
        name="Bufale.net",
        base_url="https://www.bufale.net",
        search_url_pattern="https://www.bufale.net/?s={query}",
        category=SourceCategory.FACT_CHECKING,
        language="it",
        description="Fact-checking contro disinformazione"
    ),
    SourceConfig(
        name="IDMO",
        base_url="https://idmo.eu",
        search_url_pattern="https://idmo.eu/?s={query}",
        category=SourceCategory.FACT_CHECKING,
        language="it",
        description="Osservatorio italiano sulla disinformazione"
    ),
    SourceConfig(
        name="Snopes",
        base_url="https://www.snopes.com",
        search_url_pattern="https://www.snopes.com/?s={query}",
        category=SourceCategory.FACT_CHECKING,
        language="en",
        description="Il più antico sito di fact-checking"
    ),
    SourceConfig(
        name="PolitiFact",
        base_url="https://www.politifact.com",
        search_url_pattern="https://www.politifact.com/search/?q={query}",
        category=SourceCategory.FACT_CHECKING,
        language="en",
        description="Fact-checking politico vincitore del Pulitzer"
    ),
    SourceConfig(
        name="FactCheck.org",
        base_url="https://www.factcheck.org",
        search_url_pattern="https://www.factcheck.org/?s={query}",
        category=SourceCategory.FACT_CHECKING,
        language="en",
        description="Monitoraggio accuratezza dichiarazioni politiche"
    ),
    
    # Risorse governative
    SourceConfig(
        name="MIUR",
        base_url="https://www.miur.gov.it",
        search_url_pattern="https://www.miur.gov.it/web/guest?p_p_lifecycle=2&p_p_state=pop_up&p_p_mode=view&p_p_col_id=column-1&p_p_col_pos=1&p_p_col_count=2&_com_liferay_portlet_webcontent_display_web_portlet_WebContentDisplayPortlet_doPreview=true&_com_liferay_portlet_webcontent_web_portlet_WebContentPortlet_groupId=20156&_com_liferay_portlet_webcontent_web_portlet_WebContentPortlet_articleId=&_com_liferay_portlet_webcontent_web_portlet_WebContentPortlet_keywords={query}",
        category=SourceCategory.GOVERNMENT,
        language="it",
        description="Ministero dell'Istruzione italiano"
    ),
    SourceConfig(
        name="ISTAT",
        base_url="https://www.istat.it",
        search_url_pattern="https://www.istat.it/it/cerca?query={query}",
        category=SourceCategory.GOVERNMENT,
        language="it",
        description="Istituto Nazionale di Statistica"
    ),
    
    # Piattaforme educative
    SourceConfig(
        name="Khan Academy",
        base_url="https://www.khanacademy.org",
        search_url_pattern="https://www.khanacademy.org/search?page_search_query={query}",
        category=SourceCategory.EDUCATIONAL,
        language="en",
        description="Lezioni ed esercizi gratuiti"
    ),
    SourceConfig(
        name="OpenStax",
        base_url="https://openstax.org",
        search_url_pattern="https://openstax.org/search?query={query}",
        category=SourceCategory.EDUCATIONAL,
        language="en",
        description="Libri di testo universitari gratuiti"
    ),
]


class OnlineSearchEngine:
    """
    Motore di ricerca online specializzato per il terzo layer del RAG.
    Cerca su fonti autorevoli selezionate in base alla categoria della query.
    """
    
    DEFAULT_TIMEOUT = 10
    DEFAULT_MAX_RESULTS_PER_SOURCE = 2
    
    def __init__(self, enabled_sources: Optional[List[str]] = None):
        """
        enabled_sources: lista di nomi di fonti da abilitare.
                        Se None, usa tutte le fonti abilitate di default.
        """
        self.enabled_sources = set(enabled_sources) if enabled_sources else None
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
    
    def search_by_category(
        self, 
        query: str, 
        categories: Optional[List[SourceCategory]] = None,
        max_results: int = DEFAULT_MAX_RESULTS_PER_SOURCE
    ) -> List[WebResult]:
        """
        Esegue ricerca filtrando per categorie di fonti.
        
        Args:
            query: testo della ricerca
            categories: liste di categorie da includere. Se None, usa tutte.
            max_results: numero massimo di risultati per fonte
        
        Returns:
            Lista di WebResult ordinati per rilevanza
        """
        if not query.strip():
            return []
        
        if categories is None:
            categories = list(SourceCategory)
        
        results = []
        
        for source in SOURCES_CONFIG:
            if not source.enabled:
                continue
            
            if self.enabled_sources and source.name not in self.enabled_sources:
                continue
            
            if source.category not in categories:
                continue
            
            try:
                source_results = self._search_single_source(source, query, max_results)
                results.extend(source_results)
            except Exception as e:
                print(f"[online_search] Errore nella ricerca su {source.name}: {e}")
                continue
        
        # Ordina i risultati per lunghezza dello snippet (indicatore di completezza)
        results.sort(key=lambda r: len(r.snippet), reverse=True)
        
        return results
    
    def _search_single_source(
        self, 
        source: SourceConfig, 
        query: str, 
        max_results: int
    ) -> List[WebResult]:
        """
        Esegue ricerca su una singola fonte.
        Nota: questa implementazione usa un approccio semplificato basato su URL diretti.
        Per alcune fonti potrebbe essere necessario scraping più sofisticato o API ufficiali.
        """
        encoded_query = quote_plus(query)
        search_url = source.search_url_pattern.format(query=encoded_query)
        
        results = []
        
        try:
            response = self.session.get(search_url, timeout=self.DEFAULT_TIMEOUT)
            response.raise_for_status()
            
            # Parsing HTML per estrarre risultati
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Estrazione risultati specifica per tipo di fonte
            extracted = self._extract_results_from_html(soup, source, query)
            
            for item in extracted[:max_results]:
                results.append(WebResult(
                    title=item.get('title', f"Risultato da {source.name}"),
                    url=item.get('url', search_url),
                    snippet=item.get('snippet', '')
                ))
        
        except requests.RequestException as e:
            print(f"[online_search] Richiesta fallita per {source.name}: {e}")
        
        return results
    
    def _extract_results_from_html(
        self, 
        soup: BeautifulSoup, 
        source: SourceConfig, 
        query: str
    ) -> List[Dict]:
        """
        Estrae risultati dalla pagina HTML in modo specifico per ciascuna fonte.
        Implementazione semplificata - può essere estesa per ogni fonte.
        """
        results = []
        
        # Strategie di estrazione generiche basate sul tipo di fonte
        if source.category == SourceCategory.ENCYCLOPEDIA:
            results = self._extract_encyclopedia_results(soup, source, query)
        elif source.category == SourceCategory.ACADEMIC:
            results = self._extract_academic_results(soup, source, query)
        elif source.category == SourceCategory.FACT_CHECKING:
            results = self._extract_factcheck_results(soup, source, query)
        elif source.category == SourceCategory.GOVERNMENT:
            results = self._extract_government_results(soup, source, query)
        elif source.category == SourceCategory.EDUCATIONAL:
            results = self._extract_educational_results(soup, source, query)
        
        return results
    
    def _extract_encyclopedia_results(self, soup: BeautifulSoup, source: SourceConfig, query: str) -> List[Dict]:
        """Estrae risultati da enciclopedie."""
        results = []
        
        # Treccani
        if source.name == "Treccani":
            for item in soup.select('.result-item, .lemma-title, h3 a')[:3]:
                results.append({
                    'title': item.get_text(strip=True),
                    'url': item.get('href', '') if item.has_attr('href') else source.base_url,
                    'snippet': f"Voce enciclopedica da {source.name} su: {query}"
                })
        
        # Britannica
        elif source.name == "Britannica":
            for item in soup.select('.search-result-item, article h2 a')[:3]:
                results.append({
                    'title': item.get_text(strip=True),
                    'url': item.get('href', '') if item.has_attr('href') else source.base_url,
                    'snippet': f"Articolo da {source.name}: {query}"
                })
        
        # Fallback generico
        if not results:
            title_tag = soup.find('title')
            if title_tag:
                results.append({
                    'title': title_tag.get_text(strip=True),
                    'url': source.search_url_pattern.format(query=quote_plus(query)),
                    'snippet': f"Consulta {source.name} per: {query}"
                })
        
        return results
    
    def _extract_academic_results(self, soup: BeautifulSoup, source: SourceConfig, query: str) -> List[Dict]:
        """Estrae risultati da motori accademici."""
        results = []
        
        # Google Scholar
        if source.name == "Google Scholar":
            for item in soup.select('.gs_r, .gs_ri')[:3]:
                title_elem = item.select_one('.gs_rt a, h3 a')
                if title_elem:
                    snippet_elem = item.select_one('.gs_rs, .gs_sna')
                    results.append({
                        'title': title_elem.get_text(strip=True),
                        'url': title_elem.get('href', ''),
                        'snippet': snippet_elem.get_text(strip=True) if snippet_elem else ''
                    })
        
        # PubMed
        elif source.name == "PubMed":
            for item in soup.select('.docsum-content, .full-docsum')[:3]:
                title_elem = item.select_one('.docsum-title, .full-view-article-title')
                if title_elem:
                    snippet_elem = item.select_one('.docsum-text, .full-view-journal-citation')
                    results.append({
                        'title': title_elem.get_text(strip=True),
                        'url': title_elem.parent.get('href', '') if title_elem.parent else '',
                        'snippet': snippet_elem.get_text(strip=True) if snippet_elem else ''
                    })
        
        # Fallback generico per altri motori accademici
        if not results:
            for item in soup.select('h3 a, .result-title a, article h2 a')[:3]:
                results.append({
                    'title': item.get_text(strip=True),
                    'url': item.get('href', ''),
                    'snippet': f"Pubblicazione accademica su: {query}"
                })
        
        return results
    
    def _extract_factcheck_results(self, soup: BeautifulSoup, source: SourceConfig, query: str) -> List[Dict]:
        """Estrae risultati da siti di fact-checking."""
        results = []
        
        # Pattern comuni per articoli di fact-checking
        for item in soup.select('article, .post, .fact-check-item')[:3]:
            title_elem = item.select_one('h2 a, h3 a, .title a')
            if title_elem:
                snippet_elem = item.select_one('p, .excerpt, .summary')
                results.append({
                    'title': title_elem.get_text(strip=True),
                    'url': title_elem.get('href', ''),
                    'snippet': snippet_elem.get_text(strip=True)[:200] if snippet_elem else ''
                })
        
        # Fallback
        if not results:
            for item in soup.select('h2 a, h3 a')[:3]:
                results.append({
                    'title': item.get_text(strip=True),
                    'url': item.get('href', ''),
                    'snippet': f"Verifica fact-checking su: {query}"
                })
        
        return results
    
    def _extract_government_results(self, soup: BeautifulSoup, source: SourceConfig, query: str) -> List[Dict]:
        """Estrae risultati da siti governativi."""
        results = []
        
        # Pattern per siti istituzionali
        for item in soup.select('.news-item, .document-item, article')[:3]:
            title_elem = item.select_one('h3 a, h4 a, .title a')
            if title_elem:
                snippet_elem = item.select_one('p, .description, .abstract')
                results.append({
                    'title': title_elem.get_text(strip=True),
                    'url': title_elem.get('href', ''),
                    'snippet': snippet_elem.get_text(strip=True)[:200] if snippet_elem else ''
                })
        
        # Fallback
        if not results:
            results.append({
                'title': f"Risorsa ufficiale da {source.name}",
                'url': source.search_url_pattern.format(query=quote_plus(query)),
                'snippet': f"Consulta il sito ufficiale {source.name} per informazioni su: {query}"
            })
        
        return results
    
    def _extract_educational_results(self, soup: BeautifulSoup, source: SourceConfig, query: str) -> List[Dict]:
        """Estrae risultati da piattaforme educative."""
        results = []
        
        # Khan Academy
        if source.name == "Khan Academy":
            for item in soup.select('.search-result, .result-item')[:3]:
                title_elem = item.select_one('h3 a, .title a')
                if title_elem:
                    snippet_elem = item.select_one('p, .description')
                    results.append({
                        'title': title_elem.get_text(strip=True),
                        'url': title_elem.get('href', ''),
                        'snippet': snippet_elem.get_text(strip=True) if snippet_elem else ''
                    })
        
        # Fallback generico
        if not results:
            for item in soup.select('h3 a, .result-title a')[:3]:
                results.append({
                    'title': item.get_text(strip=True),
                    'url': item.get('href', ''),
                    'snippet': f"Risorsa educativa su: {query}"
                })
        
        return results
    
    def search_all_sources(self, query: str, max_results: int = 10) -> List[WebResult]:
        """
        Esegue ricerca su tutte le fonti abilitate.
        
        Args:
            query: testo della ricerca
            max_results: numero massimo totale di risultati
        
        Returns:
            Lista di WebResult
        """
        all_results = self.search_by_category(query, categories=None, max_results=3)
        return all_results[:max_results]
    
    def get_available_sources(self) -> List[Dict]:
        """Restituisce lista delle fonti disponibili con metadata."""
        return [
            {
                'name': source.name,
                'category': source.category.value,
                'language': source.language,
                'description': source.description,
                'enabled': source.enabled and (self.enabled_sources is None or source.name in self.enabled_sources)
            }
            for source in SOURCES_CONFIG
        ]


# Funzione wrapper per compatibilità con l'interfaccia esistente
def search_online_specialized(
    query: str, 
    categories: Optional[List[SourceCategory]] = None,
    max_results: int = 10
) -> List[WebResult]:
    """
    Funzione convenience per eseguire ricerche online specializzate.
    
    Args:
        query: testo della ricerca
        categories: categorie di fonti da includere (None = tutte)
        max_results: numero massimo di risultati
    
    Returns:
        Lista di WebResult
    """
    engine = OnlineSearchEngine()
    return engine.search_by_category(query, categories=categories, max_results=max_results // 2)

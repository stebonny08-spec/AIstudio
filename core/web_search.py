# -*- coding: utf-8 -*-
"""
core/web_search.py — W1 (Round 15b): provider di ricerca web con fallback.

LIVELLO 3 del RAG. Nessuna chiave API: il provider DEFAULT è DuckDuckGo via
libreria 'ddgs'. Catena di fallback (k = max_results, si smette appena si ha
abbastanza risultati):

  1. ddgs RISTRETTO ai trusted_sources (core/trusted_sources.py), batch
     "site:" da DOMAINS_PER_BATCH domini (stessa logica storica, priorità
     di qualità per chi studia; timeout 10s per batch);
  2. ddgs GENERICO (stessa libreria, senza site:) finché non si ha k;
  3. SearXNG self-hosted OPZIONALE — solo se config 'web.searxng_url' non
     vuoto (endpoint /search?format=json, stesso formato dei risultati);
  4. Wikipedia REST OPZIONALE — solo se config 'web.wikipedia' (True di
     default): cerca nei TITOLI (w/rest.php/v1/search/page) e poi prende
     il SUMMARY (api/rest_v1/page/summary); lingua it/en dichiarata per
     chiamata, con euristica semplice sulla query.

REGOLE (protocollo R15b):
  - MAI eccezioni verso il chiamante: in caso di problema si ritorna la
    lista (parziale o vuota) raccolta fin lì.
  - RETE QUI ESPlicita e permessa: OGNI chiamata di rete viene loggata in
    NET_LOG con provider, url/query dichiarata, ms, esito e n. risultati
    (stampa "[web_search][RETE]" + dump in qa/r15_web_netlog.json dai test).
  - Solo documenti vengono richiesti al web: NESSUN LLM cloud.
  - Config lette (MAI modificate) via data/config_manager.ConfigManager:
    'web.searxng_url' ("" = off), 'web.wikipedia' (True/False).
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from core.models import WebResult
from core.trusted_sources import all_domains

DEFAULT_MAX_RESULTS = 5
DEFAULT_TIMEOUT_SECONDS = 10
DOMAINS_PER_BATCH = 6
# R15b — budget TOTALE dell'escalation web per query (target QA v(b):
# esito (c) CON web p95 <= 8000 ms; retrieval+gate ~0,2s + margine per
# searxng/wikipedia). Oltre il budget: stop dichiarato nei log di rete.
WEB_BUDGET_S = 7.0  # R16 2.3:5s -> R18:7s (wiki join + ddgs sforavano
                     # i 5s: la wiki FINITA scartata -> GT date perse;
                     # contract.WEB_FETCH_CAP_S aggiornato, test <= invariato)

USER_AGENT = "NovaStudio/1.0 (RAG stadio web; solo lettura documenti)"

# ---------------------------------------------------------------- rete
# Registro delle chiamate di rete fatte DA QUESTO MODULO (dichiarazione
# obbligatoria). Ogni entry: {provider, url, ms, ok, n, note}.
NET_LOG: List[Dict[str, Any]] = []


def take_net_log(clear: bool = True) -> List[Dict[str, Any]]:
    """Copia (e opzionalmente svuota) il registro chiamate di rete."""
    out = list(NET_LOG)
    if clear:
        NET_LOG.clear()
    return out


def _log_net(provider: str, url: str, start: float, ok: bool,
             n: int = 0, note: str = "") -> Dict[str, Any]:
    ms = (time.time() - start) * 1000.0
    entry = {"provider": provider, "url": url, "ms": round(ms, 1),
             "ok": bool(ok), "n": int(n), "note": note}
    NET_LOG.append(entry)
    try:
        print(f"[web_search][RETE] {provider} | {url} | {ms:.0f}ms | "
              f"ok={entry['ok']} n={n}" + (f" | {note}" if note else ""))
    except UnicodeEncodeError:
        print("[web_search][RETE] (log non stampabile)")
    return entry


# ---------------------------------------------------------------- config
_CFG_CACHE: Dict[str, Any] = {}


def _cfg(key: str, default: Any) -> Any:
    """Legge SOLO una chiave di configurazione (mai scrittura)."""
    if key in _CFG_CACHE:
        return _CFG_CACHE[key]
    val = default
    try:
        from data.config_manager import ConfigManager
        val = ConfigManager().get(key, default)
    except Exception:
        val = default
    _CFG_CACHE[key] = val
    return val


def reset_config_cache() -> None:
    """Per i test: dimentica i valori config letti in precedenza."""
    _CFG_CACHE.clear()


# ---------------------------------------------------------- ddgs (base)
def _batched(items: List[str], size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _ddgs_search(query: str, max_results: int, timeout: int,
                 deadline: Optional[float] = None) -> List[WebResult]:
    """ddgs in DUE fasi: prima trusted (site:), poi generico, fino a k.
    R15b: rispetta il budget totale `deadline` (monotonic) — stop tra i batch
    con log dichiarato; timeout per chiamata limitato al residuo di budget."""
    results: List[WebResult] = []
    seen_urls = set()
    if deadline is None:
        deadline = time.monotonic() + WEB_BUDGET_S
    # R16 fix QA-1 t1: le batch "site:" fidate potevano consumare TUTTO il
    # budget (3 batch x ~2s) e il FASE 2 "generico" (che torna k=5 in ~1s)
    # NON partiva mai -> 0 risultati su 3/5 query solo-web. Fasce:
    # trusted <= 2.0s, poi generico col residuo, poi wiki (in search_web).
    _start_mono = time.monotonic()
    _trusted_deadline = min(deadline, _start_mono + 2.0)
    # R16 t3: max 2s per richiesta (un batch lento NON puo' digerire il budget intero - QA-1 t2: batch 7.1s -> 0 risultati)
    eff_timeout = int(max(1, min(timeout, 2)))

    def _absorb(raw_items) -> None:
        for item in raw_items or []:
            if len(results) >= max_results:
                return
            url = item.get("href", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            results.append(WebResult(
                title=item.get("title", "") or "",
                url=url,
                snippet=item.get("body", "") or "",
            ))

    try:
        from ddgs import DDGS
    except Exception as e:
        _log_net("ddgs", f"import ddgs fallito: {e}", time.time(), False, 0,
                 "libreria non disponibile")
        return results

    try:
        with DDGS(timeout=eff_timeout) as ddgs:
            # --- FASE 1: fonti affidabili (priorità qualità) ---
            domains = all_domains()
            for domain_batch in _batched(domains, DOMAINS_PER_BATCH):
                if len(results) >= max_results:
                    break
                if time.monotonic() >= _trusted_deadline:
                    _log_net("ddgs", f"ddgs://text?q={query[:80]}", time.time(),
                             True, 0,
                             f"fase trusted cap 2.0s - stop batch fidati "
                             f"(ottenuti {len(results)}); passo al generico")
                    break
                site_filter = " OR ".join(f"site:{d}" for d in domain_batch)
                batch_query = f"{query} ({site_filter})"
                t0 = time.time()
                try:
                    raw = ddgs.text(batch_query, max_results=max_results)
                    _log_net("ddgs", f"ddgs://text?q={batch_query[:120]}", t0,
                             True, len(raw or []),
                             f"trusted batch ({len(domain_batch)} domini)")
                    _absorb(raw)
                except Exception as e:
                    # Un batch che fallisce (timeout/rate limit) non interrompe
                    # la ricerca sugli altri gruppi. "No results found" e' un
                    # esito NORMALE di ddgs (solleva invece di tornare []).
                    if "no results" in str(e).lower():
                        _log_net("ddgs", f"ddgs://text?q={batch_query[:120]}",
                                 t0, True, 0,
                                 f"trusted batch ({len(domain_batch)} domini): "
                                 "nessun risultato (normale)")
                    else:
                        _log_net("ddgs", f"ddgs://text?q={batch_query[:120]}",
                                 t0, False, 0, f"batch fallito: {e}")

            # --- FASE 2: generico (senza site:) finché non abbiamo k ---
            # R16 t3: riserva 1.2s per Wikipedia (fattuali) in search_web
            if (len(results) < max_results
                    and time.monotonic() < deadline - 1.2):
                t0 = time.time()
                try:
                    raw = ddgs.text(query, max_results=max_results)
                    _log_net("ddgs", f"ddgs://text?q={query[:120]}", t0, True,
                             len(raw or []), "generico (no site:)")
                    _absorb(raw)
                except Exception as e:
                    if "no results" in str(e).lower():
                        _log_net("ddgs", f"ddgs://text?q={query[:120]}", t0,
                                 True, 0, "generico (no site:): nessun risultato")
                    else:
                        _log_net("ddgs", f"ddgs://text?q={query[:120]}", t0,
                                 False, 0, f"generico fallito: {e}")
    except Exception as e:
        # DDGS() stesso può esplodere (DNS offline, rate limit globale):
        # MAI eccezioni verso il chiamante.
        _log_net("ddgs", f"ddgs://text?q={query[:120]}", time.time(), False, 0,
                 f"contenitore ddgs fallito: {e}")

    return results


# ------------------------------------------------------------ SearXNG
def _searxng_search(base_url: str, query: str, max_results: int,
                    timeout: int) -> List[WebResult]:
    """SearXNG self-hosted: GET {base}/search?q=..&format=json.

    Stesso formato dei risultati ({url, title, content}); '' = disattivo.
    """
    if not str(base_url or "").strip():
        return []
    try:
        import requests
    except Exception as e:
        _log_net("searxng", f"{base_url}/search (import requests: {e})",
                 time.time(), False, 0, "requests non disponibile")
        return []

    endpoint = str(base_url).rstrip("/") + "/search"
    t0 = time.time()
    try:
        resp = requests.get(
            endpoint,
            params={"q": query, "format": "json"},
            timeout=timeout,
            headers={"User-Agent": USER_AGENT},
        )
        ok = resp.status_code == 200
        if not ok:
            _log_net("searxng", endpoint + "?q=" + quote(query[:80]), t0, False,
                     0, f"HTTP {resp.status_code}")
            return []
        data = resp.json() or {}
        raw = data.get("results") or []
        results: List[WebResult] = []
        seen = set()
        for item in raw:
            if len(results) >= max_results:
                break
            url = item.get("url") or item.get("href") or ""
            if not url or url in seen:
                continue
            seen.add(url)
            results.append(WebResult(
                title=item.get("title", "") or "",
                url=url,
                snippet=item.get("content", "") or "",
            ))
        _log_net("searxng", endpoint + "?q=" + quote(query[:80]), t0, True,
                 len(results), "stesso formato (url/title/content)")
        return results
    except Exception as e:
        _log_net("searxng", endpoint + "?q=" + quote(query[:80]), t0, False, 0,
                 f"errore: {e}")
        return []


# ----------------------------------------------------------- Wikipedia
_IT_HINTS = (
    " che ", " del ", " della ", " delle ", " degli ", " con ", " per ",
    " una ", " uno ", " come ", " quando ", " perch", " qual", " è ",
    " negli ", " nelle ", " sull", " nell", " questo ", " cosa ",
)


def _looks_italian(query: str) -> bool:
    q = " " + query.lower() + " "
    if any(ch in q for ch in "àèéìòù"):
        return True
    return any(h in q for h in _IT_HINTS)


def wikipedia_search(query: str, max_results: int = 1,
                     timeout: int = DEFAULT_TIMEOUT_SECONDS) -> List[WebResult]:
    """Wikipedia REST: 1) ricerca TITOLI, 2) SUMMARY dei titoli top.

    Lingua dichiarata per chiamata: si prova prima it o en in base
    all'euristica sulla query, poi l'altra lingua se nessun titolo.
    """
    if not query.strip() or max_results <= 0:
        return []
    try:
        import requests
    except Exception as e:
        _log_net("wikipedia", f"import requests fallito: {e}", time.time(),
                 False, 0, "requests non disponibile")
        return []

    langs = ["it", "en"] if _looks_italian(query) else ["en", "it"]
    headers = {"User-Agent": USER_AGENT}

    def _search_titles(lang: str):
        url = (f"https://{lang}.wikipedia.org/w/rest.php/v1/search/page"
               f"?q={quote(query[:120])}&limit={max(3, max_results)}")
        t0 = time.time()
        try:
            resp = requests.get(url, timeout=timeout, headers=headers)
            if resp.status_code != 200:
                _log_net("wikipedia", url, t0, False, 0,
                         f"titoli HTTP {resp.status_code} [{lang}]")
                return []
            pages = (resp.json() or {}).get("pages") or []
            _log_net("wikipedia", url, t0, True, len(pages),
                     f"titoli [{lang}]")
            return pages
        except Exception as e:
            _log_net("wikipedia", url, t0, False, 0, f"titoli [{lang}]: {e}")
            return []

    def _summary(lang: str, title: str) -> Optional[WebResult]:
        url = (f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/"
               f"{quote(title.replace(' ', '_'))}")
        t0 = time.time()
        try:
            resp = requests.get(url, timeout=timeout, headers=headers)
            if resp.status_code != 200:
                _log_net("wikipedia", url, t0, False, 0,
                         f"summary HTTP {resp.status_code} [{lang}]")
                return None
            data = resp.json() or {}
            extract = data.get("extract") or ""
            page_url = (data.get("content_urls", {})
                        .get("desktop", {}).get("page")) or url
            _log_net("wikipedia", url, t0, True, 1, f"summary [{lang}]")
            if not extract:
                return None
            return WebResult(title=data.get("title") or title,
                             url=page_url, snippet=extract)
        except Exception as e:
            _log_net("wikipedia", url, t0, False, 0, f"summary [{lang}]: {e}")
            return None

    import re as _re_y
    year_re = _re_y.compile(r"\b(1[0-9]{3}|20[0-9]{2})\b")

    def _lead(lang: str, title: str) -> str:
        """R18: estratto LEAD completo (api.php extracts) - gli summary
        REST per alcune pagine sono stub SENZA anni (misurato: Giovanni
        Boccaccio58 char, zero date) e le GT biografiche li richiedono."""
        url = (f"https://{lang}.wikipedia.org/w/api.php?action=query"
               f"&format=json&prop=extracts&explaintext=1&exintro=1"
               f"&redirects=1&titles={quote(title.replace(' ', '_'))}")
        t0 = time.time()
        try:
            resp = requests.get(url, timeout=timeout, headers=headers)
            if resp.status_code != 200:
                _log_net("wikipedia", url, t0, False, 0,
                         f"lead HTTP {resp.status_code} [{lang}]")
                return ""
            data = resp.json() or {}
            pages = (data.get("query", {}).get("pages", {}) or {})
            for _pid, pg in pages.items():
                ext = str(pg.get("extract") or "")
                if ext:
                    _log_net("wikipedia", url, t0, True, 1,
                             f"lead [{lang}] {len(ext)} char")
                    return ext
            return ""
        except Exception as e:
            _log_net("wikipedia", url, t0, False, 0, f"lead: {e}")
            return ""

    for lang in langs:
        pages = _search_titles(lang)
        if not pages:
            continue
        results: List[WebResult] = []
        for page in pages[:max_results]:
            title = page.get("title") or ""
            if not title:
                continue
            wr = _summary(lang, title)
            if wr:
                results.append(wr)
        if results:
            # R18 rescue biografico: nessun ANNO in tutti gli snippet e la
            # query e' una domanda "chi ..." -> lead extract della pagina 1
            # R18 fix11: condizionato ALLA PAGINA PRIMARIA (gli anni di
            # altri risultati - es. date di composizione del Decameron -
            # non provano che la BIOGRAFIA abbia gli anni di nascita/morte)
            if (not year_re.search(results[0].snippet or "")
                    and str(query or "").strip().lower().startswith("chi ")):
                lead = _lead(lang, results[0].title)
                if lead and year_re.search(lead):
                    results[0] = WebResult(
                        title=results[0].title, url=results[0].url,
                        snippet=lead[:600])
            return results
    return []


# -------------------------------------------------------- entry point
_ALLOWLIST_CACHE = {"mtime": -1.0, "domains": None}


def load_allowlist() -> List[str]:
    """R16 2.2: dominii da data/web_allowlist.txt (file, NON UI).

    Fallback dichiarato: se il file manca si usa la lista curata storica
    core/trusted_sources.py (seed dell'allowlist).
    """
    try:
        from pathlib import Path as _P
        path = _P(__file__).resolve().parents[1] / "data" / "web_allowlist.txt"
        mtime = path.stat().st_mtime if path.exists() else -1.0
        if _ALLOWLIST_CACHE["domains"] is not None and \
                _ALLOWLIST_CACHE["mtime"] == mtime:
            return _ALLOWLIST_CACHE["domains"]
        domains: List[str] = []
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip().lower()
                if line and not line.startswith("#"):
                    domains.append(line)
        if not domains:
            from core.trusted_sources import all_domains
            domains = [d.lower() for d in all_domains()]
        _ALLOWLIST_CACHE["mtime"] = mtime
        _ALLOWLIST_CACHE["domains"] = domains
        return domains
    except Exception:
        return list(_ALLOWLIST_CACHE.get("domains") or [])


def _in_allowlist(url: str) -> bool:
    """True se il dominio dell'url e' nell'allowlist (suffix match)."""
    try:
        from urllib.parse import urlparse
        host = (urlparse(str(url or "")).netloc or "").lower().split(":")[0]
        if host.startswith("www."):
            host = host[4:]
        if not host:
            return False
        for d in load_allowlist():
            if host == d or host.endswith("." + d):
                return True
        return False
    except Exception:
        return False


def search_web(
    query: str,
    max_results: int = DEFAULT_MAX_RESULTS,
    *,
    searxng_url: Optional[str] = None,
    wikipedia: Optional[bool] = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> List[WebResult]:
    """Ricerca web con fallback (W1). Ordine: trusted ddgs -> ddgs generico
    -> SearXNG (se configurato) -> Wikipedia (se attivo), finché non si ha
    k risultati. Ritorna SEMPRE una lista (mai eccezioni al chiamante).
    """
    if not query or not query.strip() or max_results <= 0:
        return []

    if searxng_url is None:
        searxng_url = _cfg("web.searxng_url", "")
    if wikipedia is None:
        wikipedia = bool(_cfg("web.wikipedia", True))

    results: List[WebResult] = []
    seen = set()
    # R15b: deadline comune a TUTTI i provider (budget totale, vedi WEB_BUDGET_S)
    deadline = time.monotonic() + WEB_BUDGET_S
    # R17: Wikipedia parte SUBITO in parallelo con ddgs (fattuali sempre
    # disponibili entro il budget; misurato: con la versione sequenziale
    # il batch ddgs poteva consumare il budget e skippare wiki -> 0 fonti)
    wiki_future = None
    if wikipedia:
        try:
            from concurrent.futures import ThreadPoolExecutor
            _ex = ThreadPoolExecutor(max_workers=1,
                                     thread_name_prefix="r17-wiki")
            wiki_future = _ex.submit(wikipedia_search, query,
                                     max_results,
                                     max(1, int(WEB_BUDGET_S)))
        except Exception:
            wiki_future = None

    def _extend(items: List[WebResult], front: bool = False,
                reserve: int = 0) -> None:
        # R18: front=True -> i risultati wiki (summary con date/nomi)
        # entrano in TESTA alla lista (_prompt usa i primi PROMPT_WEB_MAX);
        # reserve=N -> i filler (ddgs) tengono N slot liberi per la wiki.
        limit = max(1, max_results - reserve)
        added: List[WebResult] = []
        for wr in items:
            if len(results) + len(added) >= limit:
                break
            if wr.url in seen:
                continue
            if not _in_allowlist(wr.url):
                # R16 2.2: fuori allowlist -> SCARTATO (log dichiarato)
                seen.add(wr.url)
                _log_net("allowlist", wr.url[:120], time.time(), True, 0,
                         "fuori allowlist - scartato")
                continue
            seen.add(wr.url)
            added.append(wr)
        if front:
            results[:0] = added
        else:
            results.extend(added)

    try:
        # 1+2: ddgs trusted -> ddgs generico (default, nessuna chiave)
        _extend(_ddgs_search(query, max_results, timeout, deadline=deadline),
                reserve=2)   # R18: 2 slot garantiti alla wiki

        # 3: SearXNG self-hosted OPZIONALE (solo se ancora < k e budget residuo)
        if len(results) < max_results and str(searxng_url or "").strip():
            rem = deadline - time.monotonic()
            if rem >= 1.0:
                _extend(_searxng_search(str(searxng_url), query,
                                        max_results - len(results),
                                        int(max(1, min(timeout, rem)))))
            else:
                _log_net("searxng", "budget web esaurito - skip", time.time(),
                         True, 0,
                         f"skip budget: residuo {rem:.1f}s di {WEB_BUDGET_S}s")

        # 4: Wikipedia (parallela, lanciata all'inizio) - join col budget
        # residuo; se il tempo e' finito si usa comunque cio' che ha
        # prodotto finora (mai skippata a causa di ddgs lento)
        if wiki_future is not None:
            rem = max(2.0, deadline - time.monotonic())  # R18 floor
            try:
                wiki_items = wiki_future.result(timeout=rem)
            except Exception:
                wiki_items = None
                _log_net("wikipedia", f"query={query[:60]}", time.time(),
                         False, 0, "wiki parallela non disponibile entro "
                                   "il budget residuo")
            try:
                _ex.shutdown(wait=False)
            except Exception:
                pass
            if wiki_items and len(results) < max_results:
                _extend(wiki_items, front=True)   # R18: date/nomi in testa
    except Exception as e:
        # Difesa ulteriore: MAI eccezioni verso il chiamante.
        _log_net("search_web", f"query={query[:80]}", time.time(), False, 0,
                 f"eccezione interna intercettata: {e}")

    return results[:max_results]

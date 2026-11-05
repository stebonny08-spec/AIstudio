# -*- coding: utf-8 -*-
"""
core/rag/web_stage.py — W2/W4 (Round 15b): stadio WEB del RAG a 3 stadi.

Responsabilità (contratto core/rag/contract.py, nessuna modifica al contratto):

  W2 — pipeline di indicizzazione web:
        top-k URL (core.web_search) -> fetch (requests, timeout 10s)
        -> readability-lite (≤4000 char/doc, ESTRAZIONE LOCALE, nessuna
        libreria nuova) -> cache URL persistente in AppData (JSON indice +
        file testo, TTL 'web.cache_ttl_days' default 7gg; HIT = nessuna
        rete) -> Chunk(meta={"stage":"web","url","title","date"})
        -> embed (embedder preso in SOLO LETTURA da local_search/engine)
        -> vector_store.add_chunks -> i chunk web diventano ricercabili
        FTS5 + vettori come gli altri (stesso store 'vector_index').

  W4 — escalation: escalate(query, gate_outcome, mode, top_k) decise QUI
        l'accesso al web (P la chiama):
          mode 'mai'  -> [] SUBITO, ZERO rete;
          mode 'auto' -> solo se il gate e' parziale/nulla;
          mode 'sempre' -> sempre.
        Il modo DEFAULT viene da config 'web.mode' (letta, mai scritta).

  W3 (supporto) — tagging meta.stage + FORNITURA di items/fonti:
        web_sources() produce gli item {"stage","title","url","source"}
        che P passa nei 'sources' del poll_stream; il RENDER dei badge e'
        nella UI (web_frontend/html/index.html).

RETE ESPlicita: ogni fetch è loggato in NET_LOG (url, ms, status, hit/miss).
Le ricerche di URL sono in core/web_search.py (stesso protocollo).
Nessuna eccezione verso il chiamante: documenti malformati/timeout vengono
saltati e la pipeline continua.

EURISTICA readability-lite (documento qui, come richiesto):
  1. rimozione blocchi non-testuali: <script> <style> <noscript> <template>
     <svg> <head> e commenti HTML;
  2. se esiste <article> o <main>, si usa il contenitore PIU' LUNGO in
     testo (preferenza ai blocchi main/article, tipici del contenuto);
  3. altrimenti si raccolgono i blocchi semantici <h1..h6> <p> <li>
     <blockquote> <pre> scartando i frammenti corti (<40 char, tipici di
     nav/menu/bottoni) — "preferenza a blocchi h1-p lunghi";
  4. fallback: testo del <body> intero;
  5. strip dei tag rimanenti, unescape entita', collasso spazi bianchi;
  6. troncatura a max_chars (4000) su confine di parola con '…'.
"""
from __future__ import annotations

import hashlib
import html as html_mod
import json
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from core.models import WebResult
from core.rag.chunker import Chunk, chunk_text

WEB_STAGE = "web"
MAX_DOC_CHARS = 4000
FETCH_TIMEOUT = 10          # secondi, dichiarati (protocollo W2)
CACHE_DIR_NAME = "web_cache"
DEFAULT_TTL_DAYS = 7

FETCH_HEADERS = {
    "User-Agent": "NovaStudio/1.0 (RAG stadio web; solo lettura documenti)",
}

# ------------------------------------------------------------- rete
# Fetch fatte DA QUESTO MODULO: {provider:"fetch", url, ms, status, ok, note}
NET_LOG: List[Dict[str, Any]] = []


def take_net_log(clear: bool = True) -> List[Dict[str, Any]]:
    out = list(NET_LOG)
    if clear:
        NET_LOG.clear()
    return out


def _log_fetch(url: str, start: float, status: Any, ok: bool,
               note: str = "") -> Dict[str, Any]:
    ms = (time.time() - start) * 1000.0
    entry = {"provider": "fetch", "url": url, "ms": round(ms, 1),
             "status": status, "ok": bool(ok), "note": note}
    NET_LOG.append(entry)
    try:
        print(f"[web_stage][RETE] fetch | {url} | {ms:.0f}ms | "
              f"status={status}" + (f" | {note}" if note else ""))
    except UnicodeEncodeError:
        print("[web_stage][RETE] (log non stampabile)")
    return entry


# ------------------------------------------------------------ config
def _cfg(key: str, default: Any) -> Any:
    try:
        from data.config_manager import ConfigManager
        return ConfigManager().get(key, default)
    except Exception:
        return default


# ============================================================
# READABILITY-LITE (estrattore propio, nessuna libreria nuova)
# ============================================================
_BLOCK_RE = re.compile(
    r"(?is)<(script|style|noscript|template|svg|head)\b[^>]*>.*?</\1>")
_COMMENT_RE = re.compile(r"(?s)<!--.*?-->")
_CONTAINER_RE = re.compile(r"(?is)<(article|main)\b[^>]*>(.*?)</\1>")
_PARA_RE = re.compile(
    r"(?is)<(h[1-6]|p|li|blockquote|pre)\b[^>]*>(.*?)</\1>")
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_H1_RE = re.compile(r"(?is)<h1\b[^>]*>(.*?)</h1>")
_TITLE_RE = re.compile(r"(?is)<title\b[^>]*>(.*?)</title>")

MIN_PARAGRAPH_CHARS = 40      # sotto questa soglia un blocco e' nav/menu


def _strip_tags(text: str) -> str:
    """Rimuove i tag HTML rimasti, unescape entita', collassa spazi."""
    no_tags = _TAG_RE.sub(" ", text)
    unescaped = html_mod.unescape(no_tags)
    return _WS_RE.sub(" ", unescaped).strip()


def _truncate(text: str, max_chars: int = MAX_DOC_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    sp = cut.rfind(" ")
    if sp > max_chars * 0.6:          # evita tagli a metà parola
        cut = cut[:sp]
    return cut.rstrip() + "…"


def readability_lite(page_html: str,
                     max_chars: int = MAX_DOC_CHARS) -> str:
    """Estrae il testo 'leggibile' da una pagina HTML (vedi euristica in
    testa al modulo). Ritorna SEMPRE una stringa (≤ max_chars)."""
    if not page_html:
        return ""

    # 1) via i blocchi non-testuali
    cleaned = _BLOCK_RE.sub(" ", page_html)
    cleaned = _COMMENT_RE.sub(" ", cleaned)

    # 2) preferenza a <article>/<main> (il più lungo)
    body_html = ""
    containers = _CONTAINER_RE.findall(cleaned)
    best_len = 0
    for _tag, inner in containers:
        visible = len(_strip_tags(inner))
        if visible > best_len and visible >= MIN_PARAGRAPH_CHARS:
            best_len = visible
            body_html = inner

    # 3) oppure blocchi semantici: intestazioni h1-h6 SEMPRE (titoli),
    #    p/li/blockquote/pre solo se lunghi (>= MIN_PARAGRAPH_CHARS, scarta
    #    voci di menu/nav brevi)
    if not body_html:
        pieces = []
        for tag, inner in _PARA_RE.findall(cleaned):
            txt = _strip_tags(inner)
            if not txt:
                continue
            if tag.lower().startswith("h") or len(txt) >= MIN_PARAGRAPH_CHARS:
                pieces.append(txt)
        if pieces:
            return _truncate(" ".join(pieces), max_chars)

    # 4) fallback: intero documento
    if not body_html:
        body_html = cleaned
        m = re.search(r"(?is)<body\b[^>]*>(.*?)</body>", cleaned)
        if m:
            body_html = m.group(1)

    # 5-6) strip tag + troncatura
    return _truncate(_strip_tags(body_html), max_chars)


def extract_title(page_html: str, fallback: str = "") -> str:
    """Titolo documento: <h1> -> <title> -> fallback (tutto lite)."""
    if not page_html:
        return fallback
    cleaned = _BLOCK_RE.sub(" ", page_html)
    for rx in (_H1_RE, _TITLE_RE):
        m = rx.search(cleaned)
        if m:
            t = _strip_tags(m.group(1))
            if t:
                return t[:200]
    return fallback


# ============================================================
# CACHE URL PERSISTENTE (AppData; TTL con clock iniettabile)
# ============================================================
class WebCache:
    """Cache persistente dei testi web: JSON indice + file testo.

    - base_dir default: <AppData>/web_cache  (file JSON 'cache.json' +
      'texts/<sha1>.txt');
    - TTL 'web.cache_ttl_days' (default 7 giorni) controllato con il clock
      INIETTABILE (self._now) => logica pura testabile senza dormire;
    - hit => nessuna rete (fetch_docs legge da qui prima di chiamare requests).
    """

    def __init__(self, base_dir: Optional[Path] = None,
                 ttl_days: float = DEFAULT_TTL_DAYS, now=time.time):
        if base_dir is None:
            try:
                from data.config_manager import get_app_data_dir
                base = Path(get_app_data_dir()) / CACHE_DIR_NAME
            except Exception:
                base = Path.home() / "AppData" / "Roaming" / "NovaStudio" / CACHE_DIR_NAME
        else:
            base = Path(base_dir)
        self.base = base
        self.ttl_days = float(ttl_days)
        self._now = now
        self.index_path = self.base / "cache.json"
        self.texts_dir = self.base / "texts"
        self._index: Dict[str, Dict[str, Any]] = {}
        self._load()

    # -- persistenza indice --
    def _load(self) -> None:
        try:
            if self.index_path.exists():
                data = json.loads(self.index_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self._index = data
        except Exception:
            self._index = {}

    def _save(self) -> None:
        try:
            self.base.mkdir(parents=True, exist_ok=True)
            tmp = self.index_path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(self._index, ensure_ascii=False,
                                      indent=1), encoding="utf-8")
            tmp.replace(self.index_path)
        except Exception:
            pass

    # -- API --
    def _text_path(self, url: str) -> Path:
        sha = hashlib.sha1(url.encode("utf-8")).hexdigest()
        return self.texts_dir / f"{sha}.txt"

    def get(self, url: str) -> Optional["WebDoc"]:
        """Doc dalla cache se NON scaduto (TTL con clock iniettato)."""
        entry = self._index.get(url)
        if not entry:
            return None
        age = self._now() - float(entry.get("ts", 0))
        if age > self.ttl_days * 86400.0:
            # scaduto: rimuove (lazily) e segnala miss
            self._index.pop(url, None)
            self._save()
            return None
        try:
            text = self._text_path(url).read_text(encoding="utf-8")
        except OSError:
            self._index.pop(url, None)
            self._save()
            return None
        return WebDoc(url=url, title=entry.get("title", ""),
                      text=text, date=entry.get("date", ""),
                      from_cache=True)

    def put(self, url: str, title: str, text: str, date: str = "") -> None:
        try:
            self.texts_dir.mkdir(parents=True, exist_ok=True)
            self._text_path(url).write_text(text, encoding="utf-8")
            self._index[url] = {"title": title, "date": date,
                                "ts": self._now(), "chars": len(text)}
            self._save()
        except Exception:
            pass

    def entries(self) -> int:
        return len(self._index)

    def purge_expired(self) -> int:
        """Rimuove gli scaduti (stessa logica di get, in blocco)."""
        now = self._now()
        dead = [u for u, e in self._index.items()
                if now - float(e.get("ts", 0)) > self.ttl_days * 86400.0]
        for u in dead:
            self._index.pop(u, None)
        if dead:
            self._save()
        return len(dead)


# ============================================================
# DOCUMENTI + FETCH
# ============================================================
@dataclass
class WebDoc:
    url: str
    title: str = ""
    text: str = ""
    date: str = ""
    from_cache: bool = False
    fetch_ms: float = 0.0
    extra: Dict[str, Any] = field(default_factory=dict)


def default_cache(ttl_days: Optional[float] = None) -> WebCache:
    """Cache di default (TTL da config 'web.cache_ttl_days')."""
    if ttl_days is None:
        try:
            ttl_days = float(_cfg("web.cache_ttl_days", DEFAULT_TTL_DAYS))
        except Exception:
            ttl_days = DEFAULT_TTL_DAYS
    return WebCache(ttl_days=ttl_days)


def fetch_docs(results: Iterable[WebResult],
               cache: Optional[WebCache] = None,
               timeout: int = FETCH_TIMEOUT) -> List[WebDoc]:
    """Fetch dei top-k URL -> testo readability-lite ≤4000 char/doc.

    Prima controlla la CACHE (hit = zero rete), poi GET requests con
    timeout 10s (dichiarato). Doc vuoti/malfatti: saltati, mai eccezioni.
    """
    docs: List[WebDoc] = []
    results = list(results or [])
    if not results:
        return docs
    if cache is None:
        cache = default_cache()

    for res in results:
        url = (res.url or "").strip()
        if not url:
            continue
        # --- HIT cache: nessuna rete ---
        hit = cache.get(url)
        if hit is not None:
            if not hit.title:
                hit.title = res.title or ""
            docs.append(hit)
            continue

        # --- MISS: fetch rete (timeout dichiarato) ---
        t0 = time.time()
        try:
            import requests
            resp = requests.get(url, timeout=timeout,
                                headers=FETCH_HEADERS)
            status = resp.status_code
            if status != 200 or not resp.text:
                _log_fetch(url, t0, status, False,
                           f"HTTP {status} o body vuoto")
                continue
            page_html = resp.text
        except Exception as e:
            _log_fetch(url, t0, None, False, f"errore fetch: {e}")
            continue

        text = readability_lite(page_html, MAX_DOC_CHARS)
        _log_fetch(url, t0, status, True,
                   f"readability {len(text)} char (max {MAX_DOC_CHARS})")
        if not text:
            continue

        title = (res.title or "").strip() or extract_title(page_html)
        date = time.strftime("%Y-%m-%d", time.gmtime())
        doc = WebDoc(url=url, title=title, text=text, date=date,
                     from_cache=False,
                     fetch_ms=round((time.time() - t0) * 1000.0, 1))
        cache.put(url, title, text, date)
        docs.append(doc)

    return docs


# ============================================================
# INDICIZZAZIONE STADIO WEB (W2)
# ============================================================
def build_web_chunks(doc: WebDoc) -> List[Chunk]:
    """Chunk di un documento web con meta di stadio (W3 tagging).

    meta = {"stage":"web","url","title","date"} — campo TUO di Chunk
    (backward-compat: nessun campo obbligatorio).
    Convenzione supplementare (anti-perdita, finché add_chunks non mergia
    chunk.meta: vedi report): source_file = URL, location_hint = titolo.
    """
    chunks = chunk_text(doc.text, source_file=doc.url)
    for c in chunks:
        c.meta = {"stage": WEB_STAGE, "url": doc.url, "title": doc.title,
                  "date": doc.date}
        if not c.location_hint:
            c.location_hint = doc.title
    return chunks


def index_web(docs: List[WebDoc], store, embedder) -> Dict[str, Any]:
    """Indicizza i documenti web nello STESSO store (FTS5 + vettori).

    - embedder: SOLO LETTURA (tipicamente local_search.embedder / engine);
    - store: vector_store.add_chunks (pubblico; non si tocca vector_store*);
    - meta.stage='web' su ogni chunk => citazioni/badge stadio.
    Ritorna statistiche (mai eccezioni al chiamante: 0 chunk = no-op).
    """
    stats = {"docs": 0, "chunks": 0, "embedded": 0, "added": 0,
             "skipped_docs": 0, "store_key": getattr(store, "store_key", "")}
    all_chunks: List[Chunk] = []
    for doc in docs or []:
        if not (doc.text or "").strip() or not doc.url:
            stats["skipped_docs"] += 1
            continue
        stats["docs"] += 1
        all_chunks.extend(build_web_chunks(doc))

    stats["chunks"] = len(all_chunks)
    if not all_chunks or store is None or embedder is None:
        return stats

    try:
        embeddings = embedder.embed([c.text for c in all_chunks],
                                    kind="passage")
        stats["embedded"] = len(embeddings)
        store.add_chunks(all_chunks, embeddings)
        stats["added"] = len(all_chunks)
    except Exception as e:
        # Nessuna eccezione verso il chiamante (P); errore nel report log.
        stats["error"] = str(e)
        print(f"[web_stage] indicizzazione fallita: {e}")
    return stats


def web_sources(docs: List[WebDoc]) -> List[Dict[str, Any]]:
    """Item fonti per P: [{"stage":"web","title","url","source"}].

    P li passa in poll_stream['sources']; W renderizza badge+link in UI.
    """
    out = []
    for d in docs or []:
        out.append({"stage": WEB_STAGE,
                    "title": d.title or d.url,
                    "url": d.url,
                    "source": WEB_STAGE})
    return out


# ============================================================
# ESCALATION (W4) — decisione gate/pipe, fatta QUI (zero LLM extra)
# ============================================================
OUTCOME_PIENA = "piena"
OUTCOME_PARZIALE = "parziale"
OUTCOME_NULLA = "nulla"


BREAKER_TTL_S = 60.0   # R18 B1.2: TTL massimo del circuit-breaker web

_BREAKER_LOCK = threading.Lock()
_BREAKER = {
    "open_until": 0.0,       # epoch seconds; ora < open_until -> aperto
    "last_error": None,      # {url, status, error, ts} ULTIMO errore HTTP reale
    "last_success_ts": 0.0,
    "open_count": 0,
}
# ultima escalation (per lo stato onesto dello stadio web - B1.2/B1.3)
LAST_STATE = {
    "attempted": False,      # e' stato fatto un tentativo HTTP in questa call
    "via_breaker": False,    # saltato perche' breaker aperto (post-errore)
    "n_results": 0,
    "ok": False,             # almeno un HTTP/provider e' andato a buon fine
    "reason": "",
    "ts": 0.0,
}


def _net_tail(since_n: int) -> List[Dict[str, Any]]:
    try:
        import core.web_search as w
        return list(getattr(w, "NET_LOG", [])[since_n:]) or []
    except Exception:
        return []


def _net_len() -> int:
    try:
        import core.web_search as w
        return len(getattr(w, "NET_LOG", []) or [])
    except Exception:
        return 0


def _error_from_entry(e: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "url": str(e.get("url") or ""),
        "provider": str(e.get("provider") or ""),
        "status": e.get("status"),
        "error": str(e.get("error") or e.get("note") or e.get("message") or ""),
        "ts": float(e.get("ts") or e.get("start") or time.time()),
    }


def _update_breaker(entries: List[Dict[str, Any]], had_results: bool) -> Dict[str, Any]:
    """Aggiorna il breaker DAVVERO dopo un tentativo HTTP:
    - almeno un provider OK (o risultati) -> breaker CHIUSO;
    - tutti i tentativi falliti con errore loggato -> APERTO per TTL <=60s
      con ultimo errore {url, status, error, ts}."""
    with _BREAKER_LOCK:
        ok_entries = [e for e in entries if e.get("ok")]
        fail_entries = [e for e in entries if not e.get("ok")]
        if ok_entries or had_results:
            _BREAKER["open_until"] = 0.0
            _BREAKER["last_success_ts"] = time.time()
            return {"open": False}
        if fail_entries:
            last = _fail_last(fail_entries)
            _BREAKER["last_error"] = last
            _BREAKER["open_until"] = time.time() + BREAKER_TTL_S
            _BREAKER["open_count"] += 1
            print("[web_stage] circuit-breaker APERTO "
                  f"(TTL {int(BREAKER_TTL_S)}s): {last}")
            return {"open": True, "last_error": last}
        return {"open": bool(time.time() < _BREAKER["open_until"])}


def _fail_last(fail_entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    # preferisci errori HTTP/fetch (status/errore presenti), altrimenti ultima
    for e in reversed(fail_entries):
        if e.get("status") or e.get("error"):
            return _error_from_entry(e)
    return _error_from_entry(fail_entries[-1])


def breaker_state() -> Dict[str, Any]:
    """Stato circuit-breaker (sola lettura) per log/forensics/UI."""
    with _BREAKER_LOCK:
        now = time.time()
        return {
            "presente": True,
            "ttl_s": BREAKER_TTL_S,
            "open": now < float(_BREAKER["open_until"]),
            "open_until": float(_BREAKER["open_until"]),
            "last_error": dict(_BREAKER["last_error"]) if _BREAKER["last_error"] else None,
            "last_success_ts": float(_BREAKER["last_success_ts"]),
            "open_count": int(_BREAKER["open_count"]),
            "ts": now,
        }


def web_state() -> Dict[str, Any]:
    """Stato onesto dell'ultimo passaggio web per il router (B1.2):
    'giu' ammesso SOLO se c'e' stato un tentativo HTTP reale fallito con
    errore loggato (o breaker aperto da quell'errore entro TTL)."""
    with _BREAKER_LOCK:
        st = dict(LAST_STATE)
        st["breaker"] = {
            "open": time.time() < float(_BREAKER["open_until"]),
            "ttl_s": BREAKER_TTL_S,
            "last_error": dict(_BREAKER["last_error"]) if _BREAKER["last_error"] else None,
            "open_count": int(_BREAKER["open_count"]),
            "ts": time.time(),
        }
    return st


def escalate(query: str, gate_outcome: str = "", mode: Optional[str] = None,
             top_k: int = 5, **kwargs) -> List[WebResult]:
    """W4 - R18 B1.1/B1.2: OGNI domanda fattuale nuova TENTA il web.

    Contratto R18:
      mode='mai'    -> [] SUBITO, ZERO chiamate di rete (opt-out config);
      mode='auto'/'sempre' -> SEMPRE tentativo HTTP reale (lo short-circuit
        pre-tentativo per gate 'piena' e' RIMOSSO - F0.1 short_circuit);
      circuit-breaker: se un tentativo reale e' fallito con errore loggato
        il breaker resta aperto max 60s (retry per query alla scadenza);
        entro il TTL [] e' ammesso perche' l'errore e' REALE e loggato
        (url/status/eccezione in breaker_state().last_error).
    mode=None -> legge config 'web.mode' (default 'auto'). Mai eccezioni.
    """
    global LAST_STATE
    if mode is None:
        mode = str(_cfg("web.mode", "auto") or "auto")
    mode = str(mode or "auto").strip().lower()

    if mode == "mai":
        with _BREAKER_LOCK:
            LAST_STATE = {"attempted": False, "via_breaker": False,
                          "n_results": 0, "ok": False,
                          "reason": "mode-mai", "ts": time.time()}
        return []                      # zero rete, garantito

    # --- circuit-breaker: solo post-errore reale entro TTL --------------
    with _BREAKER_LOCK:
        if time.time() < float(_BREAKER["open_until"]):
            err = dict(_BREAKER["last_error"] or {})
            LAST_STATE = {"attempted": False, "via_breaker": True,
                          "n_results": 0, "ok": False,
                          "reason": "breaker-aperto", "ts": time.time()}
            print("[web_stage] escalation saltata: circuit-breaker aperto "
                  f"fino a {int(_BREAKER['open_until'])} (ultimo errore: {err})")
            return []
        n_before = _net_len()

    from core.web_search import search_web
    t0 = time.perf_counter()
    res: List[WebResult] = []
    err_msg = ""
    try:
        res = search_web(query, max_results=int(top_k or 5), **kwargs)
    except Exception as e:
        # errore reale non intercettato da web_search: loggato lo stesso
        err_msg = f"{type(e).__name__}: {e}"
        with _BREAKER_LOCK:
            LAST_STATE = {"attempted": True, "via_breaker": False,
                          "n_results": 0, "ok": False,
                          "reason": "eccezione: " + err_msg, "ts": time.time()}
            _BREAKER["last_error"] = {"url": "", "provider": "search_web",
                                      "status": None, "error": err_msg,
                                      "ts": time.time()}
            _BREAKER["open_until"] = time.time() + BREAKER_TTL_S
            _BREAKER["open_count"] += 1
        print(f"[web_stage] escalate fallita: {e}")
        return []

    entries = _net_tail(n_before)
    upd = _update_breaker(entries, had_results=bool(res))
    with _BREAKER_LOCK:
        any_ok = any(bool(e.get("ok")) for e in entries)
        LAST_STATE = {
            "attempted": True, "via_breaker": False,
            "n_results": len(res or []),
            "ok": bool(any_ok or res),
            "reason": ("ok" if (any_ok or res)
                       else "tentativi HTTP falliti/vuoti"),
            "ts": time.time(),
        }
        if entries and not (any_ok or res):
            # tutti i tentativi falliti: assicurati che last_error esista
            fails = [e for e in entries if not e.get("ok")]
            if fails and not _BREAKER["last_error"]:
                _BREAKER["last_error"] = _fail_last(fails)
    return res

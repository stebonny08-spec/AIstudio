"""
core/local_search.py
----------------------
Facciata semplice usata dal router: dato il testo di una domanda, aggiorna
l'indice (in modo incrementale ed economico) e ritorna i chunk più
rilevanti trovati nei file locali, comprese le eventuali immagini collegate.

Soglia di similarità a DUE LIVELLI:
  1. Soglia alta (0.45): se ci sono chunk sopra, uso quelli (max top_k).
     Questi sono i match chiaramente pertinenti.
  2. Soglia bassa (0.35): se nessuno supera 0.45, prendo fino a 3 chunk
     sopra 0.35. Questi sono match "borderline" che possono comunque
     essere utili, meglio di niente.
  3. Sotto 0.35: nessun chunk → il RAG non parte, il modello risponde
     con le sue conoscenze generali.

La strategia è quella del "recupero a due stadi": prima si prova il match
forte, poi (se non c'è) si allarga leggermente.

H8 — RETRIEVAL (capacità esposte, nessun cambio di default per i caller):
  - search(..., hybrid=True) → promuove hybrid_search a percorso opzionale
    di search(); hybrid=False (default) resta IDENTICO al comportamento
    storico (regressione: tests/testH1_parity.py 10/10).
  - RRF ufficiale k=60 (RRF_K, condiviso con vector_store_sqlite).
  - apply_context_prefixes(query, chunk_prefix_map): prefisso contestuale
    W1 deterministico (nessuna chiamata LLM); get_context_prefix(doc_id)
    da meta del chunk / tabelle doc_versions|meta (assente → None).
  - cap_parent_text(text, max_chars=5200) + build_prompt_context():
    cappatura del genitore (~1200-1500 token) dove i chunk vengono
    raccolti per il prompt. La raccolta in api.py/router NON è toccata:
    la funzione è esportata e applicata internamente in
    build_prompt_context (api.py potrà chiamarla in futuro).
  - Confidence gate con astensione: LocalSearchResult.confidence
    (alta|media|bassa|nessuna) + should_answer (H8).
  - needs_rewrite / conservative_rewrite: rewrite SOLO per query
    colloquiali/frasali, deterministic, no LLM.
  - search(..., reranker=False): opt-in per core/rag/reranker_int8
    (PLACEHOLDER non addestrato, dichiarato nel modulo).
"""

import re
import time
from typing import Dict, List, Optional, Tuple

from core.models import LocalSearchResult, RetrievedChunk
from core.rag.embedder import Embedder
from core.rag.indexer import Indexer, ProgressCallback
from core.rag.vector_store import VectorStore
from core.rag.vector_store_sqlite import RRF_K, rrf_fuse
from data.db import Database

# Soglia alta: chunk con similarità >= questa sono considerati "chiaramente
# pertinenti" e passano senza ulteriori controlli.
MIN_SIMILARITY_STRONG = 0.45

# Soglia bassa: se non c'è nulla sopra la soglia alta, si accettano fino a
# MAX_WEAK_CHUNKS chunk con similarità >= questa. Sono match "borderline".
MIN_SIMILARITY_WEAK = 0.35

# Numero massimo di chunk "borderline" che si accettano quando non ci sono
# match forti. Volamente basso: meglio 2-3 chunk marginali che 10.
MAX_WEAK_CHUNKS = 3

# H8: cappatura del testo del genitore per il contesto di prompt.
# 5200 chars ≈ 1300 token (finestra 1200-1500 token dichiarata in H8).
PARENT_TEXT_MAX_CHARS = 5200
DEFAULT_ELLIPSIS = " …"


def _rag_flag(name: str) -> bool:
    """P1b.3: flag tecnica RAG (gate.rag_flag, lazy, mai eccezione)."""
    try:
        from core.rag.gate import rag_flag
        return rag_flag(name)
    except Exception:
        return False


def _is_originals_source(source_file) -> bool:
    """True se il chunk proviene da originals/ (cartella MAI indicizzata).

    Difesa in query (C4): copre eventuali vettori orfani rimasti in indice
    da scansioni passate (prima della migrazione C3). Confronto sui soli
    componenti di directory (il nome del file e escluso), case-insensitive
    e con entrambi i separatori di percorso normalizzati.
    """
    if not source_file:
        return False
    parts = str(source_file).replace("\\", "/").lower().split("/")
    return "originals" in parts[:-1]  # [:-1] = solo cartelle, non il file


# ======================================================================
# H8 — confidence gate con astensione
# ======================================================================
def _confidence_from_sims(sims: List[float]) -> Tuple[str, bool]:
    """Mappa le similarità selezionate → (confidence, should_answer).

    Regole H8:
      - nessun chunk >= 0.45 (forte) E nessun debile >= 0.35
        → ("nessuna", False): il caller si astiene
        ("non ho abbastanza informazioni").
      - almeno 1 forte (>= 0.45)      → ("alta", True)
      - solo debili (>= 0.35)         → ("bassa", True)
      - "media" è riservato (default "non calcolato" del dataclass) e
        non viene prodotto dal gate attuale.
    """
    if any(s >= MIN_SIMILARITY_STRONG for s in sims):
        return "alta", True
    if any(s >= MIN_SIMILARITY_WEAK for s in sims):
        return "bassa", True
    return "nessuna", False


def _empty_result() -> LocalSearchResult:
    """Risultato vuoto con gate di astensione applicato."""
    return LocalSearchResult(chunks=[], confidence="nessuna", should_answer=False)


# ======================================================================
# H8 (3) — cappatura genitore + raccolta contesto per il prompt
# ======================================================================
def cap_parent_text(text: str, max_chars: int = PARENT_TEXT_MAX_CHARS) -> str:
    """Cappa il testo del genitore a max_chars (~1200-1500 token).

    - testo corto (<= max_chars) → invariato;
    - testo lungo → troncato a max_chars + ellipsis (" …").
    Esportata: api.py/router raccolgono i chunk per il prompt e possono
    (dovranno) applicarla lì; qui viene usata da build_prompt_context.
    """
    if not text:
        return ""
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + DEFAULT_ELLIPSIS


def build_prompt_context(
    chunks: Optional[List[RetrievedChunk]],
    max_chars: int = PARENT_TEXT_MAX_CHARS,
    sep: str = "\n\n",
) -> str:
    """Raccoglie i chunk recuperati nel testo di contesto per il prompt.

    Ogni testo di chunk/genitore passa da cap_parent_text (cappatura
    5200 chars ≈ 1300 token). Le immagini (is_image) sono saltate: non
    hanno testo da inserire nel contesto. Funzione ESPORTATA per i
    caller che costruiscono il prompt (api.py/router non toccati).
    """
    parts: List[str] = []
    for c in chunks or []:
        if getattr(c, "is_image", False):
            continue
        capped = cap_parent_text(getattr(c, "text", "") or "", max_chars=max_chars)
        if capped:
            parts.append(capped)
    return sep.join(parts)


# ======================================================================
# H8 (2) — prefissi contestuali W1 (deterministico, no LLM)
# ======================================================================
def apply_context_prefixes(
    query: str,
    chunk_prefix_map: Optional[Dict[str, Optional[str]]],
) -> List[str]:
    """Sceglie il prefisso contestuale più probabile per la query (W1).

    chunk_prefix_map: {documento/area → prefisso contestuale} (i valori
    possono essere None/vuoti → ignorati). Implementazione DETERMINISTICA
    e leggera, nessuna chiamata LLM (W1 sarà un worker offline dedicato):

      - score(prefisso) = numero di token in comune con la query;
      - vincente = score massimo (>0); pareggi → chiave lessicograficamente
        prima (stabile a ogni esecuzione);
      - nessun overlap → [] (nessun prefisso aiuta).

    Ritorna la lista pronta per hybrid_search(prefixes=...).
    """
    if not chunk_prefix_map:
        return []
    q_tokens = set(re.findall(r"\w+", (query or "").lower(), flags=re.UNICODE))
    if not q_tokens:
        return []
    best_key: Optional[str] = None
    best_score = 0
    for key in sorted(chunk_prefix_map.keys(), key=str):
        prefix = chunk_prefix_map.get(key)
        if not prefix or not str(prefix).strip():
            continue
        p_tokens = set(re.findall(r"\w+", str(prefix).lower(), flags=re.UNICODE))
        score = len(q_tokens & p_tokens)
        if score > best_score:
            best_score = score
            best_key = key
    if best_key is None:
        return []
    return [str(chunk_prefix_map[best_key]).strip()]


# ======================================================================
# H8 (5) — rewrite deterministico delle sole query colloquiali
# ======================================================================
# Frasi/domande comuni che segnalano una query colloquiale/frasale.
_REWRITE_PHRASES = (
    "che cos'è", "che cos'e", "che cosa", "cos'è", "cos'e",
    "qual è", "qual e", "in che modo", "a cosa serve", "per qual motivo",
)
# Parole-chiave (token interi, mai sottostringhe: "come" non matcha "economia").
_REWRITE_WORDS = {
    "come", "spiega", "spiegami", "perché", "perche", "dimmi",
    "quando", "dove", "chi", "cosa", "descrivi", "racconta",
}
# Segnali di query tecnica/corta: NON va riscritta.
_TECH_RE = re.compile(
    r"[_/\\#]|https?://|\bdef\b|\bclass\b|\bimport\b|\breturn\b|"
    r"\bselect\b|\bjoin\b|\binner\b|\btable\b|\d+|[a-z]+[A-Z]|<[^>]+>",
    flags=re.UNICODE,
)
_TECH_WORDS = {
    "python", "sql", "json", "api", "html", "css", "git", "regex",
    "numpy", "pandas", "docker", "linux", "bash", "array", "query",
    "boolean", "null", "true", "false", "string", "integer", "float",
    "stack", "heap", "cpu", "gpu", "http", "tcp", "udp", "uuid",
    "def", "class", "import", "return",
}


def _is_technical(query: str) -> bool:
    """True se la query contiene termini/pattern tecnici."""
    if _TECH_RE.search(query or ""):
        return True
    tokens = set(re.findall(r"\w+", (query or "").lower(), flags=re.UNICODE))
    return bool(tokens & _TECH_WORDS)


def needs_rewrite(query: str) -> True:
    """True se la query è colloquiale/frasale e merita conservative_rewrite.

    Regole H8:
      - query TECNICA e corta (<= 6 parole, con termini tecnici)
        → False: MAI riscritta;
      - > 6 parole → True (frasale);
      - <= 6 parole con domande comuni ("che cos'è", "come", "spiega",
        "perché", ...) → True.
    Deterministico, nessun LLM.
    """
    q = (query or "").strip().lower()
    if not q:
        return False
    words = q.split()
    if len(words) <= 6 and _is_technical(q):
        return False
    if len(words) > 6:
        return True
    if any(p in q for p in _REWRITE_PHRASES):
        return True
    return bool(set(words) & _REWRITE_WORDS)


# Riempitivi colloquiali rimossi dalla rewrite conservativa.
_FILLERS = (
    "voglio sapere", "vorrei sapere", "mi sapresti dire", "mi puoi dire",
    "puoi dirmi", "potresti dirmi", "potresti spiegarmi", "puoi spiegarmi",
    "spiegami", "dimmi per favore", "vorrei capire", "a proposito di",
    "grazie mille", "salve,", "ciao,",
)


def conservative_rewrite(query: str) -> str:
    """Rewrite conservativa e DETERMINISTICA (nessun LLM).

    Solo: normalizza spazi/minuscolo e rimuove i riempitivi colloquiali
    ("voglio sapere", "mi puoi dire", ...). Il contenuto informativo della
    query non viene mai riscritto/tradotto. Se il risultato è vuoto si
    ritorna la query normalizzata originale.
    """
    original = re.sub(r"\s+", " ", (query or "").strip().lower())
    if not original:
        return ""
    q = original
    for filler in _FILLERS:
        q = re.sub(r"\b" + re.escape(filler) + r"\b", " ", q)
    q = re.sub(r"\s+", " ", q).strip(" ,.!?;:")
    return q or original


def rewrite_query(query: str) -> str:
    """Applica la rewrite SOLO se needs_rewrite(query) è True."""
    if needs_rewrite(query):
        return conservative_rewrite(query)
    return query


# ======================================================================
# H8 (6) — reranker int8 opt-in (PLACEHOLDER non addestrato)
# ======================================================================
def _apply_reranker(query: str, rows: List[dict], top_n: int = 10) -> List[dict]:
    """Riordana i top_n candidati con core.rag.reranker_int8 (opt-in).

    Il modulo è un PLACEHOLDER dichiarato (bag-of-words int8, non
    addestrato): se assente o in errore i ranking restano invariati.
    Default OFF: viene invocato solo da search/hybrid con reranker=True.
    """
    if not rows or len(rows) <= 1:
        return rows
    head = list(rows[:top_n])
    tail = list(rows[top_n:])
    indexed = list(enumerate(head))
    # P1b.3: modello ONNX REALE solo se pronto (>=50MB + tokenizer valido);
    # altrimenti placeholder BOW dichiarato con log di guardia (G6).
    rr = None
    try:
        from core.rag import reranker_int8 as _rrm
        _ok, _why = _rrm.model_ready()
        if _ok:
            rr = _rrm.OnnxReranker()
            print(f"[Reranker] ONNX reale attivo ({_why})")
        else:
            print(f"[Reranker] ONNX non pronto ({_why}) -> placeholder BOW")
    except Exception:
        rr = None
    if rr is None:
        try:
            from core.rag.reranker_int8 import RerankerInt8
            rr = RerankerInt8()
        except Exception:
            return rows
    try:
        indexed.sort(
            key=lambda t: (-float(rr.score(query, t[1].get("text") or "")), t[0])
        )
    except Exception:
        return rows
    return [r for _, r in indexed] + tail


class LocalSearchEngine:
    def __init__(self, db: Database, vector_store: VectorStore, embedder: Optional[Embedder] = None):
        self.db = db
        self.vector_store = vector_store
        self.embedder = embedder or Embedder()
        self.indexer = Indexer(db, vector_store, self.embedder)
        # P2: warmup embedder ALL'AVVIO ENGINE — best-effort e non bloccante
        # (Embedder.warmup spawna un thread daemon e ritorna subito; gli
        # embedder di test senza warmup vengono saltati via hasattr).
        self.last_probe: Dict = {}
        warm = getattr(self.embedder, "warmup", None)
        if callable(warm):
            try:
                warm()
            except Exception as exc:  # pragma: no cover - best-effort
                print(f"[LocalSearch] warmup embedder non avviabile: {exc}")

    def ensure_index_updated(
        self,
        folder_path: str,
        ocr_enabled: bool = True,
        progress_callback: ProgressCallback = None,
    ) -> None:
        self.indexer.index_folder(folder_path, ocr_enabled=ocr_enabled, progress_callback=progress_callback)

    # ------------------------------------------------------------------
    # H8 (2) — lookup prefisso contestuale per documento
    # ------------------------------------------------------------------
    def get_context_prefix(self, doc_id: str) -> Optional[str]:
        """Prefisso contestuale W1 per doc_id (meta del chunk / tabelle
        doc_versions|meta dichiarate). Assente → None. Nessun LLM."""
        fn = getattr(self.vector_store, "get_context_prefix", None)
        if callable(fn):
            try:
                return fn(doc_id)
            except Exception:
                return None
        return None

    def search(self, query: str, top_k: int = 5,
                topic: Optional[str] = None,
                hybrid: bool = False,
                prefixes: Optional[List[str]] = None,
                reranker: bool = False,
                variants: Optional[List[str]] = None) -> LocalSearchResult:
        """Cerca i chunk più pertinenti per la query.

        top_k è il numero massimo di chunk da restituire nel caso di match
        forti. Nel caso di match deboli, ne restituisce al massimo
        MAX_WEAK_CHUNKS.

        Se viene passato un topic (argomento scelto per la conversazione),
        il recupero viene ristretto al sottoinsieme di chunk pertinenti a
        quell'argomento: prima si costruisce il gruppo tramite embedding
        dell'argomento, poi la domanda normale viene filtrata su quel gruppo.

        H8 (capacità, default INVARIATO):
          hybrid=False (default) → percorso storico IDENTICO (regressione
              tests/testH1_parity.py 10/10 deve passare invariato);
          hybrid=True → delega a hybrid_search (RRF + prefissi W1);
          reranker=True → riordino opt-in top-10 con reranker_int8
              (PLACEHOLDER non addestrato, default OFF).

        Il risultato espone H8 confidence (alta|media|bassa|nessuna) e
        should_answer (gate di astensione).
        """
        self.last_probe = {}
        if hybrid:
            return self.hybrid_search(
                query, top_k=top_k, topic=topic,
                prefixes=prefixes, reranker=reranker,
                variants=variants,
            )

        if not query.strip() or self.vector_store.count() == 0:
            return _empty_result()

        query_embedding = self.embedder.embed_one(query, kind="query")

        # Prendo il doppio di quello che serve, per avere margine dopo il filtro
        fetch_n = max(top_k * 2, 10)
        raw_results = self.vector_store.query(query_embedding, top_k=fetch_n)
        # C4: difesa in query — esclude chunk di originals/ (vettori orfani).
        # Le soglie NON vengono alzate: si toglie solo ciò che non deve
        # mai comparire tra le fonti.
        raw_results = [
            r for r in raw_results
            if not _is_originals_source(r.get("source_file"))
        ]

        # --- Filtro per argomento (sottoinsieme legato al topic) ---
        topic = (topic or "").strip()
        if topic and raw_results:
            try:
                topic_embedding = self.embedder.embed_one(topic, kind="query")
                topic_results = self.vector_store.query(
                    topic_embedding, top_k=max(fetch_n * 2, 30)
                )
                # C4: stessa esclusione di originals/ anche nel filtro topic
                topic_results = [
                    r for r in topic_results
                    if not _is_originals_source(r.get("source_file"))
                ]
                topic_texts = {r["text"] for r in topic_results}
                scoped = [r for r in raw_results if r["text"] in topic_texts]
                if scoped:
                    # La domanda è stata risposta solo con chunk pertinenti
                    # anche all'argomento scelto.
                    raw_results = scoped
                else:
                    # Nessun overlap: restano i chunk dell'argomento più
                    # vicini (comunque rilevanti per il topic scelto).
                    raw_results = [
                        r for r in topic_results
                        if r["similarity"] >= MIN_SIMILARITY_WEAK
                    ][:top_k]
            except Exception as e:
                # In caso di errore si continua senza filtro: meglio la
                # ricerca normale che nessuna risposta.
                print(f"[LocalSearch] Filtro argomento non disponibile: {e}")

        # --- H8 (6): reranker opt-in (P1b.3: serve anche il flag) ---
        # reranker=True resta opt-in del caller; deve valere ANCHE il flag
        # di config rag.rerank.enabled (default OFF, esito A/B
        # qa/p1b_rag.json: BLOCKED, modello ONNX non pronto).
        if reranker and _rag_flag("rag.rerank.enabled"):
            raw_results = _apply_reranker(query, raw_results)

        # --- Stadio 1: match forti ---
        strong = [r for r in raw_results if r["similarity"] >= MIN_SIMILARITY_STRONG]
        if strong:
            selected = strong[:top_k]
        else:
            # --- Stadio 2: match borderline (pochi) ---
            weak = [r for r in raw_results if r["similarity"] >= MIN_SIMILARITY_WEAK]
            selected = weak[:MAX_WEAK_CHUNKS]

        if not selected:
            return _empty_result()

        chunks: List[RetrievedChunk] = [
            RetrievedChunk(
                text=r["text"],
                source_file=r["source_file"],
                location_hint=r["location_hint"],
                similarity=r["similarity"],
                is_image=r["is_image"],
                image_path=r["image_path"] or None,
                mime_type=r["mime_type"] or None,
            )
            for r in selected
        ]
        confidence, should_answer = _confidence_from_sims(
            [float(r["similarity"]) for r in selected]
        )
        return LocalSearchResult(
            chunks=chunks, confidence=confidence, should_answer=should_answer,
        )

    # ------------------------------------------------------------------
    # H8 — ricerca ibrida (vettore + FTS5) con fusione RRF
    # ------------------------------------------------------------------
    def hybrid_search(
        self,
        query: str,
        top_k: int = 5,
        topic: Optional[str] = None,
        prefixes: Optional[List[str]] = None,
        reranker: bool = False,
        variants: Optional[List[str]] = None,
    ) -> LocalSearchResult:
        """Ricerca ibrida UFFICIALE per H8: fusione RRF dei ranking.

        Fonti fuse (tutte con score = Σ 1/(k_rrf + rank), RRF k=60):
          1. lista vettoriale (query embedding) per ogni variante;
          2. lista FTS5 (bm25) per ogni variante;
          3. ogni variante = query + eventuale prefisso contestuale W1
             (`prefixes=["Lezione 3:", "Appunti di biologia:"]` →
             "Lezione 3: <query>", ...). prefixes=None (default) → una
             sola variante: la query pura. I prefissi possono anche
             essere prodotti da apply_context_prefixes(query, map).

        Rewrite (H8,5): se needs_rewrite(query) la query viene prima
        normalizzata con conservative_rewrite (deterministico, no LLM);
        query tecniche/corte non vengono mai riscritte.

        Semantica dei punteggi:
          - un risultato con vettore tiene la sua vera similarity (1-cos);
          - un risultato trovato SOLO da FTS entra con
            PROVISIONAL_FTS_SIMILARITY (0.40): cade nella fascia
            "borderline" (>=0.35, <0.45), quindi non supera mai la soglia
            forte e vive nel limite MAX_WEAK_CHUNKS.
          Le soglie forti/debili, il filtro originals/ e il filtro topic
          sono IDENTICI a search(); il gate confidence/should_answer è
          esposto anche qui (H8,4).

        reranker=True → riordino opt-in top-10 con reranker_int8
        (PLACEHOLDER non addestrato). Default OFF.
        """
        # ------- P3: strumentazione per-stadio (timings + probe dump) ----
        # Ultima chiamata ibrida espone self.last_probe:
        #   embed_ms/fts_ms/vec_ms/total_ms + liste vec/fts/fuse + candidati
        # pre-soglia. Il router P lo consuma per costruire RetrievalOutcome.
        t_total = time.perf_counter()
        self.last_probe = {
            "query_norm": query, "embed_ms": 0.0, "fts_ms": 0.0,
            "vec_ms": 0.0, "total_ms": 0.0, "variants": 0,
            "vec_lists": [], "fts_lists": [], "fused": [],
            "candidates": [],
        }
        if not query.strip() or self.vector_store.count() == 0:
            self.last_probe["total_ms"] = (time.perf_counter() - t_total) * 1000.0
            return _empty_result()

        # H8 (5): rewrite conservativa solo per query colloquiali.
        query = rewrite_query(query) or query
        self.last_probe["query_norm"] = query

        # ---- P1b.3 HyDE (flag rag.hyde): hyp via sidecar -> vettore ----
        # IL TESTO ipotetico sostituisce la query SOLO nell'embedding della
        # variante principale; la FTS5 resta sulla query originale.
        # Sidecar giu'/timeout (~8s) -> fallback silenzioso alla query
        # normale (dettagli in last_probe["hyde"], nessuna eccezione).
        hyde_text = None
        if _rag_flag("rag.hyde"):
            try:
                from core.rag.hyde import generate_hypothetical
                _hyp, _hinfo = generate_hypothetical(query)
                self.last_probe["hyde"] = _hinfo
                if _hyp:
                    hyde_text = _hyp
            except Exception as _hexc:
                self.last_probe["hyde"] = {"ok": False,
                                           "reason": f"err:{_hexc}"}

        # Varianti: query pura + una per ogni prefisso contestuale W1 +
        # sub-query decomposte P1 (solo regola esplicita ai_router).
        all_variants = [query]
        for prefix in prefixes or []:
            prefix = (prefix or "").strip()
            if prefix:
                all_variants.append(f"{prefix} {query}".strip())
        for extra in variants or []:
            extra = (extra or "").strip()
            if extra and extra not in all_variants:
                all_variants.append(extra)
        self.last_probe["variants"] = len(all_variants)

        fetch_n = max(top_k * 2, 10)
        fts_fn = getattr(self.vector_store, "fts_query", None)
        lists: List[List[dict]] = []
        vec_lists: List[List[dict]] = []
        fts_lists: List[List[dict]] = []
        for _vi, variant in enumerate(all_variants):
            t0 = time.perf_counter()
            # P1b.3 HyDE: il vettore della variante 0 e' l'hyp (se HyDE ON
            # e generazione riuscita); la FTS5 sotto usa ancora `variant`.
            _emb_src = hyde_text if (_vi == 0 and hyde_text) else variant
            qe = self.embedder.embed_one(_emb_src, kind="query")
            self.last_probe["embed_ms"] += (time.perf_counter() - t0) * 1000.0
            t0 = time.perf_counter()
            vrows = self.vector_store.query(qe, top_k=fetch_n)
            self.last_probe["vec_ms"] += (time.perf_counter() - t0) * 1000.0
            vec_lists.append(vrows)
            lists.append(vrows)
            if callable(fts_fn):
                try:
                    t0 = time.perf_counter()
                    frows = fts_fn(variant, top_k=fetch_n)
                    self.last_probe["fts_ms"] += (time.perf_counter() - t0) * 1000.0
                    fts_lists.append(frows)
                    lists.append(frows)
                except Exception:
                    pass  # backend senza FTS: si fonde solo il vettore

        fused = rrf_fuse(lists, k=RRF_K)
        # P3: liste per-stadio per il dump RetrievalOutcome (vec/fts scores)
        self.last_probe["vec_lists"] = vec_lists
        self.last_probe["fts_lists"] = fts_lists

        # Stessa difesa C4 di search(): originals/ mai tra le fonti.
        raw_results = [
            r for r in fused
            if not _is_originals_source(r.get("source_file"))
        ]

        # ---- P1b.3 CRAG-lite (flag rag.crag_lite) --------------------
        # GATE REALE (core.rag.gate.decide_gate, soglia gate.threshold)
        # sul pool appena fuso: se NON pieno -> UN retry locale con rewrite
        # deterministica (zero LLM) + rifusione RRF + re-gate. Il BLOCCO
        # della generazione resta il gate esistente del router (non
        # duplicato); il fallback web resta lo stage R16 (nessun hook qui).
        if _rag_flag("rag.crag_lite") and lists:
            try:
                from core.rag import crag_lite as _cl
                self.last_probe["fused"] = list(raw_results)
                _crag_weak = _cl.should_retry(query, self.last_probe)
                _cinfo: Dict = {"retried": False, "weak": bool(_crag_weak)}
                if _crag_weak:
                    _rq = _cl.crag_retry_query(query)
                    if _rq and _rq not in all_variants:
                        _tc = time.perf_counter()
                        all_variants.append(_rq)
                        t0 = time.perf_counter()
                        _qe = self.embedder.embed_one(_rq, kind="query")
                        self.last_probe["embed_ms"] += (time.perf_counter() - t0) * 1000.0
                        t0 = time.perf_counter()
                        _vr = self.vector_store.query(_qe, top_k=fetch_n)
                        self.last_probe["vec_ms"] += (time.perf_counter() - t0) * 1000.0
                        vec_lists.append(_vr)
                        lists.append(_vr)
                        if callable(fts_fn):
                            try:
                                t0 = time.perf_counter()
                                _fr = fts_fn(_rq, top_k=fetch_n)
                                self.last_probe["fts_ms"] += (time.perf_counter() - t0) * 1000.0
                                fts_lists.append(_fr)
                                lists.append(_fr)
                            except Exception:
                                pass
                        fused = rrf_fuse(lists, k=RRF_K)
                        raw_results = [
                            r for r in fused
                            if not _is_originals_source(r.get("source_file"))
                        ]
                        self.last_probe["vec_lists"] = vec_lists
                        self.last_probe["fts_lists"] = fts_lists
                        _cinfo = {"retried": True, "weak": True,
                                  "retry_query": _rq,
                                  "ms": round((time.perf_counter() - _tc) * 1000.0, 1),
                                  "n_variants": len(all_variants)}
                    else:
                        _cinfo["skipped"] = "retry_query_vuota_o_duplicata"
                self.last_probe["crag"] = _cinfo
                self.last_probe["variants"] = len(all_variants)
            except Exception as _cexc:
                self.last_probe["crag"] = {"error": str(_cexc)}

        def _sim(r) -> float:
            try:
                return float(r.get("similarity") or 0.0)
            except (TypeError, ValueError):
                return 0.0

        # --- Filtro per argomento (stessa logica di search) ---
        topic = (topic or "").strip()
        if topic and raw_results:
            try:
                topic_embedding = self.embedder.embed_one(topic, kind="query")
                topic_results = self.vector_store.query(
                    topic_embedding, top_k=max(fetch_n * 2, 30)
                )
                topic_results = [
                    r for r in topic_results
                    if not _is_originals_source(r.get("source_file"))
                ]
                topic_texts = {r["text"] for r in topic_results}
                scoped = [r for r in raw_results if r["text"] in topic_texts]
                if scoped:
                    raw_results = scoped
                else:
                    raw_results = [
                        r for r in topic_results
                        if _sim(r) >= MIN_SIMILARITY_WEAK
                    ][:top_k]
            except Exception as e:
                print(f"[LocalSearch] Filtro argomento non disponibile: {e}")

        # --- H8 (6): reranker opt-in (P1b.3: serve anche il flag) ---
        # reranker=True resta opt-in del caller; deve valere ANCHE il flag
        # di config rag.rerank.enabled (default OFF, esito A/B
        # qa/p1b_rag.json: BLOCKED, modello ONNX non pronto).
        if reranker and _rag_flag("rag.rerank.enabled"):
            raw_results = _apply_reranker(query, raw_results)

        # --- P3: pool candidati (post-filtri, PRE-soglie) per near_miss ---
        self.last_probe["fused"] = list(raw_results)
        self.last_probe["candidates"] = list(raw_results)

        strong = [r for r in raw_results if _sim(r) >= MIN_SIMILARITY_STRONG]
        if strong:
            selected = strong[:top_k]
        else:
            weak = [r for r in raw_results if _sim(r) >= MIN_SIMILARITY_WEAK]
            selected = weak[:MAX_WEAK_CHUNKS]

        if not selected:
            self.last_probe["total_ms"] = (time.perf_counter() - t_total) * 1000.0
            return _empty_result()

        chunks: List[RetrievedChunk] = [
            RetrievedChunk(
                text=r["text"],
                source_file=r["source_file"],
                location_hint=r.get("location_hint", ""),
                similarity=_sim(r),
                is_image=r.get("is_image", False),
                image_path=r.get("image_path") or None,
                mime_type=r.get("mime_type") or None,
            )
            for r in selected
        ]
        confidence, should_answer = _confidence_from_sims(
            [_sim(r) for r in selected]
        )
        self.last_probe["total_ms"] = (time.perf_counter() - t_total) * 1000.0
        return LocalSearchResult(
            chunks=chunks, confidence=confidence, should_answer=should_answer,
        )

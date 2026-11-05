"""
core/rag/embedder.py
---------------------
Trasforma testo in vettori numerici (embedding) per la ricerca per
similarità semantica.

Scelta di design: usiamo 'sentence-transformers' con il modello
'intfloat/multilingual-e5-small', che gira interamente in locale sul PC
dell'utente. Il modello è multilingua e allineato: una query in italiano
e un chunk in inglese che parlano dello stesso concetto finiscono vicini
nello spazio vettoriale. Questo è essenziale perché il corpus RAG può
contenere materiale sia italiano sia inglese, mentre le domande
dell'utente sono tipicamente in italiano.

Modello E5 — prefissi obbligatori:
    E5 è addestrato con prefissi distinti per query e passage:
        "query: <testo>"    per le domande dell'utente
        "passage: <testo>"  per i chunk da indicizzare
    Ometterli peggiora sensibilmente la qualità del retrieval. Non sono
    un'opzione: vanno sempre applicati. Per questo il default di embed()
    è kind="passage" (il caso più frequente: l'indicizzazione), mentre
    embed_one() ha default kind="query" (il caso d'uso tipico: cercare).

Coerente con l'obiettivo dell'app di azzerare i costi di gestione: anche
l'indicizzazione è 100% gratuita e offline. Il modello viene scaricato
automaticamente (una sola volta, ~470MB) al primo utilizzo e poi riusato
dalla cache locale di Hugging Face.
"""

import gc
import threading
from collections import OrderedDict
from typing import List, Literal

_MODEL_NAME = "intfloat/multilingual-e5-small"

EmbedKind = Literal["query", "passage"]

_model = None
_model_lock = threading.Lock()

# Cache piccola LRU per gli embedding di QUERY (non per l'indicizzazione):
# tiene l'istanza lazy calda solo per le domande frequenti, con memoria
# limitata (max _QUERY_CACHE_MAX vettori).
_QUERY_CACHE_MAX = 128
# Chiave LRU = (testo, model_id) - P2: la cache di query e' invalidata se
# cambia il modello di embedding (embedding_model_id del blocco I).
_query_cache: "OrderedDict[tuple, List[float]]" = OrderedDict()
_query_cache_lock = threading.Lock()

# ---------------------------------------------------------------- P2
# Warmup best-effort: Embedder.warmup() NON blocca mai (spawna un thread
# daemon una sola volta per processo che carica il modello E fa un mini
# encode di verifica). is_model_ready() espone lo stato per le misure.
_warmup_lock = threading.Lock()
_warmup_started = False
_model_ready = False


def is_model_ready() -> bool:
    """True se il modello E5 e' stato caricato (warmup o uso reale)."""
    return _model_ready or _model is not None


def _warmup_worker() -> None:
    """Thread daemon: carica il modello + mini-encode di verifica.
    Best-effort: qualunque errore viene loggato e ignorato (nessuna eccezione
    propagata al chiamante; il thread e' separato dal path della query).
    """
    global _model_ready
    try:
        model = _get_model()
        model.encode(
            _apply_prefix(["warmup"], "query"),
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        _model_ready = True
        print("[Embedder] warmup completato (modello caricato in background)")
    except Exception as exc:  # pragma: no cover - best-effort
        print(f"[Embedder] warmup best-effort non riuscito: {exc}")


def release_model() -> None:
    """Rilascia il modello di embedding dalla memoria (H1: "modello solo in
    indicizzazione").

    Dopo un ciclo di indicizzazione la sessione del modello non deve
    restare residente: chiama release_model() e la prossima query lo
    ricarica in modo lazy (la cache query LRU qui sopra evita ricarichi
    ripetuti per gli stessi testi). Nel progetto NON esiste un runtime
    ONNX: il backend e' sentence-transformers/torch, quindi il requisito
    "ONNX solo in indicizzazione" viene garantito rilasciando qui il
    modello a fine indicizzazione.
    """
    global _model, _model_ready
    with _model_lock:
        _model = None
    _model_ready = False
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def clear_query_cache() -> None:
    """Svuota la cache LRU degli embedding di query."""
    with _query_cache_lock:
        _query_cache.clear()


def _get_model():
    """Carica il modello di embedding una sola volta (lazy singleton).
    Il lock evita che due thread lo carichino contemporaneamente in memoria.
    """
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:  # doppio controllo: un altro thread potrebbe
                                  # averlo già caricato mentre aspettavamo il lock
                from sentence_transformers import SentenceTransformer
                _model = SentenceTransformer(_MODEL_NAME)
    return _model


def _apply_prefix(texts: List[str], kind: EmbedKind) -> List[str]:
    """Antepone il prefisso E5 corretto a ciascun testo.

    Il prefisso è identico per tutte le lingue: E5 allinea italiano e
    inglese nello stesso spazio vettoriale proprio grazie a questo
    meccanismo, non nonostante esso. Un chunk italiano e un chunk
    inglese ricevono entrambi "passage: ", e una query italiana riceve
    "query: " — indipendentemente dalla lingua dei testi.
    """
    prefix = "query: " if kind == "query" else "passage: "
    return [prefix + t for t in texts]


class Embedder:
    @property
    def model_id(self) -> str:
        """ID del modello di embedding (contratto P: Embedder.model_id)."""
        return _MODEL_NAME

    @property
    def warm(self) -> bool:
        """True quando il modello e' caricato (misura p95 encode warm)."""
        return is_model_ready()

    def warmup(self) -> None:
        """PRE-CARICAMENTO BEST-EFFORT (contratto P: -> None, mai bloccante).

        Avvia (una sola volta per processo) un thread daemon che carica il
        modello E5 ed esegue un mini-encode di verifica. Ritorna SEMPRE
        immediatamente: nessun caricamento nel path della prima query.
        Qualunque errore resta interno al thread (log + nessuna eccezione).
        """
        global _warmup_started
        try:
            with _warmup_lock:
                if _warmup_started or _model is not None:
                    return
                _warmup_started = True
            threading.Thread(
                target=_warmup_worker, daemon=True, name="embedder-warmup"
            ).start()
        except Exception as exc:  # pragma: no cover - mai bloccante
            print(f"[Embedder] warmup non avviabile: {exc}")

    def embed(self, texts: List[str], kind: EmbedKind = "passage") -> List[List[float]]:
        """Calcola l'embedding di una lista di testi in un'unica chiamata
        (molto più efficiente che chiamarlo testo per testo).

        kind: "passage" (default) per indicizzare chunk di documenti,
              "query" per le domande dell'utente.
        """
        if not texts:
            return []
        model = _get_model()
        prefixed = _apply_prefix(texts, kind)
        vectors = model.encode(
            prefixed,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        return vectors.tolist()

    def embed_one(self, text: str, kind: EmbedKind = "query") -> List[float]:
        """Embedding di un singolo testo. Default kind="query" perché il
        caso d'uso più frequente è embeddare la domanda dell'utente; per
        indicizzare un singolo passage, passare esplicitamente kind="passage".

        Per le query (kind="query") il risultato passa da una cache LRU
        piccola (_QUERY_CACHE_MAX): le domande ripetute non rieseguono il
        modello. I passage (indicizzazione) non entrano in cache: elevati
        e servono una volta sola.
        """
        if kind == "query":
            key = (text, _MODEL_NAME)   # P2: chiave = (query, model_id)
            with _query_cache_lock:
                cached = _query_cache.get(key)
            if cached is not None:
                _query_cache.move_to_end(key)
                return list(cached)
        vec = self.embed([text], kind=kind)[0]
        if kind == "query":
            with _query_cache_lock:
                _query_cache[key] = list(vec)
                _query_cache.move_to_end(key)
                while len(_query_cache) > _QUERY_CACHE_MAX:
                    _query_cache.popitem(last=False)
        return vec
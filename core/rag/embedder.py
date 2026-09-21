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

import threading
from typing import List, Literal

_MODEL_NAME = "intfloat/multilingual-e5-small"

EmbedKind = Literal["query", "passage"]

_model = None
_model_lock = threading.Lock()


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
        """
        return self.embed([text], kind=kind)[0]
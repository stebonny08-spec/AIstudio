"""
core/rag/embedder.py
---------------------
Trasforma testo in vettori numerici (embedding) per la ricerca per
similarità semantica.

Scelta di design: usiamo 'sentence-transformers' con il modello
'all-MiniLM-L6-v2', che gira interamente in locale sul PC dell'utente.
Coerente con l'obiettivo dell'app di azzerare i costi di gestione: anche
l'indicizzazione è 100% gratuita e offline, non consuma quota dell'API Gemini.

Il modello viene scaricato automaticamente (una sola volta, ~90MB) al primo
utilizzo e poi riusato dalla cache locale di Hugging Face.
"""

import threading
from typing import List

_MODEL_NAME = "all-MiniLM-L6-v2"

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


class Embedder:
    def embed(self, texts: List[str]) -> List[List[float]]:
        """Calcola l'embedding di una lista di testi in un'unica chiamata
        (molto più efficiente che chiamarlo testo per testo)."""
        if not texts:
            return []
        model = _get_model()
        vectors = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
        return vectors.tolist()

    def embed_one(self, text: str) -> List[float]:
        return self.embed([text])[0]

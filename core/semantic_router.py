"""
core/semantic_router.py
------------------------
Decide se una query deve attivare il RAG o se può essere gestita dal
modello con le sue conoscenze generali.

Usa un approccio "Semantic Router": calcola l'embedding della query e
lo confronta (similarità coseno) con due insiemi di esempi pre-classificati:
  - esempi "RAG": domande che richiedono il contesto dei materiali
  - esempi "NO-RAG": saluti, chiacchiere, domande generiche

Il gruppo con la similarità media più alta vince. Zero chiamate LLM,
latenza ~5 ms, nessuna RAM aggiuntiva (riusa l'embedder già caricato).

Ispirato a Jev (TypeSafe) e alla libreria Semantic Router, ma
implementato in locale senza dipendenze cloud.
"""

from __future__ import annotations

import threading
from typing import List, Optional
import numpy as np

from core.rag.embedder import Embedder


# ======================================================================
# ESEMPI DI ADDESTRAMENTO
# ======================================================================

_RAG_EXAMPLES: List[str] = [
    "spiega la fotosintesi clorofilliana",
    "qual è la formula dell'energia cinetica",
    "riassumi il capitolo sulla rivoluzione francese",
    "cosa dice il mio appunto sulla mitosi",
    "fammi un esercizio sui logaritmi",
    "ripassiamo la prima guerra mondiale",
    "chiariscimi il concetto di entropia",
    "cosa c'è scritto nel libro di biologia",
    "qual è la definizione di derivate parziali",
    "spiegami il teorema di Pitagora",
    "riassumi la lezione sui vettori",
    "cosa ho scritto sull'apparato digerente",
    "fammi delle domande sul capitolo 5",
    "esercizi di chimica organica",
    "ripasso di storia romana",
    "chiarimento sull'elettromagnetismo",
    "riassunto del manuale di diritto",
    "spiega l'equazione di Schrödinger",
    "qual è la differenza tra DNA e RNA",
    "come si risolve un'equazione di secondo grado",
    "cosa sono gli integrali",
    "spiegami la legge di Ohm",
    "fammi un test sul capitolo dei verbi latini",
    "quali sono le cause della crisi del '29",
    "spiegami la teoria della relatività",
]

_NO_RAG_EXAMPLES: List[str] = [
    # --- Saluti iniziali ---
    "ciao",
    "salve",
    "buongiorno",
    "buonasera",
    "buonanotte",
    "ehi",
    "bella",
    "ciao, ci sei?",
    "buondì",
    "hello",
    "hi",

    # --- Small talk ---
    "come stai",
    "come va",
    "tutto bene",
    "che si dice",
    "tutto a posto",
    "come butta",
    "che mi racconti",

    # --- Test di presenza ---
    "ci sei",
    "sei lì",
    "sei attivo",
    "funzioni",
    "test",
    "test 1 2 3",
    "prova",
    "sei online",

    # --- Identità ---
    "chi sei",
    "come ti chiami",
    "hai un nome",
    "cosa sei",
    "sei un essere umano",
    "sei un robot",
    "sei un'intelligenza artificiale",
    "chi ti ha creato",
    "parlami di te",

    # --- Capacità ---
    "cosa sai fare",
    "cosa puoi fare per me",
    "a cosa servi",
    "qual è il tuo scopo",
    "sai parlare in italiano",
    "capisci l'italiano",
    "puoi mentire",
    "puoi sbagliare",
    "sai mantenere un segreto",
    "ti puoi offendere",
    "puoi arrabbiarti",
    "cosa sai fare in questa app",
    "come funzioni",
    "a cosa servi in questo programma",
    "puoi vedere le immagini",
    "puoi leggere i miei appunti",
    "puoi aiutarmi a studiare",

    # --- Cortesia ---
    "grazie",
    "grazie mille",
    "mille grazie",
    "ti ringrazio",
    "sei stato gentilissimo",
    "sei molto bravo",
    "sei intelligente",
    "scusa",
    "mi scusi",
    "ti chiedo scusa",
    "per favore",
    "per cortesia",
    "non ti preoccupare",
    "fa niente",
    "lascia stare",
    "non importa",
    "ok",
    "va bene",
    "ho capito",
    "perfetto",
    "ottimo",
    "ricevuto",

    # --- Saluti finali ---
    "arrivederci",
    "addio",
    "a dopo",
    "a domani",
    "ci vediamo",
    "buona giornata",
    "buona serata",
    "sogni d'oro",
    "stammi bene",
    "abbi cura di te",
    "è stato un piacere",
    "alla prossima",
    "ci sentiamo",

    # --- Meta-comandi conversazionali ---
    "ripeti",
    "non ho capito",
    "cosa intendi",
    "puoi spiegarlo meglio",
    "sii più breve",
    "sii più sintetico",
    "parla più semplice",
]


class SemanticRouter:
    """Router basato su similarità semantica per decidere se usare il RAG."""

    def __init__(self, embedder: Embedder):
        self._embedder = embedder
        self._rag_vectors: Optional[np.ndarray] = None
        self._no_rag_vectors: Optional[np.ndarray] = None
        # P2: caricamento in BACKGROUND (il cold E5+115 esempi ~43,6s NON
        # deve stare nel path della prima query).
        self._warm_lock = threading.Lock()
        self._warm_started = False

    @property
    def ready(self) -> bool:
        """True quando i vettori di esempio sono calcolati (nessun blocco)."""
        return (
            self._rag_vectors is not None
            and self._no_rag_vectors is not None
        )

    def warmup(self) -> None:
        """Best-effort, mai bloccante: calcola i vettori degli esempi in un
        thread daemon una sola volta. Se non pronto a runtime il router P
        cade su regole deterministiche H9 (nessun blocco della query)."""
        with self._warm_lock:
            if self._warm_started or self.ready:
                return
            self._warm_started = True

        def _worker() -> None:
            try:
                self._ensure_vectors()
                print("[SemanticRouter] warmup esempi completato (background)")
            except Exception as exc:  # pragma: no cover - best-effort
                print(f"[SemanticRouter] warmup best-effort non riuscito: {exc}")
                with self._warm_lock:
                    self._warm_started = False  # permette un retry successivo

        try:
            threading.Thread(
                target=_worker, daemon=True, name="semantic-router-warmup"
            ).start()
        except Exception as exc:  # pragma: no cover
            print(f"[SemanticRouter] warmup non avviabile: {exc}")

    def _ensure_vectors(self) -> None:
        if self._rag_vectors is not None and self._no_rag_vectors is not None:
            return

        rag_vecs = self._embedder.embed(_RAG_EXAMPLES, kind="query")
        no_rag_vecs = self._embedder.embed(_NO_RAG_EXAMPLES, kind="query")

        self._rag_vectors = np.array(rag_vecs, dtype=np.float32)
        self._no_rag_vectors = np.array(no_rag_vecs, dtype=np.float32)

    def _avg_similarity(self, query_vec: np.ndarray, ref_vectors: np.ndarray) -> float:
        sims = ref_vectors @ query_vec
        return float(sims.mean())

    def should_use_rag(self, query: str) -> tuple[bool, float, float]:
        """Ritorna (usa_rag, sim_rag, sim_no_rag)."""
        if not query or not query.strip():
            return False, 0.0, 0.0

        self._ensure_vectors()

        query_vec = np.array(self._embedder.embed_one(query, kind="query"), dtype=np.float32)

        sim_rag = self._avg_similarity(query_vec, self._rag_vectors)
        sim_no_rag = self._avg_similarity(query_vec, self._no_rag_vectors)

        # Bias verso il RAG in caso di parità (rischio minore: se era
        # chiacchiera, il modello ignora comunque il contesto).
        if sim_rag >= sim_no_rag - 0.03:
            return True, sim_rag, sim_no_rag
        return False, sim_rag, sim_no_rag
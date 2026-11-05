"""
core/rag/reranker_int8.py
-------------------------
H8 (6) — reranker int8 top-10, OPT-IN (default OFF).

*** PLACEHOLDER DICHIARATO: NON ADDESTRATO *** (Round 12 — rinominato)
Non esiste un modello di ranking addestrato (né SVD addestrato, né pesi
appresi). L'implementazione corrente è un bag-of-words DETERMINISTICO
con conteggi interi quantizzati nel range int8 [-127, 127] e similarità
coseno tra i vettori di occorrenze. "int8" qui indica solo il tipo dei
pesi, NON un modello compresso/trained.

Stato onesto (Round 12 — nome esplicito):
  TRAINED = False            → nessun addestramento, nessun dataset.
  PLACEHOLDER_NAME = "reranker_placeholder"
  PLACEHOLDER_NOTE → descrizione leggibile del limite.

ROUND 12 (G6 — igiene registry):
  * classe rinominata RerankerPlaceholder (nome esplicito).
  * ALIAS backward-compatible: `RerankerInt8 = RerankerPlaceholder`
    → core/local_search.py (NON toccato) continua a importare
      `from core.rag.reranker_int8 import RerankerInt8` senza cambi.
  * GUARDIA: all'attivazione (reranker=True → costruzione dell'istanza
    dentro _apply_reranker di local_search) viene loggato:
      "[Reranker] NON ADDESTRATO — usato ordinamento base"

Interfaccia stabile H8 (sostituibile con un vero modello senza cambiare
i caller):
  RerankerPlaceholder.score(query, passage) -> float   (sim coseno BOW)
  RerankerPlaceholder.rerank(query, passages, top_k) -> List[int]
  get_reranker() -> RerankerPlaceholder
  RerankerInt8 -> ALIAS DEPRECATO di RerankerPlaceholder (non rimuovere)

Usato da core/local_search.search/hybrid_search SOLO con reranker=True.
"""

from __future__ import annotations

import logging
import re
from typing import Dict, List, Sequence

logger = logging.getLogger(__name__)

# Dichiarazione di onestà: nessun peso addestrato in questo modulo.
TRAINED = False
PLACEHOLDER_NAME = "reranker_placeholder"
PLACEHOLDER_NOTE = (
    "reranker non addestrato: ordina per similarità bag-of-words "
    "(conteggi int8, coseno) — placeholder deterministico H8"
)

_TOKEN_RE = re.compile(r"\w+", flags=re.UNICODE)
_INT8_MIN = -127
_INT8_MAX = 127

# Messaggio di guardia emesso ad ogni attivazione (reranker=True).
NOT_TRAINED_MSG = "[Reranker] NON ADDESTRATO — usato ordinamento base"


def _clamp_i8(value: int) -> int:
    """Quantizzazione intera nel range int8 (senza segno usato: 1..127)."""
    return max(_INT8_MIN, min(_INT8_MAX, int(value)))


def _bow(text: str) -> Dict[str, int]:
    """Conteggio token con pesi interi clampati in int8."""
    counts: Dict[str, int] = {}
    for tok in _TOKEN_RE.findall((text or "").lower()):
        counts[tok] = _clamp_i8(counts.get(tok, 0) + 1)
    return counts


class RerankerPlaceholder:
    """PLACEHOLDER (Round 12): score(query, passage) -> float in [0, 1].

    Ordina per similarità BOW/coseno con pesi int8 — NON addestrato.
    Dichiarazione: `trained == False` (vedi PLACEHOLDER_NOTE).

    La costruzione dell'istanza equivale ad ATTIVARE il reranker
    (local_search la fa solo con reranker=True): in tal caso viene
    loggato NOT_TRAINED_MSG per rendere esplicita la semiazione.
    """

    trained = TRAINED
    note = PLACEHOLDER_NOTE
    placeholder_name = PLACEHOLDER_NAME

    def __init__(self, log_untrained: bool = True) -> None:
        # Guardia di trasparenza: se qualcuno attiva il reranker e non è
        # addestrato, lo diciamo a log (nessuna eccezione, nessun crash).
        if log_untrained and not TRAINED:
            logger.warning(NOT_TRAINED_MSG)

    def score(self, query: str, passage: str) -> float:
        """Similarità coseno bag-of-words tra query e passaggio.

        Ritorna 0.0 se uno dei due testi non contiene token. Il valore è
        in [0, 1] (conteggi non negativi → coseno non negativo).
        """
        q = _bow(query)
        p = _bow(passage)
        if not q or not p:
            return 0.0
        dot = 0
        for tok, cnt in q.items():
            other = p.get(tok)
            if other:
                dot += cnt * other
        if dot == 0:
            return 0.0
        q_norm = sum(c * c for c in q.values()) ** 0.5
        p_norm = sum(c * c for c in p.values()) ** 0.5
        if q_norm <= 0.0 or p_norm <= 0.0:
            return 0.0
        return float(dot) / (q_norm * p_norm)

    def rerank(
        self, query: str, passages: Sequence[str], top_k: int = 10
    ) -> List[int]:
        """Indici dei migliori `top_k` passaggi, per score decrescente.

        Ordinamento stabile: a parità di score prevale l'indice originale
        (comportamento deterministico).
        """
        indexed = list(enumerate(list(passages)))
        indexed.sort(key=lambda t: (-self.score(query, t[1]), t[0]))
        limit = max(0, int(top_k))
        return [i for i, _ in indexed[:limit]]


# ALIAS backward-compatible (DEPRECATO — Round 12).
# core/local_search.py importa `RerankerInt8`: non toccare il caller,
# l'alias tiene in piedi l'interfaccia H8 finché il modulo esiste.
RerankerInt8 = RerankerPlaceholder


def get_reranker() -> "RerankerPlaceholder":
    """Factory H8 (statolessa: nessun modello caricato in memoria).

    Round 12: ritorna un RerankerPlaceholder (alias RerankerInt8).
    """
    return RerankerPlaceholder()



# ======================================================================
# P1b.3 — modello ONNX REALE (Xenova/bge-reranker-v2-m3) dietro flag
# ======================================================================
# Download in tools/models/rerank_bge-v2m3/ (coordinatore). Regola di
# qualita': il modello e' USABILE solo se .done presente, onnx >= 50MB e
# tokenizer.json e' JSON valido; altrimenti model_ready()==False ->
# nessuna costruzione sessione (nessuna attesa indefinita) e rerank
# dichiarato BLOCKED/OFF in qa/p1b_rag.json.

ONNX_MIN_BYTES = 50 * 1024 * 1024


def _onnx_dir():
    from pathlib import Path
    return Path(__file__).resolve().parents[2] / "tools" / "models" / "rerank_bge-v2m3"


def model_ready() -> "tuple":
    """(pronto, motivo) per il modello ONNX di rerank (P1b.3).

    Controlli: marker .done, onnx/model_quantized.onnx >= 50MB,
    tokenizer.json JSON valido. Motivo sempre popolato (log/BLOCKED).
    """
    import json as _json
    d = _onnx_dir()
    onnx = d / "onnx" / "model_quantized.onnx"
    if not (d / ".done").exists():
        return False, "marker .done mancante"
    if not onnx.exists():
        return False, "onnx/model_quantized.onnx mancante"
    try:
        sz = onnx.stat().st_size
    except OSError as exc:
        return False, f"onnx illeggibile: {exc}"
    if sz < ONNX_MIN_BYTES:
        return False, (f"model_quantized.onnx {sz} B < {ONNX_MIN_BYTES} B "
                       f"(download non completo/corrotto)")
    tok = d / "tokenizer.json"
    try:
        _json.loads(tok.read_text(encoding="utf-8"))
    except Exception as exc:
        return False, f"tokenizer.json non valido: {type(exc).__name__}: {exc}"
    return True, "ok"


class OnnxReranker:
    """Reranker ONNX reale: costruzione SOLO se model_ready()==True.

    Interfaccia speculare a RerankerPlaceholder (score/rerank) per non
    toccare i caller. Score = sigmoid(logit) del pair (query, passage),
    scala [0,1] come il placeholder.
    """

    trained = True
    backend = "onnx_bge-reranker-v2-m3-int8"

    def __init__(self) -> None:
        ok, why = model_ready()
        if not ok:
            raise RuntimeError(f"OnnxReranker non costruibile: {why}")
        import numpy as _np
        import onnxruntime as ort
        from tokenizers import Tokenizer
        d = _onnx_dir()
        self._np = _np
        self._sess = ort.InferenceSession(
            str(d / "onnx" / "model_quantized.onnx"),
            providers=["CPUExecutionProvider"])
        self._tok = Tokenizer.from_file(str(d / "tokenizer.json"))
        self._inputs = [i.name for i in self._sess.get_inputs()]

    def score(self, query: str, passage: str) -> float:
        try:
            enc = self._tok.encode(query or "", passage or "")
            feed = {}
            for name in self._inputs:
                if name == "input_ids":
                    vals = enc.ids
                elif name == "attention_mask":
                    vals = enc.attention_mask
                elif name == "token_type_ids":
                    vals = enc.type_ids
                else:
                    raise RuntimeError(f"input ONNX sconosciuto: {name}")
                feed[name] = self._np.array([vals], dtype=self._np.int64)
            out = self._sess.run(None, feed)[0]
            logit = float(self._np.asarray(out).reshape(-1)[0])
            logit = max(-60.0, min(60.0, logit))
            return 1.0 / (1.0 + self._np.exp(-logit))
        except Exception:
            return 0.0

    def rerank(self, query: str, passages, top_k: int = 10):
        indexed = list(enumerate(list(passages)))
        indexed.sort(key=lambda t: (-self.score(query, t[1]), t[0]))
        return [i for i, _ in indexed[:max(0, int(top_k))]]

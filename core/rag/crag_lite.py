# -*- coding: utf-8 -*-
"""core/rag/crag_lite.py — P1b.3: CRAG-lite dietro flag (rag.crag_lite).

Idea (CORRECTIVE RAG in miniatura, NO LLM, NO rete):
  dopo il retrieval ibrido, il GATE REALE (core.rag.gate.decide_gate,
  soglia gate.threshold da config, default 0.70) viene valutato sul pool
  appena fuso; se l'esito NON e' pieno -> UN solo retry locale con una
  rewrite DETERMINISTICA della query (termini di contenuto), rifusione
  RRF con la lista in piu', poi di nuovo gate.

  * BLOCCO GENERAZIONE: non duplicato — resta il gate esistente
    (router: informativa zero-LLM su OUTCOME_NULLA). Se dopo il retry
    l'esito resta debole, il gate decide come prima (nessun cambio di
    contratto). Il fallback WEB resta gestito dallo stage web R16
    esistente: crag_lite NON lo invoca (nessun hook di rete qui) — solo
    rewrite + retry + il solito verdetto del gate.
  * Metrica A/B sui 5 NEGATIVI del GT: quante "no-answer corrette"
    (OUTCOME_NULLA del gate) ON vs OFF — vedi qa/p1b_rag.json.

Collegamento (non duplicazione): outcome_from_probe costruisce un
RetrievalOutcome (contratto core.rag.contract) dai probe per-stadio di
LocalSearchEngine.last_probe, esattamente come fa il router in
_build_outcome (qui single-stage "appunti", il solo usato dall'A/B GT).
"""
from __future__ import annotations

import time
from types import SimpleNamespace
from typing import Any, Dict, Optional

from core.rag.contract import (
    OUTCOME_PIENA,
    STAGE_APPUNTI,
    RetrievalOutcome,
    StageHit,
)
from core.rag.gate import rag_flag

__all__ = [
    "crag_enabled",
    "gate_threshold",
    "crag_retry_query",
    "outcome_from_probe",
    "should_retry",
]


def crag_enabled() -> bool:
    """True se CRAG-lite e' attivo (flag rag.crag_lite / env RAG_TECH)."""
    return rag_flag("rag.crag_lite")


def gate_threshold() -> float:
    """Soglia gate da config (gate.threshold, default 0.70)."""
    try:
        from data.config_manager import ConfigManager
        return float(ConfigManager().get("gate.threshold", 0.70))
    except Exception:
        return 0.70


# Parole-guida/domanda escluse dalla rewrite di retry (oltre alle stopword
# del gate): il retry cerca keyword "da索引", non una frase interrogativa.
_RETRY_DROP = frozenset("""
qual quali quanto quanta cosa cose chi dove quando come perche perché
spiega spiegami dimmi descrivi racconta vorrei voglio sapere potresti
puoi riesci tra nelle sui sul delle degli degli nella nel
""".split())


def crag_retry_query(query: str) -> str:
    """Rewrite DETERMINISTICA per il retry (zero LLM).

    Toglie parole-guida e stopword, tiene i soli termini di contenuto
    (normalizzati come li normalizza il gate: minuscolo/senza accenti),
    max 12 termini. Se non resta nulla -> rewrite conservativa della
    query originale (comunque mai vuota).
    """
    from core.rag.gate import _tokens  # stesso tokenizzatore del gate
    toks = [t for t in _tokens(query or "") if t not in _RETRY_DROP]
    if toks:
        return " ".join(toks[:12])
    try:
        from core.local_search import conservative_rewrite
        return conservative_rewrite(query or "")
    except Exception:
        return (query or "").strip()


def _sim(row: Any) -> float:
    try:
        return float(row.get("similarity") or 0.0)
    except (TypeError, AttributeError, ValueError):
        return 0.0


def outcome_from_probe(query: str, probe: Dict[str, Any],
                       stage: str = STAGE_APPUNTI) -> RetrievalOutcome:
    """RetrievalOutcome (contratto G) costruito dai probe di LocalSearch.

    Single-stage: usa fused/candidates del probe + dump per-stadio
    (vec_lists -> vec_scores ordinati desc, fts_lists -> bm25 raw, come
    si aspetta gate._fts_info). Stessa struttura che il router ricava da
    _build_outcome per lo stadio appunti.
    """
    probe = probe or {}
    fused_rows = list(probe.get("fused") or probe.get("candidates") or [])
    hits = []
    for i, r in enumerate(fused_rows[:10], start=1):
        chunk = SimpleNamespace(
            text=str(r.get("text") or ""),
            source_file=str(r.get("source_file") or ""),
        )
        hits.append(StageHit(chunk=chunk, stage=stage, score=_sim(r),
                             rrf_rank=i))
    vec_sims = []
    for vl in probe.get("vec_lists") or []:
        for r in vl:
            vec_sims.append(_sim(r))
    vec_sims.sort(reverse=True)  # vec_top legge il primo > 0
    fts_scores = []
    for fl in probe.get("fts_lists") or []:
        for r in fl:
            try:
                fts_scores.append(float(r.get("bm25") or 0.0))
            except (TypeError, ValueError):
                fts_scores.append(0.0)
    probed = ["appunti"] if (probe.get("vec_lists") or probe.get("fts_lists")) \
        else []
    return RetrievalOutcome(
        query=query,
        query_norm=str(probe.get("query_norm") or query),
        fused=hits,
        fts_scores=fts_scores,
        vec_scores=vec_sims,
        stages_probed=probed,
        embed_ms=float(probe.get("embed_ms", 0.0) or 0.0),
        fts_ms=float(probe.get("fts_ms", 0.0) or 0.0),
        vec_ms=float(probe.get("vec_ms", 0.0) or 0.0),
        total_ms=float(probe.get("total_ms", 0.0) or 0.0),
    )


def should_retry(query: str, probe: Dict[str, Any],
                 threshold: Optional[float] = None) -> bool:
    """True se il GATE REALE (decide_gate) da esito NON pieno sul pool.

    E' l'unico criterio di retry: nessuna soglia parallela inventata —
    si riusa core.rag.gate.decide_gate con gate.threshold.
    """
    if threshold is None:
        threshold = gate_threshold()
    try:
        from core.rag.gate import decide_gate
        dec = decide_gate(outcome_from_probe(query, probe), float(threshold))
        return str(getattr(dec, "outcome", "")) != OUTCOME_PIENA
    except Exception:
        return False

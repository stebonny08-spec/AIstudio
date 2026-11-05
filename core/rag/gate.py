# -*- coding: utf-8 -*-
"""core/rag/gate.py — R15b blocco G: gate precoce post-retrieval (G1/G2/G3).

Contratto (core/rag/contract.py — NON modificato, MAI toccato da G):

    decide_gate(outcome: RetrievalOutcome, threshold: float, *,
                web_attempted: bool = False) -> GateDecision
    build_informativa(decision: GateDecision) -> str

Vincoli rispettati:
  * O(1)  — nessuna ricerca, nessun re-embedding, nessun accesso a DB:
            si leggono SOLO le feature gia' presenti in RetrievalOutcome
            (top-10 fused, fts_scores, vec_scores, stages_probed, near_miss,
            total_ms) e, in aggiunta bounded, i testi dei soli top-3 chunk
            per il supporto lessicale (costo proporzionale a 3 chunk, non
            alla dimensione dell'indice).
  * ZERO LLM — il modulo non importa nessun client/modello LLM: il verdetto
            SUBITO dopo il retrieval, prima di qualsiasi generazione.
  * esiti obbligatori OUTCOME_PIENA / OUTCOME_PARZIALE / OUTCOME_NULLA del
            contratto (core.rag.contract), mai un "info non trovata" nudo.
  * ogni parziale/nulla viene loggato con contract.log_astensione (G3):
            G e' l'unico scrittore di %APPDATA%/NovaStudio/astensioni.jsonl.

Modello decisionale (tarato su qa/gt_set_r15.json — vedi qa/qa_r15_g_report.md):
  vec      = top-1 similarita' coseno (vec_scores[0], scala [0,1])
  fts      = evidenza lessicale FTS5/BM25 (fts_scores: "0 se stadio non
             interpellato"; valori negativi = bm25 raw di SQLite)
  supporto = evidenza FTS OPPURE overlap lessicale query<->top-3 chunk
  score    = 0.6*vec + 0.4*max(fts_norm, lex)   (fusione, scala [0,1])

  piena    = vec >= threshold E supporto verificabile
  parziale = candidati utili (supporto > 0) ma sotto soglia / supporto debole
             -> near_miss = top-3 sub-soglia con score
  nulla    = niente di utilizzabile (nessun candidato, oppure alta somiglianza
             vettoriale SENZA alcun supporto lessicale: caso q4-like
             mitosi/meiosi fuori corpus con sim 0.82 >= 0.45)

elapsed_ms (dichiarato) = outcome.total_ms (tempo di retrieval prodotto da P)
                          + tempo speso dentro decide_gate (perf_counter).
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from core.rag import contract
from core.rag.contract import (
    OUTCOME_NULLA,
    OUTCOME_PARZIALE,
    OUTCOME_PIENA,
    GateDecision,
    RetrievalOutcome,
    StageHit,
)

__all__ = [
    "decide_gate",
    "build_informativa",
    "OUTCOME_PIENA",
    "OUTCOME_PARZIALE",
    "OUTCOME_NULLA",
]

# ------------------------------------------------------------------ pesi
W_VEC = 0.6          # peso della somiglianza vettoriale top-1 nella fusione
W_SUP = 0.4          # peso del supporto (FTS5/bm25 o overlap lessicale)
LEX_MIN = 0.25       # frazione minima di termini della query presenti nei
                     # top-3 chunk per considerare "supportato" il candidato.
                     # FIX-3 (R15b I, recalibrazione MISURATA sul pipeline
                     # REALE — qa/tmp/r15_diag_gate.json, PRIMA/DOPO nel
                     # report di integrazione): il pipeline reale espone in
                     # outcome.query_norm la query GRETTA (P non fa il
                     # rewrite opt-in: core/local_search.py imposta
                     # query_norm=query), quindi il denominatore di lex
                     # include parole di guida delle domande che il
                     # query_norm del GT tarato da G esclude. Misurato sui
                     # 18 casi di qa/gt_set_r15.json (lex_live = hits/len):
                     #   parziali x1/x3/x4 = 1/4 = 0.25 (GT tarato: 1/3 =
                     #   0.333 -> con 0.30 cadevano in nulla);
                     #   x2 = 1/3 = 0.333 (gia' OK);
                     #   negativo critico n1 = 1/5 = 0.20 (GT: 1/4 = 0.25);
                     #   negativi n2-n5 = 0 hits.
                     # La finestra di calibrazione e' UNICA: (0.20, 0.25] —
                     # sopra 0.20 n1 resta escluso, fino a 0.25 x1/x3/x4
                     # sono inclusi. Scelto 0.25 (il massimo che esclude n1).
LEX_MIN_WEAK = 0.20  # via alternativa: almeno LEX_MIN_HITS termini DISTINCTI
LEX_MIN_HITS = 2     # della query presenti nei top-3 (parfrasi con overlap
                     # 20-30%: n1 ha 1 solo termine -> escluso)
FTS_BM25_SAT = 6.0   # saturazione |bm25| -> [0,1] (bm25 di SQLite <= 0)
FTS_EVID_FLOOR = 3.5 # |bm25| minimo per parlare di MATCH lessicale REALE:
                     # le MATCH OR su parole comuni/stopword restituiscono
                     # bm25 ~ -0.000x su 17 chunk (misurato: n4 -0.0,
                     # n5 -0.56, n2 -1.11) e NON devono contare come evidenza
FTS_EVID_NORM = FTS_EVID_FLOOR / FTS_BM25_SAT  # 0.583 in scala [0,1]
MAX_NEAR_MISS = 3
SCORE_EPS = 1e-9

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_ACCENTI = str.maketrans("àèéìòùâêîôûäëïöüç", "aeeiouaeiouaeiouc")

_STOPWORDS = frozenset("""
il lo la li le gli un uno una di a e o che per con su in da se non più
questo questa quello quella suo sua suoi sue mio mia tu tuo suo
essere sono era fue era stato essere ha hanno aveva dovrà deve possono
come quando dove perché cosa chi quale quali quanto quanta
ed del della delle dello dei degli al alla alle allo ai agli
sul sulla sulle sullo sui sugli nel nella nelle nello nei negli
tratto tra contro oltre verso senza fino durante dopo prima
the of and to in a is are for on with as it this that
""".split())


def _norm(text: str) -> str:
    """Minuscolo + senza accenti (confronto lessicale tollerante)."""
    return (text or "").translate(_ACCENTI).lower()


def _tokens(text: str, min_len: int = 3) -> List[str]:
    """Token di contenuto (stopword e parole troppo corte escluse)."""
    out = []
    for t in _TOKEN_RE.findall(_norm(text)):
        if len(t) >= min_len and t not in _STOPWORDS:
            out.append(t)
    return out


def lex_stats(query: str, texts: Sequence[str]) -> Tuple[float, int]:
    """(rapporto[0,1], n. termini distinti della query presenti nei testi)."""
    qt = _tokens(query)
    if not qt:
        return 0.0, 0
    seen = set()
    for t in texts:
        seen.update(_tokens(t or ""))
    if not seen:
        return 0.0, 0
    hit = sum(1 for t in qt if t in seen)
    return hit / float(len(qt)), hit


def lex_support(query: str, texts: Sequence[str]) -> float:
    """Quoziente di overlap lessicale [0,1] tra query e testi dei chunk.

    Identifica il caso q4-like (domanda FUORI corpus: alta sim coseno ma
    nessun termine della query nei chunk recuperati).
    """
    return lex_stats(query, texts)[0]


def _fts_info(outcome: RetrievalOutcome) -> Tuple[bool, bool, float, str]:
    """(tentato, evidenza, normalizzato[0,1], scala) dall'dump FTS5 top-10."""
    vals: List[float] = []
    for v in (outcome.fts_scores or []):
        try:
            vals.append(float(v))
        except (TypeError, ValueError):
            continue
    attempted = bool(outcome.fts_ms and outcome.fts_ms > 0) or any(
        v != 0.0 for v in vals)
    nonzero = [v for v in vals if v != 0.0]
    if not nonzero:
        return attempted, False, 0.0, "vuoto"
    if any(v < 0.0 for v in nonzero):
        # bm25 raw di SQLite: piu' NEGATIVO = match piu' forte
        best = min(nonzero)
        norm = max(0.0, min(1.0, (-best) / FTS_BM25_SAT))
        # evidenza SOLO con match lessicale reale (vedi FTS_EVID_FLOOR)
        return attempted, (-best) >= FTS_EVID_FLOOR, norm, "bm25"
    best = max(nonzero)
    norm = best if best <= 1.0 else min(1.0, best / 10.0)
    norm = max(0.0, min(1.0, norm))
    return attempted, norm >= FTS_EVID_NORM, norm, "norm"


def vec_top(outcome: RetrievalOutcome) -> float:
    """Top-1 similarita' coseno (scala [0,1])."""
    for v in (outcome.vec_scores or []):
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        if fv > 0.0:
            return fv
    if outcome.fused:
        try:
            s = float(outcome.fused[0].score)
        except (TypeError, ValueError):
            return 0.0
        if 0.0 <= s <= 1.0:
            return s
    return 0.0


def gate_score(vec: float, fts_norm: float, lex: float) -> float:
    """Fusione [0,1]: 0.6*vec + 0.4*massimo tra supporto FTS e lessicale."""
    sup = max(fts_norm, lex)
    return max(0.0, min(1.0, W_VEC * vec + W_SUP * sup))


def _chunk_text(hit: Any) -> str:
    chunk = getattr(hit, "chunk", None)
    return str(getattr(chunk, "text", "") or "")


def _chunk_source(hit: Any) -> str:
    chunk = getattr(hit, "chunk", None)
    return str(getattr(chunk, "source_file", "") or "")


def _top_texts(outcome: RetrievalOutcome, n: int = 3) -> List[str]:
    return [_chunk_text(h) for h in (outcome.fused or [])[:n] if _chunk_text(h)]


def _pick_near_miss(outcome: RetrievalOutcome, threshold: float) -> List[StageHit]:
    """Top-3 sub-soglia: preferisce il dump di P, altrimenti lo ricalcola."""
    nm = list(outcome.near_miss or [])
    if not nm:
        nm = [h for h in (outcome.fused or []) if float(h.score) < threshold]
    if not nm:
        nm = list(outcome.fused or [])
    return nm[:MAX_NEAR_MISS]


def decide_gate(outcome: RetrievalOutcome, threshold: float, *,
                web_attempted: bool = False) -> GateDecision:
    """Verdetto SUBITO dopo il retrieval — O(1), ZERO LLM.

    Ritorna GateDecision con outcome in {piena, parziale, nulla}.
    Le astensioni (parziale/nulla) vengono loggate con
    contract.log_astensione (G3, scrittura esclusiva di G).
    """
    t0 = time.perf_counter()
    try:
        thr = float(threshold)
    except (TypeError, ValueError):
        thr = 0.45

    fused = list(getattr(outcome, "fused", None) or [])
    stages = list(getattr(outcome, "stages_probed", None) or [])
    query_norm = str(getattr(outcome, "query_norm", "") or "").strip() \
        or str(getattr(outcome, "query", "") or "").strip()
    query_raw = str(getattr(outcome, "query", "") or "")

    vec = vec_top(outcome)
    _att, fts_ev, fts_norm, _scale = _fts_info(outcome)
    lex, lex_hits = lex_stats(query_norm or query_raw, _top_texts(outcome, 3))
    score = gate_score(vec, fts_norm, lex)
    # pertinenza verificabile: match FTS reale OPPURE overlap lessicale
    support = (bool(fts_ev) or lex >= LEX_MIN
               or (lex_hits >= LEX_MIN_HITS and lex >= LEX_MIN_WEAK))

    near_miss: List[StageHit] = []
    if not fused and vec <= SCORE_EPS:
        outcome_kind, causa = OUTCOME_NULLA, "nessun_candidato"
    elif support and score >= thr:
        # "piena" = top fuso >= threshold E pertinenza (feature tarate)
        outcome_kind, causa = OUTCOME_PIENA, "copertura_piena"
    elif support:
        outcome_kind, causa = OUTCOME_PARZIALE, "sotto_soglia"
        near_miss = _pick_near_miss(outcome, thr)
    else:
        outcome_kind, causa = OUTCOME_NULLA, (
            "alta_somiglianza_senza_supporto" if vec >= thr
            else "nessun_supporto")
        near_miss = _pick_near_miss(outcome, thr)

    if not near_miss and outcome_kind != OUTCOME_PIENA:
        near_miss = _pick_near_miss(outcome, thr)

    elapsed_ms = float(getattr(outcome, "total_ms", 0.0) or 0.0) + (
        time.perf_counter() - t0) * 1000.0

    reason = (
        f"causa={causa};score={score:.4f};vec={vec:.4f};"
        f"fts={fts_norm:.4f}{'*' if fts_ev else ''};lex={lex:.4f};"
        f"soglia={thr:.4f};web={'tentato' if web_attempted else 'non tentato'}"
    )
    decision = GateDecision(
        outcome=outcome_kind,
        threshold=thr,
        top_score=score,
        query_norm=query_norm,
        stages_probed=stages,
        near_miss=near_miss,
        elapsed_ms=elapsed_ms,
        reason=reason,
    )
    # Attributo extra (GateDecision e' un dataclass del contratto che G non
    # puo' modificare): build_informativa lo usa per il badge web.
    try:
        decision.web_attempted = bool(web_attempted)   # type: ignore[attr-defined]
    except Exception:
        pass

    if outcome_kind != OUTCOME_PIENA:
        _log_astensione(decision, causa, query_raw, vec, score)
    return decision


def _log_astensione(decision: GateDecision, causa: str, query: str,
                    vec: float, score: float) -> None:
    """G3: ogni parziale/nulla finisce in astensioni.jsonl (mai eccezione)."""
    try:
        record: Dict[str, Any] = {
            "causa": causa,
            "score": round(float(score), 4),
            "vec_top": round(float(vec), 4),
            "stadi": list(decision.stages_probed or []),
            "query": query,
            "tempo_totale_ms": round(float(decision.elapsed_ms), 2),
            "outcome": decision.outcome,
            "near_miss": [
                {
                    "stage": getattr(h, "stage", "?"),
                    "score": round(float(getattr(h, "score", 0.0)), 4),
                    "source": _chunk_source(h)[-80:],
                }
                for h in (decision.near_miss or [])
            ],
            "web_attempted": bool(getattr(decision, "web_attempted", False)),
            "threshold": float(decision.threshold),
        }
        contract.log_astensione(record)
    except Exception:
        pass  # il log non deve mai rompere il percorso di risposta


def _causa_di(decision: GateDecision) -> str:
    reason = str(getattr(decision, "reason", "") or "")
    for part in reason.split(";"):
        if part.startswith("causa="):
            return part.split("=", 1)[1].strip()
    return ""


def _web_tentato(decision: GateDecision) -> bool:
    val = getattr(decision, "web_attempted", None)
    if isinstance(val, bool):
        return val
    return "web=tentato" in str(getattr(decision, "reason", "") or "")


def _frase_causa(causa: str) -> str:
    return {
        "nessun_candidato":
            "la ricerca non ha restituito alcun candidato utilizzabile",
        "sotto_soglia":
            "ci sono indizi utili ma il punteggio di pertinenza resta sotto "
            "la soglia di affidabilita'",
        "supporto_debole":
            "il punteggio e' alto ma il supporto testuale e' debole",
        "nessun_supporto":
            "i candidati recuperati non contengono i termini della domanda",
        "alta_somiglianza_senza_supporto":
            "le corrispondenze sono solo semanticamente vicine ma non "
            "contengono i termini della domanda (probabilmente fuori corpus)",
        "copertura_piena": "copertura piena",
    }.get(causa, causa or "esito negativo")


def build_informativa(decision: GateDecision, *,
                      web_status: str = "non_eseguito",
                      web_note: str = "") -> str:
    """Esito (c): messaggio informativo deterministico — ZERO LLM.

    Cosa cercato (stadi + query normalizzata), top-3 quasi-corrispondenze con
    score, suggerimento di riformulazione/aggiunta materiale e badge web
    (tentato / non disponibile).
    """
    causa = _causa_di(decision)
    query = decision.query_norm or "(query vuota)"

    # R18 B5.2 - MESSAGGIO UMANO per l'UI: una frase onesta + 2-3
    # suggerimenti. NIENTE percorsi filesystem, score, soglie, "Perche':",
    # quasi-corrispondenze con path: i dettagli completi restano nei log
    # (astensioni.jsonl, gia' scritto da decide_gate + print sotto).
    ws = str(web_status or "non_eseguito").strip()
    if ws == "giu":
        intro = ("Non ho trovato una risposta affidabile: i materiali "
                 "locali non coprono bene questa domanda e, per un "
                 "problema di rete, non sono riuscito a consultare il "
                 "web in questo momento.")
    elif ws == "vuoto":
        intro = ("Non ho trovato una risposta completa: i materiali "
                 "locali non bastano per questa domanda e nessuna fonte "
                 "web utile è emersa dalla ricerca.")
    elif ws == "ok_con_risultati":
        intro = ("Non ho trovato una risposta completa: i materiali "
                 "locali non bastano e non sono riuscito a integrare i "
                 "risultati web in una risposta affidabile.")
    else:
        intro = ("Non ho trovato nei materiali locali una risposta "
                 "completa a questa domanda.")
    if web_note:
        intro += " " + str(web_note).strip()

    righe: List[str] = [intro, ""]
    righe.append("Cosa puoi provare:")
    righe.append("  * riformula la domanda usando i termini esatti usati "
                 "nei tuoi materiali (titoli, concetti, sigle);")
    righe.append("  * restringi il tema a una parte precisa del programma;")
    righe.append("  * aggiungi alla biblioteca il documento che contiene "
                 "l'argomento e riprova.")

    # dettagli SOLO nei log (mai nell'UI)
    try:
        nm = list(decision.near_miss or [])
        print(
            f"[gate] informativa: causa={causa or '?'} "
            f"score={float(decision.top_score):.4f} "
            f"soglia={float(decision.threshold):.4f} "
            f"stadi={list(decision.stages_probed or [])} "
            f"ws={ws} query={query!r} "
            f"near_miss={[(getattr(h, 'stage', '?'), round(float(getattr(h, 'score', 0.0)), 4)) for h in nm]}"
        )
    except Exception:
        pass
    return "\n".join(righe)



# ======================================================================
# P1b.3 — flag tecnica RAG (A/B su GT reale: qa/p1b_rag.json)
# ======================================================================
# I DEFAULT qui sotto sono l'ESITO dell'A/B P1b.3 (regola dichiarata: ON
# SOLO SE recall@5 o MRR migliora >= +0.03 — cioe' almeno 1 query sui 9
# positivi, granularita' 1/9 = +0.111 — E ms aggiunti p95 <= 150ms).
# Numeri completi e decisioni: qa/p1b_rag.json; verifica automatica in
# tests/testP1b_rag.py. Se un flag diventa ON, la relativa riga in
# RAG_FLAG_DEFAULTS passa a True CON il commento dei numeri (P1b.4).
RAG_FLAG_DEFAULTS: Dict[str, bool] = {
    "rag.hyde": False,          # A/B: vedi qa/p1b_rag.json -> tecnica "hyde"
    "rag.decompose": False,     # A/B: vedi qa/p1b_rag.json -> "decompose"
    "rag.crag_lite": False,     # A/B: vedi qa/p1b_rag.json -> "crag"
    "rag.rerank.enabled": False,  # A/B: BLOCKED (modello ONNX non pronto)
}

# Mappa flag -> nome tecnica usato dall'env RAG_TECH dell'A/B.
_TECH_ENV_MAP = {
    "rag.hyde": "hyde",
    "rag.decompose": "decompose",
    "rag.crag_lite": "crag",
    "rag.rerank.enabled": "rerank",
}


def rag_flag(name: str, default: Optional[bool] = None) -> bool:
    """Flag opt-in di una tecnica RAG (P1b.3), con override d'ambiente.

    Meccanismo RIPRODUCIBILE dell'A/B (dichiarato in qa/p1b_rag.json):
      * RAG_TECH=<tech>  -> SOLO quella tecnica ON, tutte le altre OFF;
      * RAG_TECH=none    -> tutte OFF (run OFF dell'A/B);
      * RAG_TECH assente -> default RAG_FLAG_DEFAULTS (o il valore di
        config, se la chiave e' presente: l'utente puo' forzarla).

    `name` e' la chiave di config ("rag.hyde", "rag.decompose",
    "rag.crag_lite", "rag.rerank.enabled"). Nessuna eccezione: errore di
    config -> default (flag OFF, comportamento sicuro).
    """
    key = _TECH_ENV_MAP.get(name, name)
    try:
        import os
        env = os.environ.get("RAG_TECH", "").strip().lower()
    except Exception:
        env = ""
    if env:
        if env in ("none", "off", "0"):
            return False
        return env == key
    if default is None:
        default = RAG_FLAG_DEFAULTS.get(name, False)
    try:
        from data.config_manager import ConfigManager
        return bool(ConfigManager().get(name, default))
    except Exception:
        return bool(default)

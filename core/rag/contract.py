# -*- coding: utf-8 -*-
"""core/rag/contract.py — R15b CONTRATTO D'INTERFACCIA tra i blocchi FASE1.

Creato dal COORDINATORE prima del lancio parallelo dei 4 blocchi:
  P (percorsocritico)  -> produce RetrievalOutcome + emette ProgressEvent, usa GateDecision
  G (gate precoce)     -> implementa decide_gate(RetrievalOutcome) -> GateDecision + log astensioni
  W (stadio web)       -> produce docs/chunks con meta.stage='web', legge SETTING_KEYS
  I (indici)           -> embedding_model_id, coverage audit, indici partecipanti

REGOLE:
- NESSUN blocco modifica i campi di QUESTO modulo (owner: coordinatore).
- Tutti i nuovi settings vivono in data/config_manager.py con le CHIAVI elencate
  in SETTING_KEYS (già pre-inserite); i blocchi le LEGGONO, non le definiscono.
- Log astensioni: JSONL dedicato (vedi astensioni_path), scritto SOLO da G.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------- stadi
STAGE_APPUNTI = "appunti"
STAGE_LIBRI = "libri"
STAGE_WEB = "web"
STAGES = (STAGE_APPUNTI, STAGE_LIBRI, STAGE_WEB)

# ------------------------------------------------------------- settings
# Chiavi già presenti in data/config_manager.py (owner: coordinatore).
# G legge gate.threshold; W legge web.*; P legge rag.progress_events.
SETTING_KEYS = (
    "gate.threshold",           # float, default 0.45 (G taratura su GT -> riporta al coordinatore)
    "web.mode",                 # "auto" | "sempre" | "mai"
    "web.weight_appunti",       # float 1.0
    "web.weight_libri",         # float 1.0
    "web.weight_web",           # float 0.8
    "web.cache_ttl_days",       # int 7
    "rag.progress_events",      # bool True
)

# --------------------------------------------------------- esiti gate (G2)
OUTCOME_PIENA = "piena"       # copertura piena -> risposta con citazioni
OUTCOME_PARZIALE = "parziale"  # risposta con cio' che c'e' + near-miss
OUTCOME_NULLA = "nulla"       # escalation web / messaggio informativo


@dataclass
class StageHit:
    """Chunk fuso con provenienza (W3: citazioni con badge stadio)."""
    chunk: Any                 # RetrievedChunk (core.models)
    stage: str                 # STAGES
    score: float               # score di provenienza (vec sim o rrf normalizzato)
    rrf_rank: int = 0


@dataclass
class RetrievalOutcome:
    """Output obbligatorio della fase di recupero (P produce, G consuma).

    dump per-stadio obbligatorio (F0.1): fts5_score e vec_score per i top-10.
    near_miss = top-3 chunk SOGLIA-SOTTO con score (per esito parziale G2b).
    """
    query: str
    query_norm: str = ""             # dopo rewrite ott-in (P1)
    fused: List[StageHit] = field(default_factory=list)          # top-10 dopo RRF 3 stadi
    near_miss: List[StageHit] = field(default_factory=list)      # top-3 sub-soglia
    fts_scores: List[float] = field(default_factory=list)        # top-10 (0 se stadio non interpellato)
    vec_scores: List[float] = field(default_factory=list)
    stages_probed: List[str] = field(default_factory=list)       # stadi realmente interrogati
    embed_ms: float = 0.0
    fts_ms: float = 0.0
    vec_ms: float = 0.0
    total_ms: float = 0.0
    cache_hit: bool = False           # P4 semantic/answer cache
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def top_score(self) -> float:
        return max((h.score for h in self.fused), default=0.0)


@dataclass
class GateDecision:
    """Output obbligatorio del gate precoce (G1: decide SUBITO dopo retrieval)."""
    outcome: str                     # OUTCOME_PIENA | PARZIALE | NULLA
    threshold: float
    top_score: float
    query_norm: str
    stages_probed: List[str]
    near_miss: List[StageHit] = field(default_factory=list)
    elapsed_ms: float = 0.0          # tempo dall'ingresso della query al verdetto
    reason: str = ""

    def to_log(self) -> Dict[str, Any]:
        d = asdict(self)
        d["near_miss"] = [
            {"stage": getattr(h.get("chunk", None), "stage", h.get("stage", "?")),
             "score": h.get("score", 0.0),
             "source": str(getattr(h.get("chunk", None), "source_file", ""))[-80:]}
            for h in d.get("near_miss", []) or []
        ]
        d["ts"] = time.time()
        return d


# ----------------------------------------------------- progress events (P3)
# P emette (solo se config rag.progress_events=True):
#   {"type": "progress", "stage": "appunti|libri|web|gate|synth",
#    "status": "start|done|skip", "ms": float}
# W li renderizza nella chat (nessun altro UI richiesto).
PROGRESS_TYPE = "progress"

# Evento fonti strutturate (P emette dopo il retrieval; W renderizza badge+url).
# Già cablato in backend/api.py (poll_stream["sources"]) dal coordinatore.
SOURCES_TYPE = "sources"   # {"type":"sources","items":[{"stage","title","url","source"}...]}

# web_override per query (W4): send_message(..., web_override="auto|sempre|mai")
# viene passato a process_query_stream SOLO se il router dichiara il parametro
# (api.py lo passa con guardia inspect.signature — P aggiunge web_override: str = "").

# ------------------------------------------------------------ API attese
# G (core/rag/gate.py, creato da G):
#   decide_gate(outcome: RetrievalOutcome, threshold: float, *,
#               web_attempted: bool = False) -> GateDecision   # O(1), zero LLM
#   build_informativa(decision: GateDecision) -> str            # esito (c), zero LLM
#   (P usa un fallback provvisorio di pari firma finche' G non atterra;
#    stessa firma obbligatoria per entrambi)
# P (core/rag/embedder.py):
#   Embedder.warmup() -> None          # best-effort, mai bloccante all'init
#   Embedder.model_id -> str
# I (core/rag/vector_store_sqlite.py, entrambi gli store):
#   get_index_meta(key) -> str|None / set_index_meta(key, value) -> None
#   ensure_embedder_consistent(embedder_id: str) -> "ok"|"reindexing"
#     (rileva mismatch -> reindex LOW-PRIO in background, mai bloccante)
#   add_chunks(...) DEVE popolare chunks_fts (FTS5) oltre ai vettori (W2/web)
# W (core/rag/chunker.py):
#   Chunk(..., meta: dict | None = None)  # opzionale, backward-compat;
#     meta["stage"] in {appunti,libri,web}, meta["url"], meta["date"] per web
# Applicazione pesi RRF per stadio (web.weight_*): P (fusione in hybrid_search).

# ID embedder atteso (confronto I1: indice vs runtime)
EMBEDDER_ID = "intfloat/multilingual-e5-small"


# ------------------------------------------------------- log astensioni (G3)
def astensioni_path() -> Path:
    """File log dedicato astensioni (JSONL). Scrittura SOLO da G."""
    try:
        from data.config_manager import get_app_data_dir
        base = Path(get_app_data_dir())
    except Exception:
        base = Path.home() / "AppData" / "Roaming" / "NovaStudio"
    return base / "astensioni.jsonl"


def log_astensione(record: Dict[str, Any]) -> None:
    """Accoda una riga JSONL. G è l'unico chiamante di production."""
    record.setdefault("ts", time.time())
    p = astensioni_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


# ===========================================================================
# R16 - CONTRATTO AGGIORNATO (owner: coordinatore; i blocchi LEGGONO)
# F0 forensics: qa/f0_round16.json (TEMPLATE-LEAK / CANNED / DUPLICATI /
# WEB-NON-USATO / TEMPO). I fix partono SOLO da quella tabella.
# ===========================================================================

# --- B1: guardia output (core/rag/output_guard.py, owner B1) --------------
# Marker vietati nell'OUTPUT e nel prompt grezzo (F0.2a/b): la frase canned
# dello screenshot NON esiste nel codice (scan F0) ma e' generata dal modello
# sul prompt senza chat-template -> vietata come marker.
CANNED_MARKERS = (
    "[Fonte",
    "User:",
    "Assistant:",
    "System:",
    "DOMANDA DELL'UTENTE",
    "</contesto>",
    "<contesto>",
    "La risposta è data da un utente",
    "La risposta è data",
    "utente di questo tipo",
)
OUTPUT_MIN_LEN = 80           # output piu' corti -> retry/fallback (R16 1.2)

# Prefisso deterministico esito PARZIALE (R16 3.1b): emesso dalla PIPE (B2).
# Backward-compat: l'istruzione di prompt (B1, _PARTIAL_OUTCOME_INSTRUCTION)
# mantiene letteralmente "Ho trovato solo questo nei materiali" per
# tests/testR15_gate.py:225.
PARTIAL_PREFIX = "Dai tuoi materiali emerge solo questo: "

# --- SLO R16 (misurati in QA-1) ------------------------------------------
SLO_TOTAL_S = 20.0            # risposta completa renderizzata, p95
SLO_FIRST_TOKEN_S = 2.0       # primo token/feedback, p95
RETRIEVE_TIMEBOX_S = 1.0      # retrieve locale (soft, B2)
WEB_FETCH_CAP_S = 7.0         # fetch web totale (B2; R18: 5 -> 7)

# --- B2: rete simulata giu' per QA-1 (v) ---------------------------------
# Env var: se settata a "1", lo stadio web restituisce subito [] con status
# "giu" (nessuna chiamata di rete). Usata SOLO dai test QA.
WEB_DOWN_ENV = "R16_WEB_DOWN"

# --- B1->B2->FE: evento di RESET (retry/fallback al posto dell'output) ----
# B1 yielda dal client il dict contract.RESET_TOKEN (al posto di str) quando
# deve azzerare lo stream gia' emesso (post-gen guard FAIL -> retry/fallback).
# B2 (router) converte: isinstance(tok, dict) and tok.get("_reset")
#   -> yield {"type": "reset"}
# backend/api.py (coordinatore, GIA' CABLATO): reset -> svuota s["tokens"],
#   incrementa s["reset_count"]; poll_stream espone "reset_count".
# FE (B4): se reset_count cresce -> streamingText.value = "" (retry
#   SOSTITUISCE, non aggiunge - R16 4.2).
RESET_TYPE = "reset"
RESET_TOKEN: Dict[str, Any] = {"_reset": True}

# --- B2: allowlist web (file, NON UI) ------------------------------------
# File repo (una riga per dominio, # = commenti). B2 lo crea/seeded da
# core/trusted_sources.py se mancante; il filtro web legge SEMPRE da qui.
ALLOWLIST_FILE = "data/web_allowlist.txt"

# --- B2/B1: budget generazione per SLO (R16 2.4) -------------------------
# generate_stream/stream_via_sidecar accettano il kwarg opzionale
# time_budget_s (secondi residui per la GENERAZIONE); default None =
# comportamento storico invariato (tutti i test R15 restano verdi).
TIME_BUDGET_KWARG = "time_budget_s"

# --- B2: log di OGNI risposta (R16 3.3) ----------------------------------
def risposte_path() -> Path:
    """JSONL log risposte (stadi, score, tempi, esito, len, marker-check)."""
    try:
        from data.config_manager import get_app_data_dir
        base = Path(get_app_data_dir())
    except Exception:
        base = Path.home() / "AppData" / "Roaming" / "NovaStudio"
    return base / "risposte.jsonl"


def log_risposta(record: Dict[str, Any]) -> None:
    """Accoda una riga JSONL. Chiamante: B2 (router), alla fine di ogni query."""
    record.setdefault("ts", time.time())
    p = risposte_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


# --- API attese R16 (firmhe definite dai blocchi) -------------------------
# B1 (core/rag/output_guard.py):
#   check_output(text: str, *, system_text: str = "") -> Dict[str, Any]
#       {"ok": bool, "markers": [str...], "too_short": bool, "canned": bool,
#        "reason": str}
#   compose_fallback(chunks, web_results, query) -> str   # template-free
# B1 (local_llm_client): kwarg time_budget_s su generate_stream e
#   stream_via_sidecar; last_marker_check: Dict sul client/proxy letto da B2.
# B3 (core/rag/gate.py):
#   build_informativa(decision, *, web_status: str = "non_eseguito",
#                     web_note: str = "") -> str
#   web_status in {"ok_con_risultati", "giu", "vuoto", "non_eseguito"}
#   (backward-compat: i default tengono la firma usata da R15 verde)
# B2 (router): chiama contract.log_risposta(record) a fine query; converte
#   RESET_TOKEN in evento {"type": RESET_TYPE}.


# ===========================================================================
# R18b - TRE STADI SU OGNI DOMANDA + GROUNDING + INTENT-AWARE CACHE
# (owner: round 18 - le voci R15b/R16 sopra restano INTATTE)
# ===========================================================================
# B1.1: ogni domanda fattuale nuova esegue appunti -> libri -> web.
#   Unica eccezione: cache hit con similarity >= 0.92 E intent =
#   stessa-domanda-riformulata (core/rag/intent.py).
# B1.2: circuit-breaker web (core/rag/web_stage.py) TTL massimo
#   WEB_BREAKER_TTL_S secondi con retry per query; "web non disponibile"
#   (web_status="giu") SOLO dopo tentativo HTTP reale fallito con errore
#   loggato (url/status/eccezione in web_stage.web_state()["breaker"]
#   ["last_error"]); MAI short-circuit pre-tentativo.
WEB_BREAKER_TTL_S = 60.0
# B1.3: provenienza = stadi CONTRIBUENTI (chunk nel contesto di
#   generazione con similarity >= soglia di ammissione H8
#   MIN_SIMILARITY_WEAK); se nessuno contribuisce -> lista vuota e la UI
#   mostra NONE_SOURCE_TEXT.
NONE_SOURCE_TEXT = "nessuna fonte trovata"
# B2.1: self-check di grounding - UNA chiamata (profilo think) con
#   grammatica JSON {"ok": bool, "violations": [str, ...]};
#   violations -> 1 rigenerazione vincolata (kwarg "repair_note" su
#   generate_stream/stream_via_sidecar/_prepare_messages); persistenza ->
#   risposta che dichiara il limite (grounding.limit_statement).
GROUNDING_GRAMMAR = {"ok": "bool", "violations": "list[str]"}
# B2.2: conflitto locale vs web -> seguono le fonti web allowlist + frase
#   che segnala il dato diverso dei locali (istruzione in
#   local_llm_client._prepare_messages).
# B3.1: taxonomia intent (core/rag/intent.py):
#   stessa-domanda-riformulata | sotto-domanda | nuova-domanda | chit-chat
# B3.2: delta-reuse e cache hit SOLO su stessa-domanda-riformulata con
#   similarity >= SIM_CACHE_THRESHOLD; sotto/nuova-domanda forzano
#   retrieval fresco; ogni decisione loggata (cache_decision nei log).
SIM_CACHE_THRESHOLD = 0.92
# B3.3: follow-up (sotto-domanda) -> query di retrieval espansa col topic
#   di conversazione (intent.expand_query), mai la letterale da sola.
# B4: unicità su sha1(contenuto normalizzato) per (store_key,
#   source_file) in chunks (content_hash + ux_chunks_hash_doc); top-k
#   deduplicato per hash (store._dedup_hash_rows).
# B5.1: minimi per intent (grounding.min_words_for / depth_check):
#   nuova-domanda >=120 parole OPPURE >=3 punti; sotto-domanda e
#   stessa-domanda-riformulata >=80 parole; chit-chat libera;
#   risposta fattuale <40 parole = insufficiente.
MIN_WORDS_BY_INTENT = {
    "nuova-domanda": 120,
    "sotto-domanda": 80,
    "stessa-domanda-riformulata": 80,
    "chit-chat": 0,
}
# B5.2: build_informativa = frase onesta + 2-3 suggerimenti; percorsi,
#   score, soglie e "Perche':" SOLO nei log (astensioni/print gate).

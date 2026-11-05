"""
core/router.py
------------------
Regia del RAG a 3 livelli (materiali -> libreria -> web) con:
  - Semantic Router per chitchat vs studio (warmup in BACKGROUND)
  - top_k adattivo in base alla modalita' di studio
  - Split del testo RAG in parti se supera il tetto dinamico
  - Rolling summary ESTRATTIVO per le continuazioni
  - R15b (blocco P):
      * answer cache PRIMA di tutto (core/rag/answer_cache, TTL 7gg)
      * retrieve IBRIDO (FTS5+vettoire, RRF pesato per stadio) con
        time-box SOFT 1s (dichiarato, mai abort)
      * gate precoce decide SUBITO dopo il retrieval (core.rag.gate se di
        G; fallback shim di pari firma finche' G non atterra)
      * ESATTAMENTE UNA chiamata generate_stream per query nel percorso
        default: il contesto finale (locale OPPURE web fuso) viene deciso
        PRIMA della generazione — mai locale-irrilevante-poi-web
      * web_override: "auto" (default) | "sempre" | "mai"
      * eventi progress per stadio (rag.progress_events) e sources

Eventi emessi:
  {"type": "queue", "parts": [...], "query": "...", "context_kind": "...",
   "study_mode": "...", "current_part": N, "total_parts": M, "source": "..."}
  {"type": "token", "text": "..."}
  {"type": "source", "value": "..."}
  {"type": "progress", "stage": "appunti|libri|web|gate|synth|cache",
   "status": "start|done|skip", "ms": float, "note": "..."}
  {"type": "sources", "items": [{"stage","title","url","source"}]}
"""

from __future__ import annotations

import re
import threading
import time
from typing import Dict, Generator, List, Optional, Tuple

from core.ai_router import Router0LLM
from core.local_llm_client import FALLBACK_MARKER, DEFAULT_STUDY_MODE
from core.local_search import (
    MAX_WEAK_CHUNKS,
    MIN_SIMILARITY_STRONG,
    MIN_SIMILARITY_WEAK,
    LocalSearchEngine,
)
from core.models import AnswerResult, RetrievedChunk, WebResult
from core.prefix_cache import get_prefix_cache
from core.rag.answer_cache import (
    AnswerCache, corpus_fingerprint, make_key as make_cache_key,
)
from core.rag import grounding as rag_grounding
from core.rag import intent as rag_intent
from core.rag.contract import (
    OUTCOME_NULLA,
    OUTCOME_PARZIALE,
    OUTCOME_PIENA,
    STAGE_APPUNTI,
    STAGE_LIBRI,
    STAGE_WEB,
    GateDecision,
    RetrievalOutcome,
    StageHit,
)
from core.rag.vector_store_sqlite import RRF_K
from core.semantic_router import SemanticRouter
from core.web_search import search_web

MAX_IMAGES_PER_ANSWER = 3
MIN_IMAGE_SIMILARITY = 0.25

_SYSTEM_PROMPT_RESERVE = 900
_QUERY_RESERVE = 100
_PARTS_SUMMARY_RESERVE = 400   # spazio per i riassunti delle parti precedenti
_RESPONSE_RESERVE = 1500
_SAFETY_MARGIN = 300

# ------------------------------------------------------------------ R15b P
# Time-box SOFT del retrieve (dichiarato): se superato si LOGGA e si
# continua (nessun abort, nessuna eccezione).
RETRIEVE_SOFT_TIMEBOX_MS = 1000
WEB_STAGE_ENTRY_S = 6.0  # R18: degradazione STADIO - se la ricerca locale supera questi secondi il web e' saltato (mai si amputa il testo).0
# Score provvisorio assegnato ai risultati WEB (stesso valore provvisorio
# FTS: 0.40 -> "borderline", non supera mai la soglia forte 0.45 da solo).
WEB_PROVISIONAL_SIMILARITY = 0.40
# Chunk di testo per il re-stream della cache (risposta salvata).
_CACHE_STREAM_CHUNK = 64

_VALID_WEB_MODES = ("auto", "sempre", "mai")


def _is_fallback(text: str) -> bool:
    if FALLBACK_MARKER not in text:
        return False
    stripped = text.replace(FALLBACK_MARKER, "").strip(" .,:;!\"'()[]\n\t")
    return len(stripped) < 40


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 3)


# ==================================================================
# H3 - PREFISSI STABILI + PROMPT CACHE + CONTEXT SHIFTING
# ==================================================================
SYSTEM_PROFILE_VERSION = "1"
ROLLING_SUMMARY_MAX_CHARS = 2000   # ~500 token stimati (chars/4)


def _turn_to_text(turn) -> str:
    """Testo deterministico di un turno di storia (mai troncato qui)."""
    if isinstance(turn, dict):
        role = str(turn.get("role", "user"))
        content = str(turn.get("content", ""))
        return f"[{role}] {content}"
    return str(turn)


def build_prompt_segments(system_profile_id, rag_header, history_turns,
                          query) -> dict:
    """Costruisce i segmenti di prompt con CHIAVI ORDINATE e testo
    deterministico (stesso input -> stessi byte, senza date/ora/casuali):

        [system profile versionato] -> [header RAG] ->
        [storia (turni interi)] -> [query]

    Ritorna un dict con le chiavi, in ordine: system, rag, history, query.
    """
    system_text = f"[system profile={system_profile_id} v{SYSTEM_PROFILE_VERSION}]\n"
    rag_text = f"[rag]\n{rag_header if rag_header else '(nessun contesto)'}\n"
    lines = [_turn_to_text(t) for t in (history_turns or [])]
    history_text = ("\n".join(lines) + "\n") if lines else ""
    query_text = f"[query]\n{query}"
    return {
        "system": system_text,
        "rag": rag_text,
        "history": history_text,
        "query": query_text,
    }


def record_prefix_log(query, system_profile_id="", rag_header="",
                      history_turns=None) -> str:
    """Calcola l'hash di prefix (system+rag+history, query esclusa), lo
    registra nella PromptPrefixCache e logga HIT/MISS."""
    segments = build_prompt_segments(
        system_profile_id, rag_header, history_turns, query
    )
    cache = get_prefix_cache()
    outcome = cache.register(
        segments["system"], segments["rag"], segments["history"]
    )
    stats = cache.stats()
    print(
        f"[PrefixCache] {outcome} profile={system_profile_id} "
        f"hit_rate={stats['hit_rate']:.2f} "
        f"(hits={stats['hits']}, misses={stats['misses']})"
    )
    return outcome


def history_char_budget(n_ctx: int = 4096) -> int:
    """Soglia in CHARS per la storia: ~75% del contesto
    (token stimati = chars/4). n_ctx 4096 -> 3072 token -> 12288 chars."""
    try:
        n_ctx = int(n_ctx)
    except (TypeError, ValueError):
        n_ctx = 4096
    if n_ctx <= 0:
        n_ctx = 4096
    return int(n_ctx * 0.75) * 4


def _first_chunk(text: str, limit: int = 160) -> str:
    """Prima frase (estrattiva) o primi `limit` chars, senza tagliare a metà
    parola quando serve."""
    text = (text or "").strip()
    if not text:
        return ""
    m = re.search(r"[.!?]\s", text)
    if m and m.start() >= 40:
        return text[: m.start() + 1].strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    idx = cut.rfind(" ")
    if idx > limit // 2:
        cut = cut[:idx]
    return cut.strip()


def trim_history(turns, max_chars):
    """Context shifting + rolling summary PURA (nessuna LLM).

    Se la storia supera `max_chars`, scarta i turni piu' vecchi (mai
    troncando un turno a metà: si tiene un suffisso di turni INTERI) e
    produce un riassunto rolling estrattivo al piu' ~500 token stimati
    (ROLLING_SUMMARY_MAX_CHARS = 2000 chars).

    Ritorna (kept_turns, summary_text | None).
    """
    turns = list(turns or [])
    if not turns:
        return [], None

    texts = [_turn_to_text(t) for t in turns]
    if sum(len(t) for t in texts) <= max_chars:
        return turns, None

    kept = list(turns)
    kept_texts = list(texts)
    dropped_texts = []
    # Scarta dall'inizio finche' il suffisso intero entra nel budget.
    # Se un singolo turno supera il budget lo si tiene comunque PER INTERO.
    while len(kept) > 1 and sum(len(t) for t in kept_texts) > max_chars:
        dropped_texts.append(kept_texts.pop(0))
        kept.pop(0)

    summary = None
    if dropped_texts:
        summary = "\n".join(_first_chunk(t) for t in dropped_texts if t)
        if len(summary) > ROLLING_SUMMARY_MAX_CHARS:
            cut = summary[: ROLLING_SUMMARY_MAX_CHARS - 1]
            idx = cut.rfind(" ")
            if idx > 0:
                cut = cut[:idx]
            summary = cut.rstrip() + "…"
    return kept, summary


def extract_part_summary(response_text: str, max_chars: int = 120) -> str:
    """Estrae un mini-riassunto ESTRATTIVO dalla risposta di una parte.

    Strategia:
      1. Prende la prima frase non vuota (tipicamente l'attacco della parte)
      2. Se c'e' spazio, aggiunge l'ultima frase completa (l'attacco al tema successivo)
      3. Tronca a max_chars caratteri, senza tagliare a metà parola

    Non usa il modello: e' pura estrazione. Costo: ~0.
    """
    if not response_text:
        return ""

    text = response_text.strip()

    # Rimuovi separatori visivi residui (---) e blank lines
    text = re.sub(r"\n*---\n*", "\n", text).strip()

    # Dividi in frasi (euristica: dopo . ! ? seguiti da spazio + maiuscola)
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ\"«\(])", text)
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        return text[:max_chars]

    first = sentences[0]
    last = sentences[-1] if len(sentences) > 1 else ""

    result = first
    if last and last != first:
        # Aggiungi l'ultima solo se resta spazio
        if len(result) + len(last) + 3 <= max_chars:
            result = f"{result} … {last}"

    result = result[:max_chars].strip()

    # Non tagliare a metà parola
    if len(result) == max_chars and not result.endswith(('.', '!', '?', '…')):
        idx = result.rfind(' ')
        if idx > 0:
            result = result[:idx].rstrip() + '…'

    return result


# ==================================================================
# R15b P3 - GATE: import lazy di core.rag.gate (blocco G) + FALLBACK SHIM
# ==================================================================
# FINCHE' G non atterra core.rag.gate non esiste: si usa UN shim di pari
# firma QUI dentro (si dichiara esplicitamente nel reason del GateDecision).
# appena G pubblica decide_gate/build_informativa l'import lazy li usa.
def _fallback_decide_gate(outcome: RetrievalOutcome, threshold: float, *,
                          web_attempted: bool = False) -> GateDecision:
    """Fallback shim di pari firma (rimosso automaticamente quando G
    atterra: l'import lazy prova core.rag.gate PRIMA, a ogni query).

    Regole dichiarate dello shim:
      - top_score >= threshold            -> piena
      - fused non vuoto e top_score >= 0.35 (soglia H8 "debole")
        oppure near-miss presenti         -> parziale
      - altrimenti                        -> nulla
    """
    t0 = time.perf_counter()
    try:
        thr = float(threshold)
    except (TypeError, ValueError):
        thr = 0.45
    top = float(outcome.top_score)
    fused = list(outcome.fused or [])
    near = list(outcome.near_miss or [])
    if fused and top >= thr:
        outcome_s = OUTCOME_PIENA
        reason = f"top_score {top:.3f} >= soglia {thr:.2f}"
    elif fused and top >= 0.35:
        outcome_s = OUTCOME_PARZIALE
        reason = f"top_score {top:.3f} in fascia debile (< {thr:.2f})"
    elif near:
        outcome_s = OUTCOME_PARZIALE
        reason = f"near-miss sub-soglia disponibili ({len(near)})"
    else:
        outcome_s = OUTCOME_NULLA
        reason = "nessun chunk recuperato sopra la soglia minima"
    return GateDecision(
        outcome=outcome_s,
        threshold=thr,
        top_score=top,
        query_norm=outcome.query_norm,
        stages_probed=list(outcome.stages_probed or []),
        near_miss=near,
        elapsed_ms=(time.perf_counter() - t0) * 1000.0,
        reason=("FALLBACK SHIM P (core.rag.gate assente) — "
                + reason + (" [web_attempted]" if web_attempted else "")),
    )


def _fallback_build_informativa(decision: GateDecision, **kwargs) -> str:
    """Fallback shim di pari firma per build_informativa (zero LLM)."""
    stages = ", ".join(decision.stages_probed or []) or "nessuno"
    base = (
        "Non ho trovato materiale abbastanza attendibile nei miei appunti "
        f"per rispondere con sicurezza (stadi interrogati: {stages})."
    )
    if decision.near_miss:
        try:
            first = decision.near_miss[0]
            src = getattr(getattr(first, "chunk", None), "source_file", "") or ""
            base += (
                f" Materiale vicino ma sotto soglia: "
                f"{str(src)[-80:]} (score {getattr(first, 'score', 0.0):.2f})."
            )
        except Exception:
            pass
    if decision.reason:
        base += f" [{decision.reason}]"
    return base


def _gate_fns() -> Tuple:
    """Import LAZY di core.rag.gate (owner G); se assente -> shim di pari
    firma. Provato a ogni query: appena G atterra viene usato il suo."""
    try:
        from core.rag import gate as _gate_mod
        return _gate_mod.decide_gate, _gate_mod.build_informativa
    except Exception:
        return _fallback_decide_gate, _fallback_build_informativa


def _read_pipeline_cfg() -> dict:
    """Lettura (SOLO lettura) delle chiavi di config del contratto P."""
    defaults = {
        "progress_events": True,
        "threshold": 0.45,
        "web_mode": "auto",
        "w_appunti": 1.0,
        "w_libri": 1.0,
        "w_web": 0.8,
        "ttl_days": 7,
    }
    try:
        from data.config_manager import ConfigManager
        c = ConfigManager()
        return {
            "progress_events": bool(c.get("rag.progress_events",
                                          defaults["progress_events"])),
            "threshold": float(c.get("gate.threshold", defaults["threshold"])),
            "web_mode": str(c.get("web.mode", defaults["web_mode"])
                            or defaults["web_mode"]).strip().lower(),
            "w_appunti": float(c.get("web.weight_appunti",
                                     defaults["w_appunti"])),
            "w_libri": float(c.get("web.weight_libri", defaults["w_libri"])),
            "w_web": float(c.get("web.weight_web", defaults["w_web"])),
            "ttl_days": int(c.get("web.cache_ttl_days", defaults["ttl_days"])),
        }
    except Exception:
        return dict(defaults)


def _row_key(row: dict) -> Tuple[str, str]:
    """Chiave di identita' riga (stessa di rrf_fuse di vector_store_sqlite)."""
    return (row.get("source_file", ""), row.get("text", ""))


def _row_sim(row: dict) -> float:
    try:
        return float(row.get("similarity") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _to_chunk(row: dict) -> RetrievedChunk:
    return RetrievedChunk(
        text=row.get("text") or "",
        source_file=row.get("source_file") or "",
        location_hint=row.get("location_hint") or "",
        similarity=_row_sim(row),
        is_image=bool(row.get("is_image", False)),
        image_path=row.get("image_path") or None,
        mime_type=row.get("mime_type") or None,
    )


class Router:
    def __init__(self, local_client_provider, local_search, books_search,
                 rag_top_k=5, rag_max_tokens=5000):
        self._get_client = local_client_provider
        self.local_search = local_search
        self.books_search = books_search
        self.rag_top_k = rag_top_k
        self.rag_max_tokens = rag_max_tokens
        self.semantic_router = SemanticRouter(local_search.embedder)
        # ---- P2: warmup ALL'AVVIO (best-effort, thread daemon, no-block) --
        # 1) embedder: carica E5 in background (Embedder.warmup -> None);
        # 2) semantic_router: esempi in background (il cold 43,6s NON sta
        #    nel path della prima query; se non pronto si cade su regole H9).
        try:
            warm = getattr(local_search.embedder, "warmup", None)
            if callable(warm):
                warm()
        except Exception as exc:  # pragma: no cover - best-effort
            print(f"[Router] warmup embedder non avviabile: {exc}")
        try:
            self.semantic_router.warmup()
        except Exception as exc:  # pragma: no cover - best-effort
            print(f"[Router] warmup semantic_router non avviabile: {exc}")
        # ---- P4: answer cache (istanza singola, persistente AppData) -----
        self._answer_cache: Optional[AnswerCache] = None
        self._answer_cache_lock = threading.Lock()

    # ------------------------------------------------------------ P2/P4
    @property
    def answer_cache(self) -> AnswerCache:
        with self._answer_cache_lock:
            if self._answer_cache is None:
                self._answer_cache = AnswerCache()
            return self._answer_cache

    def _adaptive_top_k(self, study_mode: str) -> int:
        base = self.rag_top_k
        if study_mode == "esercizio":
            return max(3, base - 2)
        if study_mode == "ripasso":
            return base + 5
        if study_mode == "riassunto":
            return base + 10
        return base

    # ==================================================================
    # ENTRY POINT
    # ==================================================================
    def process_query(self, query, mode, thinking=False, study_mode=DEFAULT_STUDY_MODE) -> AnswerResult:
        client = self._get_client()
        text = ""
        source = "nessuna"
        for ev in self.process_query_stream(query, mode, thinking, study_mode):
            if ev["type"] == "token":
                text += ev["text"]
            elif ev["type"] == "source":
                source = ev["value"]
        return AnswerResult(text=text, source=source)

    @staticmethod
    def _resolve_web_override(web_override: str, cfg: dict) -> str:
        """web_override: 'auto' | 'sempre' | 'mai' (default: config web.mode)."""
        v = str(web_override or "").strip().lower()
        if v in _VALID_WEB_MODES:
            return v
        v = str(cfg.get("web_mode") or "auto").strip().lower()
        return v if v in _VALID_WEB_MODES else "auto"

    @staticmethod
    def _cache_stages(mode: str, include_books: bool, web_mode: str) -> List[str]:
        """Set di stadi ATTIVI per la chiave di cache (dichiarato):
        stadi garantiti + risoluzione web della query."""
        if mode == "solo_online":
            return [STAGE_WEB]
        stages = [STAGE_APPUNTI]
        if include_books:
            stages.append(STAGE_LIBRI)
        stages.append(f"web:{web_mode}")
        return stages

    def process_query_stream(
        self,
        query: str,
        mode: str,
        thinking: bool = False,
        study_mode: str = DEFAULT_STUDY_MODE,
        stop_event: Optional[threading.Event] = None,
        topic: str = "",
        history_turns: Optional[list] = None,
        web_override: str = "",
    ) -> Generator[dict, None, None]:
        client = self._get_client()
        t_q0 = time.perf_counter()   # timer E2E per il budget del branch cache

        # ---- config per la query (sola lettura) ------------------------
        cfg = _read_pipeline_cfg()
        web_mode = self._resolve_web_override(web_override, cfg)
        include_books = (mode == "automatica")

        # ---- R18 B3.1: intent (regole + embedding) + query espansa ----
        try:
            _emb1 = self.local_search.embedder.embed_one
        except Exception:
            _emb1 = None
        intent_info = rag_intent.classify(query, history_turns,
                                          embed_fn=_emb1)
        intent_cls = str(intent_info.get("intent") or "")
        retrieval_query = query
        if intent_cls == rag_intent.INTENT_SOTTO:
            # B3.3: follow-up -> query di retrieval espansa col topic di
            # conversazione (MAI la frase letterale da sola)
            retrieval_query = rag_intent.expand_query(query, history_turns)
        print(f"[Router] intent={intent_cls} "
              f"sim={intent_info.get('similarity')} "
              f"rule={intent_info.get('rule')}"
              + (f" | retrieval='{retrieval_query}'"
                 if retrieval_query != query else ""))
        cache_decision: Dict = {
            "intent": intent_cls,
            "similarity": intent_info.get("similarity"),
            "rule": intent_info.get("rule"),
            "metric": intent_info.get("metric"),
            "hit": False, "allowed": None, "reason": "miss",
        }

        # ---- P4: ANSWER CACHE PRIMA DI TUTTO (prima di ogni lavoro) ----
        model_id = str(getattr(self.local_search.embedder, "model_id", "") or "")
        cache_stages = self._cache_stages(mode, include_books, web_mode)
        cache_key = make_cache_key(query, model_id, cache_stages)
        fingerprint = self._cache_fingerprint()
        try:
            self.answer_cache.ttl_seconds = int(cfg["ttl_days"]) * 86400
        except Exception:
            pass
        rec = None
        try:
            rec = self.answer_cache.get(cache_key, fingerprint)
        except Exception as exc:  # pragma: no cover - cache mai bloccante
            print(f"[Router] answer cache get fallito: {exc}")
        _cache_ok = False
        if rec:
            # ---- R18 B3.2: cache hit / delta-reuse SOLO su
            # stessa-domanda-riformulata con similarity >= 0.92 ---------
            try:
                _ref_hist = [{"role": "user",
                              "content": str(rec.get("query") or "")}]
                _intent_cached = rag_intent.classify(query, _ref_hist,
                                                     embed_fn=_emb1)
                _sim_cached = float(_intent_cached.get("similarity")
                                    if _intent_cached.get("similarity")
                                    is not None else 0.0)
            except Exception:
                _intent_cached = {"intent": "?"}
                _sim_cached = 0.0
            # basis dichiarato: se c'e' storia -> intent vs storia;
            # senz'altro contesto -> la classificazione vs la domanda in
            # cache (identita' di chiave = sim 1.0) fa fede.
            _has_hist = any(
                isinstance(t, dict)
                and str(t.get("role", "")).lower() in ("user", "utente")
                and str(t.get("content") or "").strip()
                for t in (history_turns or []))
            _basis = (intent_cls if _has_hist
                      else str(_intent_cached.get("intent") or ""))
            _cache_ok = (
                _basis == rag_intent.INTENT_RIFORMULATA
                and _sim_cached >= rag_intent.SIM_THRESHOLD
            )
            cache_decision.update({
                "hit": True, "allowed": bool(_cache_ok),
                "intent_cached": _intent_cached.get("intent"),
                "similarity_cached": round(_sim_cached, 4),
                "rec_query": rec.get("query"),
                "basis": _basis,
                "reason": ("stessa-domanda-riformulata sim>=0.92"
                           if _cache_ok else
                           f"basis={_basis} non ammesso per il riuso "
                           "(B3.2: solo stessa-domanda-riformulata)"),
            })
            if not _cache_ok:
                rec = None
                print("[Router] cache HIT BLOCCATO (B3.2): intent="
                      f"{intent_cls}/{_intent_cached.get('intent')} "
                      f"sim={_sim_cached:.3f} -> retrieval fresco")
            else:
                print("[Router] cache HIT ammesso (B3.2): "
                      f"sim={_sim_cached:.3f} intent={intent_cls}")
        else:
            cache_decision["hit"] = False
        if rec:
            # R16 follow-up: HIT = rielaborazione LLM della bozza salvata
            # (MAI testo identico: guard not_identical_to nel client;
            #  bozze marcate sbagliate non arrivano qui perche' eliminate
            #  da flag_wrong_answer). Se la rielaborazione non va, si
            #  continua col pipeline normale (nessun silenzio, mai).
            if cfg["progress_events"]:
                yield {
                    "type": "progress", "stage": "cache", "status": "done",
                    "ms": 0.0,
                    "note": (f"risposta da cache rielaborata "
                             f"(TTL {cfg['ttl_days']}gg)"),
                }
            yield {"type": "sources", "items": list(rec.get("items") or [])}
            saved_text = str(rec.get("text") or "")
            saved_source = str(rec.get("source") or "nessuna")
            from core.rag.contract import SLO_TOTAL_S as _SLOc
            budget_c = max(3.0, float(_SLOc) - 1.0
                           - (time.perf_counter() - t_q0))
            acc_c: List[str] = []
            re_ok = False
            try:
                for ev2 in self._iter_gen(
                        client, query,
                        context_kind="locale",
                        local_chunks=None, web_results=None,
                        allow_fallback_marker=False,
                        images=[], thinking=thinking,
                        study_mode=study_mode, stop_event=stop_event,
                        part_index=0, is_last_part=True,
                        parts_summaries=[],
                        history_turns=history_turns,
                        time_budget_s=budget_c,
                        answer_draft=saved_text):
                    if ev2["type"] == "reset":
                        acc_c.clear()
                    elif ev2["type"] == "token":
                        acc_c.append(ev2["text"])
                    yield ev2
                served = "".join(acc_c).strip()
                if served:
                    _col = " ".join(served.split()).lower()
                    _ref = " ".join(saved_text.split()).lower()
                    if _col == _ref or (len(_ref) > 120
                                        and _col[:120] == _ref[:120]):
                        # client finto/modello che riconsegna la BOZZA:
                        # mai testo identico -> RESET + fallback onesto
                        # (emergenza, la cache non ha chunk a disposizione)
                        yield {"type": "reset"}
                        acc_c.clear()
                        from core.rag.output_guard import compose_fallback
                        fb = compose_fallback(None, None, query)
                        for i in range(0, len(fb), _CACHE_STREAM_CHUNK):
                            chunk = fb[i:i + _CACHE_STREAM_CHUNK]
                            yield {"type": "token", "text": chunk}
                            acc_c.append(chunk)
                re_ok = bool("".join(acc_c).strip())
            except Exception as exc:
                print(f"[Router] cache rielaborazione fallita ({exc}): "
                      "pipeline normale")
                re_ok = False
            if re_ok:
                # R18: provenienza dai metadati cache (niente footer nel
                # testo rielaborato)
                prov_c = list(rec.get("provenance") or [])
                if not prov_c:
                    for _it in (rec.get("items") or []):
                        _st = str(_it.get("stage") or "")
                        if _st and _st not in prov_c:
                            prov_c.append(_st)
                if prov_c:
                    yield {"type": "sources",
                           "items": list(rec.get("items") or []),
                           "stages": prov_c}
                yield {"type": "source", "value": saved_source}
                try:
                    from core.rag.contract import log_risposta as _lr2
                    _lr2({"query": query, "esito": "cache_rielaborato",
                          "intent": intent_cls,
                          "cache_decision": dict(cache_decision),
                          "stadi": list(cache_stages),
                          "score": None, "tempi_per_stadio": [],
                          "tempo_totale_ms": round(
                              (time.perf_counter() - t_q0) * 1000.0, 2),
                          "output_len": sum(len(x) for x in acc_c),
                          "marker_check": getattr(client,
                                                  "last_marker_check", None),
                          "web_status": "non_eseguito",
                          "source": saved_source})
                except Exception:
                    pass
                return
            rec = None   # rielaborazione fallita -> pipeline normale

        try:
            record_prefix_log(
                query, system_profile_id=study_mode,
                rag_header="", history_turns=history_turns or [],
            )
        except Exception:
            pass

        cache_ctx = {
            "key": cache_key,
            "fingerprint": fingerprint,
            "stages": cache_stages,
            "model_id": model_id,
            "query": query,
            "intent": intent_info,
            "decision": dict(cache_decision),
        }

        if mode == "automatica":
            # R18 B3.1/B1.1: chit-chat SOLO per intent chit-chat (saluti/
            # sociali). Ogni domanda FATTUALE nuova attraversa la pipeline
            # a 3 stadi appunti -> libri -> web, anche con gate pieno.
            if intent_cls == rag_intent.INTENT_CHITCHAT:
                yield from self._emit_chitchat(client, query, thinking,
                                               study_mode, stop_event,
                                               history_turns)
                return

        if mode == "solo_locale":
            yield from self._stream_rag_pipeline(
                client, query, thinking, study_mode, stop_event, topic,
                history_turns, include_books=False, web_mode="mai",
                cfg=cfg, cache_ctx=cache_ctx, intent=intent_cls,
                retrieval_query=retrieval_query,
            )
        elif mode == "solo_online":
            # Percorso web esplicito invariato (1 chiamata, nessun escalation).
            yield from self._stream_web_only_v2(client, query, thinking,
                                                study_mode, stop_event,
                                                history_turns)
        else:
            yield from self._stream_rag_pipeline(
                client, query, thinking, study_mode, stop_event, topic,
                history_turns, include_books=True, web_mode=web_mode,
                cfg=cfg, cache_ctx=cache_ctx, intent=intent_cls,
                retrieval_query=retrieval_query,
            )

    # ------------------------------------------------------------------
    # P2 - decisione semantica con fallback 0-LLM se il warmup non e' finito
    # ------------------------------------------------------------------
    def _semantic_decide(self, query: str) -> Tuple[bool, float, float]:
        sr = self.semantic_router
        # E5 "warm" (non rilasciato da release_model dopo l'indicizzazione):
        # se freddo, should_use_rag pagherebbe il reload del modello nel
        # PRIMO feedback della query -> si cade sulle regole H9 (0-LLM, ~8us)
        # per non superare il target "primo feedback UI <= 2s".
        model_warm = bool(getattr(self.local_search.embedder, "warm", True))
        if getattr(sr, "ready", True) and model_warm:
            try:
                return sr.should_use_rag(query)
            except Exception as exc:  # pragma: no cover
                print(f"[Router] semantic_router in errore: {exc}")
        # NON PRONTO (o modello freddo): nessun blocco — regole H9 (0-LLM).
        try:
            intent = Router0LLM().route(query).get("intent")
        except Exception:
            intent = "rag"
        return (intent != "chat"), 0.0, 0.0

    # ------------------------------------------------------------------
    # P4 - fingerprint corpus per invalidare la cache
    # ------------------------------------------------------------------
    def _cache_fingerprint(self) -> Optional[str]:
        try:
            stores = [
                getattr(self.local_search, "vector_store", None),
                getattr(self.books_search, "vector_store", None),
            ]
            db = getattr(self.local_search, "db", None)
            return corpus_fingerprint(stores=[s for s in stores if s],
                                      db=db)
        except Exception:
            return None

    # ------------------------------------------------------------------
    # P1 - decomposizione SOLO su regola esplicita (ai_router, 0-LLM)
    # ------------------------------------------------------------------
    @staticmethod
    def _decompose(query: str) -> List[str]:
        """Sub-query SOLO se le regole esplite di ai_router scattano
        (multi-punto / "confronta" / "tutto su"): split deterministico,
        NO LLM, e la generazione resta UNA sola con la query originale."""
        # P1b.3: decomposizione dietro FLAG rag.decompose (default OFF,
        # esito A/B qa/p1b_rag.json). Flag spento -> percorso INVARIATO:
        # subqueries=[] esattamente come prima dello hook (variants=None).
        try:
            from core.rag.gate import rag_flag
            if not rag_flag("rag.decompose"):
                return []
        except Exception:
            return []
        try:
            out = Router0LLM().route(query)
        except Exception:
            return []
        if out.get("intent") != "rag":
            return []
        return [s for s in (out.get("subqueries") or []) if str(s).strip()]

    # ==================================================================
    # PIPELINE RAG R15b (P3): retrieve ibrido -> gate -> UNA generazione
    # ==================================================================
    # R16 B2 - vedi qa/qa_r16_b2_report.md
    def _stream_rag_pipeline(
        self,
        client,
        query: str,
        thinking: bool,
        study_mode: str,
        stop_event: Optional[threading.Event],
        topic: str,
        history_turns: Optional[list],
        include_books: bool,
        web_mode: str,
        cfg: dict,
        cache_ctx: dict,
        intent: str = "nuova-domanda",
        retrieval_query: str = "",
    ) -> Generator[dict, None, None]:
        t_start = time.perf_counter()
        rq = (retrieval_query or query).strip() or query   # B3.3
        progress_on = bool(cfg["progress_events"])
        threshold = float(cfg["threshold"])
        weights = {
            STAGE_APPUNTI: float(cfg["w_appunti"]),
            STAGE_LIBRI: float(cfg["w_libri"]),
            STAGE_WEB: float(cfg["w_web"]),
        }

        prog_log: List[Dict] = []

        def prog(stage: str, status: str, ms: float = 0.0,
                 note: str = "") -> Optional[dict]:
            prog_log.append({"stage": stage, "status": status,
                             "ms": round(float(ms), 2), "note": note})
            if not progress_on:
                return None
            return {
                "type": "progress", "stage": stage, "status": status,
                "ms": round(float(ms), 2), "note": str(note),
            }

        # ---- PRIMI FEEDBACK UI SUBITO (prima di ogni lavoro lungo) ------
        ev = prog("gate", "start", 0.0,
                  "gate precoce: deciso subito dopo il retrieval")
        if ev:
            yield ev
        ev = prog("appunti", "start", 0.0,
                  "recupero ibrido appunti (FTS5 + vettori, RRF)")
        if ev:
            yield ev

        # ---- P1: decomposizione solo su regola esplicita (una solta
        #     generazione, le sub-query servono SOLO al retrieval) --------
        subqueries = self._decompose(rq)
        top_k = self._adaptive_top_k(study_mode)

        # ---- stadio APPUNTI (hybrid=True; il default di search resta False)
        local = self.local_search.search(
            rq, top_k=top_k, topic=topic or None,
            hybrid=True, variants=subqueries or None,
        )
        probe_app: Dict = dict(
            getattr(self.local_search, "last_probe", None) or {})
        ev = prog("appunti", "done",
                  probe_app.get("total_ms", 0.0),
                  f"{len(local.chunks)} chunk"
                  + (f", {len(subqueries)} sub-query" if subqueries else ""))
        if ev:
            yield ev

        # ---- stadio LIBRI ------------------------------------------------
        probes: List[Tuple[str, Dict]] = [(STAGE_APPUNTI, probe_app)]
        if include_books:
            ev = prog("libri", "start", 0.0,
                      "recupero ibrido libri (FTS5 + vettori, RRF)")
            if ev:
                yield ev
            books = self.books_search.search(
                rq, top_k=top_k, topic=topic or None,
                hybrid=True, variants=subqueries or None,
            )
            probe_books: Dict = dict(
                getattr(self.books_search, "last_probe", None) or {})
            probes.append((STAGE_LIBRI, probe_books))
            ev = prog("libri", "done", probe_books.get("total_ms", 0.0),
                      f"{len(books.chunks)} chunk")
            if ev:
                yield ev
        else:
            _motivo_lib = ("stadio libri non interrogato in questa modalita"
                           if not include_books else
                           "appunti lenti: libri saltati (R18)")
            ev = prog("libri", "skip", 0.0, _motivo_lib)
            if ev:
                yield ev

        # ---- time-box SOFT retrieve (dichiarato, mai abort) -------------
        retrieve_ms = (time.perf_counter() - t_start) * 1000.0
        if retrieve_ms > RETRIEVE_SOFT_TIMEBOX_MS:
            print(f"[R15P] retrieve time-box SOFT superato: "
                  f"{retrieve_ms:.0f}ms > {RETRIEVE_SOFT_TIMEBOX_MS:.0f}ms "
                  f"— log dichiarato, continuo senza abort")

        # ---- RetrievalOutcome (RRF pesato per stadio dai pesi config) ---
        outcome = self._build_outcome(query, probes, weights, threshold,
                                      total_ms=retrieve_ms)

        # ---- GATE SUBITO dopo il retrieval (G o shim) -------------------
        decide_gate, build_informativa = _gate_fns()
        t_gate = time.perf_counter()
        decision = decide_gate(outcome, threshold, web_attempted=False)
        gate_ms = (time.perf_counter() - t_gate) * 1000.0
        ev = prog("gate", "done", gate_ms,
                  f"esito={getattr(decision, 'outcome', '?')} "
                  f"top={outcome.top_score:.3f}")
        if ev:
            yield ev

        # ---- ESCALATION WEB (orchestrazione P3) -------------------------
        web_results: Optional[List[WebResult]] = None
        web_error = False  # R16: None dall'escalation = errore/assente
        # R18 B1.1: Ogni domanda fattuale nuova TENTA il web (unica
        # eccezione: cache hit intent-aware B3.2, gestito a monte; e
        # web.mode='mai' = opt-out di config). Gli short-circuit
        # pre-tentativo (gate piena / stadi lenti) sono RIMOSSI (F0.1).
        want_web = (web_mode != "mai")
        if want_web and web_mode != "mai":
            ev = prog("web", "start", 0.0, "interrogo lo stadio web (W)")
            if ev:
                yield ev
            t_web = time.perf_counter()
            from core.rag.contract import WEB_DOWN_ENV as _WDE0
            import os as _os0
            if _os0.environ.get(_WDE0, "") == "1":
                # R16 2.5 / QA(v): rete simulata giu' -> ZERO chiamate
                web_results = []
                web_error = True
            else:
                web_results = self._fetch_web_stage(
                    rq,
                    gate_outcome=str(getattr(decision, "outcome", "") or ""),
                    mode=web_mode,
                )
                web_error = web_results is None
                web_results = web_results or []
            web_ms = (time.perf_counter() - t_web) * 1000.0
            if web_results:
                # refusione RRF a 3 stadi con il peso web.* + gate2
                web_rows = self._web_rows(web_results)
                probes_web = probes + [(STAGE_WEB, {
                    "query_norm": outcome.query_norm,
                    "embed_ms": 0.0, "fts_ms": 0.0, "vec_ms": 0.0,
                    "total_ms": web_ms, "variants": 1,
                    "vec_lists": [], "fts_lists": [],
                    "fused": list(web_rows), "candidates": list(web_rows),
                })]
                outcome = self._build_outcome(query, probes_web, weights,
                                              threshold,
                                              total_ms=retrieve_ms + web_ms)
                decision = decide_gate(outcome, threshold, web_attempted=True)
                ev = prog("web", "done", web_ms,
                          f"{len(web_results)} risultati web fusi")
            else:
                # FIX-2 (R15b I): il web e' stato INTERROGATO (o ha tentato)
                # ma non ha prodotto risultati utili: la decisione resta
                # quella corrente (pre-web), pero' l'informativa di gate
                # deve poter dire "[Web: tentato]" invece di affermare che
                # il web "non e' stato interrogato" (falso: qui lo e').
                try:
                    decision.web_attempted = True   # type: ignore[attr-defined]
                except Exception:
                    pass
                ev = prog("web", "skip", web_ms,
                          "core.rag.web_stage assente (W non atterra) "
                          "o nessun risultato")
            if ev:
                yield ev
        else:
            _motivo = f"modalita web={web_mode}"
            ev = prog("web", "skip", 0.0, _motivo)
            if ev:
                yield ev

        # R16 3.1(c): stato onesto dello stadio web (informativa + log)
        import os as _os1
        from core.rag.contract import WEB_DOWN_ENV as _WDE1
        if not (want_web and web_mode != "mai"):
            web_status_val = "non_eseguito"
        elif _os1.environ.get(_WDE1, "") == "1" or web_error:
            web_status_val = "giu"
        else:
            # R18 B1.2: 'giu' SOLO dopo tentativo HTTP reale fallito con
            # errore loggato (url/status/eccezione nel breaker, TTL 60s).
            try:
                from core.rag import web_stage as _wsx
                _wst = _wsx.web_state()
            except Exception:
                _wst = {}
            _br = _wst.get("breaker") or {}
            if web_results:
                web_status_val = "ok_con_risultati"
            elif (_br.get("open") and _br.get("last_error")) or (
                    _wst.get("attempted") and not _wst.get("ok")
                    and _br.get("last_error")):
                web_status_val = "giu"
            else:
                web_status_val = "vuoto"

        # ---- SOURCES: emission con items+stages nei rami (R18) --------
        items = self._build_source_items(outcome, web_results)

        # ---- SYNTH: ESATTAMENTE UNA generazione col contesto finale -----
        local_chunks = [h.chunk for h in outcome.fused
                        if h.stage in (STAGE_APPUNTI, STAGE_LIBRI)]
        has_web = any(h.stage == STAGE_WEB for h in outcome.fused)
        t_synth = time.perf_counter()
        ev = prog("synth", "start", 0.0, "generazione con contesto finale")
        if ev:
            yield ev

        # FIX-2 (R15b I): esito (c) = informativa a ZERO LLM quando la
        # decisione FINALE del gate e' OUTCOME_NULLA — NON solo quando
        # fused e' vuoto (su questo corpus ogni query ha sim >= 0.35 ->
        # fused quasi mai vuoto, ma il gate puo' comunque dire "nulla":
        # alta sim SENZA supporto, pre-screen 0.74-0.84 misurato).
        # ORDINE (dichiarato): la condizione usa la decisione CORRENTE,
        # cioe' quella finale dopo il re-gate web se fatto — se il web ha
        # reintegrato e il re-gate e' diventato piena/parziale si genera
        # normalmente.
        # ECCEZIONE "web results presenti" CON local vuoto (misurata, non
        # inventata): se i candidati LOCALI eligibility-H8 sono vuoti e il
        # web ha fornito il contesto, si genera SEMPRE con quel contesto
        # (regola P1 "1 sola chiamata col contesto finale"; test_03 e
        # test_03b di testR15_pipe.py — sims misurate 0.086 < 0.35 per la
        # query gibberish, store vuoto per 03b). Con candidati locali
        # PRESENTI ma gate finale ancora nulla (web incluso: "0 risultati
        # utili dopo gate2") -> informativa zero-LLM (QA-1 iv, v-a, v-b).
        final_nulla = str(getattr(decision, "outcome", "") or "") \
            == OUTCOME_NULLA
        # R16 3.1: informativa SOLO se non c'e' nulla con cui generare.
        # Con risultati web disponibili -> risposta BASATA SUL WEB
        # (F0 q3/q4: 5 risultati web fusi + informativa = bug WEB-NON-USATO;
        #  l'informativa zero-LLM spetta a web vuoto/giu'/non eseguito).
        want_inform = (not web_results) and (final_nulla
                                             or not outcome.fused)
        if want_inform:
            text = build_informativa(decision, web_status=web_status_val)
            # R18 B1.3: nessun contesto di generazione -> nessun chunk
            # sopra soglia contribuisce -> provenienza VUOTA (la UI
            # mostra "nessuna fonte trovata"); i near-miss NON contano.
            prov_i: List[str] = []
            # B1.3: SEMPRE emesso (stadi vuoti -> "nessuna fonte trovata")
            yield {"type": "sources", "items": items or [],
                   "stages": prov_i}
            for i in range(0, len(text), _CACHE_STREAM_CHUNK):
                yield {"type": "token", "text": text[i:i + _CACHE_STREAM_CHUNK]}
            ev = prog("synth", "done",
                      (time.perf_counter() - t_synth) * 1000.0,
                      "informativa gate (zero LLM)")
            if ev:
                yield ev
            yield {"type": "source", "value": "nessuna"}
            try:
                from core.rag.contract import log_risposta as _lr1
                _lr1({
                    "query": query, "esito": "informativa",
                    "stadi": list(getattr(decision, "stages_probed", [])
                                  or []),
                    "score": round(float(getattr(decision, "top_score", 0.0)
                                         or 0.0), 4),
                    "tempi_per_stadio": list(prog_log),
                    "tempo_totale_ms": round((time.perf_counter() - t_start)
                                             * 1000.0, 2),
                    "output_len": len(text),
                    "marker_check": {"ok": True, "reason":
                                     "informativa-deterministica"},
                    "web_status": web_status_val, "source": "nessuna",
                    "intent": intent,
                    "intent_info": dict(cache_ctx.get("intent") or {}),
                    "cache_decision": dict(cache_ctx.get("decision") or {}),
                })
            except Exception:
                pass
            return

        # Contesto finale deciso PRIMA di generare:
        #   - solo locale  -> context_kind="locale"
        #   - solo web     -> context_kind="web" (+ web_results formattati)
        #   - locale+web   -> fuso come chunk "locale" (chunk pseudo-web con
        #     url come source_file): il client formatta locale OPPURE web,
        #     mai entrambi — UNA sola chiamata.
        if final_nulla and web_results:
            # R16 3.1(c): risposta BASATA SUL WEB con citazioni url:
            # il gate locale resta nulla su score floor web (0.4 < soglia)
            # ma il web e' l'ultimo layer SEMPRE ATTIVO -> si genera.
            context_kind = "web"
            gen_chunks = None
            gen_web = web_results
            source = "web"
        elif web_results and has_web and not local_chunks:
            context_kind = "web"
            gen_chunks = None
            gen_web = web_results
            source = "web"
        elif has_web and local_chunks:
            context_kind = "locale"
            gen_chunks = local_chunks + self._pseudo_web_chunks(outcome)
            gen_web = None
            source = "web"   # contesto contiene fonti web -> escalation web
        else:
            context_kind = "locale"
            gen_chunks = local_chunks
            gen_web = None
            if any(h.stage == STAGE_APPUNTI for h in outcome.fused):
                source = "locale"
            else:
                source = "libri_preselezionati"

        prov_list = self._provenance_contributing(outcome, context_kind,
                                                   gen_chunks, gen_web)
        if items:
            yield {"type": "sources", "items": items, "stages": prov_list}

        # UNA SOLA chiamata generate_stream (fallback-marker escalation
        # eliminata: il gate ha gia' deciso; split resta solo se il contesto
        # supera il tetto del contesto — queue event, feature esistente).
        from core.rag.contract import SLO_TOTAL_S as _SLO0
        # margine 1.0s: t_start e' l'ingresso della pipeline, mentre il
        # timer E2E del QA parte prima (cache/semantic) - misurato T1
        time_budget_s = max(3.0, float(_SLO0) - 1.0
                            - (time.perf_counter() - t_start))
        holder: Dict = {}
        collected: List[str] = []
        # FIX-II (R15b): prefisso DETERMINISTICO per esito parziale. Il QA-1
        # ha mostrato 0/6 compliance del modello sull'istruzione (il kwarrand
        # outcome="parziale" ARRIVA, vedi attempt2 outcome_kwargs=['parziale']):
        # la frase "Ho trovato solo questo nei materiali: " viene quindi emessa
        # DALLA PIPELINE (zero affidabilita' sul modello); l'istruzione nel
        # prompt resta per tono/citazioni near-miss.
        if str(getattr(decision, "outcome", "")) == OUTCOME_PARZIALE:
            from core.rag.contract import PARTIAL_PREFIX as _PP0
            yield {"type": "token", "text": _PP0}
        for ev2 in self._emit_level(
            client, query, context_kind, gen_chunks, gen_web,
            False, thinking, study_mode, stop_event, source, holder,
            allow_split=True, history_turns=history_turns,
            outcome=str(getattr(decision, "outcome", "") or "") or None,
            time_budget_s=time_budget_s,
        ):
            if ev2.get("type") == "token":
                collected.append(ev2.get("text") or "")
            elif ev2.get("type") == "reset":
                collected.clear()  # R16: il retry/fallback SOSTITUISCE
            yield ev2

        synth_ms = (time.perf_counter() - t_synth) * 1000.0
        ev = prog("synth", "done", synth_ms,
                  "1 chiamata generate_stream" + (
                      " (parte 1 di queue)" if holder.get("split") else ""))
        if ev:
            yield ev

        # ---- R18 B2.1/B5.1: self-check grounding + profondita' --------
        validation: Dict = {"skipped": True, "reason": "nessuna verifica"}
        if (not holder.get("split")
                and intent != "chit-chat"
                and (gen_chunks or gen_web)):
            final_text = "".join(collected)
            dg = rag_grounding.depth_check(final_text, intent)
            ctx_texts = (
                [str(getattr(c, "text", "")) for c in (gen_chunks or [])]
                + [str(getattr(r, "snippet", "")) for r in (gen_web or [])])
            # R18 fix10: anni biografici mancanti (deterministico)
            _bio_missing = self._bio_years_missing(query, ctx_texts,
                                                   final_text)
            if _bio_missing:
                print(f"[Router] anni biografici mancanti: {_bio_missing}")
            t_chk = time.perf_counter()
            gc = rag_grounding.run_check(query, ctx_texts, final_text,
                                         client=client)
            validation = {
                "depth": dg, "grounding": gc, "attempts": 1,
                "check_ms": round((time.perf_counter() - t_chk) * 1000.0, 1),
            }
            need_regen = ((not dg.get("ok")) or (gc.get("ok") is False)
                          or bool(_bio_missing))
            if need_regen:
                repair_bits = []
                if _bio_missing:
                    repair_bits.append(
                        "Anni di nascita/morte presenti nel CONTESTO ma "
                        "MANCANTI nella risposta: "
                        + ", ".join(_bio_missing)
                        + " -> inseriscili nella biografia.")
                viol = list(gc.get("violations") or [])
                if viol:
                    repair_bits.append(
                        "Affermazioni NON supportate dal contesto (da "
                        "correggere o rimuovere): "
                        + "; ".join(str(v) for v in viol[:4]) + ".")
                if not dg.get("ok"):
                    repair_bits.append(
                        f"Risposta troppo breve: servono almeno "
                        f"{dg.get('min', 80)} parole ben articolate (o "
                        f"almeno 3 punti strutturati) SOLO sul contesto "
                        f"fornito.")
                repair_bits.append(
                    "Se materiali locali e fonti web sono in contrasto, "
                    "segui le fonti web e segnala in una frase il dato "
                    "diverso riportato dai locali.")
                note = " ".join(repair_bits)
                print(f"[Router] rigenerazione vincolata (B2/B5): "
                      f"{note[:220]}")
                yield {"type": "reset"}
                collected.clear()
                t_re = time.perf_counter()
                for evr in self._iter_gen(
                        client, query, context_kind=context_kind,
                        local_chunks=gen_chunks, web_results=gen_web,
                        allow_fallback_marker=False, images=None,
                        thinking=thinking, study_mode=study_mode,
                        stop_event=stop_event, part_index=0,
                        is_last_part=True, parts_summaries=[],
                        history_turns=history_turns,
                        outcome=str(getattr(decision, "outcome", ""))
                        or None,
                        time_budget_s=max(3.0, float(_SLO0) - 1.0
                                          - (time.perf_counter() - t_synth)),
                        repair_note=note):
                    if evr.get("type") == "token":
                        collected.append(evr.get("text") or "")
                    elif evr.get("type") == "reset":
                        collected.clear()
                    yield evr
                final_text = "".join(collected)
                dg2 = rag_grounding.depth_check(final_text, intent)
                gc2 = rag_grounding.run_check(query, ctx_texts, final_text,
                                              client=client)
                validation = {
                    "depth": dg2, "grounding": gc2, "attempts": 2,
                    "first": {"depth": dg, "grounding": gc},
                    "check_ms": round(
                        (time.perf_counter() - t_re) * 1000.0, 1),
                }
                if gc2.get("ok") is False and gc2.get("violations"):
                    # persiste -> risposta che dichiara il limite (B2.1)
                    stmt = rag_grounding.limit_statement(
                        gc2["violations"])
                    fb = ""
                    try:
                        from core.rag.output_guard import (
                            compose_fallback as _cfb1)
                        fb = str(_cfb1(gen_chunks, gen_web,
                                      query) or "").strip()
                    except Exception:
                        fb = ""
                    body = stmt + ("\n\n" + fb if fb else "")
                    yield {"type": "reset"}
                    collected.clear()
                    for i in range(0, len(body), _CACHE_STREAM_CHUNK):
                        piece = body[i:i + _CACHE_STREAM_CHUNK]
                        yield {"type": "token", "text": piece}
                        collected.append(piece)
                    validation["limit_declared"] = True
            print("[Router] validazione R18: "
                  + str(validation)[:400])

        # R16 3.3: OGNI risposta loggata (stadi/score/tempi/esito/len/marker)
        try:
            from core.rag.contract import log_risposta as _lr0
            _lr0({
                "query": query,
                "esito": str(getattr(decision, "outcome", "") or ""),
                "stadi": list(getattr(decision, "stages_probed", []) or []),
                "score": round(float(getattr(decision, "top_score", 0.0)
                                     or 0.0), 4),
                "tempi_per_stadio": list(prog_log),
                "tempo_totale_ms": round((time.perf_counter() - t_start)
                                         * 1000.0, 2),
                "output_len": sum(len(x) for x in collected),
                "marker_check": getattr(client, "last_marker_check", None),
                "web_status": web_status_val,
                "source": source,
                "provenienza": list(prov_list),
                "sources": [dict(i) for i in (items or [])][:8],
                "intent": intent,
                "intent_info": dict(cache_ctx.get("intent") or {}),
                "cache_decision": dict(cache_ctx.get("decision") or {}),
                "validazione": validation,
            })
        except Exception:
            pass

        # ---- P4: scrittura cache SOLO se completo + con fonti ----------
        complete = (
            not holder.get("split")
            and not holder.get("fallback")
            and not validation.get("limit_declared")
            and bool(collected)
            and bool(items)
            and not (stop_event is not None and stop_event.is_set())
        )
        if complete:
            try:
                self.answer_cache.put(
                    cache_ctx["key"],
                    query=cache_ctx["query"],
                    text="".join(collected),
                    source=source,
                    items=items,
                    model_id=cache_ctx["model_id"],
                    stages=cache_ctx["stages"],
                    fingerprint=cache_ctx["fingerprint"],
                    provenance=prov_list,
                )
            except Exception as exc:  # pragma: no cover - mai bloccante
                print(f"[Router] answer cache put fallito: {exc}")

    # ------------------------------------------------------------------
    # P3 - costruzione RetrievalOutcome (RRF pesato per stadio)
    # ------------------------------------------------------------------
    @staticmethod
    def _build_outcome(query: str, probes: List[Tuple[str, Dict]],
                       weights: Dict[str, float], threshold: float,
                       total_ms: float = 0.0) -> RetrievalOutcome:
        embed_ms = fts_ms = vec_ms = 0.0
        stages_probed: List[str] = []
        query_norm = ""
        stage_lists: List[Tuple[str, List[dict]]] = []
        all_candidates: List[Tuple[str, dict]] = []
        vec_sim: Dict[Tuple[str, str], float] = {}
        fts_sim: Dict[Tuple[str, str], float] = {}
        fts_bm25: Dict[Tuple[str, str], float] = {}

        for stage, probe in probes:
            probe = probe or {}
            embed_ms += float(probe.get("embed_ms", 0.0) or 0.0)
            fts_ms += float(probe.get("fts_ms", 0.0) or 0.0)
            vec_ms += float(probe.get("vec_ms", 0.0) or 0.0)
            query_norm = probe.get("query_norm") or query_norm
            rows = probe.get("fused") or []
            cands = probe.get("candidates") or rows
            if rows or probe.get("variants"):
                stages_probed.append(stage)
            if rows:
                stage_lists.append((stage, list(rows)))
            for r in cands:
                all_candidates.append((stage, r))
            for vl in probe.get("vec_lists") or []:
                for r in vl:
                    k = _row_key(r)
                    prev = vec_sim.get(k)
                    sim = _row_sim(r)
                    if prev is None or sim > prev:
                        vec_sim[k] = sim
            for fl in probe.get("fts_lists") or []:
                for r in fl:
                    k = _row_key(r)
                    if k not in fts_sim:
                        fts_sim[k] = _row_sim(r)
                        try:
                            # bm25 RAW di SQLite (<=0): e' IL valore che il
                            # gate G si aspetta in fts_scores ("0 se stadio
                            # non interpellato"; negativo = match piu' forte)
                            fts_bm25[k] = float(r.get("bm25") or 0.0)
                        except (TypeError, ValueError):
                            fts_bm25[k] = 0.0

        # ---- eleggibilita' H8 (dichiarata): nessun rumore sub-soglia ----
        # - righe locali: forti (>=0.45); se nessun forte -> debili (>=0.35)
        #   con cap MAX_WEAK_CHUNKS (stessa politica di search()/hybrid);
        # - righe WEB: sempre ammesse quando W4 le ha fornite (fusione
        #   garantita per "sempre"/"auto" deciso dal gate).
        local_all: List[Tuple[str, dict]] = []
        web_all: List[Tuple[str, dict]] = []
        for stage, rows in stage_lists:
            if stage == STAGE_WEB:
                web_all.extend((stage, r) for r in rows)
            else:
                local_all.extend((stage, r) for r in rows)
        strong = [(s, r) for s, r in local_all
                  if _row_sim(r) >= MIN_SIMILARITY_STRONG]
        if strong:
            local_eligible = strong
        else:
            weak = [(s, r) for s, r in local_all
                    if _row_sim(r) >= MIN_SIMILARITY_WEAK]
            weak.sort(key=lambda t: -_row_sim(t[1]))
            local_eligible = weak[:MAX_WEAK_CHUNKS]
        eligible_keys = {_row_key(r) for _s, r in (local_eligible + web_all)}

        # ---- fusione RRF cross-stadio con PESI da config ----------------
        # (rank = posizione nella lista STAGIALE originale, pesata per stadio)
        scores: Dict[Tuple[str, str], float] = {}
        best: Dict[Tuple[str, str], Tuple[str, dict]] = {}
        for stage, rows in stage_lists:
            w = float(weights.get(stage, 1.0))
            for rank, row in enumerate(rows, start=1):
                k = _row_key(row)
                if k not in eligible_keys:
                    continue  # sub-soglia H8: mai nel contesto di generazione
                scores[k] = scores.get(k, 0.0) + w / (RRF_K + rank)
                prev = best.get(k)
                if prev is None or _row_sim(row) > _row_sim(prev[1]):
                    best[k] = (stage, row)

        ordered = sorted(scores.items(), key=lambda kv: -kv[1])[:10]
        fused: List[StageHit] = []
        fts_scores: List[float] = []
        vec_scores: List[float] = []
        rrf_scores: List[float] = []
        bm25_scores: List[float] = []
        for rank, (k, rrf_sc) in enumerate(ordered, start=1):
            stage, row = best[k]
            fused.append(StageHit(chunk=_to_chunk(row), stage=stage,
                                  score=_row_sim(row), rrf_rank=rank))
            vec_scores.append(float(vec_sim.get(k, 0.0)))
            # fts_scores = bm25 raw (contratto: "fts5_score per top-10",
            # 0 se la riga non e' nell'indice FTS) — scala attesa dal gate G
            fts_scores.append(float(fts_bm25.get(k, 0.0)))
            rrf_scores.append(float(rrf_sc))
            bm25_scores.append(float(fts_bm25.get(k, 0.0)))

        # ---- near_miss: top-3 candidati SOGLIA-SOTTO (fuori dal top-10) --
        fused_keys = {k for k, _ in ordered}
        sub = [(stage, row) for stage, row in all_candidates
               if _row_key(row) not in fused_keys
               and _row_sim(row) < float(threshold)]
        sub.sort(key=lambda t: -_row_sim(t[1]))
        near_miss = [StageHit(chunk=_to_chunk(row), stage=stage,
                              score=_row_sim(row), rrf_rank=0)
                     for stage, row in sub[:3]]

        return RetrievalOutcome(
            query=query,
            query_norm=query_norm or query,
            fused=fused,
            near_miss=near_miss,
            fts_scores=fts_scores,
            vec_scores=vec_scores,
            stages_probed=stages_probed,
            embed_ms=embed_ms,
            fts_ms=fts_ms,
            vec_ms=vec_ms,
            total_ms=total_ms,
            cache_hit=False,
            extra={
                "weights": dict(weights),
                "threshold": float(threshold),
                "rrf_scores": rrf_scores,
                "fts_bm25": bm25_scores,
                "soft_timebox_ms": RETRIEVE_SOFT_TIMEBOX_MS,
            },
        )

    # ------------------------------------------------------------------
    # P3 - web stage (W) via import LAZY; assente -> niente web (dichiarato)
    # ------------------------------------------------------------------
    @staticmethod
    def _normalize_web_results(res) -> Optional[List[WebResult]]:
        if res is None:
            return None
        if isinstance(res, dict):
            res = res.get("results") or res.get("items") or res.get("hits") or []
        out: List[WebResult] = []
        try:
            for r in res or []:
                if isinstance(r, WebResult):
                    out.append(r)
                elif isinstance(r, dict):
                    out.append(WebResult(
                        title=str(r.get("title") or ""),
                        url=str(r.get("url") or r.get("link") or ""),
                        snippet=str(r.get("snippet") or r.get("text")
                                    or r.get("description") or ""),
                    ))
                elif hasattr(r, "title"):
                    out.append(WebResult(
                        title=str(getattr(r, "title", "") or ""),
                        url=str(getattr(r, "url", "") or ""),
                        snippet=str(getattr(r, "snippet", "")
                                    or getattr(r, "text", "") or ""),
                    ))
        except Exception:
            return None
        return out

    @staticmethod
    def _fetch_web_stage(query: str, gate_outcome: str = "",
                         mode: str = "auto") -> Optional[List[WebResult]]:
        """Risultati web VIVI tramite core.rag.web_stage (owner W).

        Protocollo: ws.escalate(query, gate_outcome=..., mode=...) — W4
        decide lui stesso auto/sempre/mai; P passa gia' l'esito del gate e
        la modalita' risolta (policy identica: auto solo se parziale/nulla).

        - modulo assente (W non atterra) -> None: NESSUN web (dichiarato);
        - web tentato ma vuoto ([]) -> [] (W4 ha deciso o zero risultati);
        - errore di esecuzione -> None (nessuna eccezione propagata).
        """
        try:
            import core.rag.web_stage as ws
        except Exception:
            return None
        esc = getattr(ws, "escalate", None)
        if callable(esc):
            try:
                res = esc(query, gate_outcome=gate_outcome, mode=mode,
                          top_k=5)
            except TypeError:
                try:
                    res = esc(query)
                except Exception as exc:
                    print(f"[R15P] web_stage.escalate in errore: {exc}")
                    return None
            except Exception as exc:
                print(f"[R15P] web_stage.escalate in errore: {exc}")
                return None
            norm = Router._normalize_web_results(res)
            if norm is not None:
                return norm
        # Fallback di compatibilita': altre API del modulo (mai eccezioni)
        fns = []
        for name in ("search_web", "web_search", "search", "fetch",
                     "query", "run", "execute"):
            fn = getattr(ws, name, None)
            if callable(fn):
                fns.append(fn)
        for fn in fns:
            for args in ((query,), (query, 5)):
                try:
                    res = fn(*args)
                except TypeError:
                    continue
                except Exception as exc:
                    print(f"[R15P] web_stage in errore: {exc}")
                    break
                norm = Router._normalize_web_results(res)
                if norm is not None:
                    return norm
        return None

    # ------------------------------------------------------------------
    # P3 - righe/richiami per la fusione e le fonti
    # ------------------------------------------------------------------
    @staticmethod
    def _web_rows(web_results: List[WebResult]) -> List[dict]:
        rows = []
        for r in web_results or []:
            rows.append({
                "text": f"{r.title}\n{r.snippet}",
                "source_file": r.url or r.title,
                "location_hint": "web",
                "similarity": WEB_PROVISIONAL_SIMILARITY,
                "is_image": False,
                "image_path": "",
                "mime_type": "",
                "url": r.url or "",
                "title": r.title or "",
            })
        return rows

    @staticmethod
    def _pseudo_web_chunks(outcome: RetrievalOutcome) -> List[RetrievedChunk]:
        """Chunk pseudo-web per il contesto FUSO locale+web (UNA chiamata):
        il client formatta i chunk con source_file = url."""
        out = []
        for h in outcome.fused:
            if h.stage != STAGE_WEB:
                continue
            c = h.chunk
            if getattr(c, "is_image", False):
                continue
            out.append(RetrievedChunk(
                text=c.text,
                source_file=c.source_file,
                location_hint="web",
                similarity=c.similarity,
                is_image=False, image_path=None, mime_type=None,
            ))
        return out

    def _build_source_items(self, outcome: RetrievalOutcome,
                            web_results: Optional[List[WebResult]]) -> List[dict]:
        """items = [{stage,title,url,source}] da chunk fusi + web live."""
        items: List[dict] = []
        seen = set()

        def _add(stage, title, url, source):
            k = (stage, url or source, title)
            if k in seen:
                return
            seen.add(k)
            items.append({"stage": stage, "title": title, "url": url,
                          "source": source})

        for h in outcome.fused:
            c = h.chunk
            if h.stage == STAGE_WEB:
                title = (c.text or "").split("\n", 1)[0][:120]
                _add(STAGE_WEB, title, c.source_file or "",
                     c.source_file or title)
            else:
                src = str(c.source_file or "")
                title = src.replace("\\", "/").split("/")[-1] or src
                if c.location_hint:
                    title = f"{title} — {c.location_hint}"
                _add(h.stage, title, "", src)
        # eventuali web live non finiti nei fused (margine RRF) restano fonti
        if web_results:
            for r in web_results:
                _add(STAGE_WEB, (r.title or "")[:120], r.url or "",
                     r.url or (r.title or ""))
        return items

    # ==================================================================
    # CONTINUAZIONE con ROLLING SUMMARY
    # ==================================================================
    def continue_stream(
        self,
        chunks: List[RetrievedChunk],
        query: str,
        context_kind: str,
        study_mode: str,
        parts_summaries: List[str],
        part_index: int,
        is_last_part: bool,
        stop_event: Optional[threading.Event] = None,
        source: str = "locale",
        history_turns: Optional[list] = None,
    ) -> Generator[dict, None, None]:
        client = self._get_client()
        try:
            # G2: header RAG REALE (prime fonti) + storia reale nel log prefisso
            hdr = ""
            try:
                hdr = " | ".join(
                    (getattr(c, "source_file", "") or "").split("\\")[-1] +
                    ": " + (getattr(c, "text", "") or "")[:120]
                    for c in (chunks or [])[:3]
                )
            except Exception:
                hdr = ""
            record_prefix_log(
                query, system_profile_id=study_mode,
                rag_header=hdr, history_turns=history_turns or [],
            )
        except Exception:
            pass
        images = self._select_images(chunks)
        try:
            for ev_t in self._iter_gen(
                client, query,
                context_kind=context_kind,
                local_chunks=chunks,
                web_results=None,
                allow_fallback_marker=False,
                images=images,
                thinking=False,
                study_mode=study_mode,
                stop_event=stop_event,
                part_index=part_index,
                is_last_part=is_last_part,
                parts_summaries=parts_summaries,
                history_turns=history_turns,
            ):
                yield ev_t
        finally:
            yield {"type": "source", "value": source}

    # ==================================================================
    # CHITCHAT
    # ==================================================================
    def _emit_chitchat(self, client, query, thinking, study_mode, stop_event, history_turns=None):
        # R16: progress UI + budget SLO + reset + log (F0 q1: progress=[]
        # e 57s di decode senza nessun feedback intermedio)
        t0 = time.perf_counter()
        progress_on = bool(_read_pipeline_cfg()["progress_events"])
        if progress_on:
            yield {"type": "progress", "stage": "synth", "status": "start",
                   "ms": 0.0, "note": "risposta diretta (nessun materiale)"}
        from core.rag.contract import SLO_TOTAL_S as _SLO1
        budget = max(3.0, float(_SLO1) - 1.0
                     - (time.perf_counter() - t0))
        collected: List[str] = []
        for ev_t in self._iter_gen(
            client, query,
            context_kind="none",
            local_chunks=None,
            web_results=None,
            allow_fallback_marker=False,
            images=None,
            thinking=thinking,
            study_mode=study_mode,
            stop_event=stop_event,
            chitchat=True,
            history_turns=history_turns,
            time_budget_s=budget,
        ):
            if ev_t["type"] == "reset":
                collected.clear()
            else:
                collected.append(ev_t["text"])
            yield ev_t
        if progress_on:
            yield {"type": "progress", "stage": "synth", "status": "done",
                   "ms": round((time.perf_counter() - t0) * 1000.0, 2),
                   "note": "1 chiamata generate_stream"}
        yield {"type": "source", "value": "nessuna"}
        self._log_risposta({
            "query": query, "esito": "chitchat", "stadi": [],
            "score": None, "tempi_per_stadio": [],
            "tempo_totale_ms": round((time.perf_counter() - t0) * 1000.0, 2),
            "output_len": sum(len(x) for x in collected),
            "marker_check": getattr(client, "last_marker_check", None),
            "web_status": "non_eseguito", "source": "nessuna",
        })

    # ==================================================================
    # LIVELLO WEB ESPLICITO (solo_online, invariato)
    # ==================================================================
    def _stream_web_only_v2(self, client, query, thinking, study_mode, stop_event, history_turns=None):
        # solo_online: percorso web esplicito invariato (1 chiamata LLM),
        # con soli eventi progress se abilitati da rag.progress_events.
        progress_on = bool(_read_pipeline_cfg()["progress_events"])
        t0 = time.perf_counter()
        if progress_on:
            yield {"type": "progress", "stage": "web", "status": "start",
                   "ms": 0.0, "note": "modalita solo_online"}
        web = search_web(query)
        if progress_on:
            yield {"type": "progress", "stage": "web", "status": "done",
                   "ms": round((time.perf_counter() - t0) * 1000.0, 2),
                   "note": f"{len(web) if web else 0} risultati"}
        if not web:
            yield from self._emit_single_level(
                client, query, "none", None, None, False,
                thinking, study_mode, stop_event, "nessuna",
                history_turns=history_turns,
            )
            return
        holder = {}
        yield from self._emit_level(
            client, query, "web", None, web, False,
            thinking, study_mode, stop_event, "web", holder,
            allow_split=False, history_turns=history_turns,
        )

    # ==================================================================
    # R18: provenienza per STADIO dai metadati (niente codici [F#] nel
    # testo, niente blocco "Fonti:" con URL - la UI mostra solo una riga
    # piccola: "Fonte: appunti" / "Fonti: appunti e web")
    # ==================================================================
    @staticmethod
    def _provenance_stages(outcome, context_kind: str, gen_chunks,
                           gen_web) -> List[str]:
        seen = set()
        if context_kind == STAGE_WEB or gen_web:
            seen.add(STAGE_WEB)
        fused_stage = {id(h.chunk): getattr(h, "stage", "")
                       for h in (outcome.fused if outcome else [])}
        for c in (gen_chunks or []):
            st = fused_stage.get(id(c), "")
            if not st and getattr(c, "location_hint", "") == "web":
                st = STAGE_WEB
            if st:
                seen.add(st)
        return [s for s in (STAGE_APPUNTI, STAGE_LIBRI, STAGE_WEB)
                if s in seen]

    @staticmethod
    def _provenance_from_hits(hits) -> List[str]:
        seen = set()
        for h in (hits or []):
            st = getattr(h, "stage", None)
            if st:
                seen.add(st)
        return [s for s in (STAGE_APPUNTI, STAGE_LIBRI, STAGE_WEB)
                if s in seen]

    @staticmethod
    def _bio_years_missing(query: str, ctx_texts, answer: str) -> List[str]:
        """R18: per domande BIOGRAFICHE ("chi e'/era/fu") gli anni (4 cifre)
        presenti nel CONTESTO ma assenti dalla risposta -> forzano la
        rigenerazione vincolata con gli anni elencati (GT B2.3)."""
        import re as _re2
        q = " ".join(_re2.sub(r"[^a-z0-9 ]", " ",
                              str(query or "").lower()).split())
        if not _re2.search(r"\bchi (e|era|fu|sia|sara)\b", q):
            return []
        year_re = _re2.compile(r"\b(1[0-9]{3}|20[0-9]{2})\b")
        ctx_years: List[str] = []
        for t in (ctx_texts or []):
            for y in year_re.findall(str(t or "")):
                if y not in ctx_years:
                    ctx_years.append(y)
        if len(ctx_years) < 2:
            return []
        ans_years = set(year_re.findall(str(answer or "")))
        return [y for y in ctx_years if y not in ans_years][:4]

    @staticmethod
    def _provenance_contributing(outcome, context_kind: str, gen_chunks,
                                 gen_web) -> List[str]:
        """R18 B1.3 - provenienza = stadi CONTRIBUENTI: chunk sopra soglia
        di ammissione H8 (MIN_SIMILARITY_WEAK) presenti NEL CONTESTO della
        generazione; web solo se effettivamente usato. Nessun contributore
        -> lista vuota -> "nessuna fonte trovata" in UI."""
        seen = set()
        if gen_web or context_kind == STAGE_WEB:
            seen.add(STAGE_WEB)
        for c in (gen_chunks or []):
            st = None
            if getattr(c, "location_hint", "") == "web":
                st = STAGE_WEB
            else:
                # mappa stage dai fused (gli oggetti sono gli stessi)
                for h in (outcome.fused if outcome else []):
                    if h.chunk is c:
                        st = h.stage
                        break
            if st and float(getattr(c, "similarity", 0.0) or 0.0) >= MIN_SIMILARITY_WEAK:
                seen.add(st)
        return [s for s in (STAGE_APPUNTI, STAGE_LIBRI, STAGE_WEB)
                if s in seen]

    # ==================================================================
    # R16: iteratori convalidati (RESET -> evento reset; budget tempo)
    # ==================================================================
    @staticmethod
    def _iter_gen(client, query, **kw):
        """client.generate_stream -> eventi {type: token|reset}.

        - time_budget_s passato SOLO se il client lo dichiara (compat test);
        - dict contract.RESET_TOKEN dal client -> evento {"type":"reset"}
          (api.py svuota i token; FE sostituisce il testo).
        """
        time_budget_s = kw.pop("time_budget_s", None)
        answer_draft = kw.pop("answer_draft", None)
        repair_note = kw.pop("repair_note", None)
        try:
            import inspect as _inspect0
            sig = _inspect0.signature(client.generate_stream)
            # passa se il param esplicito OPPURE **kwargs (proxy R15:
            # senza questo check il budget NON arrivava mai al client -
            # misurato QA-1 t1: totali 28-57s con deadline non applicata)
            pass_opt = any(
                (k in sig.parameters) or any(
                    p.kind == p.VAR_KEYWORD
                    for p in sig.parameters.values())
                for k, v in (("time_budget_s", time_budget_s),
                             ("answer_draft", answer_draft),
                             ("repair_note", repair_note))
                if v is not None)
        except (TypeError, ValueError):
            pass_opt = False
        if pass_opt:
            if time_budget_s is not None:
                kw["time_budget_s"] = time_budget_s
            if answer_draft is not None:
                kw["answer_draft"] = answer_draft
            if repair_note is not None:
                kw["repair_note"] = repair_note
        try:
            stream = client.generate_stream(query, **kw)
        except TypeError:
            kw.pop("time_budget_s", None)
            kw.pop("answer_draft", None)
            kw.pop("repair_note", None)
            stream = client.generate_stream(query, **kw)
        for token in stream:
            if isinstance(token, dict):
                if token.get("_reset"):
                    yield {"type": "reset"}
                continue
            yield {"type": "token", "text": token}

    def _log_risposta(self, record: dict) -> None:
        """R16 3.3: log ogni risposta (mai eccezione verso il path)."""
        try:
            from core.rag import contract as _ct0
            _ct0.log_risposta(record)
        except Exception:
            pass

    # ==================================================================
    # EMISSIONE LIVELLO (split per contesto lungo, rolling summary)
    # ==================================================================
    def _emit_level(self, client, query, context_kind, chunks, web_results,
                    allow_fallback, thinking, study_mode, stop_event, source, holder,
                    allow_split=True, history_turns=None, outcome=None,
                    time_budget_s=None):
        # FIX-1 (R15b I): outcome=decision.outcome del gate (piena|parziale|
        # nulla|None) viene inoltrato a client.generate_stream cosi' il flag
        # parziale di G (_PARTIAL_OUTCOME_INSTRUCTION in local_llm_client,
        # applicato SOLO se outcome=="parziale") arriva davvero in E2E.
        # Backward-compat: outcome=None o != "parziale" -> prompt IDENTICO
        # (nessun flag aggiunto), garantito dal client.
        if chunks and allow_split:
            parts = self._split_chunks_if_needed(chunks, query)
        else:
            parts = [chunks] if chunks else [[]]

        if len(parts) > 1:
            holder["split"] = True
            holder["fallback"] = False
            yield {
                "type": "queue",
                "parts": parts[1:],
                "query": query,
                "context_kind": context_kind,
                "study_mode": study_mode,
                "current_part": 1,
                "total_parts": len(parts),
                "source": source,
            }
            images = self._select_images(parts[0])
            try:
                for ev_t in self._iter_gen(
                    client, query,
                    context_kind=context_kind,
                    local_chunks=parts[0],
                    web_results=web_results,
                    allow_fallback_marker=False,
                    images=images,
                    thinking=thinking,
                    study_mode=study_mode,
                    stop_event=stop_event,
                    part_index=1,
                    is_last_part=False,
                    parts_summaries=[],
                    history_turns=history_turns,
                    outcome=outcome,
                    time_budget_s=time_budget_s,
                ):
                    yield ev_t
            finally:
                yield {"type": "source", "value": source}
            return

        holder["split"] = False
        buf = []
        images = self._select_images(chunks)
        try:
            for ev_t in self._iter_gen(
                client, query,
                context_kind=context_kind,
                local_chunks=chunks,
                web_results=web_results,
                allow_fallback_marker=allow_fallback,
                images=images,
                thinking=thinking,
                study_mode=study_mode,
                stop_event=stop_event,
                part_index=0,
                is_last_part=True,
                parts_summaries=[],
                history_turns=history_turns,
                outcome=outcome,
                time_budget_s=time_budget_s,
            ):
                if ev_t["type"] == "reset":
                    buf.clear()  # R16: retry sostituisce
                else:
                    buf.append(ev_t["text"])
                yield ev_t
        finally:
            yield {"type": "source", "value": source}
        holder["fallback"] = _is_fallback("".join(buf)) if allow_fallback else False

    def _emit_single_level(self, client, query, context_kind, chunks, web_results,
                           allow_fallback, thinking, study_mode, stop_event, source,
                           history_turns=None, outcome=None):
        holder = {}
        yield from self._emit_level(
            client, query, context_kind, chunks, web_results,
            allow_fallback, thinking, study_mode, stop_event, source, holder,
            history_turns=history_turns, outcome=outcome,
        )

    def _split_chunks_if_needed(self, chunks, query) -> List[List[RetrievedChunk]]:
        if not chunks:
            return [[]]

        client = self._get_client()
        n_ctx = client.n_ctx if client else 8192

        overhead = (
            _SYSTEM_PROMPT_RESERVE
            + _QUERY_RESERVE
            + _PARTS_SUMMARY_RESERVE
            + _RESPONSE_RESERVE
            + _SAFETY_MARGIN
        )
        available = n_ctx - overhead
        available = max(1000, min(available, self.rag_max_tokens))

        parts: List[List[RetrievedChunk]] = []
        current: List[RetrievedChunk] = []
        current_tokens = 0

        # R17: il prompt usa SOLO 3 chunk x 220 char (budget SLO, vedi
        # local_llm_client.PROMPT_*): stimare sui testi COMPLETI faceva
        # "splittare" ogni risposta reale in code multi-parte -> la
        # risposta veniva troncata alla parte 1 e MAI messa in cache
        # (misurato: complete=False split=True su ogni run reale).
        try:
            from core.local_llm_client import PROMPT_CHUNK_CHARS as _PCC
            _cap_tok = (_PCC // 3) + 50
        except Exception:
            _cap_tok = 160
        for chunk in chunks:
            chunk_tokens = min(_estimate_tokens(chunk.text) + 50, _cap_tok)
            if current and current_tokens + chunk_tokens > available:
                parts.append(current)
                current = [chunk]
                current_tokens = chunk_tokens
            else:
                current.append(chunk)
                current_tokens += chunk_tokens

        if current:
            parts.append(current)
        return parts if parts else [[]]

    @staticmethod
    def _select_images(chunks):
        images = []
        for c in chunks or []:
            if len(images) >= MAX_IMAGES_PER_ANSWER:
                break
            if c.is_image and c.image_path and c.similarity >= MIN_IMAGE_SIMILARITY:
                try:
                    with open(c.image_path, "rb") as f:
                        images.append((f.read(), c.mime_type or "image/png"))
                except OSError:
                    continue
        return images

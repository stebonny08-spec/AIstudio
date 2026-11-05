#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""qa/f0_round18.py - FASE0 R18 (round "tre stadi + grounding"): FORENSICS
bloccante della catena fotosintesi (4 domande) + audit indice + sintomi.

OUTPUT: qa/f0_round18.json (+ qa/f0_round18.log); dump completi in
qa/tmp/f0r18_prompt_<id>.txt e qa/tmp/f0r18_raw_<id>.txt.

F0.1 per ognuna delle 4 risposte della catena:
  - decisione router (semantic decide, gate, context_kind, cache);
  - stadi INTERROGATI vs CONTRIBUENTI (chunk sopra soglia gate/forte/debole);
  - stato circuit-breaker web (modullo: assente = dato reale) + ultimo
    errore web + timestamp (NET_LOG);
  - decisione cache/delta-reuse (similarity, intent classificato offline);
  - testo INTEGRALE dei chunk dati al modello (cattura _iter_gen + prompt);
  - provenienza emessa e branch di calcolo (_provenance_stages/from_hits).
F0.2 origine errore "azoto/nitrificazione" per ciascuna risposta:
  (i) nel chunk locale, (ii) distorsione modello, (iii) ereditato
  (delta-reuse/cache o storia conversazionale).
F0.3 audit indice: chunk per hash(contenuto) per documento, duplicati.
F0.4 sintomi S1-S5 (tabella causa radice, compilata da F0).

PROTOCOLLO (dichiarazioni): backend = core.router.Router.process_query_stream
con wiring identico a backend/api.py::_run_generation (mode='automatica',
history_turns ACCUMULATI come nella conversazione reale, topic='').
web_override = config web.mode a runtime. CONFIG sola lettura. Risposte:
answer cache rediretta a file temporaneo. RETE: solo stadio web (allowlist),
NET_LOG drenato per caso. HF_HUB_OFFLINE=1. Numeri solo misurati.
"""

from __future__ import annotations

import functools
import json
import os
import re
import sys
import threading
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# --- STUB webview PRIMA di qualsiasi import -----------------------------
if "webview" not in sys.modules:
    try:
        import webview  # noqa: F401
    except Exception:
        _wv = types.ModuleType("webview")

        class _FileDialog:
            OPEN = "open"
            SAVE = "save"

        _wv.FileDialog = _FileDialog
        _wv.windows = []
        sys.modules["webview"] = _wv

OUT_JSON = ROOT / "qa" / "f0_round18.json"
OUT_LOG = ROOT / "qa" / "f0_round18.log"
TMP = ROOT / "qa" / "tmp"
TMP_AC = TMP / "f0r18_ac.jsonl"

_LOG_FH = None
_OUT_LOG_READY = False


def log(msg: str) -> None:
    global _LOG_FH
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        if _OUT_LOG_READY:
            if _LOG_FH is None:
                _LOG_FH = OUT_LOG.open("a", encoding="utf-8")
            _LOG_FH.write(line + "\n")
            _LOG_FH.flush()
    except Exception:
        pass


def ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000.0, 2)


def trunc(s: str, n: int) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n] + f"...[+{len(s) - n} char]"


# ========================================================================
# ISTITRUZIONE (spy su gate/cache/web/provenienza/_iter_gen/search)
# ========================================================================
CAP: dict = {}


def _reset_cap() -> None:
    CAP.clear()
    CAP.update({
        "gates": [], "semantic": [], "iter_gen": [], "prov": [],
        "prov_from_hits": [], "cache_get": [], "escalate": [],
        "search_web": [], "searches": [], "aicache_get": 0,
        "messages": None, "sidecar_prompt": None,
        "sidecar_complete_calls": 0,
    })


_reset_cap()

ORIG = {}


def install_spies() -> None:
    import core.rag.gate as gate_mod
    from core.router import Router
    from core.rag.answer_cache import AnswerCache
    from core.local_search import LocalSearchEngine
    from core.local_llm_client import LocalLLMClient
    import core.sidecar.client as scc
    import core.rag.web_stage as ws
    import core.web_search as web_search
    from core.ai_cache import AiCache

    # --- gate: ogni decisione ------------------------------------------
    og = gate_mod.decide_gate

    @functools.wraps(og)
    def gate_spy(outcome, threshold, *, web_attempted=False, **kw):
        dec = og(outcome, threshold, web_attempted=web_attempted, **kw)
        CAP["gates"].append({
            "outcome": dec.outcome, "threshold": dec.threshold,
            "top_score": round(float(dec.top_score), 4),
            "reason": dec.reason,
            "stages_probed": list(dec.stages_probed or []),
            "web_attempted": bool(getattr(dec, "web_attempted", False)),
            "fused_n": len(getattr(outcome, "fused", []) or []),
            "fused": [{
                "stage": h.stage,
                "score": round(float(h.score), 4),
                "source": str(getattr(h.chunk, "source_file", ""))[-90:],
                "text_head": str(getattr(h.chunk, "text", ""))[:140],
            } for h in (getattr(outcome, "fused", []) or [])],
            "near_miss": [{
                "stage": h.stage, "score": round(float(h.score), 4),
                "source": str(getattr(h.chunk, "source_file", ""))[-90:],
            } for h in (getattr(dec, "near_miss", []) or [])],
        })
        return dec

    gate_mod.decide_gate = gate_spy
    ORIG["gate"] = og

    # --- semantic decide -------------------------------------------------
    osd = Router._semantic_decide

    @functools.wraps(osd)
    def sem_spy(self, query):
        out = osd(self, query)
        CAP["semantic"].append({"query": query, "use_rag": out[0],
                                "sim_rag": out[1], "sim_no_rag": out[2]})
        return out

    Router._semantic_decide = sem_spy

    # --- _iter_gen: testo INTEGRALE dei chunk dati al modello -----------
    oig = Router.__dict__["_iter_gen"]
    oig_fn = oig.__func__ if hasattr(oig, "__func__") else oig

    def iter_spy(client, query, **kw):
        CAP["iter_gen"].append({
            "query": query,
            "context_kind": kw.get("context_kind"),
            "chitchat": bool(kw.get("chitchat")),
            "outcome": kw.get("outcome"),
            "answer_draft": trunc(str(kw.get("answer_draft") or ""), 400),
            "local_chunks": [{
                "source_file": str(getattr(c, "source_file", "")),
                "location_hint": str(getattr(c, "location_hint", "")),
                "similarity": round(float(getattr(c, "similarity", 0.0) or 0.0), 4),
                "text": str(getattr(c, "text", "") or ""),
            } for c in (kw.get("local_chunks") or [])],
            "web_results": [{
                "title": str(getattr(r, "title", "")),
                "url": str(getattr(r, "url", "")),
                "snippet": str(getattr(r, "snippet", "")),
            } for r in (kw.get("web_results") or [])],
            "history_turns_n": len(kw.get("history_turns") or []),
        })
        return oig_fn(client, query, **kw)

    Router._iter_gen = staticmethod(iter_spy)

    # --- provenienza -----------------------------------------------------
    opv = Router.__dict__["_provenance_stages"]
    opv_fn = opv.__func__ if hasattr(opv, "__func__") else opv

    def prov_spy(outcome, context_kind, gen_chunks, gen_web):
        ret = opv_fn(outcome, context_kind, gen_chunks, gen_web)
        CAP["prov"].append({
            "branch": "_provenance_stages", "context_kind": context_kind,
            "gen_chunks_n": len(gen_chunks or []), "gen_web_n": len(gen_web or []),
            "returned": list(ret),
        })
        return ret

    Router._provenance_stages = staticmethod(prov_spy)

    opfh = Router.__dict__["_provenance_from_hits"]
    opfh_fn = opfh.__func__ if hasattr(opfh, "__func__") else opfh

    def provfh_spy(hits):
        ret = opfh_fn(hits)
        CAP["prov_from_hits"].append({
            "branch": "_provenance_from_hits", "hits_n": len(hits or []),
            "returned": list(ret),
        })
        return ret

    Router._provenance_from_hits = staticmethod(provfh_spy)

    # --- answer cache get ------------------------------------------------
    ocg = AnswerCache.get

    @functools.wraps(ocg)
    def cache_spy(self, key, fingerprint=None):
        rec = ocg(self, key, fingerprint)
        CAP["cache_get"].append({
            "key": key, "hit": rec is not None,
            "rec_query": (rec or {}).get("query"),
            "rec_text_head": trunc(str((rec or {}).get("text") or ""), 200),
        })
        return rec

    AnswerCache.get = cache_spy

    # --- AiCache.get: delta-reuse nel path chat? -------------------------
    oacg = AiCache.get

    @functools.wraps(oacg)
    def aicache_spy(self, *a, **k):
        CAP["aicache_get"] += 1
        return oacg(self, *a, **k)

    AiCache.get = aicache_spy

    # --- web: escalate (decisione) + search_web (tentativo HTTP) ---------
    oesc = ws.escalate

    @functools.wraps(oesc)
    def esc_spy(query, gate_outcome="", mode=None, top_k=5, **kw):
        res = oesc(query, gate_outcome=gate_outcome, mode=mode, top_k=top_k, **kw)
        CAP["escalate"].append({
            "query": query, "gate_outcome": gate_outcome, "mode": mode,
            "n_results": len(res or []),
        })
        return res

    ws.escalate = esc_spy

    osw = web_search.search_web

    @functools.wraps(osw)
    def sw_spy(query, max_results=5, **kw):
        t0 = time.perf_counter()
        res = osw(query, max_results=max_results, **kw)
        CAP["search_web"].append({
            "query": query, "max_results": max_results,
            "n_results": len(res or []), "ms": ms(t0),
        })
        return res

    web_search.search_web = sw_spy
    # search_web e' anche importato in router (`from ... import search_web`)
    # e dentro web_stage.escalate lo chiama via `from core.web_search import
    # search_web` all'interno della funzione -> spy del modulo basta.

    # --- LocalSearchEngine.search (stadi interrogati) --------------------
    ols = LocalSearchEngine.search

    @functools.wraps(ols)
    def search_spy(self, query, **kw):
        out = ols(self, query, **kw)
        probe = dict(getattr(self, "last_probe", None) or {})
        store_key = str(getattr(getattr(self, "vector_store", None),
                                "store_key", "?"))
        CAP["searches"].append({
            "store_key": store_key, "query": query,
            "top_k": kw.get("top_k"), "topic": kw.get("topic"),
            "variants": kw.get("variants"),
            "n_returned": len(getattr(out, "chunks", []) or []),
            "probe_total_ms": probe.get("total_ms"),
            "fused_rows_n": len(probe.get("fused") or []),
            "fused": [{
                "sim": round(float((r or {}).get("similarity") or 0.0), 4),
                "source": str((r or {}).get("source_file") or "")[-90:],
            } for r in (probe.get("fused") or [])[:10]],
        })
        return out

    LocalSearchEngine.search = search_spy

    # --- cattura prompt sidecar ----------------------------------------
    orig_prep = LocalLLMClient._prepare_messages

    def prep_spy(self, *a, **k):
        msgs = orig_prep(self, *a, **k)
        CAP["messages"] = msgs
        return msgs

    LocalLLMClient._prepare_messages = prep_spy

    orig_mtp = scc._messages_to_prompt

    def mtp_spy(prompt_or_messages):
        out = orig_mtp(prompt_or_messages)
        CAP["sidecar_prompt"] = out
        return out

    scc._messages_to_prompt = mtp_spy

    orig_complete = scc.SidecarClient.complete

    def complete_spy(self, *a, **k):
        CAP["sidecar_complete_calls"] += 1
        return orig_complete(self, *a, **k)

    scc.SidecarClient.complete = complete_spy


# ========================================================================
# SETUP (schema qa/f0_round16.py)
# ========================================================================
def setup():
    from data.config_manager import ConfigManager, get_app_data_dir
    from data.db import Database
    from core.rag.vector_store import VectorStore
    from core.local_search import LocalSearchEngine
    from core.local_llm_client import (LocalLLMClient, maybe_wrap_sidecar,
                                       DEFAULT_STUDY_MODE)
    from core.router import Router
    from core.rag.answer_cache import AnswerCache
    import core.sidecar.client as scc  # noqa: F401 (spies lo richiedono)

    cfg = ConfigManager()
    cfg_read = {
        "rag.progress_events": bool(cfg.get("rag.progress_events", True)),
        "gate.threshold": float(cfg.get("gate.threshold", 0.70)),
        "web.mode": str(cfg.get("web.mode", "auto")),
        "llm.backend": str(cfg.get("llm.backend", "")),
        "web.wikipedia": bool(cfg.get("web.wikipedia", True)),
        "web.searxng_url": str(cfg.get("web.searxng_url", "")),
        "rag_top_k": int(cfg.get("rag_top_k", 5)),
        "local_model_path": str(cfg.get("local_model_path", "")),
        "llama.n_ctx": int(cfg.get("llama.n_ctx", 8192)),
    }
    appdata = get_app_data_dir()
    log(f"config (sola lettura): {json.dumps(cfg_read, ensure_ascii=False)}")

    install_spies()
    log("spy installati: gate/semantic/_iter_gen/provenienza/cache/AiCache/"
        "web/search/prompt-sidecar")

    t = time.perf_counter()
    db = Database()
    vs = VectorStore(str(appdata / "vector_index"))
    local = LocalSearchEngine(db, vs)
    vs_b = VectorStore(str(appdata / "vector_index_books"))
    books = LocalSearchEngine(db, vs_b, local.embedder)
    boot_ms = ms(t)
    log(f"boot store/engine: {boot_ms}ms; chunk local={vs.count()} "
        f"books={vs_b.count()}")

    t = time.perf_counter()
    client = LocalLLMClient(
        model_path=cfg_read["local_model_path"],
        n_ctx=cfg_read["llama.n_ctx"],
        n_gpu_layers=cfg.get("local_model_n_gpu_layers", -1),
        n_threads=cfg.get("local_model_n_threads"),
    )
    proxy = maybe_wrap_sidecar(client)
    backend = "sidecar" if proxy is not client else "in-process"
    log(f"client setup: {ms(t)}ms backend={backend}")

    spy = {"n": 0}
    orig_gs = proxy.generate_stream

    @functools.wraps(orig_gs)
    def gs_spy(*a, **k):
        spy["n"] += 1
        return orig_gs(*a, **k)

    proxy.generate_stream = gs_spy

    router = Router(lambda: proxy, local, books,
                    rag_top_k=cfg_read["rag_top_k"], rag_max_tokens=5000)
    TMP.mkdir(parents=True, exist_ok=True)
    if TMP_AC.exists():
        TMP_AC.unlink()
    router._answer_cache = AnswerCache(path=TMP_AC)
    log(f"answer cache rediretta a {TMP_AC}")

    return {"cfg": cfg_read, "router": router, "local": local, "books": books,
            "vs": vs, "vs_b": vs_b, "spy": spy, "backend": backend,
            "DEFAULT_STUDY_MODE": DEFAULT_STUDY_MODE, "cfgmgr": cfg,
            "embedder": local.embedder}


# ========================================================================
# INTENT CLASSIFIER (offline, read-only - regole + embedding)
# ========================================================================
_REF_MARKERS = (
    "questa", "questo", "questi", "queste", "di come", "parlami meglio",
    "approfond", "spiega meglio", "piu preciso", "più preciso", "meglio di",
    "il processo", "quel processo", "la parte", "del processo",
)
_SUMMARY_REQ = ("riassunto", "riepilogo", "sintetizza", "riepiloga")


def _norm_txt(s: str) -> str:
    s = (s or "").lower()
    for a, b in (("à", "a"), ("è", "e"), ("é", "e"), ("ì", "i"),
                 ("ò", "o"), ("ù", "u")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9 ]", " ", s)


def _tokens(s: str) -> set:
    return {t for t in _norm_txt(s).split() if len(t) >= 4}


def classify_intent(query: str, prev_user: str, prev_answer: str,
                    embedder=None) -> dict:
    """Taxonomia R18: stessa-domanda-riformulata | sotto-domanda |
    nuova-domanda | chit-chat. Regole + embedding (cosine vs turno
    precedente utente; fallback lexical jaccard)."""
    q = (query or "").strip()
    ql = _norm_txt(q)
    words = ql.split()
    # chit-chat: regole deterministiche (saluti/grazie/domanda corta senza
    # contenuto fattuale) o intent chat del router 0-LLM
    try:
        from core.ai_router import Router0LLM
        intent0 = Router0LLM().route(q).get("intent")
    except Exception:
        intent0 = None
    FACTUAL = ("cos'e", "cosa e", "chi e", "come", "quando", "dove",
               "perche", "spiega", "spiegami", "descrivi", "definisci",
               "quali sono", "quanto", "riassunto", "riassumi",
               "riepilogo", "approfond", "fammi un", "parlami", "differenza")
    if not any(m in ql for m in FACTUAL):
        if intent0 == "chat" or (words and words[0] in (
                "ciao", "salve", "grazie", "ok", "bene", "si", "no",
                "perfetto", "quindi")):
            return {"intent": "chit-chat", "rule": f"intent0={intent0}",
                    "similarity": None}

    sim_emb = None
    if prev_user and embedder is not None:
        try:
            a = embedder.embed_one(prev_user, kind="query")
            b = embedder.embed_one(q, kind="query")
            sim_emb = round(float(sum(x * y for x, y in zip(a, b))), 4)
        except Exception:
            sim_emb = None
    toks_q, toks_p = _tokens(q), _tokens(prev_user or "")
    jacc = (len(toks_q & toks_p) / len(toks_q | toks_p)) if (toks_q and toks_p) else 0.0
    best = sim_emb if sim_emb is not None else jacc

    # stessa-domanda-riformulata: alta similarita' vs turno utente prec.
    if best >= 0.92:
        return {"intent": "stessa-domanda-riformulata",
                "rule": f"sim>={0.92}", "similarity": best,
                "sim_metric": "embedding" if sim_emb is not None else "jaccard"}

    # sotto-domanda: riferimenti anaforici/al altra entita' del topic
    ref_hit = [m for m in _REF_MARKERS if m in ql]
    shared = toks_q & toks_p
    if ref_hit or (shared and best >= 0.30) or (
            any(w in ql for w in _SUMMARY_REQ) and shared):
        return {"intent": "sotto-domanda",
                "rule": ("ref=" + ",".join(ref_hit[:3])) if ref_hit
                        else ("shared=" + ",".join(sorted(shared)[:4])),
                "similarity": best,
                "sim_metric": "embedding" if sim_emb is not None else "jaccard"}

    if shared or best >= 0.30:
        return {"intent": "sotto-domanda", "rule": "shared_topic",
                "similarity": best,
                "sim_metric": "embedding" if sim_emb is not None else "jaccard"}
    return {"intent": "nuova-domanda", "rule": "nessun_legame",
            "similarity": best,
            "sim_metric": "embedding" if sim_emb is not None else "jaccard"}


# ========================================================================
# RUN CATENA (4 domande, storia accumulata come nell'app)
# ========================================================================
CHAIN = [
    ("q1", "cos'è la fotosintesi?"),
    ("q2", "fammi un riassunto più preciso e puntuale"),
    ("q3", "parlami meglio di questa produzione di ossigeno"),
    ("q4", "voglio approfondire la parte di come viene rilasciato l'ossigeno"),
]


def drain_netlog() -> list:
    try:
        import core.web_search as w
        entries = list(getattr(w, "NET_LOG", []) or [])
        if hasattr(w, "NET_LOG"):
            w.NET_LOG[:] = []
        return entries
    except Exception:
        return []


def breaker_state() -> dict:
    """Stato circuit-breaker web: modullo reale o 'assente' (dato reale)."""
    try:
        import core.rag.web_stage as ws
    except Exception as exc:
        return {"presente": False, "errore_lettura": str(exc)}
    keys = [k for k in dir(ws) if re.search(
        r"breaker|circuit|cooldown|backoff|open_until", k, re.I)]
    custom = [k for k in keys if not k.startswith("__")]
    return {
        "presente": bool(custom),
        "chiavi_trovate": custom,
        "nota": ("nessun circuit-breaker nel codice: lo short-circuit avviene "
                 "pre-tentativo (gate piena -> escalate [] senza HTTP; "
                 "WEB_STAGE_ENTRY_S=6s -> web saltato)"),
    }


def run_case(env, case_id, query, history_turns, web_override="auto"):
    router = env["router"]
    spy = env["spy"]
    _reset_cap()

    events = []
    text_parts = []
    progress = []
    sources_events = []
    source = None
    first_progress = None
    first_token = None
    err = None
    cache_branch = False
    t0 = time.perf_counter()
    try:
        for ev in router.process_query_stream(
                query, mode="automatica", thinking=False,
                study_mode=env["DEFAULT_STUDY_MODE"],
                stop_event=threading.Event(), topic="",
                history_turns=list(history_turns),
                web_override=web_override):
            now = ms(t0)
            et = ev.get("type")
            events.append(et)
            if et == "progress":
                if first_progress is None:
                    first_progress = now
                progress.append({k: ev.get(k) for k in
                                 ("stage", "status", "ms", "note")
                                 if ev.get(k) is not None})
                if ev.get("stage") == "cache":
                    cache_branch = True
            elif et == "token":
                if first_token is None:
                    first_token = now
                text_parts.append(ev.get("text") or "")
            elif et == "sources":
                sources_events.append({
                    "items_n": len(ev.get("items") or []),
                    "stages": list(ev.get("stages") or []),
                    "items": [dict(i) for i in (ev.get("items") or [])][:8],
                })
            elif et == "source":
                source = ev.get("value")
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    total = ms(t0)

    raw = "".join(text_parts)
    msgs = CAP["messages"] or []
    side_prompt = CAP["sidecar_prompt"]

    # dump completi
    pfile = TMP / f"f0r18_prompt_{case_id}.txt"
    rfile = TMP / f"f0r18_raw_{case_id}.txt"
    pfile.write_text(
        ("=== SIDECAR body['prompt'] ===\n"
         + (side_prompt or "(non chiamato: path in-process)")
         + "\n\n=== MESSAGES JSON ===\n"
         + json.dumps(msgs, ensure_ascii=False, indent=1)),
        encoding="utf-8")
    rfile.write_text(raw, encoding="utf-8")

    # contesto <contesto> vs storia (per F0.2)
    prompt_all = side_prompt or json.dumps(msgs, ensure_ascii=False)
    ctx_blocks = re.findall(r"<contesto[^>]*>(.*?)</contesto>", prompt_all,
                            flags=re.S)
    ctx_text = "\n".join(ctx_blocks)
    hist_msgs = msgs[1:-1] if len(msgs) >= 2 else msgs[:-1]
    hist_text = "\n".join(str(m.get("content") or "") for m in hist_msgs)

    net = drain_netlog()
    last_err = next((e for e in reversed(net) if not e.get("ok")), None)

    res = {
        "case": case_id, "query": query,
        "history_turns_n": len(history_turns),
        "web_override": web_override,
        "llm_calls": spy["n"],
        "total_ms": total, "first_progress_ms": first_progress,
        "first_token_ms": first_token, "n_tokens": len(text_parts),
        "text_len": len(raw), "source": source,
        "error": err,
        "progress": progress,
        "sources_events": sources_events,
        "provenienza_emessa": (sources_events[-1]["stages"]
                               if sources_events else None),
        "router_decision": {
            "semantic": list(CAP["semantic"]),
            "gates": list(CAP["gates"]),
            "context_kind": [g.get("context_kind") for g in CAP["iter_gen"]],
            "cache_branch": cache_branch,
        },
        "stadi": {
            "interrogati": _probed_stages(progress, CAP["searches"]),
            "contribuenti": _contributing(CAP["iter_gen"], CAP["gates"]),
        },
        "cache_delta": {
            "answer_cache_get": list(CAP["cache_get"]),
            "aicache_get_calls": CAP["aicache_get"],
            "delta_reuse_nel_path_chat": CAP["aicache_get"] > 0,
            "branch": "cache-rielaborato" if cache_branch else "pipeline",
        },
        "web": {
            "circuit_breaker": breaker_state(),
            "escalate_calls": list(CAP["escalate"]),
            "search_web_calls": list(CAP["search_web"]),
            "net_log_n": len(net),
            "net_log": net,
            "ultimo_errore": last_err,
            "short_circuit_pretentativo": _short_circuit(progress,
                                                          CAP["escalate"],
                                                          CAP["search_web"]),
        },
        "chunk_dati_al_modello": _chunks_for_model(CAP["iter_gen"]),
        "prompt": {
            "file": str(pfile.relative_to(ROOT)).replace("\\", "/"),
            "sidecar_len": len(side_prompt or ""),
            "n_messages": len(msgs),
            "ctx_blocks_n": len(ctx_blocks),
            "ctx_text_len": len(ctx_text),
        },
        "output": {
            "file": str(rfile.relative_to(ROOT)).replace("\\", "/"),
            "raw_full": trunc(raw, 8000),
            "words": len(raw.split()),
        },
        "_ctx_text": ctx_text,
        "_hist_text": hist_text,
        "net_log_raw": net,
    }
    log(f"CASE {case_id}: total={total:.0f}ms tok={len(text_parts)} "
        f"words={len(raw.split())} cache={cache_branch} "
        f"prov={res['provenienza_emessa']} err={err}")
    return res


def _probed_stages(progress, searches):
    probed = []
    for p in progress:
        st, status = p.get("stage"), p.get("status")
        if st in ("appunti", "libri", "web") and status in ("done", "start"):
            if st not in probed:
                probed.append(st)
    for g in []:
        pass
    return probed


def _contributing(iter_gen_calls, gates):
    """Stadi CONTRIBUENTI = stadi dei chunk effettivamente passati al
    modello, con conteggi sopra soglia (gate 0.70 / forte 0.45)."""
    thr = 0.70
    try:
        from data.config_manager import ConfigManager
        thr = float(ConfigManager().get("gate.threshold", 0.70))
    except Exception:
        pass
    # mappa source_file -> stage dai probes (searches catturate via gates
    # fused: la stage e' in gates[].fused[].stage per il fused; per i chunk
    # passati usiamo la presenza nei fused del gate)
    stage_by_source = {}
    for g in gates:
        for f in g.get("fused") or []:
            stage_by_source.setdefault(f.get("source"), f.get("stage"))
    out = {}
    for call in iter_gen_calls:
        for c in call.get("local_chunks") or []:
            src = str(c.get("source_file") or "")
            stage = None
            for k, v in stage_by_source.items():
                if k and (k in src or src.endswith(k)):
                    stage = v
                    break
            if stage is None:
                stage = "appunti"  # fallback: store locale (corpus unico)
            d = out.setdefault(stage, {"n": 0, "sopra_soglia_gate": 0,
                                       "sopra_forte_045": 0, "max_sim": 0.0})
            d["n"] += 1
            sim = float(c.get("similarity") or 0.0)
            d["max_sim"] = max(d["max_sim"], round(sim, 4))
            if sim >= thr:
                d["sopra_soglia_gate"] += 1
            if sim >= 0.45:
                d["sopra_forte_045"] += 1
        if call.get("web_results"):
            d = out.setdefault("web", {"n": 0, "sopra_soglia_gate": 0,
                                       "sopra_forte_045": 0, "max_sim": 0.0})
            d["n"] += len(call["web_results"])
            d["sopra_soglia_gate"] += len(call["web_results"])
            d["sopra_forte_045"] += len(call["web_results"])
    return out


def _chunks_for_model(iter_gen_calls):
    out = []
    for i, call in enumerate(iter_gen_calls, 1):
        out.append({
            "call": i, "context_kind": call.get("context_kind"),
            "chitchat": call.get("chitchat"),
            "local_chunks": call.get("local_chunks"),
            "web_results": call.get("web_results"),
        })
    return out


def _short_circuit(progress, escalate_calls, search_web_calls):
    web_prog = [p for p in progress if p.get("stage") == "web"]
    skip = [p for p in web_prog if p.get("status") == "skip"]
    detail = {
        "web_progress": web_prog,
        "escalate_chiamato": bool(escalate_calls),
        "search_web_chiamato_http": bool(search_web_calls),
    }
    if skip:
        detail["tipo"] = "skip-pre-tentativo"
        detail["motivo"] = skip[0].get("note")
    elif escalate_calls and not search_web_calls:
        detail["tipo"] = "escalate-senza-http"
        detail["motivo"] = ("escalate() ha short-circuittato pre-HTTP "
                            "(auto+piena o mode=mai)")
    elif search_web_calls:
        detail["tipo"] = "nessuno"
    else:
        detail["tipo"] = "nessun-web-richiesto"
    return detail


# ========================================================================
# F0.2 - origine errore "azoto/nitrificazione"
# ========================================================================
ERR_TERMS = ("nitrificazion", "azoto", "nitrati", "denitrificazion")


def classify_f02(case: dict) -> dict:
    out_t = (case.get("output", {}).get("raw_full") or "").lower()
    ctx_t = (case.get("_ctx_text") or "").lower()
    hist_t = (case.get("_hist_text") or "").lower()
    chunk_texts = " ".join(
        c.get("text", "") for call in case.get("chunk_dati_al_modello") or []
        for c in (call.get("local_chunks") or [])
        + [{"text": r.get("snippet", "")} for r in (call.get("web_results") or [])]
    ).lower()
    term_ev = {}
    for term in ERR_TERMS:
        term_ev[term] = {
            "in_output": term in out_t,
            "in_chunk_dati": term in chunk_texts,
            "in_ctx_blocco": term in ctx_t,
            "in_storia": term in hist_t,
        }
    hit_out = [t for t, e in term_ev.items() if e["in_output"]]
    via_cache = bool(case.get("cache_delta", {}).get("branch")
                     == "cache-rielaborato")
    cls, notes = None, []
    if not hit_out:
        cls = "NA (termine assente dall'output)"
    else:
        t0 = hit_out[0]
        e = term_ev[t0]
        if via_cache:
            cls = "(iii) ereditato da delta-reuse/cache"
            notes.append("risposta servita dal branch cache")
        elif e["in_chunk_dati"] or e["in_ctx_blocco"]:
            cls = "(i) presente nel testo del chunk locale"
            notes.append("termine nei chunk/blocchi contesto")
        elif e["in_storia"]:
            cls = "(iii) ereditato (storia conversazionale)"
            notes.append("termine nella storia (risposte precedenti), "
                         "non nei chunk freschi")
        else:
            cls = "(ii) distorsione del modello vs chunk"
            notes.append("termine solo nell'output")
    return {"classificazione": cls, "evidenza_per_termine": term_ev,
            "termini_in_output": hit_out, "via_cache": via_cache,
            "notes": notes}


# ========================================================================
# F0.3 - AUDIT INDICE (chunk per hash per documento)
# ========================================================================
def audit_index() -> dict:
    import sqlite3
    import hashlib
    import collections

    def norm(s):
        return re.sub(r"\s+", " ", (s or "").strip().lower())

    def hh(s):
        return hashlib.sha1(norm(s).encode("utf-8", "ignore")).hexdigest()[:16]

    out = {"stores": {}}
    base = Path(os.environ.get("APPDATA", "")) / "NovaStudio"

    # 1) store attivo sqlite (studioia.db)
    p = base / "studioia.db"
    try:
        con = sqlite3.connect(f"file:{p.as_posix()}?mode=ro", uri=True)
        rows = list(con.execute("SELECT store_key, source_file, testo FROM chunks"))
        dvr = list(con.execute("SELECT * FROM doc_versions"))
        con.close()
        per = collections.Counter()
        bydoc = collections.defaultdict(collections.Counter)
        for sk, sf, t in rows:
            per[(sk, sf, hh(t))] += 1
            bydoc[(sk, sf)][hh(t)] += 1
        dups = [{"store": k[0], "doc": k[1], "hash": k[2], "n": v}
                for k, v in per.items() if v > 1]
        out["stores"]["attivo_sqlite"] = {
            "db": str(p), "rows": len(rows), "unique_doc_hash": len(per),
            "dup_groups": dups,
            "per_document": [
                {"store": k[0], "doc": k[1], "righe": sum(c.values()),
                 "hash_unici": len(c),
                 "hash_ripetuti": {h: n for h, n in c.items() if n > 1}}
                for k, c in sorted(bydoc.items())],
            "doc_versions": [list(r) for r in dvr],
        }
    except Exception as e:
        out["stores"]["attivo_sqlite"] = {"error": str(e)}

    # 2) chroma legacy locale + books
    for tag, dbp in (("chroma_locale", base / "vector_index" / "chroma.sqlite3"),
                     ("chroma_books", base / "vector_index_books" / "chroma.sqlite3")):
        if not dbp.exists():
            out["stores"][tag] = {"presente": False}
            continue
        try:
            c = sqlite3.connect(f"file:{dbp.as_posix()}?mode=ro", uri=True)
            n = list(c.execute("SELECT COUNT(*) FROM embeddings"))[0][0]
            docs = [r[0] for r in c.execute(
                "SELECT string_value FROM embedding_metadata "
                "WHERE key='chroma:document'")]
            srcs = [r[0] for r in c.execute(
                "SELECT string_value FROM embedding_metadata "
                "WHERE key='source_file'")]
            c.close()
            cnt = collections.Counter(hh(d) for d in docs)
            out["stores"][tag] = {
                "presente": True, "attivo": False,
                "note": "backend attivo = sqlite; chroma = legacy migrato",
                "embeddings": n, "hash_unici": len(cnt),
                "dup_hashes": {k: v for k, v in cnt.items() if v > 1},
                "source_files": sorted(set(srcs)),
            }
        except Exception as e:
            out["stores"][tag] = {"presente": True, "error": str(e)}

    # 3) copie su disco del file fotosintesi
    root = ROOT / "file_AIstudio"
    out["disco_copie_fotosintesi"] = [str(x) for x in root.rglob("*fotosintesi*")]
    # presenze totali del documento (disco + store con hash identici)
    presenze = len(out["disco_copie_fotosintesi"])
    act = out["stores"].get("attivo_sqlite", {})
    presenze += len(act.get("per_document", []))
    ch = out["stores"].get("chroma_locale", {})
    if isinstance(ch, dict) and ch.get("embeddings"):
        presenze += len(set(str(s) for s in ch.get("source_files", [])))
    out["fotosintesi_presenze_totali"] = presenze
    return out


# ========================================================================
# MAIN
# ========================================================================
def sidecar_state() -> str:
    try:
        from core.sidecar.server import get_server
        return str(get_server().state)
    except Exception as e:
        return f"error:{type(e).__name__}: {e}"


def shutdown_sidecar() -> str:
    try:
        from core.sidecar.server import get_server
        srv = get_server()
        for attr in ("shutdown", "stop", "stop_if_idle"):
            fn = getattr(srv, attr, None)
            if callable(fn):
                try:
                    fn()
                except Exception:
                    pass
        return sidecar_state()
    except Exception as e:
        return f"error:{type(e).__name__}: {e}"


def main():
    global _OUT_LOG_READY
    OUT_LOG.parent.mkdir(parents=True, exist_ok=True)
    if OUT_LOG.exists():
        OUT_LOG.unlink()
    _OUT_LOG_READY = True

    log("=== FASE0 R18 FORENSICS (start) ===")
    env = setup()
    log(f"sidecar state pre: {sidecar_state()}")
    # attesa warmup (fallback 0-LLM solo se non pronto entro 180s)
    t_w = time.perf_counter()
    while time.perf_counter() - t_w < 180.0:
        ready_sem = bool(getattr(env["router"].semantic_router, "ready", True))
        warm_emb = bool(getattr(env["local"].embedder, "warm", True))
        if ready_sem and warm_emb:
            break
        time.sleep(0.5)
    log(f"warmup atteso: semantic.ready={getattr(env['router'].semantic_router, 'ready', None)} "
        f"embedder.warm={getattr(env['local'].embedder, 'warm', None)} "
        f"({ms(t_w)}ms)")

    cases = []
    history = []   # turni accumulati come nella conversazione reale
    prev_user = ""
    prev_answer = ""
    for cid, q in CHAIN:
        intent = classify_intent(q, prev_user, prev_answer,
                                 embedder=env.get("embedder"))
        log(f"intent[{cid}] = {intent}")
        r = run_case(env, cid, q, history,
                     web_override=env["cfg"]["web.mode"])
        r["intent_classificato"] = intent
        r["f0_2"] = classify_f02(r)
        log(f"F0.2[{cid}] = {r['f0_2']['classificazione']} "
            f"termini={r['f0_2']['termini_in_output']}")
        # accumulo storia identico all'app (user + risposta AI)
        history.append({"role": "user", "content": q})
        history.append({"role": "assistant",
                        "content": r.get("output", {}).get("raw_full") or ""})
        prev_user, prev_answer = q, r.get("output", {}).get("raw_full") or ""
        # pulizia campi interni
        r.pop("_ctx_text", None)
        r.pop("_hist_text", None)
        r.pop("net_log_raw", None)
        cases.append(r)

    log("audit indice (F0.3)...")
    idx = audit_index()
    log(f"presenze totali file fotosintesi: "
        f"{idx.get('fotosintesi_presenze_totali')}")

    out = {
        "round": "18",
        "phase": "F0-forensics",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "method": (
            "Router.process_query_stream (wiring api._run_generation), "
            "catena 4 domande con history_turns accumulati; spy su "
            "gate.decide_gate/semantic_decide/_iter_gen(chunk completi)/"
            "_provenance_stages/_provenance_from_hits/AnswerCache.get/"
            "AiCache.get/web_stage.escalate/web_search.search_web/"
            "LocalSearchEngine.search; prompt sidecar catturato; intent "
            "classificato offline (regole+embedding); audit indice read-only"
        ),
        "declarations": {
            "config_read_only": True,
            "hf_offline": os.environ.get("HF_HUB_OFFLINE"),
            "network": "stadio web (allowlist) - NET_LOG per caso",
            "answer_cache_tmp": str(TMP_AC),
            "sidecar_state_pre": sidecar_state(),
        },
        "chain": [{"id": c, "query": q} for c, q in CHAIN],
        "cases": cases,
        "f0_3_indice": idx,
        "f0_4_sintomi": None,   # compilato dopo analisi (vedi report)
    }
    final_state = shutdown_sidecar()
    out["declarations"]["sidecar_state_post"] = final_state
    log(f"sidecar state post: {final_state}")

    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    log(f"scritto {OUT_JSON}")
    try:
        import subprocess
        r = subprocess.run(["tasklist"], capture_output=True, text=True,
                           timeout=20)
        n_llama = r.stdout.lower().count("llama-server")
        out["declarations"]["llama_residual"] = n_llama
        log(f"processi residui llama-server: {n_llama}")
        OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1),
                            encoding="utf-8")
    except Exception as e:
        log(f"check processi non disponibile: {e}")


if __name__ == "__main__":
    main()

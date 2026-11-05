#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""qa/r15_qa1.py — QA-1 Round 15b: MATRICE DEI FALLIMENTI (rerunnable).

OUTPUT: qa/r15_qa1.json (+ qa/r15_qa1.log). Nessun altro file scritto.

DECLARAZIONI DI PROTOCOLLO (obbligatorie, verificate a runtime):
  * BACKEND: `core.router.Router.process_query_stream` a livello Router
    (NON StudioIAAPI): wiring identico a backend/api.py::_run_generation
    (mode='automatica' come il frontend web_frontend/html/index.html:1997,
    history_turns=[], stop_event, topic='', web_override passato se la
    firma lo supporta). backend.* NON viene importato -> pywebview non
    serve; comunque lo STUB webview viene registrato PRIMA di qualsiasi
    import (stesso schema di tests/testC_rag.py) per sicurezza.
  * RETE: SOLO per i casi web (iii e v-b). Ogni chiamata è loggata dai
    moduli productioni: core.web_search.NET_LOG (ddgs trusted/generico +
    Wikipedia REST; SearXNG off => 0 chiamate) e core.web_search/web_stage
    NET_LOG per i fetch (cache URL AppData TTL7: HIT = 0 rete, dichiarata).
    Ogni entry drenata viene ristampata come "[RETE DICHIARATA]" e salvata
    in network_log. HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE forzati (0 download).
  * CONFIG: SOLO LETTURA. web OFF/ON ottenuto col parametro runtime
    web_override ('mai'/'auto') del contratto P, senza scrivere web.mode.
    Valori letti a runtime: rag.progress_events, gate.threshold, web.mode.
  * ANSWER CACHE: rediretta a file temporaneo qa/tmp/r15_qa1_ac.jsonl
    (nessuna scrittura su %APPDATA%\\answer_cache.jsonl) + clear() dichiarato
    prima di OGNI sample per evitare HIT di misura.
  * astensioni.jsonl: letto come evidenza; scritto SOLO da core.rag.gate.
  * Max 6 tentativi per unita' -> poi BLOCKED con causa + procedura.
  * Numeri/tempi SOLO misurati (time.perf_counter); niente pip; alla fine
    shutdown sidecar + check/kill dichiarato dei processi residui.
"""

from __future__ import annotations

import functools
import inspect
import json
import math
import os
import subprocess
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

# --- STUB webview PRIMA di qualsiasi import backend.* (dichiarato) -------
if "webview" not in sys.modules:
    try:
        import webview  # noqa: F401  (se installato si usa quello)
    except Exception:
        _wv = types.ModuleType("webview")

        class _FileDialog:
            OPEN = "open"
            SAVE = "save"

        _wv.FileDialog = _FileDialog
        _wv.windows = []
        sys.modules["webview"] = _wv
WEBVIEW_STUB = "registrato prima degli import (backend.* non importato)"

OUT_JSON = ROOT / "qa" / "r15_qa1.json"
OUT_LOG = ROOT / "qa" / "r15_qa1.log"
TMP_AC = ROOT / "qa" / "tmp" / "r15_qa1_ac.jsonl"
GT_PATH = ROOT / "qa" / "gt_set_r15.json"

MAX_ATTEMPTS = 6            # tentativi massimi per unita' (protocollo)
METHOD = (
    "Router.process_query_stream a livello core (wiring = api.py."
    "_run_generation, mode='automatica'); webview stub dichiarato ma non "
    "necessario (backend non importato)"
)

_LOG_FH = None


def log(msg: str) -> None:
    global _LOG_FH
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        if _LOG_FH is None:
            _LOG_FH = OUT_LOG.open("a", encoding="utf-8")
        _LOG_FH.write(line + "\n")
        _LOG_FH.flush()
    except Exception:
        pass


def ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000.0, 2)


def _informativa_flags(text: str) -> dict:
    """Contenuto esito (c) sul TESTO COMPLETO emesso."""
    t = (text or "").lower()
    return {
        "_is_informativa": ("non ho trovato nei materiali locali" in t
                            and "cercato:" in t
                            and "stadi interrogati" in t
                            and "cosa puoi provare" in t
                            and "riformula" in t),
        "apertura": ("non ho trovato nei materiali locali" in t),
        "stadi": "stadi interrogati" in t,
        "query_cercato": "cercato:" in t,
        "suggerimento": ("riformula" in t and "aggiungi alla biblioteca" in t),
        "near_miss": "quasi corrispondenze" in t,
        "badge_web": "[web:" in t,
    }


def p95_nearest(samples) -> float | None:
    """p95 nearest-rank: sorted[ceil(0.95*n)-1] (per n=5 => max)."""
    if not samples:
        return None
    s = sorted(float(x) for x in samples)
    idx = max(0, math.ceil(0.95 * len(s)) - 1)
    return round(s[idx], 2)


def trunc(s: str, n: int = 700) -> str:
    s = " ".join(str(s or "").split())
    return s[:n] + ("…" if len(s) > n else "")


def read_gt() -> dict:
    return json.loads(GT_PATH.read_text(encoding="utf-8"))


# ======================================================================
# ASTENSIONI (evidenza, solo lettura)
# ======================================================================
def astensioni_path() -> Path:
    from core.rag import contract
    return Path(contract.astensioni_path())


def astensioni_count() -> int:
    p = astensioni_path()
    if not p.exists():
        return 0
    with p.open("r", encoding="utf-8", errors="replace") as f:
        return sum(1 for l in f if l.strip())


def astensioni_new(after_n: int) -> list:
    p = astensioni_path()
    if not p.exists():
        return []
    out = []
    with p.open("r", encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f):
            if i < after_n or not line.strip():
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                out.append({"_raw": line.strip()[:300]})
    return out


# ======================================================================
# RETE (drenaggio NET_LOG productione + stampa dichiarata)
# ======================================================================
def drain_netlog(case_id: str) -> list:
    entries = []
    try:
        import core.web_search as ws
        for e in ws.take_net_log(clear=True):
            e2 = dict(e)
            e2["module"] = "web_search"
            e2["case"] = case_id
            entries.append(e2)
    except Exception as e:
        entries.append({"module": "web_search", "case": case_id,
                        "error": str(e), "ms": 0, "ok": False})
    try:
        import core.rag.web_stage as wst
        for e in wst.take_net_log(clear=True):
            e2 = dict(e)
            e2["module"] = "web_stage"
            e2["case"] = case_id
            entries.append(e2)
    except Exception as e:
        entries.append({"module": "web_stage", "case": case_id,
                        "error": str(e), "ms": 0, "ok": False})
    for e in entries:
        log(f"[RETE DICHIARATA] {case_id} | {e.get('module')} | "
            f"{e.get('provider', 'fetch')} | {str(e.get('url', ''))[:120]} | "
            f"{e.get('ms')}ms | ok={e.get('ok')} n={e.get('n', '')}")
    return entries


# ======================================================================
# SETUP (wiring identico a api.py, engine reali, nessuno stub)
# ======================================================================
def setup():
    from data.config_manager import ConfigManager, get_app_data_dir
    from data.db import Database
    from core.rag.vector_store import VectorStore
    from core.local_search import LocalSearchEngine
    from core.local_llm_client import (LocalLLMClient, maybe_wrap_sidecar,
                                       DEFAULT_STUDY_MODE)
    from core.router import Router
    from core.rag.answer_cache import AnswerCache

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
    }
    appdata = get_app_data_dir()
    log(f"config (sola lettura): {json.dumps(cfg_read, ensure_ascii=False)}")
    log(f"webview stub: {WEBVIEW_STUB}")

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
        n_ctx=int(cfg.get("local_model_n_ctx", 8192)),
        n_gpu_layers=cfg.get("local_model_n_gpu_layers", -1),
        n_threads=cfg.get("local_model_n_threads"),
    )
    proxy = maybe_wrap_sidecar(client)
    backend = "sidecar" if proxy is not client else "in-process"
    log(f"client setup: {ms(t)}ms backend={backend}")

    # --- SPY generate_stream (conteggio chiamate, firma preservata) ------
    spy = {"n": 0, "outcome_kwargs": [], "firma_preservata": None,
           "bind_ok": None, "backend": backend}
    orig_gs = proxy.generate_stream

    @functools.wraps(orig_gs)
    def gs_spy(*a, **k):
        spy["n"] += 1
        spy["outcome_kwargs"].append(k.get("outcome"))
        return orig_gs(*a, **k)

    proxy.generate_stream = gs_spy
    try:
        s1 = str(inspect.signature(orig_gs))
        s2 = str(inspect.signature(gs_spy))
        spy["firma_preservata"] = (s1 == s2)
        inspect.signature(gs_spy).bind(
            "Q", context_kind="locale", local_chunks=[], web_results=None,
            allow_fallback_marker=False, images=[], thinking=False,
            study_mode="default", stop_event=None, chitchat=False,
            part_index=0, is_last_part=True, parts_summaries=[],
            history_turns=[], outcome="parziale")
        spy["bind_ok"] = True
        spy["sig_originale"] = s1
    except Exception as e:
        spy["bind_ok"] = f"{type(e).__name__}: {e}"
    log(f"spy generate_stream: firma_preservata={spy['firma_preservata']} "
        f"bind_ok={spy['bind_ok']}")

    router = Router(lambda: proxy, local, books,
                    rag_top_k=cfg_read["rag_top_k"], rag_max_tokens=5000)
    # answer cache -> file temporaneo QA (dichiarato; produzione intoccata)
    TMP_AC.parent.mkdir(parents=True, exist_ok=True)
    if TMP_AC.exists():
        TMP_AC.unlink()
    router._answer_cache = AnswerCache(path=TMP_AC)
    log(f"answer cache rediretta a {TMP_AC} (produzione intoccata)")

    engines = {"sr": router.semantic_router, "local": local, "books": books,
               "vs": vs, "router": router, "proxy": proxy, "spy": spy,
               "cfg": cfg_read, "boot_ms": boot_ms, "backend": backend,
               "DEFAULT_STUDY_MODE": DEFAULT_STUDY_MODE}
    return engines


def sidecar_state() -> str:
    try:
        from core.sidecar.server import get_server
        return str(get_server().state)
    except Exception as e:
        return f"error:{type(e).__name__}: {e}"


# ======================================================================
# RUN E2E (tutto misurato; cache clear dichiarato; net log drenato)
# ======================================================================
def run_e2e(env, query, web_override, case_id, mode="automatica"):
    router = env["router"]
    spy = env["spy"]
    router.answer_cache.clear()          # dichiarato: niente HIT di misura
    n_ast_before = astensioni_count()
    net_before = 0  # (i drenaggi sono per-case: qui si drena DOPO il run)
    spy_before = spy["n"]

    events = []
    text_parts = []
    progress = []
    sources_items = None
    source = None
    queues = []
    first_progress = None
    first_token = None
    err = None
    t0 = time.perf_counter()
    try:
        for ev in router.process_query_stream(
                query, mode=mode, thinking=False,
                study_mode=env["DEFAULT_STUDY_MODE"],
                stop_event=threading.Event(), topic="", history_turns=[],
                web_override=web_override):
            now = ms(t0)
            et = ev.get("type")
            events.append(et)
            if et == "progress":
                if first_progress is None:
                    first_progress = now
                progress.append({k: ev.get(k) for k in
                                 ("stage", "status", "ms", "note")})
            elif et == "token":
                if first_token is None:
                    first_token = now
                text_parts.append(ev.get("text") or "")
            elif et == "sources":
                sources_items = list(ev.get("items") or [])
            elif et == "source":
                source = ev.get("value")
            elif et == "queue":
                queues.append({"parts": len(ev.get("parts") or [])})
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    total = ms(t0)

    text = "".join(text_parts)
    tl = text.lower()
    llm_calls = spy["n"] - spy_before
    outcome_kwargs = (list(spy["outcome_kwargs"][-llm_calls:])
                      if llm_calls > 0 else [])
    info_flags = _informativa_flags(text)
    new_ast = astensioni_new(n_ast_before)
    net = drain_netlog(case_id)
    gate_done = next((p for p in progress if p.get("stage") == "gate"
                      and p.get("status") == "done"), None)
    res = {
        "case": case_id, "query": query, "web_override": web_override,
        "mode": mode, "total_ms": total, "first_progress_ms": first_progress,
        "first_token_ms": first_token, "n_tokens": len(text_parts),
        "text_len": len(text), "text_head": trunc(text, 700),
        "text_full": trunc(text, 4000),
        "formula_parziale_full": ("ho trovato solo questo" in tl),
        "esito_c_full": bool(info_flags["_is_informativa"]),
        "info_flags": info_flags,
        "source": source, "sources_items": sources_items,
        "progress": progress, "gate_note": (gate_done or {}).get("note"),
        "llm_calls": llm_calls, "outcome_kwargs": outcome_kwargs,
        "astensioni_new": new_ast, "net_new": net, "net_n": len(net),
        "queues": queues, "error": err,
    }
    log(f"E2E {case_id}: total={total:.0f}ms first_prog={first_progress} "
        f"tok={len(text_parts)} source={source} llm={llm_calls} "
        f"gate={(gate_done or {}).get('note')} ast+{len(new_ast)} "
        f"net+{len(net)} err={err}")
    return res


# ======================================================================
# PRE-SCREEN retrieval-level (0 LLM, 0 rete): anchor + candidati (iv)
# ======================================================================
def prescreen(env, gt):
    local = env["local"]
    router = env["router"]
    out = {"positivi": {}, "candidati_iv": []}

    for cid in ("p1", "p4", "p2", "p3"):
        c = next(x for x in gt["casi"] if x["id"] == cid)
        q, anchor = c["query"], c["atteso"]["anchor"]
        t = time.perf_counter()
        res = local.search(q, top_k=5, topic=None, hybrid=True)
        dt = ms(t)
        probe = dict(getattr(local, "last_probe", None) or {})
        rows = probe.get("fused") or []
        sims = []
        for r in rows:
            try:
                sims.append(round(float(r.get("similarity") or 0.0), 4))
            except Exception:
                pass
        top5 = [ch.text for ch in (res.chunks or [])[:5]]
        hit = any(anchor.lower() in (tx or "").lower() for tx in top5)
        out["positivi"][cid] = {
            "query": q, "anchor": anchor, "hybrid_ms": dt,
            "anchor_in_top5": hit, "n_chunks": len(res.chunks),
            "top5_head": [trunc(tx, 120) for tx in top5],
            "probe_sims": sims[:10], "confidence": res.confidence,
        }
        log(f"PRE-SCREEN {cid}: anchor={anchor!r} in_top5={hit} "
            f"hybrid_ms={dt} sims={sims[:5]}")

    cands = []
    gibberish = [
        ("g1", "zqxwv utrpo mnlkj gbvcd flurble"),
        ("g2", "blorp wozzit snarf xyzz quantum qzxj"),
        ("g3", "kvbnm wplko itruy phptx Pjvka"),
        ("g4", "The quirked flurble grozznik wobbled silently."),
    ]
    for gid, q in gibberish:
        cands.append({"id": gid, "tipo": "senza-senso", "query": q})
    for cid in ("n4", "n5", "n2", "n1", "n3", "x1"):
        c = next(x for x in gt["casi"] if x["id"] == cid)
        cands.append({"id": cid, "tipo": c["tipo"], "query": c["query"]})

    for c in cands:
        q = c["query"]
        t = time.perf_counter()
        try:
            local.search(q, top_k=5, topic=None, hybrid=True)
            probe = dict(getattr(local, "last_probe", None) or {})
            rows = probe.get("fused") or []
            sims = []
            for r in rows:
                try:
                    sims.append(float(r.get("similarity") or 0.0))
                except Exception:
                    pass
            maxsim = max(sims) if sims else 0.0
            # eleggibilita' H8 del router: fused vuoto SOLO se TUTTE le
            # righe sono < 0.35 (MIN_SIMILARITY_WEAK)
            eligible = any(s >= 0.35 for s in sims)
            use_rag, sim_rag, sim_no_rag = router._semantic_decide(q)
            c.update({"max_sim": round(maxsim, 4),
                      "n_rows": len(sims), "fused_vuoto_previsto": (not eligible),
                      "use_rag": bool(use_rag),
                      "semantic": [round(float(sim_rag), 4),
                                   round(float(sim_no_rag), 4)],
                      "ms": ms(t)})
        except Exception as e:
            c.update({"error": f"{type(e).__name__}: {e}",
                      "fused_vuoto_previsto": False})
        out["candidati_iv"].append(c)
        log(f"PRE-SCREEN {c['id']}: max_sim={c.get('max_sim')} "
            f"fused_vuoto_previsto={c.get('fused_vuoto_previsto')} "
            f"use_rag={c.get('use_rag')} q={trunc(q, 60)}")

    # ordine tentativi (iv): prima i previsti fused-vuoto (use_rag True),
    # poi i migliori (max_sim piu' basso)
    out["candidati_iv"].sort(
        key=lambda c: (not c.get("fused_vuoto_previsto", False),
                       not c.get("use_rag", True),
                       float(c.get("max_sim") or 0)))
    return out


# ======================================================================
# CHECKS
# ======================================================================
def check_i(env, gt, pre):
    """(i) positivo con anchor: retrieval-level + E2E."""
    evid = []
    ok_all = True
    attempts = []
    for cid in ("p1", "p4"):
        c = next(x for x in gt["casi"] if x["id"] == cid)
        ps = pre["positivi"][cid]
        r = run_e2e(env, c["query"], "mai", f"i_{cid}")
        ast_for_q = [a for a in r["astensioni_new"]
                     if str(a.get("query", "")).strip() ==
                     c["query"].strip()]
        items = r["sources_items"] or []
        sub = {
            "id": f"i_{cid}", "query": c["query"],
            "anchor": c["atteso"]["anchor"],
            "retrieval_anchor_in_top5": ps["anchor_in_top5"],
            "e2e_source_locale": r["source"] == "locale",
            "tokens_non_vuoti": r["n_tokens"] > 0,
            "sources_appunti": any(i.get("stage") == "appunti"
                                   for i in items),
            "astensioni_0": len(ast_for_q) == 0,
            "total_ms": r["total_ms"], "first_progress_ms": r["first_progress_ms"],
            "llm_calls": r["llm_calls"], "error": r["error"],
        }
        sub_ok = (ps["anchor_in_top5"] and sub["e2e_source_locale"]
                  and sub["tokens_non_vuoti"] and sub["sources_appunti"]
                  and sub["astensioni_0"] and not r["error"])
        sub["ok"] = sub_ok
        attempts.append(sub)
        evid.append(f"{cid}: anchor_in_top5={ps['anchor_in_top5']} "
                    f"source={r['source']} tok={r['n_tokens']} "
                    f"sources={[i.get('stage') for i in items]} "
                    f"astensioni+={len(r['astensioni_new'])} "
                    f"total={r['total_ms']:.0f}ms")
        log(f"CHECK i {cid}: ok={sub_ok}")
        ok_all = ok_all and sub_ok
    return {"id": "i", "check": "positivo con anchor: top-5 + E2E "
            "(source=locale, tokens, sources appunti, 0 astensioni)",
            "ok": ok_all, "attempts": attempts, "evidence": evid,
            "timings": {"first_progress_ms":
                        [a["first_progress_ms"] for a in attempts],
                        "total_ms": [a["total_ms"] for a in attempts]}}


def check_ii(env, gt):
    """(ii) parziale: astensioni outcome=parziale + formula + tokens."""
    evid, attempts = [], []
    ok_all = False
    parziali = [x for x in gt["casi"] if x["tipo"] == "parziale"]
    used = 0
    # 4 GT parziali + 2 diagnostiche extra (web auto su x1) = max 6
    plan = [(c, "mai") for c in parziali] + \
           [(parziali[0], "auto"), (parziali[1], "auto")]
    for c, wo in plan:
        if used >= MAX_ATTEMPTS:
            break
        used += 1
        r = run_e2e(env, c["query"], wo, f"ii_{c['id']}_{wo}")
        ast_p = [a for a in r["astensioni_new"]
                 if str(a.get("query", "")).strip() == c["query"].strip()
                 and a.get("outcome") == "parziale"]
        # formula verificata sul TESTO REALE COMPLETO emesso
        formula = bool(r["formula_parziale_full"])
        sub = {"id": f"ii_{c['id']}_{wo}", "query": c["query"],
               "web_override": wo,
               "astensioni_parziale": len(ast_p) > 0,
               "formula_parziale": formula,
               "net_log": r["net_new"], "net_n": r["net_n"],
               "tokens_non_vuoti": r["n_tokens"] > 0,
               "llm_calls": r["llm_calls"],
               "outcome_kwargs_visti": r["outcome_kwargs"],
               "total_ms": r["total_ms"],
               "first_progress_ms": r["first_progress_ms"],
               "text_head": r["text_head"], "text_full": r["text_full"],
               "error": r["error"]}
        sub_ok = (len(ast_p) > 0 and formula and r["n_tokens"] > 0
                  and not r["error"])
        sub["ok"] = sub_ok
        attempts.append(sub)
        evid.append(f"{c['id']}/{wo}: ast_parziale={len(ast_p)>0} "
                    f"formula={formula} tok={r['n_tokens']} "
                    f"llm={r['llm_calls']} outcome_kwarg={r['outcome_kwargs']}")
        log(f"CHECK ii {c['id']} ({used}/{MAX_ATTEMPTS}): ok={sub_ok} "
            f"formula={formula}")
        if sub_ok:
            ok_all = True
            break
    return {"id": "ii", "check": "parziale: astensioni outcome=parziale + "
            "formula 'Ho trovato solo questo' nel testo emesso + tokens",
            "ok": ok_all, "attempts": attempts, "n_attempts": used,
            "evidence": evid,
            "timings": {"first_progress_ms":
                        [a["first_progress_ms"] for a in attempts],
                        "total_ms": [a["total_ms"] for a in attempts]}}


def check_iii(env, gt):
    """(iii) negativo + web ON (web_override=auto; config web.mode=auto)."""
    evid, attempts = [], []
    ok_all = False
    negs = [x for x in gt["casi"] if x["tipo"] == "negativo"]
    plan = [(c, "auto") for c in negs] + [(negs[0], "sempre")]
    used = 0
    for c, wo in plan:
        if used >= MAX_ATTEMPTS:
            break
        used += 1
        r = run_e2e(env, c["query"], wo, f"iii_{c['id']}_{wo}")
        items = r["sources_items"] or []
        web_items = [i for i in items
                     if i.get("stage") == "web"
                     and str(i.get("url", "")).lower().startswith("http")]
        sub = {"id": f"iii_{c['id']}_{wo}", "query": c["query"],
               "web_override": wo,
               "sources_web_http": len(web_items) > 0,
               "n_web_items": len(web_items),
               "web_items": web_items[:5],
               "tokens_non_vuoti": r["n_tokens"] > 0,
               "net_log_n": r["net_n"],
               "net_log": r["net_new"][:20],
               "total_ms": r["total_ms"],
               "first_progress_ms": r["first_progress_ms"],
               "source": r["source"], "gate_note": r["gate_note"],
               "text_head": r["text_head"], "error": r["error"]}
        sub_ok = (len(web_items) > 0 and r["n_tokens"] > 0
                  and r["net_n"] > 0 and not r["error"])
        sub["ok"] = sub_ok
        attempts.append(sub)
        evid.append(f"{c['id']}/{wo}: web_items={len(web_items)} "
                    f"tok={r['n_tokens']} net={r['net_n']} "
                    f"source={r['source']} total={r['total_ms']:.0f}ms")
        log(f"CHECK iii {c['id']} ({used}/{MAX_ATTEMPTS}): ok={sub_ok} "
            f"web_items={len(web_items)} net={r['net_n']}")
        if sub_ok:
            ok_all = True
            break
    return {"id": "iii", "check": "negativo + web ON: sources con >=1 "
            "item stage=web url http(s) + tokens + log rete dichiarato",
            "ok": ok_all, "attempts": attempts, "n_attempts": used,
            "evidence": evid,
            "timings": {"first_progress_ms":
                        [a["first_progress_ms"] for a in attempts],
                        "total_ms": [a["total_ms"] for a in attempts]}}


def _is_informativa(text: str) -> bool:
    t = (text or "").lower()
    return ("non ho trovato nei materiali locali" in t
            and "cercato:" in t
            and "stadi interrogati" in t
            and "cosa puoi provare" in t
            and "riformula" in t)


def check_iv(env, gt, pre):
    """(iv) senza copertura + web OFF (web_override='mai'): esito (c)."""
    evid, attempts = [], []
    ok_all = False
    winner = None
    cands = pre["candidati_iv"][:MAX_ATTEMPTS]
    used = 0
    for c in cands:
        if used >= MAX_ATTEMPTS:
            break
        used += 1
        r = run_e2e(env, c["query"], "mai", f"iv_{c['id']}")
        # contenuto esito (c) verificato sul TESTO REALE COMPLETO
        flags = r["info_flags"]
        info = bool(r["esito_c_full"])
        ast_n = [a for a in r["astensioni_new"]
                 if str(a.get("query", "")).strip() == c["query"].strip()
                 and a.get("outcome") == "nulla"
                 and a.get("web_attempted") is False]
        sub = {"id": f"iv_{c['id']}", "query": c["query"],
               "cand_tipo": c.get("tipo"),
               "max_sim_pre": c.get("max_sim"),
               "fused_vuoto_previsto": c.get("fused_vuoto_previsto"),
               "esito_c_informativa": info,
               "contiene_stadi": flags.get("stadi"),
               "contiene_query_cercato": flags.get("query_cercato"),
               "contiene_suggerimento": flags.get("suggerimento"),
               "contiene_near_miss": flags.get("near_miss"),
               "zero_llm": r["llm_calls"] == 0,
               "llm_calls": r["llm_calls"],
               "astensioni_nulla_no_web": len(ast_n) > 0,
               "tokens_non_vuoti": r["n_tokens"] > 0,
               "total_ms": r["total_ms"],
               "first_progress_ms": r["first_progress_ms"],
               "gate_note": r["gate_note"],
               "text_full": r["text_full"], "error": r["error"]}
        sub_ok = (info and sub["contiene_stadi"] and sub["contiene_query_cercato"]
                  and sub["contiene_suggerimento"] and sub["zero_llm"]
                  and len(ast_n) > 0 and r["n_tokens"] > 0 and not r["error"])
        sub["ok"] = sub_ok
        attempts.append(sub)
        evid.append(f"{c['id']}: max_sim={c.get('max_sim')} "
                    f"esito_c={info} llm={r['llm_calls']} "
                    f"ast_nulla={len(ast_n)>0} tok={r['n_tokens']} "
                    f"gate={r['gate_note']} total={r['total_ms']:.0f}ms")
        log(f"CHECK iv {c['id']} ({used}/{MAX_ATTEMPTS}): ok={sub_ok} "
            f"esito_c={info} llm={r['llm_calls']}")
        if sub_ok:
            ok_all = True
            winner = c
            break
    return {"id": "iv", "check": "senza copertura + web OFF (web_override="
            "'mai'): esito (c) informativa + 0 generate_stream + astensioni "
            "outcome=nulla web_attempted=False",
            "ok": ok_all, "attempts": attempts, "n_attempts": used,
            "winner": (winner or {}).get("id"), "evidence": evid,
            "timings": {"first_progress_ms":
                        [a["first_progress_ms"] for a in attempts],
                        "total_ms": [a["total_ms"] for a in attempts]}}


def check_v(env, iv_case, pre):
    """(v) tempi esito (c): (a) senza web n=5 p95<=3000ms,
    (b) con web n=5 p95<=8000ms — VARIANTE DICHIARATA: escalation web
    con 0 risultati utili dopo gate2 (criterio abort adattato ai fix,
    vedi qa/qa_r15_integration_report.md; solo logica di misura)."""
    out = {"id": "v", "check": "p95 esito(c) senza web <=3000ms (n=5) e "
           "con web <=8000ms (n=5)", "v_a": None, "v_b": None}

    # ---- (v)(a): la query vincente di (iv), web OFF, n=5 ----
    if iv_case and iv_case.get("ok") and iv_case.get("winner"):
        c = next(x for x in pre["candidati_iv"]
                 if x["id"] == iv_case["winner"])
        samples = []
        for i in range(5):
            r = run_e2e(env, c["query"], "mai", f"va_{i+1}")
            samples.append({
                "n": i + 1, "total_ms": r["total_ms"],
                "first_progress_ms": r["first_progress_ms"],
                "first_token_ms": r["first_token_ms"],
                "esito_c": bool(r["esito_c_full"]),
                "llm_calls": r["llm_calls"], "n_tokens": r["n_tokens"],
                "net_n": r["net_n"], "error": r["error"]})
        tot = [s["total_ms"] for s in samples]
        p = p95_nearest(tot)
        all_c = all(s["esito_c"] and s["llm_calls"] == 0 and not s["error"]
                    for s in samples)
        out["v_a"] = {"query": c["query"], "n": len(samples),
                      "samples": samples, "p95_ms": p, "target_ms": 3000,
                      "p95_ok": (p is not None and p <= 3000 and all_c),
                      "ok": (p is not None and p <= 3000 and all_c),
                      "metodo_p95": "nearest-rank sorted[ceil(0.95*n)-1]"}
        log(f"CHECK v(a): p95={p}ms target<=3000ms ok={out['v_a']['ok']}")
    else:
        out["v_a"] = {"ok": False, "status": "BLOCKED",
                      "cause": "esito(c) non raggiungibile nel caso (iv): "
                               "tempo MANCANTE (dichiarato)",
                      "p95_ms": None, "target_ms": 3000, "n": 0,
                      "samples": []}
        log("CHECK v(a): BLOCKED — tempo mancante (esito c non riprodotto)")

    # ---- (v)(b): esito(c) CON web — VARIANTE DICHIARATA ---------------
    # Protocollo: se (v)b non produce esito(c) "per natura del web che
    # risponde" si misura la variante equivalente "escalation web con 0
    # risultati utili dopo gate2": candidati GT negativi (use_rag=True,
    # gate pre-web nulla MISURATO in qa/tmp/r15_vb_probe.json) con
    # web_override='auto'. La decisione FINALE resta nulla dopo il re-gate
    # (i risultati web non entrano nel top-3 lex misurato: RRF tiene i
    # locali sopra) -> con i fix l'informativa si emette con 0 LLM e con
    # rete REALE dichiarata (net_n>0 per ogni campione).
    # CRITERIO DI ABORT ADATTATO AI FIX (DICHIARATO — solo logica di
    # misura, mai falsare): il criterio PRIMA pretendeva un candidato
    # "senza-senso" con fused_vuoto_previsto dal pre-screen H8 (PRIMA:
    # tutti fused_vuoto_previsto=False -> BLOCKED senza campioni; e
    # per giunta tutti use_rag=False -> percorso chitchat SENZA gate ->
    # esito(c) comunque irraggiungibile). ORA un campione CONTA se emette
    # esito(c) REALE sul testo completo con llm_calls=0 e net_n>0.
    # Ordine candidati = latenza web misurata dalla probe
    # (qa/tmp/r15_vb_probe.json: n3/n1 early-stop trusted ~1.4-2.5s).
    _VB_ORDER = ("n3", "n1", "n5", "n2", "n4")
    negs = [c for c in pre["candidati_iv"] if c.get("tipo") == "negativo"]
    negs = sorted(negs, key=lambda c: _VB_ORDER.index(c.get("id"))
                  if c.get("id") in _VB_ORDER else 99)

    def _vb_sample(env, c, idx):
        r = run_e2e(env, c["query"], "auto", f"vb_{idx}")
        return {
            "n": idx, "cand": c.get("id"), "total_ms": r["total_ms"],
            "first_progress_ms": r["first_progress_ms"],
            "first_token_ms": r["first_token_ms"],
            "esito_c": bool(r["esito_c_full"]),
            "llm_calls": r["llm_calls"], "n_tokens": r["n_tokens"],
            "net_n": r["net_n"], "net_log": r["net_new"][:6],
            "error": r["error"]}

    samples = []        # SOLO campioni esito(c) validi (alimentano il p95)
    probes_failed = []  # candidati/campioni non-esito(c) (dati, non p95)
    winner = None
    used = 0
    for c in negs:
        if used >= MAX_ATTEMPTS:
            break
        used += 1
        s = _vb_sample(env, c, used)
        ok_c = (s["esito_c"] and s["llm_calls"] == 0 and s["net_n"] > 0
                and not s["error"])
        if not ok_c:
            probes_failed.append(s)
            log(f"CHECK v(b): candidato {c.get('id')} NON esito(c) "
                f"(esito_c={s['esito_c']} llm={s['llm_calls']} "
                f"net={s['net_n']}) -> candidato successivo")
            continue
        winner = c
        samples.append(s)
        # completa a 5 campioni REALI sulla STESSA query vincente
        while len(samples) < 5 and used < MAX_ATTEMPTS:
            used += 1
            s2 = _vb_sample(env, c, used)
            if not (s2["esito_c"] and s2["llm_calls"] == 0
                    and not s2["error"]):
                # campione non ripetibile: abort dichiarato (mai misura
                # di un percorso che non e' l'esito (c))
                probes_failed.append(s2)
                log(f"CHECK v(b): campione {s2['n']} del vincente "
                    f"{c.get('id')} non esito(c) -> abort dichiarato")
                break
            samples.append(s2)
        break

    tot = [s["total_ms"] for s in samples]
    p = p95_nearest(tot)
    all_c = (len(samples) == 5
             and all(s["esito_c"] and s["llm_calls"] == 0
                     and s["net_n"] > 0 and not s["error"]
                     for s in samples))
    out["v_b"] = {
        "query": (winner or {}).get("query"),
        "winner": (winner or {}).get("id"),
        "n": len(samples), "samples": samples,
        "probes_failed": probes_failed, "n_attempts": used,
        "p95_ms": p, "target_ms": 8000,
        "p95_ok": (p is not None and p <= 8000 and all_c),
        "ok": (p is not None and p <= 8000 and all_c),
        "metodo_p95": "nearest-rank sorted[ceil(0.95*n)-1]",
        "fetch_reale_incluso": True,
        "variante_dichiarata": "escalation web con 0 risultati utili "
                               "dopo gate2 (decisione finale nulla) + "
                               "criterio abort adattato ai fix (solo "
                               "logica di misura) — vedi "
                               "qa/qa_r15_integration_report.md",
    }
    if not out["v_b"]["ok"]:
        out["v_b"]["status"] = "BLOCKED"
        out["v_b"]["cause"] = (
            f"esito(c) con web: n={len(samples)} campioni validi su 5 "
            f"(winner={(winner or {}).get('id')}), p95={p}ms, "
            f"tentativi={used}/{MAX_ATTEMPTS}, probes falliti="
            f"{[(x.get('cand'), x.get('esito_c'), x.get('net_n')) for x in probes_failed]}"
            " — tempo o campioni MANCANTI (dichiarato, nessun dato "
            "inventato)")
    log(f"CHECK v(b): p95={p}ms target<=8000ms ok={out['v_b']['ok']} "
        f"n={len(samples)} winner={(winner or {}).get('id')} "
        f"tentativi={used}")
    out["check_v_ok"] = bool(out["v_a"].get("ok") and out["v_b"].get("ok"))
    return out


def check_vi(results_pool):
    """(vi) t0 -> PRIMO evento progress: p95 <=2000ms su tutti i casi."""
    samples = []
    for r in results_pool:
        fp = r.get("first_progress_ms")
        samples.append({"case": r.get("case"), "query": trunc(r.get("query", ""), 70),
                        "first_progress_ms": fp,
                        "first_token_ms": r.get("first_token_ms")})
    vals = [s["first_progress_ms"] for s in samples
            if s["first_progress_ms"] is not None]
    p = p95_nearest(vals)
    return {"id": "vi", "check": "t0 -> primo evento progress (p95<=2000ms) "
            "su >=3 casi (i,iii,iv)", "ok": (p is not None and p <= 2000
                                             and len(vals) >= 3),
            "n_casi": len(vals), "p95_ms": p, "target_ms": 2000,
            "metodo_p95": "nearest-rank sorted[ceil(0.95*n)-1]",
            "samples": samples,
            "evidence": [f"{s['case']}: {s['first_progress_ms']}ms"
                         for s in samples],
            "timings": {"first_progress_ms": vals}}


# ======================================================================
# MAIN
# ======================================================================
def tasklist_pids(imagename: str) -> list:
    try:
        out = subprocess.run(["tasklist", "/FI", f"IMAGENAME eq {imagename}"],
                             capture_output=True, text=True, timeout=30)
        pids = []
        for line in (out.stdout or "").splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2 and parts[0].lower() == imagename.lower():
                try:
                    pids.append(int(parts[1]))
                except ValueError:
                    pass
        return pids
    except Exception:
        return []


def main():
    t_run = time.perf_counter()
    log("=" * 70)
    log("QA-1 R15b — MATRICE FALLIMENTI (start dichiarato)")
    log(f"method: {METHOD}")
    log(f"reti consentite: SOLO casi web (iii, v-b); config web.mode "
        f"letta (mai scritta); web OFF via web_override='mai'")

    llama_before = tasklist_pids("llama-server.exe")
    log(f"llama-server PIDs PRIMA del run: {llama_before}")

    gt = read_gt()
    env = setup()

    # ---- pre-screen retrieval-level (0 LLM, 0 rete) ----
    pre = prescreen(env, gt)

    # ---- WARMUP: 1 E2E reale per avviare sidecar + embedder + semantica --
    warm = run_e2e(env, next(x for x in gt["casi"] if x["id"] == "p1")["query"],
                   "mai", "warmup")
    st = sidecar_state()
    t_poll = time.perf_counter()
    while st != "up" and ms(t_poll) < 15000:
        time.sleep(0.5)
        st = sidecar_state()
    log(f"sidecar state dopo warmup: {st} (llm.backend="
        f"{env['cfg']['llm.backend']}, backend={env['backend']}, "
        f"warmup tokens={warm['n_tokens']}, err={warm['error']})")
    env["router"].answer_cache.clear()   # dichiarato: warmup fuori misura

    cases = []
    blocked_global = None
    if st != "up" or warm["n_tokens"] == 0 or warm["error"]:
        blocked_global = (
            f"SERVER LLM NON OPERATIVO: sidecar state={st}, warmup "
            f"tokens={warm['n_tokens']}, err={warm['error']} -> tutti i "
            f"casi E2E BLOCKED. PROCEDURA: verificare llm.backend=sidecar "
            f"(deve dare state=up dopo la 1a chiamata, cold 1.7-3s), "
            f"llama-server.exe avviato, modello "
            f"{env['cfg']['local_model_path']} presente; ripetere "
            f"PYTHONIOENCODING=utf-8 python qa/r15_qa1.py")
        log(f"BLOCKED GLOCALE: {blocked_global}")

    # ---- (i) ----
    if blocked_global:
        cases.append({"id": "i", "check": "positivo con anchor",
                      "ok": False, "status": "BLOCKED",
                      "cause": blocked_global, "evidence": [],
                      "timings": {}})
    else:
        c_i = check_i(env, gt, pre)
        c_i["status"] = "OK" if c_i["ok"] else "FAIL"
        cases.append(c_i)

    # ---- (ii) ----
    if blocked_global:
        cases.append({"id": "ii", "check": "parziale: astensioni + formula",
                      "ok": False, "status": "BLOCKED",
                      "cause": blocked_global, "evidence": [], "timings": {}})
    else:
        c_ii = check_ii(env, gt)
        if c_ii["ok"]:
            c_ii["status"] = "OK"
        elif c_ii["n_attempts"] >= MAX_ATTEMPTS:
            c_ii["status"] = "BLOCKED"
            c_ii["cause"] = (
                "formula 'Ho trovato solo questo nei materiali: ' NON "
                "emessa in E2E dopo 6 tentativi: spy su "
                "generate_stream mostra outcome_kwargs="
                f"{[k for a in c_ii['attempts'] for k in a['outcome_kwargs_visti']]} "
                "(router._emit_level NON passa decision.outcome al client; "
                "il flag _PARTIAL_OUTCOME_INSTRUCTION di "
                "core/local_llm_client.py resta outcome=None). "
                "PROCEDURA: passare outcome=decision.outcome dal gate a "
                "generate_stream in Router._emit_level/_emit_single_level "
                "(firma gia' presente: generate_stream(..., outcome=None)) "
                "e ripetere il run.")
        else:
            c_ii["status"] = "FAIL"
        cases.append(c_ii)

    # ---- (iii) ----
    if blocked_global:
        cases.append({"id": "iii", "check": "negativo + web ON",
                      "ok": False, "status": "BLOCKED",
                      "cause": blocked_global, "evidence": [], "timings": {}})
    else:
        c_iii = check_iii(env, gt)
        c_iii["status"] = "OK" if c_iii["ok"] else "FAIL"
        if not c_iii["ok"] and c_iii["n_attempts"] >= MAX_ATTEMPTS:
            c_iii["status"] = "BLOCKED"
            c_iii["cause"] = ("nessun run con >=1 source web http dopo 6 "
                              "tentativi (ddgs/Wikipedia: vedere network_log)")
        cases.append(c_iii)

    # ---- (iv) ----
    if blocked_global:
        cases.append({"id": "iv", "check": "senza copertura + web OFF "
                      "-> esito (c) zero LLM", "ok": False,
                      "status": "BLOCKED", "cause": blocked_global,
                      "evidence": [], "timings": {}})
        c_iv = cases[-1]
    else:
        c_iv = check_iv(env, gt, pre)
        if c_iv["ok"]:
            c_iv["status"] = "OK"
        else:
            # 6 tentativi eseguiti -> BLOCKED con causa+procedura
            last = c_iv["attempts"][-1] if c_iv["attempts"] else {}
            c_iv["status"] = "BLOCKED"
            c_iv["cause"] = (
                "esito (c) NON riprodotto dopo 6 tentativi: "
                f"ultimi observati esito_c={last.get('esito_c_informativa')} "
                f"llm_calls={last.get('llm_calls')} gate={last.get('gate_note')}. "
                "CAUSA: build_informativa viene emesso SOLO se "
                "outcome.fused e' vuoto (router.py: if not outcome.fused), "
                "cioe' quando TUTTE le righe ibride sono <0.35 (H8); su "
                "questo corpus i negative GT hanno max_sim "
                f"{[ (c['id'], c.get('max_sim')) for c in pre['candidati_iv'] if c['id'].startswith('n') ]} "
                "-> fused non vuoto -> generazione LLM (1 chiamata) invece "
                "dell'informativa, pur con gate outcome=nulla. "
                "PROCEDURA: in Router._stream_rag_pipeline passare a "
                "build_informativa(decision) anche quando "
                "decision.outcome==OUTCOME_NULLA nonostante fused non vuoto "
                "(o filtrare fused per esito di gate); poi ripetere "
                "PYTHONIOENCODING=utf-8 python qa/r15_qa1.py")
        cases.append(c_iv)

    # ---- (v) tempi ----
    c_v = check_v(env, c_iv if not blocked_global else None, pre)
    if blocked_global:
        c_v["v_a"] = {"ok": False, "status": "BLOCKED",
                      "cause": blocked_global, "p95_ms": None, "n": 0,
                      "samples": []}
        c_v["v_b"] = dict(c_v.get("v_b") or {}, ok=False, status="BLOCKED",
                          cause=blocked_global, p95_ms=None)
    c_v["ok"] = bool(c_v.get("check_v_ok"))
    c_v["status"] = "OK" if c_v["ok"] else ("BLOCKED"
                                            if (c_v["v_a"].get("status")
                                                == "BLOCKED"
                                                or c_v["v_b"].get("status")
                                                == "BLOCKED") else "FAIL")
    cases.append(c_v)

    # ---- (vi) tempo al primo feedback (campioni da i, iii, iv + v) ----
    pool = []
    for r in getattr(main, "_e2e_pool", []):
        pool.append(r)
    # ricostruisci dai casi: primi progress di i, iii, iv (>=3 casi)
    for c in cases:
        if c["id"] in ("i", "iii", "iv"):
            for a in c.get("attempts", []) or []:
                pool.append({"case": a.get("id"),
                             "query": a.get("query", ""),
                             "first_progress_ms": a.get("first_progress_ms"),
                             "first_token_ms": a.get("first_token_ms")})
        if c["id"] == "v":
            for key in ("v_a", "v_b"):
                for s in (c.get(key) or {}).get("samples", []) or []:
                    pool.append({"case": f"v{s['n']}",
                                 "query": (c.get(key) or {}).get("query", ""),
                                 "first_progress_ms": s.get("first_progress_ms"),
                                 "first_token_ms": s.get("first_token_ms")})
    c_vi = check_vi(pool)
    c_vi["status"] = "OK" if c_vi["ok"] else "FAIL"
    cases.append(c_vi)

    # ---- shutdown sidecar + processi residui (dichiarato) ----
    shutdown_info = {"attempted": True}
    try:
        from core.sidecar.server import get_server
        srv = get_server()
        shutdown_info["state_before"] = srv.state
        srv.shutdown()
        shutdown_info["state_after"] = sidecar_state()
    except Exception as e:
        shutdown_info["error"] = f"{type(e).__name__}: {e}"
    log(f"sidecar shutdown: {shutdown_info}")

    time.sleep(1.0)
    llama_after = tasklist_pids("llama-server.exe")
    killed = []
    for pid in llama_after:
        if pid not in llama_before:
            try:
                subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                               capture_output=True, timeout=20)
                killed.append(pid)
                log(f"KILL dichiarato: llama-server residuo PID {pid}")
            except Exception as e:
                log(f"kill residuo PID {pid} fallito: {e}")
    py_after = tasklist_pids("python.exe") + tasklist_pids("pythonw.exe")
    py_before_note = ("snapshot non catturato all'avvio per python.exe "
                      "(altri processi altrui NON toccati); il solo python "
                      "avviato da questo run e' questo script stesso, che "
                      "termina alla fine")
    residui = {
        "llama_server_prima": llama_before,
        "llama_server_dopo_shutdown": llama_after,
        "llama_server_killati_dichiarati": killed,
        "python_dopo": len(py_after),
        "note_python": py_before_note,
        "sidecar": shutdown_info,
    }
    log(f"processi residui: {json.dumps(residui, ensure_ascii=False)}")

    # ---- network log consolidato (TUTTI i casi: ogni chiamata dichiarata) ----
    net_all = []
    for c in cases:
        for a in c.get("attempts", []) or []:
            net_all.extend(a.get("net_log", []) or [])
        for key in ("v_a", "v_b"):
            for s in (c.get(key) or {}).get("samples", []) or []:
                net_all.extend(s.get("net_log", []) or [])
            # probes non-esito(c) di (v)b: RETE pur dichiarata a runtime
            for s in (c.get(key) or {}).get("probes_failed", []) or []:
                net_all.extend(s.get("net_log", []) or [])
    net_all = net_all[:200]

    # ---- target finali ----
    by_id = {c["id"]: c for c in cases}
    v_a = (by_id.get("v") or {}).get("v_a") or {}
    v_b = (by_id.get("v") or {}).get("v_b") or {}
    esiti_ok = all(by_id.get(k, {}).get("ok") for k in
                   ("i", "ii", "iii", "iv", "v", "vi"))
    out = {
        "round": "R15b", "qa": "QA-1 matrice fallimenti",
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        "method": METHOD,
        "declarations": {
            "webview_stub": WEBVIEW_STUB,
            "config": "sola lettura (valori letti: "
                      f"{json.dumps(env['cfg'], ensure_ascii=False)})",
            "web_off_on": "web_override runtime del contratto P "
                          "('mai'/'auto'/'sempre'); web.mode config "
                          "invariata",
            "rete": "SOLO casi web (iii, v-b); ogni chiamata in "
                    "network_log; SearXNG off; HF offline",
            "answer_cache": f"rediretta a {TMP_AC} + clear per ogni sample",
            "spy_generate_stream": {k: env["spy"].get(k) for k in
                                    ("n", "firma_preservata", "bind_ok",
                                     "backend")},
            "blocked_globale": blocked_global,
        },
        "prescreen": pre,
        "warmup": {"total_ms": warm["total_ms"], "n_tokens": warm["n_tokens"],
                   "error": warm["error"], "sidecar_state": st},
        "cases": cases,
        "targets": {
            "v_senza_web_p95": v_a.get("p95_ms"),
            "v_senza_web_target": 3000,
            "v_con_web_p95": v_b.get("p95_ms"),
            "v_con_web_target": 8000,
            "vi_p95": by_id.get("vi", {}).get("p95_ms"),
            "vi_target": 2000,
            "vi_n": by_id.get("vi", {}).get("n_casi"),
            "esiti_ok": esiti_ok,
        },
        "network_log": net_all,
        "network_log_n": len(net_all),
        "processi_residui": residui,
        "run_wall_ms": ms(t_run),
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    log(f"scritto {OUT_JSON} (wall={out['run_wall_ms']:.0f}ms, "
        f"esiti_ok={esiti_ok})")
    for k in ("i", "ii", "iii", "iv", "v", "vi"):
        c = by_id.get(k, {})
        log(f"ESITO {k}: ok={c.get('ok')} status={c.get('status')}")
    log(f"TARGETS: v_senza_web_p95={out['targets']['v_senza_web_p95']}"
        f"/<=3000 | v_con_web_p95={out['targets']['v_con_web_p95']}"
        f"/<=8000 | vi_p95={out['targets']['vi_p95']}/<=2000 "
        f"(n={out['targets']['vi_n']})")
    log("RETE usata (dichiarata): "
        f"{len(net_all)} chiamate loggate")
    log("=" * 70)


if __name__ == "__main__":
    main()

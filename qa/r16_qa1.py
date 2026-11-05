#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""qa/r16_qa1.py — R16 QA-1: matrice 20 query con SLO reali (rerunnable).

OUTPUT: qa/r16_qa1.json (+ qa/r16_qa1.log).

Matrice (R16 FASE finale):
  (i)  10 query con copertura LOCALE (GT R15 positivi + varianti)
  (ii) 5 query SOLO-WEB (incl. "chi e' dante alighieri")   [rete dichiarata]
  (iii)5 query senza copertura con R16_WEB_DOWN=1 (rete simulata giu')

Per OGNI query:
  - tempo totale (<= 20000 ms)
  - primo token di risposta (<= 2000 ms) + primo progress (informativo)
  - guardia marker: check_output(...) su output REALE (0 marker)
  - lunghezza >= 80 char OPPURE struttura esito (c) informativa
  - UN solo blocco di emissioni (nessun doppio stream) + reset gestiti
  - fonti con badge stadio (sources): item con stage e, per web, url
    in allowlist (core.web_search._in_allowlist)

DECLARAZIONI DI PROTOCOLLO:
  * BACKEND: core.router.Router.process_query_stream (wiring =
    backend/api.py::_run_generation, mode='automatica', web_override='auto',
    history_turns=[]); webview stub registrato; backend.* non importato.
  * WARMUP FUORI MISURA: (1) embedder+semantic pronti; (2)1 query
    "priming" RAG scartata (avvia llama-server + riempie la prefix cache).
  * ANSWER CACHE: rediretta a qa/tmp/r16_qa1_ac.jsonl + clear() prima di
    ogni sample (nessun HIT di misura).
  * RETE: SOLO gruppo (ii) (ddgs/wikipedia via allowlist, NET_LOG drenato);
    gruppo (iii) con R16_WEB_DOWN=1 -> ZERO chiamate (assertato).
  * CONFIG: sola lettura. HF_HUB_OFFLINE=1. Numeri solo misurati.
  * "UN solo messaggio renderizzato": qui si verifica l'invariante
    backend (UNA sola emission block + evento reset = sostituzione) +
    suite jsdom tests/r16_chat_ui.test.js (dedupe su data-msg-id);
    nessun doppio save (db.save avviene SOLO a done, api.py).
"""
from __future__ import annotations

import functools
import inspect
import json
import os
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

OUT_JSON = ROOT / "qa" / "r16_qa1.json"
OUT_LOG = ROOT / "qa" / "r16_qa1.log"
TMP_AC = ROOT / "qa" / "tmp" / "r16_qa1_ac.jsonl"
GT_PATH = ROOT / "qa" / "gt_set_r15.json"

_LOG_FH = None
_T0RUN = time.time()


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


def trunc(s: str, n: int) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n] + f"...[+{len(s) - n}]"


def p95(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    import math
    return vals[max(0, math.ceil(0.95 * len(vals)) - 1)]


def p50(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    import math
    return vals[max(0, math.ceil(0.50 * len(vals)) - 1)]


def drain_netlog():
    try:
        import core.web_search as w
        entries = list(getattr(w, "NET_LOG", []) or [])
        if hasattr(w, "NET_LOG"):
            w.NET_LOG[:] = []
        try:
            import core.rag.web_stage as ws
            for e in (getattr(ws, "NET_LOG", []) or []):
                entries.append(e)
            if hasattr(ws, "NET_LOG"):
                ws.NET_LOG[:] = []
        except Exception:
            pass
        return entries
    except Exception:
        return []


# ======================================================================
# SETUP
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
        "progress_events": bool(cfg.get("rag.progress_events", True)),
        "threshold": float(cfg.get("gate.threshold", 0.70)),
        "web.mode": str(cfg.get("web.mode", "auto")),
        "llm.backend": str(cfg.get("llm.backend", "")),
        "rag_top_k": int(cfg.get("rag_top_k", 5)),
        "local_model_path": str(cfg.get("local_model_path", "")),
    }
    log(f"config: {json.dumps(cfg_read, ensure_ascii=False)}")

    t = time.perf_counter()
    db = Database()
    vs = VectorStore(str(get_app_data_dir() / "vector_index"))
    local = LocalSearchEngine(db, vs)
    vs_b = VectorStore(str(get_app_data_dir() / "vector_index_books"))
    books = LocalSearchEngine(db, vs_b, local.embedder)
    log(f"boot store {ms(t)}ms chunk={vs.count()}/{vs_b.count()}")

    client = LocalLLMClient(
        model_path=cfg_read["local_model_path"],
        n_ctx=int(cfg.get("local_model_n_ctx", 8192)),
        n_gpu_layers=cfg.get("local_model_n_gpu_layers", -1),
        n_threads=cfg.get("local_model_n_threads"),
    )
    proxy = maybe_wrap_sidecar(client)
    spy = {"n": 0}
    orig_gs = proxy.generate_stream

    @functools.wraps(orig_gs)
    def gs_spy(*a, **k):
        spy["n"] += 1
        return orig_gs(*a, **k)

    proxy.generate_stream = gs_spy

    router = Router(lambda: proxy, local, books,
                    rag_top_k=cfg_read["rag_top_k"], rag_max_tokens=5000)
    TMP_AC.parent.mkdir(parents=True, exist_ok=True)
    if TMP_AC.exists():
        TMP_AC.unlink()
    router._answer_cache = AnswerCache(path=TMP_AC)

    return {"cfg": cfg_read, "router": router, "local": local,
            "spy": spy, "proxy": proxy,
            "DEFAULT_STUDY_MODE": DEFAULT_STUDY_MODE}


def wait_ready(env, timeout_s=90.0):
    """Warmup FUORI MISURA: embedder warm + semantic ready (+ sidecar boot)."""
    t0 = time.perf_counter()
    emb = env["local"].embedder
    while time.perf_counter() - t0 < timeout_s:
        warm = bool(getattr(emb, "warm", True))
        ready = bool(getattr(env["router"].semantic_router, "ready", True))
        if warm and ready:
            break
        time.sleep(0.5)
    log(f"ready: embedder.warm={getattr(emb, 'warm', '?')} "
        f"semantic.ready={getattr(env['router'].semantic_router, 'ready', '?')} "
        f"({ms(t0)}ms)")


# ======================================================================
# RUN QUERY (misura)
# ======================================================================
def run_query(env, case_id, query, web_override="auto", env_down=False):
    router = env["router"]
    spy = env["spy"]
    router.answer_cache.clear()
    spy_before = spy["n"]
    if env_down:
        os.environ["R16_WEB_DOWN"] = "1"
    else:
        os.environ.pop("R16_WEB_DOWN", None)

    text_parts = []
    progress = []
    sources_items = None
    source = None
    first_token = None
    first_progress = None
    resets = 0
    emission_blocks = 0
    in_block = False
    err = None
    net_before = drain_netlog()
    t0 = time.perf_counter()
    try:
        for ev in router.process_query_stream(
                query, mode="automatica", thinking=False,
                study_mode=env["DEFAULT_STUDY_MODE"],
                stop_event=threading.Event(), topic="", history_turns=None,
                web_override=web_override):
            now = ms(t0)
            et = ev.get("type")
            if et == "progress":
                if first_progress is None:
                    first_progress = now
                progress.append({k: ev.get(k) for k in
                                 ("stage", "status", "ms", "note")
                                 if ev.get(k) is not None})
            elif et == "token":
                if first_token is None:
                    first_token = now
                if not in_block:
                    emission_blocks += 1
                    in_block = True
                text_parts.append(ev.get("text") or "")
            elif et == "reset":
                resets += 1
                text_parts = []      # semantica: il retry SOSTITUISCE
                in_block = False
            elif et == "sources":
                sources_items = list(ev.get("items") or [])
            elif et == "source":
                source = ev.get("value")
                in_block = False
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    total = ms(t0)
    os.environ.pop("R16_WEB_DOWN", None)
    net = drain_netlog()
    del net_before

    text = "".join(text_parts)
    # guardia marker sul testo REALE emesso
    from core.rag.output_guard import check_output
    chk = check_output(text, check_min_len=False)
    from core.rag.gate import build_informativa  # noqa: F401  (import check)
    esito_c = text.lstrip().startswith("Non ho trovato")
    len_ok = len(text.strip()) >= 80 or esito_c
    # fonti: badge stadio + allowlist per url web
    from core.web_search import _in_allowlist
    web_urls = [i.get("url") for i in (sources_items or [])
                if i.get("stage") == "web" and i.get("url")]
    web_allow_ok = all(_in_allowlist(u) for u in web_urls)
    # gruppo ii (solo-web): DEVE arrivare almeno un url web in allowlist
    # (attenzione: "iii".startswith("ii") e' True -> esclusione esplicita)
    if str(case_id).startswith("iii"):
        _group = "iii"
    elif str(case_id).startswith("ii"):
        _group = "ii"
    else:
        _group = "i"
    web_expected = (_group == "ii")
    stages = [p.get("stage") for p in progress]
    res = {
        "case": case_id, "query": query, "env_down": env_down,
        "total_ms": total, "first_token_ms": first_token,
        "first_progress_ms": first_progress,
        "slo_total_ok": total <= 20000.0,
        "slo_token_ok": (first_token is not None and first_token <= 2000.0),
        "n_tokens": len(text_parts), "text_len": len(text),
        "text_head": trunc(text, 400),
        "guard_markers": chk["markers"], "guard_ok": chk["ok"],
        "len_ok": len_ok, "esito_c": esito_c,
        "resets": resets, "emission_blocks": emission_blocks,
        "single_block_ok": emission_blocks <= 1,
        "source": source,
        "sources_n": len(sources_items or []),
        "sources_stages": sorted({i.get("stage") for i in
                                  (sources_items or [])}),
        "web_urls": web_urls, "web_allow_ok": web_allow_ok,
        "llm_calls": spy["n"] - spy_before,
        "net_n": len(net), "net_ok": (len(net) == 0) if env_down else None,
        "stages": stages,
        "stage_ms": {p.get("stage"): p.get("ms") for p in progress
                     if p.get("status") == "done"},
        "error": err,
    }
    local_expected = (_group == "i")     # fonti locali con badge
    down_expected = (_group == "iii")     # esito (c) informativo obbligatorio
    # ok_core = tutti gli assert TRANNE il sub-SLO "primo token <= 2s"
    # (misurato: irraggiungibile sul web per fisica fetch 1.1-3.3s + pp;
    #  dichiarato apertamente nel report)
    res["ok_core"] = bool(
        res["slo_total_ok"] and res["guard_ok"]
        and res["len_ok"] and res["single_block_ok"] and not err
        and res["net_ok"] is not False and web_allow_ok
        and (not web_expected or len(web_urls) >= 1)
        and (not local_expected or res["sources_n"] >= 1)
        and (not down_expected or esito_c)
    )
    res["ok"] = bool(res["ok_core"] and res["slo_token_ok"])
    res["web_expected"] = web_expected
    res["group"] = _group
    log(f"QA {case_id}: total={total:.0f} tok={first_token} "
        f"n={len(text_parts)} llm={res['llm_calls']} guard={chk['ok']} "
        f"len_ok={len_ok} blocks={emission_blocks} resets={resets} "
        f"src={source} weburls={len(web_urls)} net={len(net)} "
        f"ok={res['ok']} err={err}")
    return res


# ======================================================================
# MATRICE
# ======================================================================
def build_matrix():
    gt = json.loads(GT_PATH.read_text(encoding="utf-8"))
    positivi = [c for c in gt.get("casi", [])
                if str(c.get("tipo", "")).lower() in ("positivo", "ok", "")]
    # fallback: casi con anchor
    if len(positivi) < 10:
        positivi = [c for c in gt.get("casi", [])
                    if c.get("atteso", {}).get("anchor")
                    or c.get("anchor")]
    local_q = []
    for c in positivi:
        q = c.get("query")
        if q:
            local_q.append(q)
    # integrazione fino a 10 con query locali REALI note dal corpus
    extra_local = [
        "Che ruolo svolge la plastocianina nella catena di trasporto degli "
        "elettroni?",
        "Qual e' il valore di delta G della reazione che produce glucosio "
        "nella fotosintesi?",
        "Perche' la RuBisCO e' un enzima particolarmente lento?",
        "Che differenza c'e' tra fotosintesi ossigenica e anossica?",
        "Dove avviene la fosforilazione fotosintetica?",
    ]
    for q in extra_local:
        if len(local_q) >= 10:
            break
        if q not in local_q:
            local_q.append(q)
    local_q = local_q[:10]

    web_q = [
        "chi è dante alighieri",
        "chi è petrarca?",
        "Chi ha scritto il Decameron?",
        "Come si calcola l'IVA sulla fattura elettronica in Italia?",
        "Quali sono le regole del calcio riguardo al fuorigioco?",
    ]
    down_q = [
        "ricetta carbonara",
        "zzqxv jklpwm nbvcxz quadrifoglio",
        "Quali sono i capitoli del Signore degli Anelli?",
        "Che ore sono adesso a New York?",
        "Cos'e' il mistero di Oak Island?",
    ]
    return [(f"i{n+1}", q, "auto", False) for n, q in enumerate(local_q)] + \
           [(f"ii{n+1}", q, "auto", False) for n, q in enumerate(web_q)] + \
           [(f"iii{n+1}", q, "auto", True) for n, q in enumerate(down_q)]


def main():
    global _LOG_FH
    if OUT_LOG.exists():
        OUT_LOG.unlink()
    log("=== R16 QA-1 matrice 20 query (start) ===")
    env = setup()
    wait_ready(env)

    # ---- WARMUP FUORI MISURA:1 query RAG priming (scartata) ----------
    prim = run_query(env, "warmup_scartata",
                     "Qual e' il valore di delta G nella fotosintesi?",
                     web_override="mai")
    log(f"warmup scartata: total={prim['total_ms']}ms "
        f"first_tok={prim['first_token_ms']}")

    matrix = build_matrix()
    log(f"matrice: {len(matrix)} query")
    cases = []
    for cid, q, wo, down in matrix:
        r = run_query(env, cid, q, web_override=wo, env_down=down)
        cases.append(r)
        # pausa minima tra query per non saturare lo slot
        time.sleep(0.2)

    def group(pref):
        return [c for c in cases if str(c["case"]).startswith(pref)]

    groups = {}
    for pref, name in (("i", "locale"), ("ii", "solo_web"),
                       ("iii", "rete_giu")):
        g = group(pref)
        groups[name] = {
            "n": len(g),
            "ok": sum(1 for c in g if c["ok"]),
            "ok_core": sum(1 for c in g if c.get("ok_core")),
            "total_p50": p50([c["total_ms"] for c in g]),
            "total_p95": p95([c["total_ms"] for c in g]),
            "first_token_p50": p50([c["first_token_ms"] for c in g]),
            "first_token_p95": p95([c["first_token_ms"] for c in g]),
            "first_progress_p95": p95([c["first_progress_ms"] for c in g]),
            "llm_calls_total": sum(c["llm_calls"] for c in g),
        }

    all_ok = all(c["ok"] for c in cases)
    summary = {
        "n": len(cases), "ok": sum(1 for c in cases if c["ok"]),
        "ok_core": sum(1 for c in cases if c.get("ok_core")),
        "slo_token_pass": sum(1 for c in cases if c["slo_token_ok"]),
        "all_ok": all_ok,
        "total_p50": p50([c["total_ms"] for c in cases]),
        "total_p95": p95([c["total_ms"] for c in cases]),
        "first_token_p50": p50([c["first_token_ms"] for c in cases]),
        "first_token_p95": p95([c["first_token_ms"] for c in cases]),
        "first_progress_p95": p95([c["first_progress_ms"] for c in cases]),
        "slo_20s_p95_ok": (p95([c["total_ms"] for c in cases]) or 0) <= 20000,
        "slo_2s_p95_ok": (p95([c["first_token_ms"] for c in cases]) or 9e9)
                         <= 2000,
        "guard_fail": [c["case"] for c in cases if not c["guard_ok"]],
        "len_fail": [c["case"] for c in cases if not c["len_ok"]],
        "block_fail": [c["case"] for c in cases
                       if not c["single_block_ok"]],
        "net_down_leak": [c["case"] for c in cases
                          if c["env_down"] and c["net_n"]],
        "web_allow_fail": [c["case"] for c in cases
                           if not c["web_allow_ok"]],
    }

    out = {
        "round": "16", "qa": "QA-1",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "run_wall_ms": round((time.time() - _T0RUN) * 1000, 1),
        "method": (
            "Router.process_query_stream (mode=automatica, web_override=auto,"
            " history=[]); warmup embedder+semantic+priming FUORI MISURA; "
            "answer cache redirect+clear; guardia=core.rag.output_guard."
            "check_output su testo reale; p95=nearest-rank; R16_WEB_DOWN=1 "
            "per il gruppo iii (zero rete assertato); rete solo gruppo ii "
            "(NET_LOG drenato per caso, allowlist data/web_allowlist.txt)"
        ),
        "declarations": {
            "config_read_only": True,
            "hf_offline": os.environ.get("HF_HUB_OFFLINE"),
            "answer_cache_tmp": str(TMP_AC),
            "single_message_backend": ("UNA emission block per query; reset = "
                                       "sostituzione (dedupe FE verificato da "
                                       "tests/r16_chat_ui.test.js 20/20)"),
            "first_token_def": ("primo evento token della RISPOSTA "
                                "(informativa inclusa: testo deterministico "
                                "zero-LLM; per le query LLM = primo token "
                                "dopo prebuffer guard 48 char)"),
        },
        "groups": groups, "summary": summary, "cases": cases,
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    log(f"scritto {OUT_JSON}")
    log(f"RIEPILOGO ok={summary['ok']}/{summary['n']} "
        f"total_p95={summary['total_p95']} tok_p95={summary['first_token_p95']} "
        f"slo20={summary['slo_20s_p95_ok']} slo2={summary['slo_2s_p95_ok']} "
        f"guard_fail={summary['guard_fail']}")

    # shutdown dichiarato
    try:
        from core.sidecar.server import get_server
        s = get_server()
        for a in ("shutdown", "stop", "stop_if_idle"):
            f = getattr(s, a, None)
            if callable(f):
                try:
                    f()
                    break
                except Exception:
                    pass
        log(f"sidecar state post: {s.state}")
    except Exception as e:
        log(f"shutdown: {e}")


if __name__ == "__main__":
    main()

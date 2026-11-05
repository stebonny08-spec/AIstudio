#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""qa/f0_round16.py — FASE0 R16: FORENSICS del leak template / canned / duplicati.

OUTPUT: qa/f0_round16.json (+ qa/f0_round16.log); dump completi in
qa/tmp/f0r16_prompt_<id>.txt e qa/tmp/f0r16_raw_<id>.txt.

OBIETTIVI (prompt R16 F0.1-F0.3):
  F0.1 query "chi è dante alighieri" (dallo screenshot/astensioni) + 3 reali
       prese da %APPDATA%/NovaStudio/astensioni.jsonl; per ciascuna:
       - PROMPT COMPLETO inviato al modello (stringa reale; per il sidecar è
         il body["prompt"] esatto POSTato a /completion; per l'in-process sono
         i messages JSON di create_chat_completion), dump su file
       - output RAW (join dei token emessi) su file
       - numero di "blocchi" ripetuti nell'output (analisi ripetizioni)
  F0.2 cause: (a) marker di template nel prompt/output; (b) frase canned
       ("La risposta è data da un utente di questo tipo.") cercata in
       prompt/output/codice; (c) ripetizioni del blocco risposta.
  F0.3 tempi per stadio (eventi progress) fino a fine risposta.

DECLARAZIONI DI PROTOCOLLO:
  * BACKEND: core.router.Router.process_query_stream (wiring identico a
    backend/api.py::_run_generation, mode='automatica', history_turns=[],
    topic='', web_override = config web.mode letta a runtime = 'auto').
    backend.* NON importato; webview stub registrato prima degli import.
  * RETE: dichiarata — web.mode=auto significa che per le query senza
    copertura locale il router tenterà il ricorso web (ddgs etc., log
    core.web_search.NET_LOG drenato e salvato in network_log). Nessun LLM
    cloud; HF_HUB_OFFLINE=1.
  * CONFIG: sola lettura. Rispondi cache: answer cache rediretta a file
    temporaneo qa/tmp/f0r16_ac.jsonl + clear() prima di ogni query.
  * NUMERI solo misurati (time.perf_counter). Max 6 tentativi per unità.
  * Alla fine: shutdown sidecar dichiarato + check processi residui.
"""

from __future__ import annotations

import functools
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

OUT_JSON = ROOT / "qa" / "f0_round16.json"
OUT_LOG = ROOT / "qa" / "f0_round16.log"
TMP = ROOT / "qa" / "tmp"
TMP_AC = TMP / "f0r16_ac.jsonl"

MARKERS = [
    "[Fonte",
    "User:",
    "Assistant:",
    "System:",
    "DOMANDA DELL'UTENTE",
    "</contesto>",
    "<contesto>",
    "La risposta è data da",
    "utente di questo tipo",
    "La risposta è data",
]

_LOG_FH = None


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


_OUT_LOG_READY = False


def ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000.0, 2)


def trunc(s: str, n: int) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n] + f"...[+{len(s) - n} char]"


def marker_counts(text: str) -> dict:
    out = {}
    for m in MARKERS:
        out[m] = (text or "").count(m)
    return out


def repetition_analysis(text: str) -> dict:
    """Blocchi ripetuti: shingle di 80 char che ricompaiono (F0.2c)."""
    t = (text or "").strip()
    if len(t) < 160:
        return {"n_char": len(t), "dup80": 0, "line_dup": 0, "head_dup": 0}
    shingles = [t[i:i + 80] for i in range(0, len(t) - 80, 40)]
    seen, dup = {}, 0
    for s in shingles:
        if s in seen:
            dup += 1
        else:
            seen[s] = True
    lines = [l.strip() for l in t.splitlines() if len(l.strip()) > 20]
    line_dup = len(lines) - len(set(lines))
    head = t[:120].strip()
    head_dup = t.count(head) if head else 0
    return {"n_char": len(t), "dup80": dup, "line_dup": line_dup,
            "head_dup": head_dup}


# ========================================================================
# SETUP (schema = qa/r15_qa1.py) + ISTRUMENTAZIONE PROMPT
# ========================================================================
CAPTURE = {
    "messages": None,          # messages JSON (in-process + sidecar)
    "sidecar_prompt": None,    # stringa esatta POSTata a /completion
    "sidecar_complete_calls": 0,
}


def setup():
    from data.config_manager import ConfigManager, get_app_data_dir
    from data.db import Database
    from core.rag.vector_store import VectorStore
    from core.local_search import LocalSearchEngine
    from core.local_llm_client import (LocalLLMClient, maybe_wrap_sidecar,
                                       DEFAULT_STUDY_MODE)
    from core.router import Router
    from core.rag.answer_cache import AnswerCache
    import core.sidecar.client as scc

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

    # --- I1: cattura messages (prompt strutturato) ----------------------
    orig_prep = LocalLLMClient._prepare_messages

    def prep_spy(self, *a, **k):
        msgs = orig_prep(self, *a, **k)
        CAPTURE["messages"] = msgs
        return msgs

    LocalLLMClient._prepare_messages = prep_spy

    # --- I2: cattura stringa esatta del body /completion (sidecar) ------
    orig_mtp = scc._messages_to_prompt

    def mtp_spy(prompt_or_messages):
        out = orig_mtp(prompt_or_messages)
        CAPTURE["sidecar_prompt"] = out
        return out

    scc._messages_to_prompt = mtp_spy

    # --- I3: rileva se il sidecar ha servito la chiamata ----------------
    orig_complete = scc.SidecarClient.complete

    def complete_spy(self, *a, **k):
        CAPTURE["sidecar_complete_calls"] += 1
        return orig_complete(self, *a, **k)

    scc.SidecarClient.complete = complete_spy

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

    # spy generate_stream (conteggio chiamate LLM)
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
            "DEFAULT_STUDY_MODE": DEFAULT_STUDY_MODE, "cfgmgr": cfg}


# ========================================================================
# RUN E2E PER QUERY (dump completo)
# ========================================================================
def run_case(env, case_id, query, web_override="auto"):
    router = env["router"]
    spy = env["spy"]
    router.answer_cache.clear()

    for k in ("messages", "sidecar_prompt"):
        CAPTURE[k] = None
    c_before = CAPTURE["sidecar_complete_calls"]
    spy_before = spy["n"]

    events = []
    text_parts = []
    progress = []
    sources_items = None
    source = None
    first_progress = None
    first_token = None
    err = None
    t0 = time.perf_counter()
    try:
        for ev in router.process_query_stream(
                query, mode="automatica", thinking=False,
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
                                 ("stage", "status", "ms", "note")
                                 if ev.get(k) is not None})
            elif et == "token":
                if first_token is None:
                    first_token = now
                text_parts.append(ev.get("text") or "")
            elif et == "sources":
                sources_items = list(ev.get("items") or [])
            elif et == "source":
                source = ev.get("value")
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    total = ms(t0)

    raw = "".join(text_parts)
    msgs = CAPTURE["messages"] or []
    side_prompt = CAPTURE["sidecar_prompt"]
    served_sidecar = CAPTURE["sidecar_complete_calls"] > c_before

    # dump completi su file
    pfile = TMP / f"f0r16_prompt_{case_id}.txt"
    rfile = TMP / f"f0r16_raw_{case_id}.txt"
    pfile.write_text(
        ("=== SIDECAR body['prompt'] (stringa esatta POST /completion) ===\n"
         + (side_prompt if side_prompt else "(non chiamato: path in-process)")
         + "\n\n=== MESSAGES JSON (struttura ruoli, in-process/chat) ===\n"
         + json.dumps(msgs, ensure_ascii=False, indent=1)),
        encoding="utf-8")
    rfile.write_text(raw, encoding="utf-8")

    prompt_for_markers = side_prompt or json.dumps(msgs, ensure_ascii=False)
    mc_prompt = marker_counts(prompt_for_markers)
    mc_out = marker_counts(raw)
    rep = repetition_analysis(raw)

    # frase canned: cercata in prompt, output e (a titolo informativo) note
    canned_hit = {
        "in_output": [m for m in MARKERS if m in raw and "risposta è data" in m],
        "in_output_any": ("La risposta è data" in raw
                          or "utente di questo tipo" in raw),
        "in_prompt_any": ("La risposta è data" in (prompt_for_markers or "")
                          or "utente di questo tipo" in (prompt_for_markers or "")),
    }

    res = {
        "case": case_id, "query": query, "web_override": web_override,
        "backend_used": ("sidecar" if served_sidecar else "in-process"),
        "llm_calls": spy["n"] - spy_before,
        "total_ms": total, "first_progress_ms": first_progress,
        "first_token_ms": first_token, "n_tokens": len(text_parts),
        "text_len": len(raw), "source": source,
        "sources_items": sources_items,
        "progress": progress,
        "prompt": {
            "file": str(pfile.relative_to(ROOT)).replace("\\", "/"),
            "sidecar_string_len": len(side_prompt or ""),
            "n_messages": len(msgs),
            "roles": [m.get("role") for m in msgs],
            "msg_lens": [len(str(m.get("content") or "")) for m in msgs],
            "head": trunc(prompt_for_markers, 900),
            "marker_counts": mc_prompt,
            "raw_role_lines_in_sidecar_string": bool(
                side_prompt and ("\nUser:" in side_prompt
                                 or "\nAssistant:" in side_prompt)),
        },
        "output": {
            "file": str(rfile.relative_to(ROOT)).replace("\\", "/"),
            "raw_full": trunc(raw, 6000),
            "head": trunc(raw, 700),
            "marker_counts": mc_out,
            "repetition": rep,
            "canned": canned_hit,
        },
        "error": err,
    }
    log(f"CASE {case_id}: total={total:.0f}ms first_tok={first_token} "
        f"tok={len(text_parts)} backend={res['backend_used']} "
        f"llm={res['llm_calls']} markers_out="
        f"{ {k: v for k, v in mc_out.items() if v} } rep={rep} err={err}")
    return res


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


def sidecar_state() -> str:
    try:
        from core.sidecar.server import get_server
        return str(get_server().state)
    except Exception as e:
        return f"error:{type(e).__name__}: {e}"


def shutdown_sidecar():
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


def tail_astensioni(n=8):
    """Query REALI fallite dal log astensioni (F0.1)."""
    p = Path(os.environ.get("APPDATA", "")) / "NovaStudio" / "astensioni.jsonl"
    qs = []
    try:
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                o = json.loads(line)
                q = str(o.get("query") or "").strip()
                if q and q not in qs:
                    qs.append(q)
            except Exception:
                continue
    except Exception:
        pass
    return qs[-n:]


def main():
    global _OUT_LOG_READY
    OUT_LOG.parent.mkdir(parents=True, exist_ok=True)
    if OUT_LOG.exists():
        OUT_LOG.unlink()
    _OUT_LOG_READY = True

    log("=== FASE0 R16 FORENSICS (start) ===")
    ast_qs = tail_astensioni()
    log(f"query astensioni (reali, ultime): {ast_qs}")

    # 4 query: screenshot + 3 reali dal log astensioni (F0.1)
    plan = []
    dante = next((q for q in ast_qs if "dante" in q.lower()), None)
    plan.append(("q1_dante", dante or "chi è dante alighieri"))
    others = [q for q in ast_qs if (q != dante and "dante" not in q.lower())]
    picks = others[-3:]
    if len(picks) < 3:
        for fb in ("chi è petrarca?", "differenza mitosi meiosi",
                   "ricetta carbonara"):
            if fb not in picks and len(picks) < 3:
                picks.append(fb)
    for i, q in enumerate(picks, start=2):
        plan.append((f"q{i}", q))
    log("piano: " + json.dumps(plan, ensure_ascii=False))

    env = setup()
    log(f"sidecar state pre: {sidecar_state()}")

    cases = []
    for cid, q in plan:
        try:
            r = run_case(env, cid, q, web_override=env["cfg"]["web.mode"])
        except Exception as e:
            r = {"case": cid, "query": q, "error": f"{type(e).__name__}: {e}"}
            log(f"CASE {cid} ECCEZIONE: {r['error']}")
        r["net_log"] = drain_netlog()
        r["net_n"] = len(r["net_log"])
        cases.append(r)

    # ---------------------------------------------------------- ANALISI
    code_scan = scan_code_for_phrase()
    summary = {"per_cause_preliminari": {}}
    for c in cases:
        if c.get("error"):
            cause = "RUN-ERROR"
        else:
            mc = c["output"]["marker_counts"]
            if any(mc.get(m, 0) > 0 for m in ("[Fonte", "User:",
                                               "Assistant:",
                                               "DOMANDA DELL'UTENTE")):
                cause = "TEMPLATE-LEAK"
            elif c["output"]["canned"]["in_output_any"]:
                cause = "CANNED-IN-OUTPUT"
            elif c["output"]["repetition"]["dup80"] > 3:
                cause = "REPETITION-BLOCKS"
            else:
                cause = "DA-ANALISI-UMANA"
        summary["per_cause_preliminari"][c["case"]] = cause

    out = {
        "round": "16",
        "phase": "F0-forensics",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "method": (
            "Router.process_query_stream (wiring api._run_generation), "
            "webview stub, web_override=config web.mode; prompt: stringa "
            "esatta body['prompt'] del sidecar (captured) + messages JSON; "
            "output = join token event; marker/repetition su testo reale; "
            "tempi perf_counter; rete solo stadio web (NET_LOG drenato)"
        ),
        "declarations": {
            "config_read_only": True,
            "hf_offline": os.environ.get("HF_HUB_OFFLINE"),
            "network": "stadio web ddgs/wikipedia (NET_LOG per caso)",
            "answer_cache_tmp": str(TMP_AC),
            "sidecar_state_pre": sidecar_state(),
        },
        "astensioni_queries": ast_qs,
        "code_scan_phrase": code_scan,
        "cases": cases,
        "summary": summary,
    }

    final_state = shutdown_sidecar()
    out["declarations"]["sidecar_state_post"] = final_state
    log(f"sidecar state post: {final_state}")

    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    log(f"scritto {OUT_JSON}")
    # check processi residui
    try:
        import subprocess
        r = subprocess.run(["tasklist"], capture_output=True, text=True,
                           timeout=20)
        n_llama = r.stdout.lower().count("llama-server")
        log(f"processi residui llama-server: {n_llama}")
        out["declarations"]["llama_residual"] = n_llama
    except Exception as e:
        log(f"check processi non disponibile: {e}")


def scan_code_for_phrase() -> dict:
    """F0.2b: la frase canned esiste nel codice sorgente? (read-only)"""
    pats = ["La risposta è data da", "utente di questo tipo",
            "La risposta è data"]
    hits = {p: [] for p in pats}
    skip = {"node_modules", "__pycache__", ".venv", "build", "dist",
            "tesseract", "tools", "models", ".git"}
    for dp, dn, fn in os.walk(str(ROOT)):
        dn[:] = [d for d in dn if d not in skip]
        for f in fn:
            if not f.endswith((".py", ".js", ".html", ".json", ".md")):
                continue
            pth = os.path.join(dp, f)
            if "f0_round16" in pth or "_f0r16" in pth:
                continue
            try:
                t = open(pth, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for pat in pats:
                if pat in t:
                    hits[pat].append(os.path.relpath(pth, ROOT)
                                     .replace("\\", "/"))
    return {k: sorted(set(v)) for k, v in hits.items()}


if __name__ == "__main__":
    main()

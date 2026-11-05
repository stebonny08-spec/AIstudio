#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""qa/r18_verify.py — R18: verifica E2E (4 query) del rifinimento chatbot.

OUTPUT: qa/r18_verify.json (+ qa/r18_tokens_v1/v2.json per gli screenshot).

Per OGNI query (TUTTO REALE, sidecar + web allowlist, rete dichiarata):
  - total_ms INFORMATIVO (nessun kill: il testo deve completarsi)
  - NESSUN marker di troncamento "_[risposta abbreviata...]"
  - NESSUN codice citazione [F#]/[W#] e nessun blocco "Fonti:" con URL
  - provenienza per STADIO dagli eventi sources.stages (metadati)
  - completezza: ultimo carattere di frase (. ! ? ...) o len>=400
  - encoding: nessuna mojibake (Ã... / U+FFFD)
  - guardia marker/verbatim/identico, lingua it, 1 blocco, >=80 char
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

spec = importlib.util.spec_from_file_location("r16qa1",
                                              str(ROOT / "qa" / "r16_qa1.py"))
qa1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa1)

QUERIES = [
    ("v1", "spiega la struttura della Divina Commedia", "lunga"),
    ("v2", "chi è dante alighieri", "solo-web"),
    ("v3", "Qual è il primo accettore di CO2 nelle piante C4?", "solo-locale"),
    ("v4", "chi è boccaccio", "solo-web"),
]

TRUNC_MARKER = "risposta abbreviata"
CODE_CITE_RE = re.compile(r"\[(?:F|W)\d+\]")
MOJIBAKE_RE = re.compile(r"Ã[\x80-\xbf]|�")
TERMINAL = set('.!?…:;"\')]»')

IT_STOP = {"di", "che", "non", "per", "con", "una", "sono", "del", "della",
           "gli", "le", "il", "lo", "questo", "come", "nel", "dalla", "che"}
EN_STOP = {"the", "and", "is", "of", "to", "in", "that", "with", "for",
           "this", "from", "are", "was"}


def lang_of(text: str) -> str:
    toks = [w.strip(".,;:!?").lower() for w in str(text or "").split()]
    it = sum(1 for w in toks if w in IT_STOP)
    en = sum(1 for w in toks if w in EN_STOP)
    return "it" if it >= en else ("en" if en > it else "?")


def run_one(env, cid, query, capture=False):
    from core.rag.output_guard import check_output
    from core.web_search import _in_allowlist

    router = env["router"]
    proxy = env["proxy"]
    router.answer_cache.clear()
    os.environ.pop("R16_WEB_DOWN", None)

    parts, sources_items, stages_evt = [], None, None
    first_token = first_progress = None
    resets = blocks = 0
    in_block = False
    progress, token_ts = [], []
    spy_n = env["spy"]["n"]
    t0 = time.perf_counter()
    for ev in router.process_query_stream(
            query, mode="automatica", thinking=False,
            study_mode=env["DEFAULT_STUDY_MODE"],
            stop_event=None, topic="", history_turns=None,
            web_override="auto"):
        now = round((time.perf_counter() - t0) * 1000.0, 1)
        et = ev.get("type")
        if et == "progress":
            if first_progress is None:
                first_progress = now
            progress.append(ev)
        elif et == "token":
            if first_token is None:
                first_token = now
            if not in_block:
                blocks += 1
                in_block = True
            parts.append(ev.get("text") or "")
            if capture:
                token_ts.append({"t": now, "n": len(ev.get("text") or "")})
        elif et == "reset":
            resets += 1
            parts = []
            in_block = False
        elif et == "sources":
            sources_items = list(ev.get("items") or [])
            if ev.get("stages") is not None:
                stages_evt = list(ev.get("stages") or [])
        elif et == "source":
            in_block = False
    total = round((time.perf_counter() - t0) * 1000.0, 1)
    net = qa1.drain_netlog()
    text = "".join(parts)

    chk = check_output(text, check_min_len=False)
    marker = getattr(getattr(proxy, "_target", proxy),
                     "last_marker_check", None) or {}
    trunc_present = TRUNC_MARKER in text
    codes = CODE_CITE_RE.findall(text)
    fonti_block = ("Fonti:" in text and "http" in text)
    mojibake = bool(MOJIBAKE_RE.search(text))
    last = text.rstrip()[-1] if text.rstrip() else ""
    completo = bool(text) and (last in TERMINAL or len(text) >= 400)
    web_urls = [i.get("url") for i in (sources_items or [])
                if i.get("stage") == "web" and i.get("url")]
    provenienza_ok = isinstance(stages_evt, list) and len(stages_evt) >= 1

    res = {
        "case": cid, "query": query, "tipo": None,
        "total_ms": total,          # INFORMATIVO (nessun kill)
        "first_token_ms": first_token,
        "first_progress_ms": first_progress,
        "text_len": len(text), "text_head": text[:400],
        "text_full": text[:6000],
        "lingua": lang_of(text),
        "guard_ok": chk["ok"], "guard_markers": chk["markers"],
        "guard_verbatim": chk.get("verbatim", False),
        "guard_identical": chk.get("identical", False),
        "client_marker": {k: marker.get(k) for k in
                          ("ok", "reason", "verbatim", "identical",
                           "code_citation")},
        "truncation_marker": trunc_present,
        "code_citations": codes,
        "fonti_block_url": fonti_block,
        "mojibake": mojibake,
        "completo": completo,
        "ultimo_char": last,
        "stages_provenienza": stages_evt,
        "provenienza_ok": provenienza_ok,
        "sources_n": len(sources_items or []),
        "web_urls": web_urls,
        "web_allow_ok": all(_in_allowlist(u) for u in web_urls),
        "llm_calls": env["spy"]["n"] - spy_n,
        "resets": resets, "emission_blocks": blocks,
        "net_n": len(net), "error": None,
    }
    res["ok"] = bool(
        res["guard_ok"] and not trunc_present and not codes
        and not fonti_block and not mojibake and res["completo"]
        and res["text_len"] >= 80 and res["lingua"] == "it"
        and blocks <= 1 and res["provenienza_ok"]
        and res["web_allow_ok"] and chk.get("ok")
    )
    if capture:
        (ROOT / "qa" / f"r18_tokens_{cid}.json").write_text(
            json.dumps({"query": query, "tokens": token_ts,
                        "total_ms": total,
                        "stages": stages_evt,
                        "sources": sources_items}, ensure_ascii=False),
            encoding="utf-8")
    print(f"R18 {cid}: total={total} tok={first_token} len={len(text)} "
          f"stages={stages_evt} trunc={trunc_present} codes={codes} "
          f"fontiURL={fonti_block} moji={mojibake} completo={completo} "
          f"lang={res['lingua']} guard={chk['ok']} blocks={blocks} "
          f"ok={res['ok']}", flush=True)
    return res


def main():
    log = qa1.log
    log("=== R18 verify: 4 query (nessun kill, provenienza per stadio) ===")
    env = qa1.setup()
    qa1.wait_ready(env)
    qa1.run_query(env, "warmup", "Qual e' il valore di delta G "
                  "nella fotosintesi?", web_override="mai")

    cases = []
    for cid, q, tipo in QUERIES:
        r = run_one(env, cid, q, capture=True)
        r["tipo"] = tipo
        cases.append(r)
        time.sleep(0.2)

    all_ok = all(c["ok"] for c in cases)
    summary = {
        "n": len(cases), "ok": sum(1 for c in cases if c["ok"]),
        "all_ok": all_ok,
        "total_max_ms": max((c["total_ms"] for c in cases), default=0),
        "total_p95_ms": max((c["total_ms"] for c in cases), default=0),
        "truncation_present": [c["case"] for c in cases
                               if c["truncation_marker"]],
        "code_citations": {c["case"]: c["code_citations"] for c in cases},
        "fonti_block_url": [c["case"] for c in cases if c["fonti_block_url"]],
        "mojibake": [c["case"] for c in cases if c["mojibake"]],
        "completi": sum(1 for c in cases if c["completo"]),
        "stages": {c["case"]: c["stages_provenienza"] for c in cases},
        "guard_fail": [c["case"] for c in cases if not c["guard_ok"]],
    }
    out = {
        "round": "18-rifinimento",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "method": (
            "Router.process_query_stream reale (sidecar MiniCPM5-2B + web "
            "allowlist, NET_LOG per caso); NIENTE kill temporale: total_ms "
            "INFORMATIVI; guardia output_guard (marker/verbatim/identico/"
            "codici [F#]); provenienza dagli eventi sources.stages; "
            "encoding check mojibake; warmup fuori misura; nessuna "
            "simulazione"
        ),
        "summary": summary, "cases": cases,
    }
    (ROOT / "qa" / "r18_verify.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"scritto qa/r18_verify.json ok={summary['ok']}/{summary['n']} "
        f"max_total={summary['total_max_ms']} trunc={summary['truncation_present']} "
        f"codes={summary['code_citations']} moji={summary['mojibake']}")

    try:
        from core.sidecar.server import get_server
        s = get_server()
        for a in ("shutdown", "stop", "stop_if_idle"):
            fn = getattr(s, a, None)
            if callable(fn):
                try:
                    fn()
                    break
                except Exception:
                    pass
        log(f"sidecar state post: {s.state}")
    except Exception as e:
        log(f"shutdown: {e}")


if __name__ == "__main__":
    main()

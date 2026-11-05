#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""qa/r16_qa2.py — R16 QA-2: 10 risposte PIENE per il gate umano.

Esegue 10 query della matrice (5 locali + 5 solo-web), salva il testo
COMPLETO in qa/r16_gate_raw.json e scrive lo scheletro di
qa/gate_round16.md con tutte le evidenze (il verdetto umano viene
aggiunto dal revisore sul file).
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

spec = importlib.util.spec_from_file_location(
    "r16qa1", str(ROOT / "qa" / "r16_qa1.py"))
qa1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa1)

PICKS = [
    ("i1", False), ("i4", False), ("i5", False), ("i9", False),
    ("i10", False),
    ("ii1", False), ("ii2", False), ("ii3", False), ("ii4", False),
    ("ii5", False),
]


def run_full(env, case_id, query, web_override="auto"):
    """Come run_query ma conserva il testo COMPLETO (per revisione)."""
    import os
    import threading
    import time as _t
    from core.rag.output_guard import check_output
    from core.web_search import _in_allowlist

    router = env["router"]
    router.answer_cache.clear()
    os.environ.pop("R16_WEB_DOWN", None)
    parts = []
    sources_items = None
    source = None
    first_token = None
    first_progress = None
    resets = 0
    blocks = 0
    in_block = False
    progress = []
    t0 = _t.perf_counter()
    for ev in router.process_query_stream(
            query, mode="automatica", thinking=False,
            study_mode=env["DEFAULT_STUDY_MODE"],
            stop_event=threading.Event(), topic="", history_turns=None,
            web_override=web_override):
        now = (_t.perf_counter() - t0) * 1000.0
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
        elif et == "reset":
            resets += 1
            parts = []
            in_block = False
        elif et == "sources":
            sources_items = list(ev.get("items") or [])
        elif et == "source":
            source = ev.get("value")
            in_block = False
    total = (_t.perf_counter() - t0) * 1000.0
    qa1.drain_netlog()
    text = "".join(parts)
    chk = check_output(text, check_min_len=False)
    web_urls = [i.get("url") for i in (sources_items or [])
                if i.get("stage") == "web" and i.get("url")]
    return {
        "case": case_id, "query": query, "total_ms": round(total, 1),
        "first_token_ms": (round(first_token, 1)
                           if first_token is not None else None),
        "first_progress_ms": (round(first_progress, 1)
                              if first_progress is not None else None),
        "text_full": text, "text_len": len(text),
        "guard_ok": chk["ok"], "guard_markers": chk["markers"],
        "source": source,
        "sources": sources_items or [],
        "web_urls": web_urls,
        "web_allow_ok": all(_in_allowlist(u) for u in web_urls),
        "resets": resets, "emission_blocks": blocks,
    }


def main():
    qa1.log("=== R16 QA-2 gate: 10 risposte piene ===")
    env = qa1.setup()
    qa1.wait_ready(env)
    qa1.run_query(env, "warmup_scartata",
                  "Qual e' il valore di delta G nella fotosintesi?",
                  web_override="mai")
    matrix = {cid: q for cid, q, _wo, _down in qa1.build_matrix()}
    out = []
    for cid, _down in PICKS:
        r = run_full(env, cid, matrix[cid])
        out.append(r)
        qa1.log(f"GATE-RUN {cid}: len={r['text_len']} "
                f"tok={r['first_token_ms']} guard={r['guard_ok']} "
                f"src={r['source']} urls={len(r['web_urls'])}")
        time.sleep(0.2)

    raw = ROOT / "qa" / "r16_gate_raw.json"
    raw.write_text(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                               "method": "r16_qa1.setup + testo COMPLETO",
                               "cases": out}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    qa1.log(f"scritto {raw}")

    # scheletro markdown per il revisore
    md = ["# R16 QA-2 — Gate umano: 10 risposte (5 locali + 5 web)",
          "",
          "Metodo: run E2E reale `qa/r16_qa2.py` (stesso harness di QA-1, "
          "warmup fuori misura, testo completo in `qa/r16_gate_raw.json`). "
          "Il revisore assegna per ogni risposta: **OK** / **PARZIALE** / "
          "**KO** su 4 assi: correttezza, citazioni/badge, assenza marker, "
          "completezza percepita.",
          ""]
    for r in out:
        stage = "WEB" if r["case"].startswith("ii") else "LOCALE"
        md += [f"## {r['case']} ({stage}) — {r['query']}",
               "",
               f"- fonte: `{r['source']}` · len={r['text_len']} · "
               f"primo token={r['first_token_ms']} ms · totale="
               f"{r['total_ms']} ms · guard={'PASS' if r['guard_ok'] else 'FAIL'}"
               f" · markers={r['guard_markers']} · resets={r['resets']} · "
               f"blocchi={r['emission_blocks']}",
               f"- fonti: {json.dumps(r['sources'], ensure_ascii=False)[:600]}",
               "",
               "```",
               r["text_full"][:2500],
               "```",
               "",
               "Verdetto: ______  (OK / PARZIALE / KO) — note: ",
               ""]
    (ROOT / "qa" / "gate_round16.md").write_text(
        "\n".join(md), encoding="utf-8")
    qa1.log("scritto qa/gate_round16.md (scheletro)")
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
        qa1.log(f"sidecar state post: {s.state}")
    except Exception as e:
        qa1.log(f"shutdown: {e}")


if __name__ == "__main__":
    main()

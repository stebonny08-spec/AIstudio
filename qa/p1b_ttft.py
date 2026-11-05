# -*- coding: utf-8 -*-
"""qa/p1b_ttft.py — P1b.4: TTFT RAG end-to-end CON acceleratori ammessi.

Metodo (riuso del metodo R16 identico, nessuna simulazione):
  qa/r16_qa1.setup() + wait_ready + run_query() su5 query miste (2 locali,
 2 web - rete dichiarata) +1 warmup scartato. TTFT = first_token_ms (primo
 evento token della risposta LLM dopo retrieval/gate). SLO: p50 <=2000ms
 (P1b.4 / soglia R16 "primo token"). Stato acceleratori letto dalla config
 REALE al momento della misura (usearch.enabled risolto, ngram_longform,
 rag.* del P1b.3). Output: qa/p1b_ttft.json
Uso (detached): set PYTHONIOENCODING=utf-8 && python qa/p1b_ttft.py
"""
from __future__ import annotations
import importlib.util
import json
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

spec = importlib.util.spec_from_file_location("r16qa1", str(ROOT / "qa" / "r16_qa1.py"))
qa1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa1)

QUERIES = [
    ("t1", "Qual e' il primo accettore di CO2 nelle piante C4?", "auto"),
    ("t2", "Spiega il ciclo di Krebs in modo sintetico ma completo.", "auto"),
    ("t3", "chi e' dante alighieri", "auto"),
    ("t4", "chi e' petrarca e perche' e' importante", "auto"),
    ("t5", "Descrivi la struttura della Divina Commedia secondo i materiali.", "auto"),
]

def p_nearest(vals, q):
    if not vals:
        return None
    s_ = sorted(vals)
    import math
    i = max(0, min(len(s_) - 1, math.ceil(q * len(s_)) - 1))
    return round(s_[i], 1)

def main():
    out = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "method": ("qa/r16_qa1.run_query su app wiring reale "
                      "(Router.process_query_stream, sidecar+gate+web), "
                      "TTFT = first_token_ms, SLO p50<=2000ms"),
           "slo_p50_ms": 2000, "cases": []}
    # stato acceleratori (config reale + risolti)
    try:
        from data.config_manager import ConfigManager
        cfg = ConfigManager()
        from core.rag.usearch_layer import usearch_enabled
        out["accelerators"] = {
            "usearch.enabled": usearch_enabled(),
            "spec.ngram_longform": cfg.get("spec.ngram_longform"),
            "spec.ngram_variant": cfg.get("spec.ngram_variant"),
            "rag.hyde": cfg.get("rag.hyde"),
            "rag.decompose": cfg.get("rag.decompose"),
            "rag.crag_lite": cfg.get("rag.crag_lite"),
            "rerank.enabled": cfg.get("rerank.enabled") or cfg.get("rag.rerank"),
            "local_model_path": cfg.get("local_model_path"),
        }
    except Exception as e:
        out["accelerators"] = {"error": str(e)[:200]}
    print("ACCEL", json.dumps(out["accelerators"], ensure_ascii=False), flush=True)

    env = qa1.setup()
    qa1.wait_ready(env)
    w = qa1.run_query(env, "warmup_ttft",
                      "Rispondi in una sola frase: qual e' la capitale d'Italia?")
    print("WARMUP tok=%s total=%s" % (w.get("first_token_ms"), w.get("total_ms")),
          flush=True)
    for cid, q, wo in QUERIES:
        r = qa1.run_query(env, cid, q, web_override=wo)
        rec = {"id": cid, "query": q,
               "first_token_ms": r.get("first_token_ms"),
               "total_ms": r.get("total_ms"),
               "ok_core": r.get("ok_core"),
               "n_tokens": r.get("n_tokens"), "text_len": r.get("text_len")}
        out["cases"].append(rec)
        print("CASE", cid, json.dumps(rec, ensure_ascii=False), flush=True)
    toks = [c["first_token_ms"] for c in out["cases"]
            if c.get("first_token_ms") is not None]
    out["summary"] = {"n": len(toks),
                      "p50": p_nearest(toks, 0.50),
                      "p95": p_nearest(toks, 0.95),
                      "max": round(max(toks), 1) if toks else None}
    out["slo_p50_ok"] = bool(out["summary"]["p50"] is not None and
                             out["summary"]["p50"] <= 2000)
    (ROOT / "qa" / "p1b_ttft.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print("SUMMARY", json.dumps(out["summary"]), "SLO_P50_OK=",
          out["slo_p50_ok"], flush=True)

if __name__ == "__main__":
    main()

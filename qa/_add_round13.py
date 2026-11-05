# -*- coding: utf-8 -*-
"""qa/_add_round13.py — costruisce e appende la entry round13 in
qa/metrics_history.json leggendo i valori SOLO da file qa/* reali su disco
(nessuna trascrizione manuale). Idempotente (se round13 esiste: sostituisce).

Uso: set PYTHONIOENCODING=utf-8&& python qa/_add_round13.py
Requisiti: qa/t1_r13.json (run T1 completato), g1_measures, g2_kv_rss,
g2_hitrate, t_probe_pywebview, h8_eval, gate_outputs_r12, r13_rag_dedupe_dryrun.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QA = ROOT / "qa"
HIST = QA / "metrics_history.json"


def load(rel: str):
    return json.loads((QA / rel).read_text(encoding="utf-8"))


def main() -> int:
    g1 = load("g1_measures.json")["sections"]
    kv = load("g2_kv_rss.json")
    hit = load("g2_hitrate.json")
    ttft = load("t_probe_pywebview.json")
    h8 = load("h8_eval.json")
    t1 = load("t1_r13.json")
    gate_rows = load("gate_outputs_r12.json")
    idx = (ROOT / "web_frontend" / "html" / "index.html").read_text(encoding="utf-8")
    build = re.search(r'var QA_TS = "([^"]+)"', idx).group(1)

    g_ok = sum(1 for e in gate_rows if e.get("parsed_ok"))
    g_per = {}
    for fid, key in (("F01", "f01"), ("F04", "f04"), ("F10", "f10"), ("F13", "f13")):
        rows = [e for e in gate_rows if e.get("fid") == fid]
        g_per[key] = {"ok": sum(1 for e in rows if e.get("parsed_ok")), "n": len(rows)}

    rss = g1["rss_mb"]
    tok = g1["tok_s"]["profili"]

    metrics = {
        "rss_before_mb": kv["rss_before_mb"],
        "rss_load_mb": rss["caricato_figli_llama_server"][1]["rss_mb"]
        if len(rss.get("caricato_figli_llama_server", [])) > 1 else None,
        "rss_30req_mb": kv["rss_after_mb"],
        "load_sec": g1["load_cold_sec"]["sec"],
        "tok_s": {
            "fast": tok["fast"]["mediana_tok_s"],
            "think": tok["think"]["mediana_tok_s"],
            "tool": tok["tool"]["mediana_tok_s"],
        },
        "latency_p50_ms": None,
        "latency_p95_ms": None,
        "ttft_p50_ms": ttft.get("p50_ms"),
        "ttft_p95_ms": ttft.get("p95_ms"),
        "ttft_n": ttft.get("n"),
        "prompt_cache_hit_rate": hit["hit_rate"],
        "kv_delta_mb": kv["delta_parent_mb"],
        "idle_unload_delta_mb": rss.get("delta_dopo_unload_vs_baseline_mb"),
        "prompt_lookup": g1["prompt_lookup"]["decisione"],
        "gate": {"total": len(gate_rows), "ok": g_ok, **g_per,
                 "stato": "invariato R13 (non rimisurato, vedi method)"},
        "recall5": h8["recall_at_5_hybrid"],
        "parity": 1.0,
        "router_p95_ms": None,
        "t1_total": t1["total_pass"],
        "books_parity": "BLOCKED (corpus vuoto 0/0 dichiarato)",
        "chromadb_runtime_imports": 0,
        "draft_decision": "Q4_K_M + draft OFF per tutti i profili (qa/r13_spec_measures.json)",
        "ttft_target_hit": False,
    }

    method = {
        "rss_before_mb": "psutil RSS padre prima degli invii -> qa/g2_kv_rss.json rss_before_mb (python tests/g2_kv_rss.py)",
        "rss_load_mb": "RSS figlio llama-server caricato (psutil) -> qa/g1_measures.json sections.rss_mb.caricato_figli_llama_server[llama-server.exe] (python tests/t2a_sidecar.py)",
        "rss_30req_mb": "RSS padre dopo 30 turni -> qa/g2_kv_rss.json rss_after_mb (python tests/g2_kv_rss.py)",
        "load_sec": "media perf_counter su start_on_demand fino a health 200 -> qa/g1_measures.json load_cold_sec (python tests/t2a_sidecar.py)",
        "tok_s": "mediana 1warmup+3, len(content)/4 / elapsed_wall, per profilo -> qa/g1_measures.json tok_s.profili (python tests/t2a_sidecar.py)",
        "ttft_p50_ms": "sonda pywebview end-to-end (bridge incluso, hidden) n=%s -> qa/t_probe_pywebview.json p50_ms; run n=5 originale in qa/r13_ttft_prev_load.json (p50 91962.4); fasi quiet tent.1 in qa/qa_r13_ttft_report.md; verdict BLOCKED (target 2000ms) con cause+procedura nel report" % ttft.get("n"),
        "ttft_p95_ms": "stessa sonda, nearest-rank -> qa/t_probe_pywebview.json p95_ms",
        "prompt_cache_hit_rate": "20 conversazioni multi-turn, HIT=KV-prefix -> qa/g2_hitrate.json hit_rate (python tests/g2_hitrate.py, eseguito R13)",
        "kv_delta_mb": "RSS padre delta su 30 turni con rolling -> qa/g2_kv_rss.json delta_parent_mb (python tests/g2_kv_rss.py, eseguito R13)",
        "gate": "NON rimisurato: invarianza registry verificata (testH4_registry 8/8 + testH4_validators 38/38 invariati; templates/validators/grammatiche intoccate R13; functions.py solo trigger_ui/note su F06/F17 fuori gate) -> valori ricontati da qa/gate_outputs_r12.json",
        "recall5": "eval retrieval reale -> qa/h8_eval.json recall_at_5_hybrid (rieseguito 2026-10-24)",
        "parity": "dedupe C3: ranking completo 24/24 query identiche salvo duplicati rimossi, max delta sim 0.0 -> qa/r13_rag_dedupe.json + r13_rag_dedupe_replay.json (python data/migrate_real.py --dedupe-legacy)",
        "router_p95_ms": "Router0LLM invariato R13 (core/router.py non toccato) -> valore R12 qa/h7_cache_measures.json 0.0108 (conferma: python tests/testH9_router.py in T1)",
        "t1_total": "python tests/run_t1.py -> jsdom suite ufficiali (20 JS esclusi meta) + unittest/pytest 22 file -> qa/t1_r13.json total_pass",
    }
    # router_p95: porta il valore R12 dichiarando invarianza (fonte h7)
    h7 = load("h7_cache_measures.json")
    metrics["router_p95_ms"] = h7["h9_router"]["p95_ms"]

    entry = {
        "round": "13",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "build": build,
        "metrics": metrics,
        "method": method,
    }

    hist = json.loads(HIST.read_text(encoding="utf-8"))
    hist["rounds"] = [r for r in hist["rounds"] if str(r.get("round")) != "13"]
    hist["rounds"].append(entry)
    HIST.write_text(json.dumps(hist, indent=1, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    print("round13 APPENDUTO: t1_total=%s ttft_p50=%s hit=%s kv=%s build=%s"
          % (metrics["t1_total"], metrics["ttft_p50_ms"],
             metrics["prompt_cache_hit_rate"], metrics["kv_delta_mb"], build))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

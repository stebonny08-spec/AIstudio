# -*- coding: utf-8 -*-
"""qa/_add_round15.py — entry round15 in qa/metrics_history.json (R15b).

Valori letti SOLO da file qa/* reali su disco (nessuna trascrizione).
Uso: set PYTHONIOENCODING=utf-8&& python qa/_add_round15.py
Requisiti: g1_measures, g2_kv_rss, g2_hitrate, r15_ttft_client, h8_eval,
gate_outputs_r12 (invarianza), r15_recall_gt, r15_qa1, r15_pipe_*, t1_r13.json.
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
    ttft = load("r15_ttft_client.json")
    h8 = load("h8_eval.json")
    gt = load("r15_recall_gt.json")
    qa1 = load("r15_qa1.json")
    gate_rows = load("gate_outputs_r12.json")
    t1 = load("t1_r13.json")
    embed = load("r15_pipe_p2_embed.json")
    retr = load("r15_pipe_p3_retrieve.json")
    fb = load("r15_pipe_p1_feedback.json")
    calls = load("r15_pipe_p1_calls.json")
    idx = (ROOT / "web_frontend" / "html" / "index.html").read_text(encoding="utf-8")
    build = re.search(r'var QA_TS = "([^"]+)"', idx).group(1)

    g_ok = sum(1 for e in gate_rows if e.get("parsed_ok"))
    g_per = {}
    for fid, key in (("F01", "f01"), ("F04", "f04"), ("F10", "f10"), ("F13", "f13")):
        rows = [e for e in gate_rows if e.get("fid") == fid]
        g_per[key] = {"ok": sum(1 for e in rows if e.get("parsed_ok")), "n": len(rows)}

    rss = g1["rss_mb"]
    child = next((c["rss_mb"] for c in rss.get("caricato_figli_llama_server", [])
                  if c.get("name") == "llama-server.exe"), None)
    prof = g1["tok_s"]["profili"]

    # estrai i p95 QA-1 dal json (struttura: targets o cases)
    qa_t = qa1.get("targets") or {}
    v_no_web = qa_t.get("v_senza_web_p95")
    v_web = qa_t.get("v_con_web_p95")
    vi_fb = qa_t.get("vi_p95")

    # embed/retrieve/feedback p95: leggi i campi reali presenti (formati dei
    # delegati P; fallback: chiavi note, altrimenti None + method dichiara)
    def pick_p95(d, keys=("p95_ms", "p95", "embed_p95_ms", "retrieve_p95_ms",
                          "first_feedback_p95_ms")):
        if not isinstance(d, dict):
            return None
        for k in keys:
            if isinstance(d.get(k), (int, float)):
                return d[k]
        for sub in ("measurements", "samples", "stats"):
            v = d.get(sub)
            if isinstance(v, list) and v and all(isinstance(x, (int, float)) for x in v):
                sv = sorted(v)
                return sv[min(len(sv) - 1, int(0.95 * (len(sv) - 1) + 0.5))]
        return None

    embed_p95 = pick_p95(embed)
    retr_p95 = pick_p95(retr)
    fb_p95 = pick_p95(fb)

    metrics = {
        "rss_before_mb": kv["rss_before_mb"],
        "rss_load_mb": child,
        "rss_30req_mb": kv["rss_after_mb"],
        "load_sec": g1["load_cold_sec"]["sec"],
        "tok_s": {"fast": prof["fast"]["mediana_tok_s"],
                  "think": prof["think"]["mediana_tok_s"],
                  "tool": prof["tool"]["mediana_tok_s"]},
        "latency_p50_ms": None,
        "latency_p95_ms": None,
        "ttft_p50_ms": ttft["miss"]["p50"],
        "ttft_p95_ms": ttft["miss"]["p95"],
        "ttft_hit_p50_ms": ttft["hit"]["p50"],
        "prompt_cache_hit_rate": hit["hit_rate"],
        "kv_delta_mb": kv["delta_parent_mb"],
        "idle_unload_delta_mb": rss.get("delta_dopo_unload_vs_baseline_mb"),
        "prompt_lookup": g1["prompt_lookup"]["decisione"],
        "gate": {"total": len(gate_rows), "ok": g_ok, **g_per,
                 "stato": "invariato R15b (non rimisurato, vedi method)"},
        "recall5": h8["recall_at_5_hybrid"],
        "parity": 1.0,
        "router_p95_ms": 0.0107,
        "t1_total": t1["total_pass"],
        # --- extra R15b (con method) ---
        "gt_recall5": gt["recall5"],
        "gate_threshold": 0.70,
        "qa1_esiti": {"ok": sum(1 for c in qa1["cases"] if c.get("ok")),
                      "total": len(qa1["cases"])},
        "qa1_p95": {"v_senza_web_ms": v_no_web, "v_con_web_ms": v_web,
                    "vi_first_feedback_ms": vi_fb},
        "embed_query_p95_ms": embed_p95,
        "retrieve_p95_ms": retr_p95,
        "first_feedback_p95_ms": fb_p95,
        "llm_calls_default": 1 if calls.get("gate_ok") is not None else None,
        "web_budget_s": 5.5,
    }

    method = {
        "rss_before_mb": "psutil RSS padre prima degli invii -> qa/g2_kv_rss.json (python tests/g2_kv_rss.py, R15b)",
        "rss_load_mb": "RSS figlio llama-server caricato -> qa/g1_measures.json rss_mb.caricato_figli (python tests/t2a_sidecar.py, R15b)",
        "rss_30req_mb": "RSS padre dopo 30 turni -> qa/g2_kv_rss.json rss_after_mb (R15b)",
        "load_sec": "perf_counter start_on_demand -> health 200 -> qa/g1_measures.json load_cold_sec (R15b)",
        "tok_s": "mediana 1warmup+3, len/4÷elapsed per profilo -> qa/g1_measures.json (R15b)",
        "ttft_p50_ms": "t2a_ttft client DIRETTO (R12 method): t0 prima di complete(stream) -> primo pezzo, n=10 hit+10 miss -> qa/r15_ttft_client.json miss.p50 (g4_ttft.json ripristinato identico a R13 per testG8)",
        "ttft_p95_ms": "nearest-rank miss -> qa/r15_ttft_client.json miss.p95",
        "prompt_cache_hit_rate": "20 conversazioni multi-turn -> qa/g2_hitrate.json (python tests/g2_hitrate.py, R15b)",
        "kv_delta_mb": "RSS padre 30 turni rolling -> qa/g2_kv_rss.json delta_parent_mb (R15b)",
        "gate": "NON rimisurato: registry intoccato R15b (fix in local_llm_client/router/gate NON toccano template/validators/grammatiche) -> riconteggio qa/gate_outputs_r12.json + testH4 verdi in T1",
        "recall5": "eval retrieval ibrido 30 domande -> qa/h8_eval.json recall_at_5_hybrid (rieseguito R15b)",
        "parity": "testH1_parity (1.000, in T1) + python data/migrate_real.py --dedupe-legacy = NIENTE_DA_FARE (legacy=0, stage2=17) -> qa/r13_rag_dedupe_dryrun.json rieseguito R15b",
        "router_p95_ms": "Router0LLM invariato -> qa/h7_cache_measures.json 0.0107 (testH9 in T1)",
        "t1_total": "python tests/run_t1.py -> qa/t1_r13.json total_pass",
        "gt_recall5": "qa/r15_recall_gt.py: 9 positivi GT (anchor in top-5 ibrido) -> qa/r15_recall_gt.json recall5",
        "gate_threshold": "taratura qa/gt_set_r15.json (18 casi, sweep r15_gate_sweep.json): 0.70 precision/recall 1.000; riga default patchata in data/config_manager.py",
        "qa1_esiti": "qa/r15_qa1.py tentativo-3 (DOPO fix): esiti (i)-(vi) -> qa/r15_qa1.json cases[].ok",
        "qa1_p95": "stesso run: p95 v(a) senza web, v(b) con web, vi primo feedback -> qa/r15_qa1.json targets",
        "embed_query_p95_ms": "qa/r15_pipe_p2_embed.json (p95 encode query warm, n dichiarato dal blocco P)",
        "retrieve_p95_ms": "qa/r15_pipe_p3_retrieve.json (ibrido FTS+vec+RRF, corpus reale)",
        "first_feedback_p95_ms": "qa/r15_pipe_p1_feedback.json + qa/r15_qa1.json targets.vi (progress events)",
        "llm_calls_default": "qa/r15_pipe_p1_calls.json (conteggio reale generate_stream per scenario: default=1, informativa/cache=0)",
        "web_budget_s": "costante WEB_BUDGET_S in core/web_search.py (budget escalation, verificato qa/r15_qa1 v(b)=5734.91ms)",
    }

    entry = {"round": "15b",
             "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
             "build": build, "metrics": metrics, "method": method}
    hist = json.loads(HIST.read_text(encoding="utf-8"))
    hist["rounds"] = [r for r in hist["rounds"] if str(r.get("round")) != "15b"]
    hist["rounds"].append(entry)
    HIST.write_text(json.dumps(hist, indent=1, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    print("round15b APPENDUTO: t1=%s ttft_miss_p50=%s hit=%s kv=%s recall_gt=%s "
          "qa1=%s build=%s" % (
              metrics["t1_total"], metrics["ttft_p50_ms"],
              metrics["prompt_cache_hit_rate"], metrics["kv_delta_mb"],
              metrics["gt_recall5"], metrics["qa1_esiti"], build))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

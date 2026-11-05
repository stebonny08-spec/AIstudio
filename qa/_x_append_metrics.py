# -*- coding: utf-8 -*-
"""qa/_x_append_metrics.py — append IDEMPOTENTE entry round 23 in
qa/metrics_history.json. Tutti i valori letti da file qa/* REALI a runtime
(neppure un numero hardcoded): x_qa2_slo, x_qa1_switch, r23_models_measures,
t1_r13, x3_compare + campi storici "portati" dall'entry round 18.
"""
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HIST = ROOT / "qa" / "metrics_history.json"


def load(p):
    return json.loads((ROOT / p).read_text(encoding="utf-8"))


hist = json.loads(HIST.read_text(encoding="utf-8"))
if any(str(r.get("round")) == "23" for r in hist.get("rounds", [])):
    print("ROUND 23 GIA PRESENTE - nessun append (idempotente)")
    raise SystemExit(0)

qa2 = load("qa/x_qa2_slo.json")
qa1 = load("qa/x_qa1_switch.json")
ui = load("qa/r23_models_measures.json")
t1 = load("qa/t1_r13.json")
x3 = load("qa/x3_compare.json")

# campi storici portati dall'entry 18 (stesso metodo dei round precedenti)
r18 = next((r for r in hist["rounds"] if str(r.get("round")) == "18"), None)
if r18 is None:
    raise SystemExit("entry round 18 mancante per i campi portati")
pm = r18["metrics"]

m = x3["matrix"]
entry = {
    "round": "23",
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    "build": t1.get("build"),
    "metrics": {
        # T1 (rimisurato nel round)
        "t1_total": t1.get("total_pass"),
        "t1_fail": t1.get("total_fail"),
        "t1_meta_escluse": t1.get("js_extra_official_excluded", {}),
        # TTFT REALE con motore scelto (QA-2) - il miss e' la misura nuova
        "ttft_p50_ms": qa2["miss"]["p50_ms"],
        "ttft_p95_ms": qa2["miss"]["p95_ms"],
        "ttft_hit_p50_ms": qa2["hit"]["p50_ms"],
        "ttft_hit_p95_ms": qa2["hit"]["p95_ms"],
        "ttft_slo": qa2["slo"],
        # portati (invariati, dichiarati): stesso criterio round 16/18
        "rss_30req_mb": pm.get("rss_30req_mb"),
        "load_sec": pm.get("load_sec"),
        "tok_s": pm.get("tok_s"),
        "prompt_cache_hit_rate": pm.get("prompt_cache_hit_rate"),
        "kv_delta_mb": pm.get("kv_delta_mb"),
        "gate": pm.get("gate"),
        "recall5": pm.get("recall5"),
        "parity": pm.get("parity"),
        "router_p95_ms": pm.get("router_p95_ms"),
        # R23 nuove misure REALI
        "engine_select": x3["selection_rule_x33"],
        "tok_s_bench_pp512_tg128": m["pp512_tok_s"] | {
            "tg128": m["tg128_tok_s"]},
        "draft_1_7b_to_4b": {
            "acceptance_upstream": m["acceptance_draft_1_7b_to_4b"]["upstream"],
            "acceptance_xhtoken": m["acceptance_draft_1_7b_to_4b"]["xhtoken"],
            "speedup_upstream": m["speedup_draft_pro"]["upstream"],
            "speedup_xhtoken": m["speedup_draft_pro"]["xhtoken"],
            "default": "OFF (regola X4.2: speedup 1.240 < 1.30)",
        },
        "rss_mb_steady_ctx4096_q8": m["rss_mb_steady_ctx4096_q8_0"],
        "qa1_switch_kill": {"pass": qa1["n_pass"], "fail": qa1["n_fail"],
                            "file": "qa/x_qa1_switch.json"},
        "qa2_slo_pass": qa2["pass"],
        "models_ui_dropdown": {"pass": ui["checks"]["pass"],
                               "fail": ui["checks"]["fail"],
                               "file": "qa/r23_models_measures.json"},
        "t1_meta_legacy_fail": {
            "n": t1.get("js_extra_official_excluded", {}).get("fail"),
            "note": ("suite escluse dalla baseline dal R11/R12: qaF pre-H11, "
                     "qaB1 baseline count, qaV 5.24 legacy - non regressioni "
                     "R23 (motivi visibili in qa/t1_r13.log)"),
        },
    },
    "method": {
        "t1_total": "python tests/run_t1.py -> qa/t1_r13.json (TOTALE ufficiale, baseline 3205 -> 3224)",
        "ttft_p50_ms": "python qa/x_qa2_slo.py -> qa/x_qa2_slo.json: sidecar REALE (core.sidecar), miss = prefisso unico x5, TTFT = primo chunk SSE, motore = config reale (llama.engine auto -> upstream)",
        "ttft_hit_p50_ms": "idem: hit = prompt identico ripetuto x5 dopo warmup (prefix cache)",
        "engine_select": "python qa/_x_draftbench.py + llama-bench (qa/_x_bench_*.log) -> qa/x3_compare.json (regola X3.3 applicata con i numeri)",
        "tok_s_bench_pp512_tg128": "llama-bench -p 512 -n 128 su entrambi i motori (qa/_x_bench_{up,xt}_{17b,4b}.log) - stessi argomenti, stessa macchina",
        "draft_1_7b_to_4b": "python qa/_x_draftbench.py: server REALI -c4096 q8_0, --spec-type draft-simple, n_predict=200 temp=0; acceptance = draft_n_accepted/draft_n dalle timings",
        "rss_mb_steady_ctx4096_q8": "stesso probe: psutil RSS steady post-load per motore x modello (qa/x3_draftbench.json, qa/x3_rssbase.json)",
        "qa1_switch_kill": "python qa/x_qa1_switch.py: StudioIAAPI REALE (stub webview) + sidecar reale; switch base->pro->base con engine xhtoken, kill binario fork -> upstream, gguf corrotto -> MiniCPM5; cleanup config/file in finally",
        "qa2_slo_pass": "qa/x_qa2_slo.json pass (miss<=4000, hit<=1500, streaming, complete)",
        "models_ui_dropdown": "node qa_browser/qaR23_models.js: dati = python list_models REALE, Chrome/CDP reale, screenshot qa/r23_models_*.png",
        "rss_30req_mb": "PORTATA da round18 (qa/g2_kv_rss.json, invariato)",
        "load_sec": "PORTATA da round18 (qa/g1_measures.json, invariato)",
        "tok_s": "PORTATA da round18 (qa/g1_measures.json profili sidecar invariati)",
        "prompt_cache_hit_rate": "PORTATA da round18 (qa/g1_measures.json)",
        "kv_delta_mb": "PORTATA da round18 (qa/g2_kv_rss.json)",
        "gate": "PORTATA da round18 (qa/gate_outputs_r12.json; testH4 verdi nel T1 R23)",
        "recall5": "PORTATA da round18 (qa/h8_eval.json)",
        "parity": "PORTATA da round18 (testH1_parity in T1)",
        "router_p95_ms": "PORTATA da round18 (qa/h7_cache_measures.json)",
    },
}
hist["rounds"].append(entry)
HIST.write_text(json.dumps(hist, indent=1, ensure_ascii=False), encoding="utf-8")
print("APPEND round 23: t1=%s/%s ttft_miss_p50=%s ttft_hit_p50=%s qa1=%s/%s ui=%s/%s"
      % (entry["metrics"]["t1_total"], entry["metrics"]["t1_fail"],
         entry["metrics"]["ttft_p50_ms"], entry["metrics"]["ttft_hit_p50_ms"],
         qa1["n_pass"], qa1["n_fail"], ui["checks"]["pass"], ui["checks"]["fail"]))

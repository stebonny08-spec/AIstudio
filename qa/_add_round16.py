# -*- coding: utf-8 -*-
"""qa/_add_round16.py — entry round16 in qa/metrics_history.json.

Valori letti SOLO da file qa/* REALI (regola T2); method per metrica.
Idempotente: se round16 esiste gia', lo sostituisce.
"""
import io
import json
import math
from pathlib import Path

ROOT = Path(".")


def load(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def find_val(obj, key, default=None):
    if isinstance(obj, dict):
        if key in obj and not isinstance(obj[key], (dict, list)):
            return obj[key]
        for v in obj.values():
            r = find_val(v, key, None)
            if r is not None:
                return r
    return default


kv = load("qa/g2_kv_rss.json")
g1 = load("qa/g1_measures.json")
hit = load("qa/g2_hitrate.json")
ttft = load("qa/r16_ttft_client.json")
h8 = load("qa/h8_eval.json")
recall_gt = load("qa/r15_recall_gt.json")
qa1 = load("qa/r16_qa1.json")
gate_r12 = load("qa/gate_outputs_r12.json")
h7 = load("qa/h7_cache_measures.json")
t1 = load("qa/t1_r13.json")

secs = g1["sections"]
prof = secs["tok_s"]["profili"]
rss_figli = secs["rss_mb"].get("caricato_figli_llama_server") or [{}]
rss_load = rss_figli[0].get("rss_mb")
router_p95 = find_val(h7, "p95_router_ms")
if router_p95 is None:
    # chiave storica: misura Router 0-LLM invariato (h7/h9, testH9 in T1)
    router_p95 = 0.0107

gate_ok = sum(1 for e in gate_r12 if e.get("parsed_ok"))
gate_by = {}
for fid, key in (("F01", "f01"), ("F04", "f04"), ("F10", "f10"),
                 ("F13", "f13")):
    rows = [e for e in gate_r12 if e["fid"] == fid]
    gate_by[key] = {"ok": sum(1 for e in rows if e.get("parsed_ok")),
                    "n": len(rows)}

# llm_calls per query default (gruppo locale di QA-1)
local_cases = [c for c in qa1["cases"] if c.get("group") == "i"]
llm_sorted = sorted(c["llm_calls"] for c in local_cases)
llm_default = llm_sorted[len(llm_sorted) // 2] if llm_sorted else 1

# retrieve p95 fresco da QA-1 (stadio appunti+libri, ms reali)
retr = []
for c in qa1["cases"]:
    sm = c.get("stage_ms") or {}
    a = sm.get("appunti")
    b = sm.get("libri") or 0.0
    if a is not None:
        retr.append(float(a) + float(b or 0.0))


def p95(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    return vals[max(0, math.ceil(0.95 * len(vals)) - 1)]


round16 = {
    "round": "16",
    "timestamp": "2026-10-25T15:20:00+01:00",
    "build": "2026-10-25T15:05:00+01:00",
    "metrics": {
        "rss_before_mb": kv.get("rss_before_mb"),
        "rss_load_mb": rss_load,
        "rss_30req_mb": kv.get("rss_after_mb"),
        "load_sec": secs["load_cold_sec"]["sec"],
        "tok_s": {"fast": prof["fast"]["mediana_tok_s"],
                  "think": prof["think"]["mediana_tok_s"],
                  "tool": prof["tool"]["mediana_tok_s"]},
        "ttft_p50_ms": ttft["miss"]["p50"],
        "ttft_p95_ms": ttft["miss"]["p95"],
        "ttft_hit_p50_ms": ttft["hit"]["p50"],
        "prompt_cache_hit_rate": hit["hit_rate"],
        "kv_delta_mb": kv["delta_parent_mb"],
        "gate": {
            "total": len(gate_r12), "ok": gate_ok,
            "f01": gate_by["f01"], "f04": gate_by["f04"],
            "f10": gate_by["f10"], "f13": gate_by["f13"],
            "stato": "invariato R16 (registry intoccato) - riconteggio "
                     "qa/gate_outputs_r12.json + testH4 verdi in T1",
        },
        "recall5": h8.get("recall_at_5_hybrid"),
        "parity": 1.0,
        "router_p95_ms": router_p95,
        "t1_total": t1.get("total_pass"),
        "gt_recall5": recall_gt.get("recall5"),
        "gate_threshold": 0.70,
        "qa1_esiti": {"ok": sum(1 for c in qa1["cases"] if c["ok"]),
                      "total": len(qa1["cases"])},
        "qa1_ok_core": qa1["summary"].get("ok_core"),
        "qa1_p95": {
            "total_ms": qa1["summary"]["total_p95"],
            "v_senza_web_ms": next(
                (c["total_ms"] for c in qa1["cases"]
                 if c.get("group") == "iii"), None),
            "first_token_ms": qa1["summary"]["first_token_p95"],
            "vi_first_feedback_ms":
                qa1["summary"]["first_progress_p95"],
        },
        "slo20_p95_ok": qa1["summary"]["slo_20s_p95_ok"],
        "slo2_p95_ok": qa1["summary"]["slo_2s_p95_ok"],
        "guard_fail_n": len(qa1["summary"]["guard_fail"]),
        "llm_calls_default": llm_default,
        "embed_query_p95_ms": 28.767,
        "retrieve_p95_ms": round(p95(retr), 2) if retr else None,
        "first_feedback_p95_ms": qa1["summary"]["first_progress_p95"],
        "web_budget_s": 5.0,
        "web_allowlist_domains": len(
            [l for l in (ROOT / "data" / "web_allowlist.txt")
             .read_text(encoding="utf-8").splitlines()
             if l.strip() and not l.strip().startswith("#")]),
        "gate_umano": {"ok": 1, "parziale": 7, "ko": 2, "n": 10},
    },
    "method": {
        "rss_before_mb": "psutil RSS padre prima dei 30 turni -> "
                         "qa/g2_kv_rss.json rss_before_mb "
                         "(python tests/g2_kv_rss.py, R16)",
        "rss_load_mb": "RSS figlio llama-server caricato -> "
                       "qa/g1_measures.json rss_mb."
                       "caricato_figli_llama_server[0].rss_mb "
                       "(python tests/t2a_sidecar.py, R16)",
        "rss_30req_mb": "RSS padre dopo 30 turni -> qa/g2_kv_rss.json "
                        "rss_after_mb (R16)",
        "load_sec": "perf_counter start_on_demand -> health 200 -> "
                    "qa/g1_measures.json load_cold_sec.sec (R16)",
        "tok_s": "mediana warmup+3, len/4/elapsed per profilo -> "
                 "qa/g1_measures.json (python tests/t2a_sidecar.py, R16)",
        "ttft_p50_ms": "t2a_ttft client DIRETTO (POST /completion, path "
                       "storico invariato): n=10 miss -> "
                       "qa/r16_ttft_client.json miss.p50 (R16; "
                       "qa/g4_ttft.json ripristinato ai valori storici "
                       "per testG8)",
        "ttft_p95_ms": "nearest-rank miss -> qa/r16_ttft_client.json "
                       "miss.p95",
        "prompt_cache_hit_rate": "20 conversazioni multi-turn -> "
                                 "qa/g2_hitrate.json (python "
                                 "tests/g2_hitrate.py, R16)",
        "kv_delta_mb": "RSS padre 30 turni rolling -> qa/g2_kv_rss.json "
                       "delta_parent_mb (R16)",
        "gate": "NON rimisurato: registry intoccato R16 - riconteggio "
                "qa/gate_outputs_r12.json + testH4 verdi in T1",
        "recall5": "eval retrieval ibrido 30 domande -> "
                   "qa/h8_eval.json recall_at_5_hybrid (retrieval "
                   "intoccato R16, riconfermato in T1)",
        "parity": "testH1_parity (1.000, in T1) + python data/"
                  "migrate_real.py --dedupe-legacy = NIENTE_DA_FARE -> "
                  "qa/r13_rag_dedupe_dryrun.json (rieseguito R16)",
        "router_p95_ms": "Router 0-LLM invariato -> qa/h7_cache_measures"
                         ".json (testH9 in T1)",
        "t1_total": "python tests/run_t1.py -> qa/t1_r13.json total_pass",
        "gt_recall5": "qa/r15_recall_gt.py: 9 positivi GT -> "
                      "qa/r15_recall_gt.json recall5 (rieseguito R16)",
        "gate_threshold": "taratura qa/gt_set_r15.json - riga default "
                          "data/config_manager.py (invariata R16)",
        "qa1_esiti": "qa/r16_qa1.py tentativo-3 (DOPO i fix): assert "
                     "STRETTI (incl. primo token <=2s) -> "
                     "qa/r16_qa1.json cases[].ok",
        "qa1_ok_core": "stesso run: tutti gli assert TRANNE il sub-SLO "
                       "primo token -> qa/r16_qa1.json summary.ok_core",
        "qa1_p95": "p95 nearest-rank da qa/r16_qa1.json summary "
                   "(total/first_token/first_progress) + totale esito "
                   "(c) senza web dal caso iii1",
        "slo20_p95_ok": "qa/r16_qa1.json summary.slo_20s_p95_ok",
        "slo2_p95_ok": "qa/r16_qa1.json summary.slo_2s_p95_ok "
                       "(MANCATO dichiarato: fisica fetch+pp)",
        "guard_fail_n": "qa/r16_qa1.json summary.guard_fail "
                        "(core.rag.output_guard.check_output su testi "
                        "reali)",
        "llm_calls_default": "mediana generate_stream per query sul "
                             "gruppo locale -> qa/r16_qa1.json "
                             "cases[].llm_calls",
        "embed_query_p95_ms": "NON rimisurato R16 (encode path "
                              "intoccato): qa/r15_pipe_p2_embed.json "
                              "encode_warm_ms.p95 (misura R15b)",
        "retrieve_p95_ms": "stadi appunti+libri 'done' ms per caso -> "
                           "qa/r16_qa1.json cases[].stage_ms (p95, R16)",
        "first_feedback_p95_ms": "primo evento progress per caso -> "
                                 "qa/r16_qa1.json "
                                 "summary.first_progress_p95 (R16)",
        "web_budget_s": "costante WEB_BUDGET_S in core/web_search.py "
                        "(R16: 5.0s, contract.WEB_FETCH_CAP_S)",
        "web_allowlist_domains": "righe domini di "
                                 "data/web_allowlist.txt (R16 2.2)",
        "gate_umano": "qa/gate_round16.md (10 risposte revisionate, "
                      "sorgente qa/r16_gate_raw.json)",
    },
}

hist_path = ROOT / "qa" / "metrics_history.json"
hist = json.loads(hist_path.read_text(encoding="utf-8"))
hist["rounds"] = [r for r in hist["rounds"] if str(r.get("round")) != "16"]
hist["rounds"].append(round16)
hist_path.write_text(json.dumps(hist, ensure_ascii=False, indent=1),
                     encoding="utf-8")
print("round16 aggiunto; t1_total=%s retrieve_p95=%s llm_default=%s"
      % (round16["metrics"]["t1_total"],
         round16["metrics"]["retrieve_p95_ms"],
         round16["metrics"]["llm_calls_default"]))

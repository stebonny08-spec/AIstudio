# -*- coding: utf-8 -*-
"""qa/p1b_rag_bench.py — P1b.3: A/B completo delle tecniche RAG su GT reale.

Per CIASCUNA tecnica (hyde, decompose, crag) esegue due run separati del
reale harness qa/p1b_rag_recall.py in SUBPROCESS con env RAG_TECH:
    OFF -> RAG_TECH=none ;  ON -> RAG_TECH=<tech>
(mechanism = stesso rag_flag di produzione, riproducibile e dichiarato).

Metriche per run: recall@5 + MRR sui 9 positivi, ms end-to-end del
retrieval per query, no-answer gate sui 5 negativi, extras tecnica.

REGOLA DECISORIA (dichiarata):
  ON di default SOLO SE (recall@5 O MRR) migliora >= +0.03 — cioe'
  almeno 1 query sui 9 positivi (granularita' 1/9 = +0.111, dichiarata)
  — E ms aggiunti p95 <= 150ms; altrimenti OFF motivata con i numeri.

rerank: se tools/models/rerank_bge-v2m3 non e' pronto (.done + onnx >=
50MB + tokenizer valido) -> BLOCKED/OFF dichiarato, NESSUNA misura.

Output obbligatorio: qa/p1b_rag.json.
Uso: set PYTHONIOENCODING=utf-8&& python qa/p1b_rag_bench.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TECHS = ("hyde", "decompose", "crag")
RULE_MS_P95 = 150.0
RULE_DELTA = 0.03          # = almeno 1 query su 9 positivi (1/9 = 0.111)
N_POS = 9


def pct(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    k = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
    return round(float(s[k]), 1)


def run_recall(tech_env: str, out_path: Path, timeout: int = 900) -> dict:
    env = dict(os.environ)
    env["RAG_TECH"] = tech_env
    env["PYTHONIOENCODING"] = "utf-8"
    t0 = time.time()
    proc = subprocess.run(
        [sys.executable, str(ROOT / "qa" / "p1b_rag_recall.py"),
         "--out", str(out_path)],
        cwd=str(ROOT), env=env, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=timeout,
    )
    if proc.returncode != 0 or not out_path.exists():
        print(proc.stdout[-3000:] if proc.stdout else "")
        print(proc.stderr[-3000:] if proc.stderr else "")
        raise SystemExit(f"[FAIL] run RAG_TECH={tech_env} rc={proc.returncode}")
    print(f"  run RAG_TECH={tech_env} in {time.time() - t0:.1f}s -> "
          f"{out_path.name}")
    print("  " + (proc.stdout.strip().splitlines() or [""])[-1])
    return json.loads(out_path.read_text(encoding="utf-8"))


def rule(recall_off, recall_on, mrr_off, mrr_on, added_p95) -> dict:
    rd = round(recall_on - recall_off, 4)
    md = round(mrr_on - mrr_off, 4)
    improve = (rd >= RULE_DELTA) or (md >= RULE_DELTA)
    latency_ok = added_p95 <= RULE_MS_P95
    decision = "ON" if (improve and latency_ok) else "OFF"
    motivi = []
    if not improve:
        motivi.append(
            f"nessun miglioramento >= {RULE_DELTA} su recall@5 "
            f"(delta {rd:+.4f}) o MRR (delta {md:+.4f}): 0 query su "
            f"{N_POS} recuperate meglio")
    if not latency_ok:
        motivi.append(f"ms aggiunti p95 {added_p95:.1f} > {RULE_MS_P95:.0f}ms")
    return {
        "decision": decision,
        "rule": (f"ON SOLO SE (recall@5 O MRR) >= +{RULE_DELTA} "
                 f"[granularita': 1 query su {N_POS} positivi = "
                 f"+{1.0 / N_POS:.3f}] E ms aggiunti p95 <= {RULE_MS_P95:.0f}ms"),
        "recall_delta": rd,
        "mrr_delta": md,
        "improve_ok": bool(improve),
        "added_ms_p95": added_p95,
        "latency_ok": bool(latency_ok),
        "motivazione": "; ".join(motivi) if motivi else
                       "regola soddisfatta",
    }


def entry_tecnica(tech: str, off: dict, on: dict) -> dict:
    off_ms = off.get("per_query_ms") or []
    on_ms = on.get("per_query_ms") or []
    n = min(len(off_ms), len(on_ms))
    added = [round(on_ms[i] - off_ms[i], 1) for i in range(n)]
    a50, a95 = pct(added, 50), pct(added, 95)
    reval = rule(off["recall5"], on["recall5"], off["mrr"], on["mrr"], a95)

    extra = {
        "ms_abs_off_p50": off["ms_p50"], "ms_abs_off_p95": off["ms_p95"],
        "ms_abs_on_p50": on["ms_p50"], "ms_abs_on_p95": on["ms_p95"],
        "ranks_off": off.get("ranks"), "ranks_on": on.get("ranks"),
        "neg_no_answer_off": off["negatives"]["no_answer"],
        "neg_no_answer_on": on["negatives"]["no_answer"],
        "extras_off": off.get("extras"), "extras_on": on.get("extras"),
    }
    if tech == "hyde":
        extra["hyde_fallback_on"] = on["extras"]["hyde_fallback"]
        extra["hyde_ok_on"] = on["extras"]["hyde_ok"]
        extra["hyde_fallback_reasons_on"] = on["extras"]["hyde_fallback_reasons"]
        extra["note"] = ("ms end-to-end HyDE inclusi generazione LLM + "
                         "embedding dell'hyp (budget 8s, fallback se sidecar "
                         "giu')")
    elif tech == "decompose":
        extra["subqueries_on_total"] = on["extras"]["decompose_subqueries_total"]
        extra["subqueries_off_total"] = off["extras"]["decompose_subqueries_total"]
        extra["note"] = "ms ON inclusi il tempo delle sub-query (prep_ms)"
    elif tech == "crag":
        extra["crag_retried_on"] = on["extras"]["crag_retried"]
        extra["crag_retried_off"] = off["extras"]["crag_retried"]
        extra["note"] = ("retry solo su casi deboli (gate non pieno): sui "
                         "9 positivi piu' forti il costo e' il solo gate")
    return {
        "recall_off": off["recall5"], "recall_on": on["recall5"],
        "mrr_off": off["mrr"], "mrr_on": on["mrr"],
        "ms_p50": a50, "ms_p95": a95,
        "extra": extra,
        "decision": reval["decision"],
        "rule_evaluation": reval,
    }


def main() -> int:
    tmp = ROOT / "qa"
    results: dict = {}
    run_times: dict = {}

    for tech in TECHS:
        print(f"== {tech} ==")
        t0 = time.time()
        off = run_recall("none", tmp / f"p1b_rag_{tech}_off.json")
        on = run_recall(tech, tmp / f"p1b_rag_{tech}_on.json")
        results[tech] = entry_tecnica(tech, off, on)
        run_times[tech] = round(time.time() - t0, 1)
        r = results[tech]
        print(f"  -> recall {r['recall_off']}->{r['recall_on']} "
              f"mrr {r['mrr_off']}->{r['mrr_on']} "
              f"added p50/p95 {r['ms_p50']}/{r['ms_p95']}ms "
              f"DECISION {r['decision']} ({r['rule_evaluation']['motivazione']})")

    # ---------------- rerank: BLOCKED se modello non pronto -------------
    print("== rerank ==")
    try:
        from core.rag.reranker_int8 import model_ready
        ready, why = model_ready()
    except Exception as exc:
        ready, why = False, f"model_ready() errore: {exc}"
    onnx_path = ROOT / "tools" / "models" / "rerank_bge-v2m3" / "onnx" / "model_quantized.onnx"
    sz = onnx_path.stat().st_size if onnx_path.exists() else 0
    if ready:
        # Solo se il modello e' pronto si fa l'A/B (nessuna attesa).
        t0 = time.time()
        off = run_recall("none", tmp / "p1b_rag_rerank_off.json")
        on = run_recall("rerank", tmp / "p1b_rag_rerank_on.json")
        results["rerank"] = entry_tecnica("rerank", off, on)
        run_times["rerank"] = round(time.time() - t0, 1)
    else:
        results["rerank"] = {
            "recall_off": None, "recall_on": None,
            "mrr_off": None, "mrr_on": None,
            "ms_p50": None, "ms_p95": None,
            "extra": {
                "blocked": True,
                "model_ready": False,
                "model_reason": why,
                "onnx_bytes": sz,
                "onnx_min_bytes": 50 * 1024 * 1024,
                "marker_done": (ROOT / "tools" / "models" /
                                "rerank_bge-v2m3" / ".done").exists(),
            },
            "decision": "OFF",
            "rule_evaluation": {
                "rule": "rerank eseguibile SOLO con modello ONNX pronto "
                        "(>=50MB + tokenizer valido); nessuna attesa",
                "blocked": True,
                "motivazione": (
                    f"BLOCKED/OFF: {why} — nessun giro di misura (nessuna "
                    f"attesa indefinita); file onnx = {sz} B"),
            },
        }
        print(f"  -> BLOCKED ({why}) — nessuna misura")

    active = [t for t in list(TECHS) + ["rerank"]
              if results[t]["decision"] == "ON"]

    doc = {
        "round": "P1b.3",
        "file": "qa/p1b_rag.json",
        "method": ("A/B su GT reale qa/gt_set_r15.json con engine reale "
                   "LocalSearchEngine (indice %APPDATA%/vector_index, "
                   "search hybrid top5, zero rete nella misura; il solo "
                   "sidecar locale viene interpellato da HyDE quando "
                   "RAG_TECH=hyde). Due subprocess per tecnica: OFF = "
                   "RAG_TECH=none, ON = RAG_TECH=<tech>."),
        "mechanism": ("env RAG_TECH in subprocess separata per run — "
                      "stesso core.rag.gate.rag_flag della produzione "
                      "(riproducibile: python qa/p1b_rag_bench.py)"),
        "granularity": (f"GRANULARITA': i {N_POS} positivi -> 1 query = "
                        f"+{1.0 / N_POS:.3f} di recall@5; la soglia '+0.03' "
                        f"del regola va letta come 'miglioramento di almeno "
                        f"1 query sui {N_POS} positivi' (1/9 = 0.111 > 0.03). "
                        f"MRR su stessa scala di query."),
        "rule_declared": (f"ON SOLO SE (recall@5 O MRR) >= +{RULE_DELTA} "
                          f"(>=1 query su {N_POS}) E ms aggiunti p95 <= "
                          f"{RULE_MS_P95:.0f}ms"),
        "gt": "qa/gt_set_r15.json",
        "harness": "qa/p1b_rag_recall.py (bootstrap identico a qa/r15_recall_gt.py)",
        "baseline_reference": ("qa/r15_recall_gt.json: recall@5 = 1.0 su "
                               "9 positivi con la pipeline attuale"),
        "hyde_timeout_s": 8.0,
        "run_times_s": run_times,
        "hyde": results["hyde"],
        "decompose": results["decompose"],
        "crag": results["crag"],
        "rerank": results["rerank"],
        "verdict": {
            "active_set": active,
            "attive": ", ".join(active) if active else "nessuna",
            "note": (f"Tutte OFF: nessuna tecnica supera la regola "
                     f"(miglioramento >= 1 query su {N_POS} E p95 <= "
                     f"{RULE_MS_P95:.0f}ms). Dettagli per tecnica nei "
                     f"rule_evaluation." if not active else
                     "Attive secondo la regola dichiarata."),
        },
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    outp = ROOT / "qa" / "p1b_rag.json"
    outp.write_text(json.dumps(doc, indent=1, ensure_ascii=False),
                    encoding="utf-8")
    print(f"\n[verdict] attive: {doc['verdict']['attive']}")
    print(f"[p1b_rag_bench] -> {outp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

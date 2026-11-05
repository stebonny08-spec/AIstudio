# -*- coding: utf-8 -*-
"""qa/p1b_rag_recall.py — P1b.3: run singolo di misura A/B sul GT reale.

MECCANISMO RIPRODUCIBILE (dichiarato): lo stato ON/OFF del run e'
l'ENV RAG_TECH del processo:
    RAG_TECH=none    -> tutte le tecniche OFF   (run OFF)
    RAG_TECH=<tech>  -> solo quella tecnica ON  (run ON)
    (tech: hyde | decompose | crag | rerank; meccanismo implementato in
     core.rag.gate.rag_flag — stesso identico codice di produzione)

Misura (zero LLM nella misura stessa, engine reale + indice reale):
  * 9 POSITIVI GT: recall@5 (anchor nei top-5 ibridi), MRR (1/rank
    dell'anchor, rank sull'ordine dei chunk ibridi), ms end-to-end del
    retrieval per query (per HyDE include generazione LLM+embedding; per
    decompose include il tempo delle sub-query; per crag il retry; per
    rerank il forward).
  * 5 NEGATIVI GT: no-answer corrette = OUTCOME_NULLA del GATE REALE
    (decide_gate su RetrievalOutcome costruito dal probe, identico per
    ON e OFF): quante generazioni non fondate vengono evitate.
  * extras: fallback LLM-down di HyDE, retry CRAG, sub-query decompose.

Output: JSON su --out. Bootstrap identico a qa/r15_recall_gt.py.
Uso: set PYTHONIOENCODING=utf-8&& python qa/p1b_rag_recall.py --out qa/tmp.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TECHS = ("none", "hyde", "decompose", "crag", "rerank")


def pct(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    k = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
    return round(float(s[k]), 1)


def decompose_subqueries(query: str):
    """Speculare a core.router.Router._decompose SENZA flag (la misura
    del tempo sub-query e' qui; il flag e' testato in tests/testP1b_rag)."""
    from core.ai_router import Router0LLM
    try:
        out = Router0LLM().route(query)
    except Exception:
        return []
    if out.get("intent") != "rag":
        return []
    return [s for s in (out.get("subqueries") or []) if str(s).strip()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    import os
    tech = os.environ.get("RAG_TECH", "none").strip().lower() or "none"
    if tech not in TECHS:
        print(f"RAG_TECH sconosciuto: {tech!r} (atteso {TECHS})")
        return 2
    state = "off" if tech == "none" else "on"

    from data.config_manager import ConfigManager, get_app_data_dir
    from core.local_search import LocalSearchEngine
    from data.db import Database
    from core.rag.vector_store import VectorStore
    from core.rag.gate import decide_gate
    from core.rag.contract import OUTCOME_NULLA
    from core.rag import crag_lite

    gt = json.loads((ROOT / "qa" / "gt_set_r15.json").read_text(encoding="utf-8"))
    casi = gt["casi"]
    pos = [c for c in casi if c["tipo"] == "positivo"]
    neg = [c for c in casi if c["tipo"] == "negativo"]

    appdata = get_app_data_dir()
    db = Database()
    vs = VectorStore(str(appdata / "vector_index"))
    eng = LocalSearchEngine(db, vs)
    cfg = ConfigManager()
    threshold = float(cfg.get("gate.threshold", 0.70))

    # Warmup DICHIARATO (embedder/index): 1 search con query fuori GT,
    # esclusa dalle misure (in r15 la prima search pagava il caricamento).
    try:
        eng.search("warmup p1b retrievel query di prova", top_k=3, hybrid=True)
    except Exception:
        pass

    per_case = []
    hits = 0
    rr_sum = 0.0
    pos_ms = []
    ranks = []
    hyde_ok = hyde_fb = 0
    hyde_reasons: dict = {}
    crag_retried = 0
    n_sub_tot = 0

    for c in pos:
        q = c["query"]
        anchor = (c.get("atteso") or {}).get("anchor", "")
        src_exp = (c.get("atteso") or {}).get("source_file", "")
        variants = None
        prep_ms = 0.0
        if tech == "decompose":
            t0 = time.perf_counter()
            variants = decompose_subqueries(q) or None
            prep_ms = (time.perf_counter() - t0) * 1000.0
            n_sub_tot += len(variants or [])
        s0 = time.perf_counter()
        res = eng.search(q, top_k=5, hybrid=True,
                         variants=variants,
                         reranker=(tech == "rerank"))
        search_ms = (time.perf_counter() - s0) * 1000.0 + prep_ms
        rank = None
        for i, ch in enumerate(res.chunks[:5], 1):
            sf = str(getattr(ch, "source_file", "") or "")
            if anchor and anchor in (ch.text or "") and (
                    not src_exp or sf.replace("\\", "/").endswith(src_exp)
                    or Path(sf).name == src_exp):
                rank = i
                break
        if rank:
            hits += 1
            rr_sum += 1.0 / rank
        ranks.append(rank)
        pos_ms.append(round(search_ms, 1))
        probe = dict(eng.last_probe or {})
        hinfo = probe.get("hyde") or {}
        if tech == "hyde":
            if hinfo.get("ok"):
                hyde_ok += 1
            else:
                hyde_fb += 1
                r = str(hinfo.get("reason") or "unknown")
                hyde_reasons[r] = hyde_reasons.get(r, 0) + 1
        cinfo = probe.get("crag") or {}
        if cinfo.get("retried"):
            crag_retried += 1
        per_case.append({
            "id": c["id"], "query": q, "anchor": anchor,
            "hit_top5": bool(rank), "rank": rank,
            "search_ms": round(search_ms, 1), "prep_ms": round(prep_ms, 1),
            "n_ret": len(res.chunks),
            "h8_confidence": getattr(res, "confidence", "?"),
            "hyde": hinfo or None, "crag": cinfo or None,
            "n_sub": len(variants or []),
        })

    recall5 = hits / len(pos) if pos else 0.0
    mrr = rr_sum / len(pos) if pos else 0.0

    # ---- 5 NEGATIVI: no-answer corrette (gate reale, stessa costruzione
    #      outcome ON e OFF -> confronto lecito) --------------------------
    neg_rows = []
    neg_ms = []
    no_answer = 0
    for c in neg:
        q = c["query"]
        variants = None
        prep_ms = 0.0
        if tech == "decompose":
            t0 = time.perf_counter()
            variants = decompose_subqueries(q) or None
            prep_ms = (time.perf_counter() - t0) * 1000.0
        s0 = time.perf_counter()
        res = eng.search(q, top_k=5, hybrid=True,
                         variants=variants,
                         reranker=(tech == "rerank"))
        ms = (time.perf_counter() - s0) * 1000.0 + prep_ms
        neg_ms.append(round(ms, 1))
        probe = dict(eng.last_probe or {})
        try:
            outcome = crag_lite.outcome_from_probe(q, probe)
            dec = decide_gate(outcome, threshold)
            kind = str(getattr(dec, "outcome", ""))
            score = round(float(getattr(dec, "top_score", 0.0)), 4)
        except Exception as exc:
            kind, score = f"err:{exc}", 0.0
        na = (kind == OUTCOME_NULLA)
        if na:
            no_answer += 1
        cinfo = probe.get("crag") or {}
        if cinfo.get("retried"):
            crag_retried += 1
        neg_rows.append({
            "id": c["id"], "query": q, "gate_outcome": kind,
            "gate_score": score, "no_answer": bool(na),
            "h8_confidence": getattr(res, "confidence", "?"),
            "should_answer": bool(getattr(res, "should_answer", True)),
            "search_ms": round(ms, 1),
            "crag": cinfo or None,
        })

    all_ms = pos_ms + neg_ms
    out = {
        "round": "P1b.3",
        "tech": tech,
        "state": state,
        "mechanism": "env RAG_TECH (stesso rag_flag di produzione)",
        "gt": "qa/gt_set_r15.json",
        "engine": ("LocalSearchEngine reale, indice %APPDATA%/vector_index, "
                   "search(hybrid=True, top_k=5), zero rete; warmup escluso "
                   "dalle misure; bootstrap identico a qa/r15_recall_gt.py"),
        "threshold_declared": threshold,
        "n_pos": len(pos),
        "hits_top5": hits,
        "recall5": round(recall5, 4),
        "mrr": round(mrr, 4),
        "ranks": ranks,
        "ms_p50": pct(all_ms, 50),
        "ms_p95": pct(all_ms, 95),
        "pos_ms": pos_ms,
        "neg_ms": neg_ms,
        "per_query_ms": all_ms,          # 9 positivi + 5 negativi, ordine GT
        "negatives": {
            "n": len(neg),
            "no_answer": no_answer,
            "per_id": neg_rows,
        },
        "extras": {
            "hyde_ok": hyde_ok,
            "hyde_fallback": hyde_fb,
            "hyde_fallback_reasons": hyde_reasons,
            "crag_retried": crag_retried,
            "decompose_subqueries_total": n_sub_tot,
        },
        "per_case": per_case,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=1, ensure_ascii=False),
                              encoding="utf-8")
    print(f"[p1b_recall] tech={tech} state={state} "
          f"recall@5={recall5:.4f} mrr={mrr:.4f} "
          f"neg_no_answer={no_answer}/{len(neg)} "
          f"ms_p50={out['ms_p50']} ms_p95={out['ms_p95']} -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

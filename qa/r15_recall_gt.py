# -*- coding: utf-8 -*-
"""qa/r15_recall_gt.py — QA-2 R15b: recall@5 su GT reale (sola retrieval).

GT: qa/gt_set_r15.json (18 casi: 9 positivi con anchor, 5 negativi, 4 parziali).
- recall@5 positivi = frazione di query il cui anchor appare nei top-5 ibridi
  (search hybrid=True, top_k=5, indice reale %APPDATA%\\NovaStudio\\vector_index).
- Negativi/parziali: solo info retrieval (n_ret + confidence H8); l'accordo gate
  a 3 esiti end-to-end e' misurato da QA-1 (qa/r15_qa1.json).
Metodo: engine reale (bootstrap identico a qa/f0_probe.py), E5 locale, zero LLM,
zero rete. Output: qa/r15_recall_gt.json.
Uso: set PYTHONIOENCODING=utf-8&& python qa/r15_recall_gt.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from data.config_manager import ConfigManager, get_app_data_dir  # noqa: E402


def main() -> int:
    gt = json.loads((ROOT / "qa" / "gt_set_r15.json").read_text(encoding="utf-8"))
    casi = gt["casi"]

    from core.local_search import LocalSearchEngine
    from data.db import Database
    from core.rag.vector_store import VectorStore

    appdata = get_app_data_dir()
    db = Database()
    vs = VectorStore(str(appdata / "vector_index"))
    eng = LocalSearchEngine(db, vs)
    cfg = ConfigManager()
    threshold = float(cfg.get("gate.threshold", 0.70))

    pos = [c for c in casi if c["tipo"] == "positivo"]
    neg = [c for c in casi if c["tipo"] == "negativo"]
    par = [c for c in casi if c["tipo"] == "parziale"]

    per_case = []
    hits = 0
    t0 = time.time()
    for c in pos:
        q = c["query"]
        s0 = time.time()
        res = eng.search(q, top_k=5, hybrid=True)
        search_ms = (time.time() - s0) * 1000.0
        anchor = (c.get("atteso") or {}).get("anchor", "")
        src_exp = (c.get("atteso") or {}).get("source_file", "")
        top5 = []
        hit = False
        for ch in res.chunks[:5]:
            sf = str(getattr(ch, "source_file", "") or "")
            top5.append(Path(sf).name if sf else "?")
            if anchor and anchor in (ch.text or "") and (
                not src_exp or sf.replace("\\", "/").endswith(src_exp)
                or Path(sf).name == src_exp
            ):
                hit = True
        if hit:
            hits += 1
        per_case.append({
            "id": c["id"], "tipo": "positivo", "query": q, "anchor": anchor,
            "hit_top5": bool(hit), "search_ms": round(search_ms, 1),
            "top5": top5, "n_ret": len(res.chunks),
            "h8_confidence": getattr(res, "confidence", "?"),
        })

    recall5 = hits / len(pos) if pos else 0.0

    neg_info, par_info = [], []
    for c in neg:
        res = eng.search(c["query"], top_k=5, hybrid=True)
        neg_info.append({"id": c["id"], "n_ret": len(res.chunks),
                         "h8_confidence": getattr(res, "confidence", "?")})
        per_case.append({"id": c["id"], "tipo": "negativo", "query": c["query"],
                         "n_ret": len(res.chunks),
                         "h8_confidence": getattr(res, "confidence", "?"),
                         "atteso": "nulla"})
    for c in par:
        res = eng.search(c["query"], top_k=5, hybrid=True)
        par_info.append({"id": c["id"], "n_ret": len(res.chunks),
                         "h8_confidence": getattr(res, "confidence", "?")})
        per_case.append({"id": c["id"], "tipo": "parziale", "query": c["query"],
                         "n_ret": len(res.chunks),
                         "h8_confidence": getattr(res, "confidence", "?"),
                         "atteso": "parziale (mai piena)"})

    out = {
        "round": "15b",
        "method": ("engine reale LocalSearchEngine(indice %%APPDATA%%/vector_index, E5 locale) + "
                   "search(hybrid=True, top_k=5); zero LLM, zero rete; bootstrap identico a "
                   "qa/f0_probe.py; soglia gate dichiarata %.2f (accordo gate E2E in "
                   "qa/r15_qa1.json)" % threshold),
        "gt": "qa/gt_set_r15.json",
        "threshold_declared": threshold,
        "n_pos": len(pos),
        "hits_top5": hits,
        "recall5": round(recall5, 4),
        "target_recall5": 1.0,
        "target_hit": recall5 >= 1.0,
        "neg_retrieval_info": neg_info,
        "par_retrieval_info": par_info,
        "total_ms": round((time.time() - t0) * 1000.0, 1),
        "per_case": per_case,
    }
    (ROOT / "qa" / "r15_recall_gt.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print("recall@5 GT = %.4f (%d/%d) target 1.000 -> %s" % (
        recall5, hits, len(pos), "OK" if out["target_hit"] else "NON RAGGIUNTO"))
    print("totale %.0f ms -> qa/r15_recall_gt.json" % out["total_ms"])
    return 0 if out["target_hit"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

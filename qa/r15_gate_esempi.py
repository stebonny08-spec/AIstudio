# -*- coding: utf-8 -*-
"""qa/r15_gate_esempi.py — 3 esiti REALI (misura vera su indice) -> qa/r15_gate_esempi.json."""
import io
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "qa"))

import r15_gate_calib as C
import core.rag.gate as gate
from core.rag.contract import RetrievalOutcome, StageHit
from core.models import RetrievedChunk

THR = 0.70
CASI = [
    ("piena", "Nella fotosintesi clorofilliana qual è il valore di ΔG in kJ/mol della reazione che produce glucosio?", False),
    ("parziale", "Che differenza c'è tra un enzima e un ormone?", False),
    ("nulla", "Qual è la differenza tra mitosi e meiosi nelle cellule?", True),
]


def main():
    con = C.open_ro(C.DB)
    rows = C.load_rows(con, "vector_index")
    vecs, backend = C.load_vectors(con, len(rows))
    by_rid = {r["rid"]: r for r in rows}
    emb = C.Embedder()
    out = {"soglia": THR, "backend": backend, "esempi": []}
    for etichetta, q, web in CASI:
        t0 = time.perf_counter()
        qv = emb.embed_one(q)
        vlist = C.vec_topk(qv, vecs, C.TOPK)
        flist = C.fts_topk(con, q, C.TOPK, "vector_index")
        fused = C.rrf_fuse([[{"rid": i} for i, _ in vlist],
                            [{"rid": f[0]} for f in flist]], k=60)
        hits = []
        for fr in fused[:C.TOPK]:
            rid = fr["rid"]
            if rid not in by_rid:
                continue
            sim = next((s for i, s in vlist if i == rid), 0.0)
            r = by_rid[rid]
            hits.append(StageHit(
                chunk=RetrievedChunk(text=r["testo"][:2000],
                                     source_file=r["source_file"],
                                     location_hint="", similarity=sim),
                stage="libri", score=float(fr.get("score", sim) or sim),
                rrf_rank=int(fr.get("rank", 0) or 0)))
        total_ms = (time.perf_counter() - t0) * 1000.0
        o = RetrievalOutcome(
            query=q, query_norm=q, fused=hits,
            fts_scores=[f[1] for f in flist],
            vec_scores=[s for _i, s in vlist],
            stages_probed=["libri", "appunti"], total_ms=total_ms)
        t1 = time.perf_counter()
        d = gate.decide_gate(o, THR, web_attempted=web)
        dec_ms = (time.perf_counter() - t1) * 1000.0
        out["esempi"].append({
            "atteso": etichetta, "query": q,
            "outcome": d.outcome, "top_score": round(d.top_score, 4),
            "reason": d.reason,
            "vec_top1": round(o.vec_scores[0], 4),
            "fts_bm25_top3": [round(x, 3) for x in o.fts_scores[:3]],
            "elapsed_ms": round(d.elapsed_ms, 2),
            "decide_gate_ms": round(dec_ms, 3),
            "near_miss": [{"source": h.chunk.source_file[-40:],
                           "score": round(h.score, 4)} for h in d.near_miss],
            "informativa": gate.build_informativa(d) if d.outcome == "nulla" else None,
        })
    con.close()
    with io.open(os.path.join(ROOT, "qa", "r15_gate_esempi.json"), "w",
                 encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    for e in out["esempi"]:
        print(e["atteso"], "->", e["outcome"], "| score", e["top_score"],
              "| vec", e["vec_top1"], "| bm25", e["fts_bm25_top3"],
              "| elapsed_ms", e["elapsed_ms"], "| decide_ms", e["decide_gate_ms"])
    print("scritto qa/r15_gate_esempi.json")


if __name__ == "__main__":
    main()

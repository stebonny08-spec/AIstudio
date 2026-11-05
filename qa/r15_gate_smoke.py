# -*- coding: utf-8 -*-
"""qa/r15_gate_smoke.py — smoke dei 3 esiti del gate (zero LLM, sintetici)."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.rag.contract import RetrievalOutcome, StageHit   # noqa: E402
from core.models import RetrievedChunk                     # noqa: E402
import core.rag.gate as g                                 # noqa: E402


def hit(text, score, src="fotosintesi_clorofilliana_universitario.md",
        stage="libri"):
    return StageHit(chunk=RetrievedChunk(text=text, source_file=src,
                                         location_hint="s1", similarity=score),
                    stage=stage, score=score)


def main():
    o1 = RetrievalOutcome(
        query="Qual e' il valore di delta G nella fotosintesi?",
        query_norm="valore delta g fotosintesi",
        fused=[hit("Il valore di delta G standard della fotosintesi clorofilliana e' positivo.", 0.83)],
        fts_scores=[-4.2, -1.1, 0.0], vec_scores=[0.83, 0.80],
        stages_probed=["libri", "appunti"],
        embed_ms=5, fts_ms=3, vec_ms=4, total_ms=14.0)
    d1 = g.decide_gate(o1, 0.45)
    print("1) piena? ->", d1.outcome, "| score", round(d1.top_score, 4),
          "| elapsed_ms", round(d1.elapsed_ms, 2), "|", d1.reason)

    o2 = RetrievalOutcome(
        query="Qual e' la differenza tra mitosi e meiosi nelle cellule?",
        query_norm="differenza mitosi meiosi cellule",
        fused=[hit("Nella fotosintesi il fotosistema II ossida l'acqua e libera ossigeno.", 0.82)],
        fts_scores=[0.0] * 10, vec_scores=[0.82, 0.81],
        stages_probed=["appunti", "libri"],
        embed_ms=5, fts_ms=3, vec_ms=4, total_ms=15.0)
    d2 = g.decide_gate(o2, 0.45)
    print("2) q4-like (sim 0.82, fts 0) ->", d2.outcome, "|",
          d2.reason)
    print(g.build_informativa(d2))

    o3 = RetrievalOutcome(
        query="quando la RuBisCO prende l'ossigeno invece dell'anidride "
              "carbonica quanta percentuale di carbonio viene persa?",
        query_norm="rubisco ossigeno fotorespirazione percentuale carbonio",
        fused=[hit("La fotorespirazione comporta una perdita di carbonio fijo "
                   "nell'ambito del ciclo di Calvin.", 0.30)],
        fts_scores=[-1.5, 0.0], vec_scores=[0.30],
        stages_probed=["libri"], embed_ms=4, fts_ms=2, vec_ms=3,
        total_ms=12.0)
    d3 = g.decide_gate(o3, 0.45)
    print("3) parziale ->", d3.outcome, "| near_miss",
          [(h.stage, round(h.score, 3)) for h in d3.near_miss], "|",
          d3.reason)

    o4 = RetrievalOutcome(query="ricetta della carbonara",
                          query_norm="ricetta carbonara", total_ms=8.0)
    d4 = g.decide_gate(o4, 0.45, web_attempted=True)
    print("4) nulla ->", d4.outcome, "|", d4.reason,
          "| web_attempted:", getattr(d4, "web_attempted", None))
    print(g.build_informativa(d4))

    assert d1.outcome == "piena", d1
    assert d2.outcome != "piena", d2
    assert d3.outcome == "parziale", d3
    assert d4.outcome == "nulla", d4
    print("SMOKE OK")


if __name__ == "__main__":
    main()

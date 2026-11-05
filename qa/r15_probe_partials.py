# -*- coding: utf-8 -*-
"""qa/r15_probe_partials.py — sceglie i casi "parziale" DEL GT per misura:
candidati con supporto presente MA score < soglia (fascia parziale)."""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "qa"))

import r15_gate_calib as C          # noqa: E402  (main non parte all'import)
import core.rag.gate as gate        # noqa: E402

THR = 0.70
CANDIDATI = [
    # (id, query) — candidati a "evidenza parziale"
    ("c01", "Chi ha scoperto la fotosintesi e in che anno è avvenuta?"),
    ("c02", "Come si coltiva il basilico in vaso sul balcone di casa?"),
    ("c03", "Come funziona la respirazione cellulare nei mitocondri?"),
    ("c04", "Perché le foglie diventano gialle in autunno?"),
    ("c05", "Quanta acqua serve un albero da frutto ogni settimana?"),
    ("c06", "Come si misura il pH del terreno di un orto?"),
    ("c07", "Qual è la differenza tra diffusione e osmosi nelle membrane cellulari?"),
    ("c08", "Come si fa il compost con le foglie secche del giardino?"),
    ("c09", "Qual è la vita media di una foglia di quercia?"),
    ("c10", "Come cambia la fotosintesi a temperature superiori ai 40 gradi?"),
    ("c11", "A che serve la luce artificiale per le piante d'appartamento?"),
    ("c12", "Come si progetta un impianto fotovoltaico per una casa?"),
    ("c13", "Spiega il ciclo dell'azoto nel terreno agricolo"),
    ("c14", "Quanto dura il giorno e la notte all'equatore?"),
    ("c15", "Come si calcola l'indice di clorofilla con il metro a foglia?"),
    ("c16", "Perché il mare è salato e come si forma il sale?"),
    ("c17", "Che differenza c'è tra un enzima e un ormone?"),
    ("c18", "Come si trasportano i nutrienti nel legno di un albero alto?"),
    ("c19", "Qual è il rapporto ATP:NADPH consumato dal ciclo di Calvin?"),
    ("c20", "Quante ATP richiede la fissazione di una sola molecola di CO2?"),
]


def main():
    con = C.open_ro(C.DB)
    rows = C.load_rows(con, C.store_key_default() if hasattr(C, "store_key_default") else "vector_index")
    vecs, backend = C.load_vectors(con, len(rows))
    by_rid = {r["rid"]: r for r in rows}
    emb = C.Embedder()
    print("backend", backend, "chunk", len(rows))
    print("%-4s %6s %4s %7s %6s %7s  %s" % ("id", "vec1", "fts", "bm25", "lex", "score", "outcome@0.70"))
    out = []
    for cid, q in CANDIDATI:
        qv = emb.embed_one(q)
        vlist = C.vec_topk(qv, vecs, C.TOPK)
        flist = C.fts_topk(con, q, C.TOPK, "vector_index")
        vec1 = vlist[0][1] if vlist else 0.0
        bm = min((f[1] for f in flist), default=0.0)
        top3 = [by_rid[fr["rid"]]["testo"][:2000]
                for fr in C.rrf_fuse([[{"rid": i} for i, _ in vlist],
                                      [{"rid": f[0]} for f in flist]], k=60)[:3]
                if fr["rid"] in by_rid]
        lex = gate.lex_support(q, top3)
        # fts_scores = dump PER-STADIO (top-10 bm25)
        fts_scores = [f[1] for f in flist]
        from core.rag.contract import RetrievalOutcome
        o = RetrievalOutcome(query=q, query_norm=q, fused=[],
                             fts_scores=fts_scores,
                             vec_scores=[s for _i, s in vlist],
                             stages_probed=["libri"], total_ms=1.0)
        info = gate._fts_info(o)
        score = gate.gate_score(vec1, info[2], lex)
        d = gate.decide_gate(o, THR)
        print("%-4s %6.3f %4d %7.3f %6.3f %7.3f  %s" %
              (cid, vec1, len(flist), bm, lex, score, d.outcome))
        out.append({"id": cid, "query": q, "vec1": round(vec1, 4),
                    "fts_hits": len(flist), "bm25_best": round(bm, 3),
                    "fts_evidenza": info[1], "lex": round(lex, 3),
                    "score": round(score, 4), "outcome@0.70": d.outcome})
    con.close()
    p = os.path.join(ROOT, "qa", "r15_partials_probe.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("scritto", p)


if __name__ == "__main__":
    main()

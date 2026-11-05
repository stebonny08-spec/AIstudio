# -*- coding: utf-8 -*-
"""qa/r15_gate_calib.py — G4: misura punteggi REALI (vec coseno + FTS5/bm25)
su qa/gt_set_r15.json, valuta separabilita' e taratura della soglia del gate.

Primitive usate DIRETTAMENTE in lettura (nessuna scrittura, nessun LLM):
  * FTS5: chunks_fts MATCH + bm25()  (stessa _fts_match_expr della produzione)
  * vettori: tabella sqlite-vec/vecnb con coseno calcolato in numpy
Output: qa/r15_gate_scores.json + qa/r15_gate_sweep.json (+ tabella stdout)
"""
import io
import json
import os
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import numpy as np                                             # noqa: E402
from data.config_manager import get_app_data_dir               # noqa: E402
from core.rag.embedder import Embedder                          # noqa: E402
from core.rag.vector_store_sqlite import rrf_fuse, _fts_match_expr  # noqa: E402
from core.rag.contract import RetrievalOutcome, StageHit        # noqa: E402
from core.models import RetrievedChunk                          # noqa: E402
import core.rag.gate as gate                                   # noqa: E402

DB = str(get_app_data_dir() / "studioia.db")
GT = os.path.join(ROOT, "qa", "gt_set_r15.json")
THRS = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85]
TOPK = 10


def open_ro(path):
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=15.0)
    con.row_factory = sqlite3.Row
    return con


def load_rows(con, store_key="vector_index"):
    return [dict(r) for r in con.execute(
        "SELECT rowid AS rid, testo, source_file FROM chunks "
        "WHERE store_key = ? ORDER BY rowid", (store_key,))]


def load_vectors(con, n):
    """Ritorna dict rid -> np.float32[dim] (sqlite-vec, fallback numpy-blob)."""
    vecs = {}
    backend = None
    try:
        import sqlite_vec
        con.execute("SELECT load_extension(?)", ("1",)) if False else None
    except Exception:
        sqlite_vec = None
    if sqlite_vec is not None:
        try:
            con.enable_load_extension(True)
            sqlite_vec.load(con)
            con.enable_load_extension(False)
            backend = "sqlite-vec"
        except Exception as exc:
            backend = None
            print("[calib] sqlite_vec non caricabile:", exc)
    if backend == "sqlite-vec":
        for r in con.execute("SELECT rowid, embedding FROM vec_vector_index"):
            blob = r[1]
            try:
                vecs[int(r[0])] = np.asarray(
                    sqlite_vec.deserialize_float32(blob), dtype=np.float32)
            except AttributeError:
                vecs[int(r[0])] = np.frombuffer(blob, dtype=np.float32).copy()
    if not vecs:
        for r in con.execute("SELECT rowid, embedding FROM vecnb_vector_index"):
            vecs[int(r[0])] = np.frombuffer(r[1], dtype=np.float32).copy()
        backend = "numpy-blob"
    if len(vecs) != n:
        print("[calib] ATTENZIONE vettori %d != chunk %d" % (len(vecs), n))
    return vecs, backend


def vec_topk(qvec, vecs, k):
    ids = sorted(vecs)
    mat = np.stack([vecs[i] for i in ids])
    q = np.asarray(qvec, dtype=np.float32)
    q = q / (np.linalg.norm(q) or 1.0)
    m = np.linalg.norm(mat, axis=1, keepdims=True)
    m[m == 0] = 1.0
    sims = (mat / m) @ q
    order = np.argsort(-sims)[:k]
    return [(ids[i], float(sims[i])) for i in order]


def fts_topk(con, text, k, store_key="vector_index"):
    match = _fts_match_expr(text or "")
    if not match:
        return []
    try:
        rows = con.execute(
            "SELECT chunks.rowid AS rid, chunks.testo, chunks.source_file, "
            "bm25(chunks_fts) AS score FROM chunks_fts "
            "JOIN chunks ON chunks.rowid = chunks_fts.rowid "
            "WHERE chunks_fts MATCH ? AND chunks.store_key = ? "
            "ORDER BY score LIMIT ?", (match, store_key, k)).fetchall()
    except sqlite3.Error as exc:
        print("[calib] MATCH fallito:", exc)
        return []
    return [(int(r["rid"]), float(r["score"]), r["testo"], r["source_file"])
            for r in rows]


def main():
    with io.open(GT, encoding="utf-8") as f:
        gt = json.load(f)
    # candidati opzionali a "parziale": misurati ma NON conteggiati nello sweep
    cand_path = os.path.join(ROOT, "qa", "r15_partials_candidates.json")
    if os.path.exists(cand_path):
        with io.open(cand_path, encoding="utf-8") as f:
            for c in json.load(f):
                cc = dict(c)
                cc.setdefault("tipo", "candidato")
                gt["casi"].append(cc)
    store_key = gt["corpus"]["store_key"]
    con = open_ro(DB)
    rows = load_rows(con, store_key)
    vecs, backend = load_vectors(con, len(rows))
    by_rid = {r["rid"]: r for r in rows}
    print("[calib] backend=%s chunk=%d vettori=%d" % (backend, len(rows), len(vecs)))

    emb = Embedder()
    scores = []
    t_all = time.perf_counter()

    THR_TARATA = 0.70
    # sweep multi-soglia: NON spammare il production log (astensioni.jsonl
    # resta scritto SOLO da G con UNA riga per caso alla soglia tarata)
    import core.rag.contract as _ct
    _orig_log = _ct.log_astensione
    _ct.log_astensione = lambda rec: None
    case_outcomes = []

    for caso in gt["casi"]:
        q = caso["query"]
        qn = caso.get("query_norm") or q
        t0 = time.perf_counter()
        qv = emb.embed_one(q)
        vlist = vec_topk(qv, vecs, TOPK)
        flist = fts_topk(con, q, TOPK, store_key)
        elapsed = (time.perf_counter() - t0) * 1000.0

        # --- costruzione RetrievalOutcome come la produrrebbe P -----------
        vec_rows = [{"rid": i, "sim": s, "testo": by_rid.get(i, {}).get("testo", ""),
                     "source_file": by_rid.get(i, {}).get("source_file", "")}
                    for i, s in vlist]
        fts_rows = [{"rid": i, "bm25": b, "testo": t, "source_file": s}
                    for i, b, t, s in flist]
        fused = rrf_fuse([[{"rid": r["rid"]} for r in vec_rows],
                          [{"rid": r["rid"]} for r in fts_rows]], k=60)
        bm25_by_rid = {r["rid"]: r["bm25"] for r in fts_rows}
        hits = []
        for fr in fused[:TOPK]:
            rid = fr["rid"]
            r = by_rid.get(rid)
            if not r:
                continue
            sim = next((s for i, s in vlist if i == rid), 0.0)
            chunk = RetrievedChunk(text=r["testo"][:2000],
                                   source_file=r["source_file"],
                                   location_hint="", similarity=sim)
            hits.append(StageHit(chunk=chunk, stage="libri",
                                 score=float(fr.get("score", sim) or sim),
                                 rrf_rank=int(fr.get("rank", 0) or 0)))
        # dump PER-STADIO (come da contratto: top-10 per stadio)
        fts_scores = [r[1] for r in flist]
        vec_scores = [s for _i, s in vlist]

        outcome = RetrievalOutcome(
            query=q, query_norm=qn, fused=hits,
            fts_scores=fts_scores, vec_scores=vec_scores,
            stages_probed=["libri", "appunti"] if flist else ["libri"],
            embed_ms=0.0, fts_ms=0.0, vec_ms=0.0, total_ms=elapsed)

        vec1 = vec_scores[0] if vec_scores else 0.0
        bm_best = min(flist, key=lambda r: r[1])[1] if flist else 0.0
        top3_texts = [by_rid[fr["rid"]]["testo"][:2000]
                      for fr in fused[:3] if fr["rid"] in by_rid]
        lex = gate.lex_support(qn, top3_texts)
        lex_hits = sum(1 for t in gate._tokens(qn)
                       if any(t in gate._tokens(x) for x in top3_texts))
        att = caso.get("atteso", {})
        anchor_ok = None
        anchor_top5 = None
        missing_absent = None
        if att.get("anchor"):
            alltext = " ".join(r["testo"] for r in rows)
            anchor_ok = att["anchor"] in alltext
            top5 = " ".join(by_rid[fr["rid"]]["testo"] for fr in fused[:5]
                            if fr["rid"] in by_rid)
            anchor_top5 = att["anchor"] in top5
        if att.get("anchor_mancante"):
            alltext = " ".join(r["testo"] for r in rows)
            missing_absent = att["anchor_mancante"].lower() not in alltext.lower()
        if att.get("fuori_corpus"):
            toks = set(gate._tokens(q))
            corp = set()
            for r in rows:
                corp.update(gate._tokens(r["testo"]))
            # validazione: al massimo 1 termine generico condiviso
            ov = len(toks & corp)
            anchor_ok = (ov / max(1, len(toks))) < 0.50

        outcomes = {}
        for thr in THRS:
            outcomes["%.2f" % thr] = gate.decide_gate(outcome, thr).outcome
        case_outcomes.append((caso, outcome))

        scores.append({
            "id": caso["id"], "tipo": caso["tipo"], "query": q,
            "vec1": round(vec1, 4),
            "vec_top5": [round(s, 4) for _i, s in vlist[:5]],
            "fts_hits": len(flist),
            "fts_bm25_best": round(bm_best, 3) if flist else None,
            "fts_evidenza": any(v != 0.0 for v in outcome.fts_scores),
            "lex": round(lex, 3), "lex_hits": int(lex_hits),
            "score_045": round(gate.gate_score(vec1,
                              gate._fts_info(outcome)[2], lex), 4),
            "total_ms": round(elapsed, 1),
            "outcome_per_soglia": outcomes,
            "anchor_in_corpus": anchor_ok,
            "anchor_in_top5": anchor_top5,
            "anchor_mancante_assente": missing_absent,
        })

    # ---------------- passo UNICO loggato (soglia tarata) ----------------
    _ct.log_astensione = _orig_log
    for caso, outcome in case_outcomes:
        gate.decide_gate(outcome, THR_TARATA)   # G3: una riga per caso

    # ---------------- sweep soglia ----------------
    sweep = []
    for thr in THRS:
        key = "%.2f" % thr
        tp = fp = fn = tn = 0
        part_ok = part_piena = part_nulla = 0
        for s in scores:
            o = s["outcome_per_soglia"][key]
            if s["tipo"] == "positivo":
                if o == "piena":
                    tp += 1
                else:
                    fn += 1
            elif s["tipo"] == "negativo":
                if o == "piena":
                    fp += 1
                else:
                    tn += 1
            elif s["tipo"] != "parziale":
                continue  # candidati misurati ma fuori dal conteggio
            else:
                if o == "parziale":
                    part_ok += 1
                elif o == "piena":
                    part_piena += 1
                else:
                    part_nulla += 1
        prec = tp / (tp + fp) if (tp + fp) else 1.0
        rec = tp / (tp + fn) if (tp + fn) else 1.0
        sweep.append({"threshold": thr, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
                      "precision": round(prec, 3), "recall": round(rec, 3),
                      "parziali_corretti": part_ok,
                      "parziali_come_piena": part_piena,
                      "parziali_come_nulla": part_nulla})

    con.close()
    out = {"db": DB, "backend": backend, "n_casi": len(scores),
           "gt": "qa/gt_set_r15.json",
           "regola": "piena = vec1 >= threshold E supporto (fts_evidenza oppure lex >= %.2f)"
                     % gate.LEX_MIN,
           "scores": scores}
    with io.open(os.path.join(ROOT, "qa", "r15_gate_scores.json"), "w",
                 encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    with io.open(os.path.join(ROOT, "qa", "r15_gate_sweep.json"), "w",
                 encoding="utf-8") as f:
        json.dump({"thresholds": THRS, "sweep": sweep}, f, ensure_ascii=False,
                  indent=2)

    print("\n%-4s %-10s %6s %4s %6s %6s %6s  %s" %
          ("id", "tipo", "vec1", "ftsh", "bm25", "lex", "score", "outcome@0.70"))
    for s in scores:
        print("%-4s %-10s %6.3f %4d %6s %6.3f %6.3f  %s" % (
            s["id"], s["tipo"], s["vec1"], s["fts_hits"],
            str(s["fts_bm25_best"]), s["lex"], s["score_045"],
            s["outcome_per_soglia"]["0.70"]))
    print("\n%-9s %4s %3s %3s %3s %7s %7s  %s" %
          ("soglia", "tp", "fp", "fn", "tn", "prec", "recall", "parziali(ok/piena/nulla)"))
    for row in sweep:
        print("%-9.2f %4d %3d %3d %3d %7.3f %7.3f  %d/%d/%d" % (
            row["threshold"], row["tp"], row["fp"], row["fn"], row["tn"],
            row["precision"], row["recall"], row["parziali_corretti"],
            row["parziali_come_piena"], row["parziali_come_nulla"]))
    print("\nvalidazioni GT: anchor_in_corpus KO ->",
          [s["id"] for s in scores if s["anchor_in_corpus"] is False],
          "| anchor_mancante presente ->",
          [s["id"] for s in scores if s["anchor_mancante_assente"] is False])
    print("tempo totale misura: %.1fs" % (time.perf_counter() - t_all))


if __name__ == "__main__":
    main()

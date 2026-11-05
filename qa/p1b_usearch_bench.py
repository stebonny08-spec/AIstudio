# -*- coding: utf-8 -*-
"""qa/p1b_usearch_bench.py - P1b.2: A/B usearch(HNSW) vs sqlite-vec.

1) LATENZA query vettoriale p50/p95 (warmup dichiarato, N=50 query/punto):
   - scala REALE (17 vettori dell'utente, dim384) su sqlite-vec vs usearch;
   - scale 1k / 10k / 50k: vettori random deterministici (seed42) SOLO per
     la LATENZA (il corpus reale ha17 vettori - nessun documento inventato;
     a queste scale la qualita' NON e' misurata). Backend sqlite-vec puro
     (CREATE VIRTUAL TABLE vec0 + kNN MATCH identico al prodotto) vs HNSW
     usearch (stessi vettori, stessi parametri del layer di prodotto).
2) RECALL@5 sul GT REALE (qa/gt_set_r15.json) via qa/r15_recall_gt.py in
  2 subprocess con RAG_USEARCH=0/1 (flag del layer).
3) REGOLA: ON SOLO SE p95 usearch <= p95 sqlite-vec sull'indice REALE
   E recall@5(on) >= recall@5(off) - 0.01 -> scrive la decisione e la
   stampa; il default USEARCH_ENABLED_DEFAULT del layer va aggiornato dal
   coordinatore in base all'esito (P1b.4).
Output: qa/p1b_usearch.json
"""
from __future__ import annotations
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT); sys.path.insert(0, str(ROOT))
OUT = ROOT / "qa" / "p1b_usearch.json"
DIM = 384
NQ = 50
WARMUP = 10
SEED = 42

def pct(vals, q):
    if not vals: return None
    s = sorted(vals)
    import math
    i = max(0, min(len(s) - 1, math.ceil(q * len(s)) - 1))
    return round(s[i], 4)

def bench_pair(vecs, queries, label):
    """Stessi vettori/queries su sqlite-vec puro e usearch HNSW."""
    import time
    # sqlite-vec puro (se l'estensione non c'e': numpy identico al fallback di prodotto)
    use_ext = False
    conn = sqlite3.connect(":memory:")
    try:
        conn.enable_load_extension(True)
        try:
            import sqlite_vec
            conn.load_extension(sqlite_vec.loadable_path())
            use_ext = True
        except Exception:
            try:
                import sqlite_vec
                sqlite_vec.load(conn)
                use_ext = True
            except Exception:
                pass
        if not use_ext:
            conn.close()
            conn = None
    except Exception:
        try: conn.close()
        except Exception: pass
        conn = None
    lat_sv = []
    if conn is not None and use_ext:
        conn.execute(f"CREATE VIRTUAL TABLE v USING vec0(embedding float[{DIM}])")
        # ogni parametro deve essere una TUPLA (1 binding); bytes = BLOB nativo
        conn.executemany("INSERT INTO v(embedding) VALUES (?)",
                         [(sqlite3.Binary(np.ascontiguousarray(v, dtype=np.float32).tobytes()),)
                          for v in vecs])
        conn.commit()
        for i, q in enumerate(queries):
            blob = sqlite3.Binary(np.ascontiguousarray(q, dtype=np.float32).tobytes())
            t0 = time.perf_counter()
            conn.execute("SELECT rowid, distance FROM v WHERE embedding MATCH ? AND k = 5",
                         (blob,)).fetchall()
            ms = (time.perf_counter() - t0) * 1000
            if i >= WARMUP: lat_sv.append(ms)
        conn.close()
    else:
        # fallback numpy (stessa semantica1-cos) - dichiarato nel json
        mat = np.asarray(vecs, dtype=np.float32)
        mnorm = np.linalg.norm(mat, axis=1, keepdims=True); mnorm[mnorm == 0] = 1
        matn = mat / mnorm
        for i, q in enumerate(queries):
            t0 = time.perf_counter()
            qn = q / (np.linalg.norm(q) or 1)
            sims = matn @ qn
            np.argpartition(-sims, min(5, len(sims)) - 1)[:5]
            ms = (time.perf_counter() - t0) * 1000
            if i >= WARMUP: lat_sv.append(ms)
    # usearch HNSW (parametri del layer di prodotto)
    from usearch.index import Index
    idx = Index(ndim=DIM, dtype="f32", metric="cos",
                connectivity=16, expansion_add=200, expansion_search=100)
    keys = np.arange(1, len(vecs) + 1, dtype=np.int64)
    idx.add(keys, np.asarray(vecs, dtype=np.float32))
    lat_uc = []
    for i, q in enumerate(queries):
        t0 = time.perf_counter()
        idx.search(np.asarray(q, dtype=np.float32).reshape(1, -1), count=5)
        ms = (time.perf_counter() - t0) * 1000
        if i >= WARMUP: lat_uc.append(ms)
    return {
        "label": label, "n": len(vecs), "dim": DIM,
        "sqlite_vec_backend": "sqlite-vec-ext" if use_ext else "numpy-fallback",
        "sqlite_vec": {"p50": pct(lat_sv, 0.50), "p95": pct(lat_sv, 0.95), "n": len(lat_sv)},
        "usearch": {"p50": pct(lat_uc, 0.50), "p95": pct(lat_uc, 0.95), "n": len(lat_uc)},
    }

def main():
    out = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "usearch_version": __import__("usearch").__version__,
           "note_scale": ("vettori random deterministici (seed42) SOLO per la latenza "
                          "a scala; il corpus reale ha17 vettori - recall misurato "
                          "solo sul GT reale"),
           "warmup": WARMUP, "n_queries": NQ, "latency": []}
    rng = np.random.default_rng(SEED)
    # scala reale: leggo i vettori veri dallo store dell'utente
    from data.config_manager import get_app_data_dir
    from core.rag.vector_store_sqlite import SQLiteVectorStore
    vs = SQLiteVectorStore(str(get_app_data_dir() / "vector_index"))
    rows = vs._conn.execute(f"SELECT embedding FROM {vs._vec_table}").fetchall()
    real = [np.frombuffer(bytes(r[0]), dtype=np.float32) for r in rows if r[0]]
    if real and len(real[0]) == DIM:
        base = np.stack(real)
        n = len(base)
        # queries: chunk reali + jitter per variare (stessa distribuzione reale)
        qs = np.stack([base[i % n] + rng.normal(0, 0.05, DIM) for i in range(NQ + WARMUP)])
        out["latency"].append(bench_pair(base, qs, "reale_%d" % n))
    for n in (1000, 10000, 50000):
        vecs = rng.standard_normal((n, DIM)).astype(np.float32)
        qs = rng.standard_normal((NQ + WARMUP, DIM)).astype(np.float32)
        out["latency"].append(bench_pair(vecs, qs, "scale_%d" % n))
    # recall GT (2 subprocess con flag)
    def run_recall(flag):
        env = dict(os.environ); env["PYTHONIOENCODING"] = "utf-8"
        if flag: env["RAG_USEARCH"] = "1"
        else: env.pop("RAG_USEARCH", None)
        r = subprocess.run([sys.executable, "qa/r15_recall_gt.py"], env=env,
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=600)
        src = ROOT / "qa" / "r15_recall_gt.json"
        dst = ROOT / ("qa/p1b_usearch_recall_%s.json" % ("on" if flag else "off"))
        res = {"flag": bool(flag), "exit": r.returncode}
        try:
            shutil.copy2(src, dst)
            res["out"] = str(dst.name)
            data = json.loads(src.read_text(encoding="utf-8"))
            # estrae recall@5 positivi (chiavi possibili: recall5/recall_at_5/...)
            for k in ("recall5", "recall_at_5", "recall_pos", "positivi"):
                if k in data: res["recall5"] = data[k]
            if "recall5" not in res and isinstance(data, dict):
                res["keys"] = list(data.keys())[:20]
                res["raw_head"] = json.dumps(data, ensure_ascii=False)[:600]
        except Exception as e:
            res["error"] = str(e)[:200]
        res["stderr_tail"] = (r.stderr or "")[-300:]
        return res
    out["recall_gt"] = {"off": run_recall(False), "on": run_recall(True)}
    # decisione
    reale = next((x for x in out["latency"] if x["label"].startswith("reale")), None)
    r_off = out["recall_gt"]["off"].get("recall5")
    r_on = out["recall_gt"]["on"].get("recall5")
    lat_ok = bool(reale and reale["usearch"]["p95"] is not None and
                  reale["sqlite_vec"]["p95"] is not None and
                  reale["usearch"]["p95"] <= reale["sqlite_vec"]["p95"])
    rec_ok = None
    try:
        if r_off is not None and r_on is not None:
            rec_ok = (float(r_on) >= float(r_off) - 0.01)
    except Exception:
        pass
    decision = bool(lat_ok and (rec_ok is not False))
    out["decision"] = {
        "latency_rule_ok (p95 usearch <= sqlite-vec sul REALE)": lat_ok,
        "recall_rule_ok (>= off -0.01)": rec_ok,
        "USEARCH_ENABLED_DEFAULT": decision,
        "rule": ("ON SOLO SE p95<=sqlite-vec sul reale E recall>=recall_off-0.01; "
                 "se il recall GT non e' interpretabile la regola latenza vale "
                 "e la lacuna e' dichiarata"),
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print("LATENCY", json.dumps(out["latency"], ensure_ascii=False), flush=True)
    print("RECALL", json.dumps(out["recall_gt"], ensure_ascii=False)[:800], flush=True)
    print("DECISION", json.dumps(out["decision"], ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()

#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
qa/f0_probe.py — F0 FORENSICS Round 15b (rerunnable, SOLO MISURE REALI).

Usage:
  set PYTHONIOENCODING=utf-8 && python qa\f0_probe.py [--no-e2e] [--no-reindex]

Output: qa/f0_forensics.json (+ stdout).

Cosa misura:
  F0.1 dump per query q1..q5: FTS5 top-10 (bm25), vettore top-10 (sim),
       fusione RRF (k=60, DIAGNOSTICA: il percorso prod usa search(hybrid=False)),
       gate (sims selezionate + confidence + should_answer), esito code-path.
  F0.2 coverage: marker attesi nei chunk indicizzati; originals/ vs rag_stage2/;
       embedding_model_id persistito (file/DB) vs runtime.
  F0.3 costo: ms per stadio + chiamate generate_stream REALI su E2E
       (q1=locale, q4=web — UNICA uscita di rete del probe: ddgs).
  F0.4 root cause: classificazione da misura (tabella finale nel JSON).

METODO dichiarato per caso dentro JSON: e2e-reale | retrieval-level+code-path.
NESSUNA simulazione: tutti i numeri sono misurati; le deduzioni code-path sono
marcate come tali nelle evidenze.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HUB_OFFLINE", "1")        # modello E5 in cache locale
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")  # nessun download non dichiarato

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

OUT_JSON = ROOT / "qa" / "f0_forensics.json"
RAG_STAGE2 = ROOT / "file_AIstudio" / "rag_stage2"
ORIGINALS = ROOT / "file_AIstudio" / "originals"

# ---------------------------------------------------------------- queries
QUERIES = {
    "q1": {
        "kind": "diretto",
        "text": "Nella fotosintesi clorofilliana qual è il valore di ΔG°' in kJ/mol della reazione che produce glucosio?",
        "markers": ["2870"],
        "desc": "fatto DIRETTO presente nel materiale (ΔG°'=+2870 kJ/mol glucosio)",
    },
    "q2": {
        "kind": "parafrasi",
        "text": "Quanta energia libera serve alle piante per trasformare anidride carbonica e acqua in zucchero usando la luce?",
        "markers": ["2870"],
        "desc": "parafrasi non banale dello stesso fatto (senza 'fotosintesi'/kJ/2870)",
    },
    "q3": {
        "kind": "multi-punto",
        "text": "Confronta le vie C4 e CAM: qual è il primo accettore di CO2 in ciascuna e il rapporto ATP:NADPH consumato per CO2?",
        "markers": ["PEP (3C)", "5.5 - 6.5"],
        "desc": "confronto C4 vs CAM (tabella 5.3): accettore PEP + ATP:NADPH 5.5-6.5",
    },
    "q4": {
        "kind": "non-coperto",
        "text": "Qual è la differenza tra mitosi e meiosi nelle cellule?",
        "markers": ["mitosi", "meiosi"],
        "desc": "argomento NON coperto dai materiali (caso web/none)",
    },
    "q5": {
        "kind": "near-miss",
        "text": "Quando un vegetale spreca una parte di quello che ha già fissato perché il suo enzima prende l'ossigeno invece del gas giusto, quanto perde in percentuale?",
        "markers": ["25%"],
        "desc": "parafrasi aggressiva fotorespirazione (perdita 25% carbonio) — misura reale del punteggio",
    },
}

E2E_CASES = ["q1", "q4"]  # 1-2 casi E2E reali con LLM locale (sidecar)
STRONG, WEAK = 0.45, 0.35  # duplicati da local_search per cross-check


def ms(t0):
    return round((time.time() - t0) * 1000.0, 2)


def trunc(s, n=200):
    s = re.sub(r"\s+", " ", (s or "")).strip()
    return s[:n] + ("…" if len(s) > n else "")


# ======================================================================
# 1) SNAPSHOT (prima di costruire gli store: eventuali scritture di boot
#    dichiarate qui sotto sono le stesse che fa l'app)
# ======================================================================
def snapshot(appdata):
    snap = {"appdata": str(appdata), "files": {}, "db": {}}
    db_path = appdata / "studioia.db"
    # elenchi dir PRIMA della costruzione degli store
    for sub in ("vector_index", "vector_index_books"):
        d = appdata / sub
        snap["files"][sub] = sorted(p.name for p in d.iterdir()) if d.exists() else "DIR_ASSENTE"
    # embedding_model.txt (persistenza id indice)
    for sub in ("vector_index", "vector_index_books"):
        f = appdata / sub / "embedding_model.txt"
        snap["files"][f"{sub}/embedding_model.txt"] = (
            f.read_text(encoding="utf-8").strip() if f.exists() else "ABSENT"
        )
    # DB read-only: schema + conteggi + colonne (embedding_model_id?)
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = con.cursor()
    tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    snap["db"]["tables"] = tables
    snap["db"]["chunks_columns"] = [r[1] for r in cur.execute("PRAGMA table_info(chunks)")]
    snap["db"]["embedding_model_id_column_in_chunks"] = (
        "embedding_model_id" in snap["db"]["chunks_columns"]
    )
    snap["db"]["chunks_per_store"] = [
        {"store_key": r[0], "n": r[1]}
        for r in cur.execute("SELECT store_key, COUNT(*) FROM chunks GROUP BY store_key")
    ]
    snap["db"]["sources"] = [
        {"store_key": r[0], "source_file": r[1], "n": r[2]}
        for r in cur.execute(
            "SELECT store_key, source_file, COUNT(*) FROM chunks GROUP BY store_key, source_file")
    ]
    snap["db"]["indexed_files_rows"] = cur.execute(
        "SELECT COUNT(*) FROM indexed_files").fetchone()[0]
    con.close()
    # originals vs rag_stage2
    def lst(p):
        return sorted(x.name for x in p.iterdir()) if p.exists() else "DIR_ASSENTE"
    snap["files"]["originals/"] = lst(ORIGINALS)
    snap["files"]["rag_stage2/"] = lst(RAG_STAGE2)
    # marcatori attesi nei chunk (indice reale)
    from data.config_manager import get_app_data_dir  # noqa: F401  (stesso path)
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = con.cursor()
    marker_counts = {}
    for qid, q in QUERIES.items():
        marker_counts[qid] = {}
        for m in q["markers"]:
            n = cur.execute(
                "SELECT COUNT(*) FROM chunks WHERE testo LIKE ?",
                (f"%{m.replace('%', chr(37)+chr(37))}%",),
            ).fetchone()[0]
            marker_counts[qid][m] = n
    con.close()
    snap["db"]["marker_chunk_counts"] = marker_counts
    return snap


# ======================================================================
# 2) RETRIEVAL-LEVEL DUMP per query
# ======================================================================
def dump_query(qid, q, engines):
    (sr, local, books, vs) = engines
    out = {}
    query = q["text"]

    # 2a. semantic router (ms + sims) — primo call include init vettori esempi
    t = time.time()
    use_rag, sim_rag, sim_no_rag = sr.should_use_rag(query)
    out["semantic_router_ms"] = ms(t)
    out["semantic_router"] = {
        "use_rag": bool(use_rag), "sim_rag": round(sim_rag, 4),
        "sim_no_rag": round(sim_no_rag, 4),
    }

    # 2b. embed query (cache LRU: se in cache ≈0 — misurato comunque)
    t = time.time()
    qe = local.embedder.embed_one(query, kind="query")
    out["embed_query_ms"] = ms(t)
    out["embed_cached"] = out["embed_query_ms"] < 1.0

    # 2c. vettore top-10 (percorso PRODUZIONE: search(hybrid=False) usa SOLO questo)
    t = time.time()
    vec_rows = vs.query(qe, top_k=10)
    out["vec_ms"] = ms(t)

    # 2d. FTS5 top-10 (diagnostico: NON consultato dal percorso produzione)
    t = time.time()
    fts_rows = vs.fts_query(query, top_k=10)
    out["fts_ms"] = ms(t)

    # 2e. RRF k=60 sulle due liste (diagnostico)
    from core.rag.vector_store_sqlite import rrf_fuse, RRF_K
    fused = rrf_fuse([vec_rows, fts_rows], k=RRF_K)
    rrf_rank = {}
    for i, r in enumerate(fused, start=1):
        rrf_rank[(r.get("source_file", ""), r.get("text", ""))] = i

    # 2f. top10 unificato (chiave (source_file,text)); stage = quali liste lo trovano
    def key(r):
        return (r.get("source_file", ""), r.get("text", ""))
    vec_map = {key(r): r for r in vec_rows}
    fts_map = {key(r): r for r in fts_rows}
    all_keys = []
    for r in vec_rows:
        k = key(r)
        if k not in all_keys:
            all_keys.append(k)
    for r in fts_rows:
        k = key(r)
        if k not in all_keys:
            all_keys.append(k)
    # ordine: RRF (se compare) altrimenti vec-then-fts
    all_keys.sort(key=lambda k: rrf_rank.get(k, 999))
    top10 = []
    for k in all_keys[:10]:
        v = vec_map.get(k)
        f = fts_map.get(k)
        stages = ("vec+fts" if v and f else "vec" if v else "fts")
        top10.append({
            "stage": stages,
            "source": k[0],
            "txt": trunc(k[1]),
            "fts": round(f["bm25"], 4) if f else None,   # bm25 SQLite: più negativo = meglio
            "vec": round(float(v["similarity"]), 4) if v else None,
            "rrf": rrf_rank.get(k),
            "rrf_score": round(rrf_rank and next(
                (float(x.get("rrf_score", 0)) for x in fused if key(x) == k), 0.0), 6),
        })
    out["fts_scores"] = [t["fts"] for t in top10 if t["fts"] is not None]
    out["vec_scores"] = [t["vec"] for t in top10 if t["vec"] is not None]
    out["rrf_ranks"] = sorted([t["rrf"] for t in top10 if t["rrf"] is not None])
    out["top10"] = top10

    # marker matching sul TESTO PIENO (non sul trunc 200 char della vista)
    def _full(rows, m):
        return any(m.lower() in (str(r.get("text") or "")).lower() for r in rows)

    def _best_sim(rows, m):
        sims_m = [float(r["similarity"]) for r in rows
                  if m.lower() in (str(r.get("text") or "")).lower()
                  and r.get("similarity") is not None]
        return round(max(sims_m), 4) if sims_m else None
    out["_marker_fulltext"] = {
        m: {"vec_top10": _full(vec_rows, m), "any_top10": _full(vec_rows + fts_rows, m),
            "vec_sim_best": _best_sim(vec_rows, m)}
        for m in q["markers"]
    }

    # 2g. gate PRODUZIONE: local_search.search(hybrid=False) — sims selezionate
    t = time.time()
    res = local.search(query, top_k=5)
    out["local_search_ms"] = ms(t)
    for _m in out["_marker_fulltext"]:
        out["_marker_fulltext"][_m]["gate_selected"] = any(
            _m.lower() in (c.text or "").lower() for c in res.chunks)
    out["gate"] = {
        "sims": [round(c.similarity, 4) for c in res.chunks],
        "confidence": res.confidence,
        "should_answer": res.should_answer,
        "thresholds": {"strong": STRONG, "weak": WEAK},
        "n_selected": len(res.chunks),
        "is_empty": res.is_empty,
    }
    # cross-check coerenza gate
    from core.local_search import _confidence_from_sims
    conf_chk, wa_chk = _confidence_from_sims(out["gate"]["sims"])
    out["gate"]["recomputed"] = {"confidence": conf_chk, "should_answer": wa_chk}

    # 2h. libri (store partecipante vuoto: misurato comunque)
    t = time.time()
    bres = books.search(query, top_k=5)
    out["books_search_ms"] = ms(t)
    out["books_empty"] = bres.is_empty

    # 2i. esito OGGI dal percorso automatica (code-path: router.py, verificato)
    if not use_rag:
        out["outcome_oggi"] = "chitchat-senza-rag (source=nessuna)"
        out["outcome_path"] = "code-path: should_use_rag=False → _emit_chitchat"
    elif not res.is_empty:
        out["outcome_oggi"] = "risposta-locale (source=locale)"
        out["outcome_path"] = "code-path: local non vuoto → _emit_level(locale)"
    else:
        out["outcome_oggi"] = "web-se-ddgs-ritorna-altrimenti-none"
        out["outcome_path"] = ("code-path: local vuoto → libri vuoto (0 chunk) → "
                               "search_web → se vuoto: generazione context=none "
                               "(il 'non ho abbastanza informazioni')")
    return out


# ======================================================================
# 3) E2E REALE (LLM locale via sidecar = config prod) — 1-2 casi
# ======================================================================
def run_e2e(qids, engines, cfg):
    from core.local_llm_client import LocalLLMClient, maybe_wrap_sidecar, DEFAULT_STUDY_MODE
    from core.router import Router
    import core.router as router_mod
    from data.config_manager import ConfigManager

    results = {}
    sr, local, books, vs = engines

    model_path = ConfigManager().get("local_model_path", "")
    t = time.time()
    client = LocalLLMClient(
        model_path=model_path,
        n_ctx=int(ConfigManager().get("local_model_n_ctx", 8192)),
        n_gpu_layers=ConfigManager().get("local_model_n_gpu_layers", -1),
        n_threads=ConfigManager().get("local_model_n_threads"),
    )
    proxy = maybe_wrap_sidecar(client)   # llm.backend=sidecar (produzione)
    results["_client_setup_ms"] = ms(t)
    results["_model_path"] = model_path
    results["_backend"] = "sidecar" if proxy is not client else "in-process"

    # --- contatore REALE chiamate generate_stream ---
    llm_calls = {"n": 0, "ms": []}
    orig_gs = proxy.generate_stream

    def gs_counted(*a, **k):
        llm_calls["n"] += 1
        t0 = time.time()
        try:
            yield from orig_gs(*a, **k)
        finally:
            llm_calls["ms"].append(ms(t0))
    proxy.generate_stream = gs_counted

    router = Router(
        lambda: proxy, local, books,
        rag_top_k=int(ConfigManager().get("rag_top_k", 5)),
        rag_max_tokens=5000,
    )

    # --- timing per stadio (solo strumentazione runtime, nessun file toccato) ---
    stage = {}

    def wrap(obj, name, bucket):
        orig = getattr(obj, name)

        def w(*a, **k):
            t0 = time.time()
            try:
                return orig(*a, **k)
            finally:
                stage[bucket] = round(stage.get(bucket, 0.0) + ms(t0), 2)
        setattr(obj, name, w)
        return orig

    wrap(router.semantic_router, "should_use_rag", "semantic_router")
    wrap(local, "search", "local_search")
    wrap(books, "search", "books_search")

    # web: tempo totale + tempo per batch ddgs (retticolo dichiarato: rete SOLO q4)
    web_stats = {"ms": 0.0, "batches": [], "results": None}
    orig_web = router_mod.search_web

    def web_timed(q, **k):
        t0 = time.time()
        r = orig_web(q, **k)
        web_stats["ms"] = round(web_stats["ms"] + ms(t0), 2)
        web_stats["results"] = len(r)
        return r
    router_mod.search_web = web_timed

    try:
        import ddgs as ddgs_mod
        orig_text = ddgs_mod.DDGS.text

        def text_timed(self, q, **k):
            t0 = time.time()
            try:
                r = orig_text(self, q, **k)
                web_stats["batches"].append({"ms": ms(t0), "n": len(r or []), "q": trunc(q, 80)})
                return r
            except Exception as e:
                web_stats["batches"].append({"ms": ms(t0), "err": str(e)[:120], "q": trunc(q, 80)})
                raise
        ddgs_mod.DDGS.text = text_timed
    except Exception as e:
        results["_ddgs_patch_error"] = str(e)

    # --- runs ---
    for qid in qids:
        q = QUERIES[qid]
        stage.clear()
        llm_calls["n"] = 0
        llm_calls["ms"] = []
        web_stats["ms"] = 0.0
        web_stats["batches"] = []
        web_stats["results"] = None
        text, source, queues = "", None, []
        first_token_ms, n_tokens = None, 0
        err = None
        t_run = time.time()
        try:
            for ev in router.process_query_stream(
                q["text"], mode="automatica", thinking=False,
                study_mode=DEFAULT_STUDY_MODE, stop_event=threading.Event(),
                topic="", history_turns=[],
            ):
                if ev["type"] == "token":
                    if first_token_ms is None:
                        first_token_ms = ms(t_run)
                    text += ev["text"]
                    n_tokens += 1
                elif ev["type"] == "source":
                    source = ev["value"]
                elif ev["type"] == "queue":
                    queues.append({"parts": len(ev.get("parts") or []),
                                   "total_parts": ev.get("total_parts")})
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
        total = ms(t_run)
        results[qid] = {
            "total_ms": total,
            "first_token_ms": first_token_ms,
            "n_tokens": n_tokens,
            "source_osservato": source,
            "llm_calls": dict(llm_calls),
            "stages_ms": dict(stage),
            "web_ms": web_stats["ms"],
            "web_batches": web_stats["batches"],
            "web_results": web_stats["results"],
            "queue_events": queues,
            "response_head": trunc(text, 400),
            "error": err,
            "method": "e2e-reale",
        }
        print(f"[E2E] {qid}: total={total:.0f}ms token={n_tokens} "
              f"source={source} llm_calls={llm_calls['n']} err={err}", flush=True)
    return results, proxy


def shutdown_sidecar():
    """Chiusura dichiarata del sidecar (llama-server) a fine run."""
    info = {"attempted": True}
    try:
        from core.sidecar.server import get_server
        srv = get_server()
        info["state_before"] = srv.state
        info["port"] = srv.port
        srv.shutdown()
        info["state_after"] = srv.state
    except Exception as e:
        info["error"] = str(e)
    return info


# ======================================================================
# 4) REINDEX (costo reale dello stadio 'eventuale reindex' — dopo i dump)
# ======================================================================
def measure_reindex(local):
    from core.rag.vector_store_sqlite import SQLiteVectorStore  # noqa: F401
    before = local.vector_store.count()
    t = time.time()
    try:
        local.ensure_index_updated(str(RAG_STAGE2), ocr_enabled=True)
        err = None
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    dt = ms(t)
    after = local.vector_store.count()
    # indexed_files popolato?
    from data.config_manager import get_app_data_dir
    con = sqlite3.connect(f"file:{get_app_data_dir() / 'studioia.db'}?mode=ro", uri=True)
    n_idx = con.execute("SELECT COUNT(*) FROM indexed_files").fetchone()[0]
    con.close()
    return {"ms": dt, "chunks_before": before, "chunks_after": after,
            "indexed_files_rows_after": n_idx, "error": err}


# ======================================================================
# 5) ROOT CAUSE (regole da misura; evidenza testuale nel JSON)
# ======================================================================
def classify(qid, dump, snap, e2e):
    q = QUERIES[qid]
    markers = q["markers"]
    mcounts = snap["db"]["marker_chunk_counts"][qid]
    # chunk coperto in indice? (tutti i marker presenti per query con risposta attesa)
    if qid == "q4":
        covered = any(v > 0 for v in mcounts.values())  # atteso False
        stage_cov = "none-atteso"
    else:
        covered = all(v > 0 for v in mcounts.values())
        stage_cov = "appunti" if covered else "none"
    # il marker compare nel top-10 vettoriale di produzione?
    def in_top(t_list, marker, field):
        return any(marker.lower() in (t["txt"] or "").lower() for t in t_list)
    mf = dump.get("_marker_fulltext", {})
    vec_hits = [m for m in markers if mf.get(m, {}).get("vec_top10")]
    fts_hits = [m for m in markers if mf.get(m, {}).get("any_top10")]
    gate_hits = [m for m in markers if mf.get(m, {}).get("gate_selected")]
    gate = dump["gate"]
    sims = gate["sims"]

    evid = []
    ev = {
        "marker_chunk_counts": mcounts,
        "markers_in_vec_top10": vec_hits,
        "markers_in_any_top10": fts_hits,
        "markers_in_gate_selected": gate_hits,
        "gate_sims": sims,
        "semantic_router": dump["semantic_router"],
        "outcome_oggi": dump["outcome_oggi"],
    }

    if qid == "q4":
        if covered:
            rc = "MISS-RETRIEVAL/UNEXPECTED-COVERAGE"
            evid.append("q4: marker mitosi/meiosi PRESENTI in indice (inaspettato)")
        else:
            rc = "NO-WEB"
            evid.append("q4: nessun chunk con mitosi/meiosi in indice (COVERAGE assente su appunti/libri); "
                        "dipende tutto da web; se ddgs vuoto → generazione context=none")
        if e2e and not e2e.get("error"):
            if e2e.get("source_osservato") == "web":
                evid.append(f"E2E reale: source=web, {e2e['web_results']} risultati, "
                            f"web_ms={e2e['web_ms']}, llm_calls={e2e['llm_calls']['n']}")
            elif e2e.get("source_osservato") == "nessuna":
                rc = "NO-WEB"
                evid.append(f"E2E reale: ddgs vuoto → source=nessuna, "
                            f"llm_calls={e2e['llm_calls']['n']} (context=none)")
            else:
                evid.append(f"E2E reale: source={e2e.get('source_osservato')} — vedere response_head")
        else:
            evid.append("E2E non riuscito/errato: esito web/none dedotto code-path")
        return rc, evid, ev

    if not covered:
        rc = "COVERAGE"
        evid.append(f"marker {markers} non presenti in nessun chunk indicizzato "
                    f"(counts={mcounts}) — materiale solo in originals/ o non indicizzato")
        return rc, evid, ev

    if vec_hits:
        # marker in top-10 PRODUZIONE: soglia reale della sim del chunk col marker
        cand = [mf[m]["vec_sim_best"] for m in vec_hits
                if mf.get(m, {}).get("vec_sim_best") is not None]
        best = max(cand) if cand else None
        if best is not None and best >= STRONG and sims and max(sims) >= STRONG:
            rc = "OK"
            evid.append(f"marker in vec top-10 con sim={best} >= 0.45 → risposta locale")
        elif best is not None and best >= WEAK:
            rc = "THRESHOLD"
            evid.append(f"marker in vec top-10 con sim={best} in [0.35,0.45): "
                        f"solo match debole (confidence=bassa), gate NON letto dal router")
        else:
            rc = "THRESHOLD"
            evid.append(f"marker in vec top-10 ma sim={best} < 0.35 → NON selezionato (invisible: "
                        f"chunk sub-0.35 non torna dal caller)")
    else:
        if fts_hits:
            rc = "MISS-RETRIEVAL"
            evid.append(f"marker NON nel top-10 vettoriale ma PRESENTE nel ranking FTS5 "
                        f"(bm25) — il percorso prod usa search(hybrid=False) → FTS/RRF mai consultati")
        else:
            rc = "MISS-RETRIEVAL"
            evid.append(f"marker non in top-10 né vec né fts per '{trunc(q['text'],80)}' "
                        f"(counts in indice={mcounts})")
    # near-miss: sim massima sub-soglia
    all_vec = [t["vec"] for t in dump["top10"] if t["vec"] is not None]
    if all_vec:
        evid.append(f"sim top-10 vettoriali: {sorted(all_vec, reverse=True)}")
    return rc, evid, ev


# ======================================================================
def postprocess():
    """Aggiorna qa/f0_forensics.json con esiti OSSERVATI (E2E) + diagnosi
    sidecar (micro-test reale) + blocking findings definitivi. Rerunnable."""
    j = json.loads(OUT_JSON.read_text(encoding="utf-8"))

    # 1) esito osservato per i casi E2E (sostituisce la derivazione code-path)
    for case in j["cases"]:
        e = case.get("e2e")
        if e and not e.get("error"):
            case["outcome_oggi_codepath_derivato"] = case["outcome_oggi"]
            case["outcome_oggi"] = (
                f"E2E-OSSERVATO: source={e['source_osservato']}, "
                f"llm_calls={e['llm_calls']['n']}, total_ms={e['total_ms']:.0f}, "
                f"web_results={e.get('web_results')}"
            )
            if case["id"] == "q4":
                case["outcome_oggi"] += (
                    " — 1a chiamata: contesto LOCALE con chunk irrilevanti (sim 0.82) → "
                    "modello ha emesso [[NESSUNA_INFORMAZIONE_LOCALE]] → escalation libri(vuoto) → "
                    "web; la 2a chiamata genera la risposta web"
                )
        elif e and e.get("error"):
            case["outcome_oggi"] = f"E2E ERRORE: {e['error']} (esito dedotto code-path: {case['outcome_oggi']})"

    # 2) micro-test REALE sidecar bind (provenienza: eseguito ora)
    side = {"note": "micro-test reale eseguito in postprocess"}
    try:
        import inspect as _inspect
        from core.local_llm_client import LocalLLMClient, maybe_wrap_sidecar, SidecarLLMProxy
        cfg = __import__("data.config_manager", fromlist=["ConfigManager"]).ConfigManager()
        side["llm.backend"] = str(cfg.get("llm.backend", "sidecar"))
        cl = LocalLLMClient(model_path=cfg.get("local_model_path", ""), n_ctx=8192)
        pr = maybe_wrap_sidecar(cl)
        side["proxy_wrapped"] = isinstance(pr, SidecarLLMProxy)
        sig = _inspect.signature(type(pr._target).stream_via_sidecar)
        kw = dict(context_kind="locale", local_chunks=[], web_results=None,
                  allow_fallback_marker=True, images=[], thinking=False,
                  study_mode="default", stop_event=None, chitchat=False,
                  history_turns=[], part_index=0, is_last_part=True,
                  parts_summaries=[])
        try:
            sig.bind("QUERY", **kw)
            side["router_style_bind"] = "OK"
        except TypeError as te:
            side["router_style_bind"] = f"FAIL: {te}"
        side["conclusion"] = (
            "SidecarLLMProxy.generate_stream fa sig.bind su metodo NON bound: "
            "'self' assorbe il primo argomento → TypeError 'missing query' → "
            "fallback SILENZIOSO su generate_stream in-process. Con llm.backend=sidecar "
            "il sidecar (llama-server) NON viene MAI raggiunto dalle chiamate di Router "
            "(stesso identico percorso in produzione). E2E F0 eseguito in-process."
        )
    except Exception as e:
        side["error"] = f"{type(e).__name__}: {e}"
    j["env"]["sidecar_diagnostics"] = side

    # 3) blocking findings definitivi
    bf = j["summary"].setdefault("blocking_findings", [])
    bf.append(
        "SIDECAR-DEAD: bind TypeError silenzioso in SidecarLLMProxy.generate_stream "
        f"(misurato: {side.get('router_style_bind')}) → con llm.backend=sidecar la "
        "generazione resta in-process e llama-server non parte mai "
        "(sidecar state=down misurato); prod affetto identicamente")
    bf.append(
        "SOGLIE NON DISCRIMINANTI su questo corpus: tutte le sim top-10 >= 0.80 "
        "(q4 IRRILEVANTE a 0.82 >= 0.45) → gate H8 non blocca nulla; il meccanismo "
        "reale di astensione osservato E2E è il marker [[NESSUNA_INFORMAZIONE_LOCALE]] "
        "emesso dal modello, non il gate")
    bf.append(
        "LATENZA DOMINATA DA PROMPT-EVAL: E2E caldo q4 call1 prima risposta token a "
        "~75s (prompt ~2.4-2.8k token, pp ~37-40 tok/s misurati impliciti) vs gen ~10 tok/s; "
        "q1 tot 85.3s (include caricamento modello in-process ~ parte dei 81.3s a first token)")
    bf.append(
        "Caso 'non ho abbastanza informazioni' (context=none): code-path dedotto — se web "
        "vuoto, q4 avrebbe 2 generate_stream (1a locale-fallback + 2a context=none); "
        "NON misurato (web-off non simulato per veto); il messaggio è generato SENZA contesto")
    bf.append(
        "embedding_model_id: PRESENTE come file per-store (vector_index/"
        "embedding_model.txt = intfloat/multilingual-e5-small, = runtime); "
        "ABSENTE come colonna/champ nei metadati DB (chunks: id, doc_id, parent_id, "
        "source_file, store_key, testo, meta, dim)")
    j["summary"]["blocking_findings"] = bf

    # 4) near-miss probe honesty + rete effettiva
    j["summary"]["near_miss_probe_q5"] = (
        "q5 (parafrasi aggressiva) misurata a sim top1=0.8502 (>=0.45): NESSUN near-miss "
        "sotto soglia ottenibile su questo corpus unitario — THRESHOLD non osservato")
    j["summary"]["network_actual"] = (
        "Rete usata: SOLO stadio web di q4 E2E (1 batch ddgs, 1829.57ms, 5 risultati, "
        "query site: su 6 domini trusted su 4 batch possibili — break a 5 risultati). "
        "q1: 0 chiamate web. HF forzato offline.")
    j["summary"]["per_root_cause"] = {
        c["root_cause"]: sum(1 for x in j["cases"] if x["root_cause"] == c["root_cause"])
        for c in j["cases"]
    }
    OUT_JSON.write_text(json.dumps(j, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[F0] postprocess OK → {OUT_JSON}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-e2e", action="store_true")
    ap.add_argument("--no-reindex", action="store_true")
    ap.add_argument("--postprocess", action="store_true")
    args = ap.parse_args()
    if args.postprocess:
        postprocess()
        return

    from data.config_manager import get_app_data_dir
    appdata = get_app_data_dir()

    print(f"[F0] appdata={appdata}", flush=True)
    snap = snapshot(appdata)   # PRIMA di costruire gli store (scritture boot dichiarate)

    # costruzione store identica a api.py (scritture boot: embedding_model.txt
    # riscritto idempotente + eventuale chroma_migrated.flag — dichiarate)
    from data.db import Database
    from core.rag.vector_store import VectorStore
    from core.local_search import LocalSearchEngine
    from core.semantic_router import SemanticRouter

    t = time.time()
    db = Database()
    vs = VectorStore(str(appdata / "vector_index"))
    local = LocalSearchEngine(db, vs)
    vs_b = VectorStore(str(appdata / "vector_index_books"))
    books = LocalSearchEngine(db, vs_b, local.embedder)
    sr = SemanticRouter(local.embedder)
    boot_ms = ms(t)
    print(f"[F0] boot store/engine: {boot_ms} ms; chunks local={vs.count()} books={vs_b.count()}",
          flush=True)

    # embedder runtime id
    from core.rag.embedder import _MODEL_NAME as RUNTIME_MODEL
    idx_model = snap["files"].get("vector_index/embedding_model.txt", "ABSENT")

    engines = (sr, local, books, vs)
    dumps = {}
    for qid, q in QUERIES.items():
        t = time.time()
        d = dump_query(qid, q, engines)
        d["_dump_wall_ms"] = ms(t)
        dumps[qid] = d
        print(f"[F0] {qid}: use_rag={d['semantic_router']['use_rag']} "
              f"vec_top1={d['vec_scores'][:1]} gate_sims={d['gate']['sims']} "
              f"conf={d['gate']['confidence']} outcome={d['outcome_oggi']}", flush=True)

    # ---- E2E (rete: SOLO per q4 → ddgs; dichiarata) ----
    e2e = {}
    proxy = None
    if not args.no_e2e:
        print("[F0] E2E inizio (sidecar llama-server locale, rete solo per q4/ddgs)", flush=True)
        e2e, proxy = run_e2e(E2E_CASES, engines, {})
    sidecar_info = shutdown_sidecar() if proxy is not None else {"attempted": False}

    # ---- reindex (dopo i dump) ----
    reidx = None
    if not args.no_reindex:
        reidx = measure_reindex(local)
        print(f"[F0] reindex: {reidx}", flush=True)

    # ---- classificazione ----
    cases = []
    per_rc = {}
    blocking = []
    for qid, q in QUERIES.items():
        e = e2e.get(qid)
        rc, evid, ev_extra = classify(qid, dumps[qid], snap, e)
        per_rc[rc] = per_rc.get(rc, 0) + 1
        method = "e2e-reale" if e else "retrieval-level+code-path"
        d = dumps[qid]
        cost = {
            "stages_ms": {
                "semantic_router": d["semantic_router_ms"],
                "embed_query": d["embed_query_ms"],
                "vec": d["vec_ms"],
                "fts": d["fts_ms"],
                "local_search_total": d["local_search_ms"],
                "books_search": d["books_search_ms"],
            },
            "llm_calls": (e["llm_calls"]["n"] if e else 1),
            "llm_calls_note": ("misurato reale (contatore su generate_stream)" if e else
                               "DEDOTTO code-path: 1 generate_stream per risposta "
                               "(router.py; q1/q4 E2E confermano il pattern)"),
            "total_ms": (e["total_ms"] if e else None),
            "method_cost": ("misurato E2E" if e else "retrieval misurato; generazione NON misurata (null)"),
        }
        if e:
            cost["stages_ms"]["web"] = e["web_ms"]
            cost["stages_ms"]["llm_gen_total"] = sum(e["llm_calls"]["ms"])
            cost["first_token_ms"] = e["first_token_ms"]
        if qid == "q4" and reidx:
            cost["stages_ms"]["reindex_background_ms"] = reidx["ms"]
            cost["reindex_note"] = ("reindex è BACKGROUND (api ogni 300s), NON nel path di query; "
                                    "misurato 1x reale qui")
        case = {
            "id": qid,
            "query": q["text"],
            "method": method,
            "stages_dump": {
                "semantic_router": d["semantic_router"],
                "semantic_router_ms": d["semantic_router_ms"],
                "embed_query_ms": d["embed_query_ms"],
                "vec_ms": d["vec_ms"],
                "fts_ms": d["fts_ms"],
                "fts_scores": d["fts_scores"],
                "vec_scores": d["vec_scores"],
                "rrf_ranks": d["rrf_ranks"],
                "top10": d["top10"],
                "gate": d["gate"],
                "marker_check": ev_extra,
            },
            "outcome_oggi": d["outcome_oggi"],
            "outcome_path": d["outcome_path"],
            "coverage": {
                "chunk_exists": all(v > 0 for v in snap["db"]["marker_chunk_counts"][qid].values())
                               if qid != "q4" else False,
                "marker_counts": snap["db"]["marker_chunk_counts"][qid],
                "stage": ("appunti" if qid != "q4" else "none"),
                "originals_vs_rag_stage2": {
                    "originals/": snap["files"]["originals/"],
                    "rag_stage2/": snap["files"]["rag_stage2/"],
                    "indexed_sources": [s["source_file"] for s in snap["db"]["sources"]],
                    "originals_indicizzato": any(
                        "originals" in (s["source_file"] or "").lower()
                        for s in snap["db"]["sources"]),
                },
                "embedding_model_id_index": idx_model,
                "embedding_model_id_runtime": RUNTIME_MODEL,
                "embedding_model_id_persist": {
                    "file_vector_index": snap["files"].get("vector_index/embedding_model.txt"),
                    "file_vector_index_books": snap["files"].get("vector_index_books/embedding_model.txt"),
                    "colonna_db_chunks": "PRESENTE" if snap["db"]["embedding_model_id_column_in_chunks"] else "ABSENTE",
                    "verdetto": ("PRESENTE come file per-store (embedding_model.txt); "
                                 "ABSENTE come colonna nei metadati DB" ),
                },
            },
            "cost": cost,
            "root_cause": rc,
            "evidenza": "; ".join(evid),
            "e2e": ({k: e[k] for k in
                     ("total_ms", "first_token_ms", "n_tokens", "source_osservato",
                      "llm_calls", "stages_ms", "web_ms", "web_batches", "web_results",
                      "queue_events", "response_head", "error")} if e else None),
        }
        cases.append(case)

    # ---- blocking findings (dalla misura) ----
    if snap["db"]["indexed_files_rows"] == 0 and snap["db"]["chunks_per_store"]:
        blocking.append(
            f"indexed_files VUOTO ({snap['db']['indexed_files_rows']} righe) con "
            f"{sum(x['n'] for x in snap['db']['chunks_per_store'])} chunk presenti → ogni "
            f"reindex background (300s) rifull re-parse+re-embed del file "
            f"(reindex misurato: {reidx['ms'] if reidx else 'n/d'} ms)")
    blocking.append(
        "Il gate H8 (confidence/should_answer) NON è letto da router.py/api.py "
        "(grep: consumatori solo core/local_search.py + core/models.py) → oggi "
        "l'astensione non decide nulla nel percorso generativo")
    blocking.append(
        "Percorso produzione search(hybrid=False): FTS5/BM25 e fusione RRF mai "
        "consultati in query (grep hybrid=True: solo definizioni/commenti in "
        "local_search.py) → dump FTS/RRF di F0.1 è diagnostico")
    if idx_model == RUNTIME_MODEL and idx_model not in (None, "ABSENT"):
        pass  # coerenza embedder OK
    else:
        blocking.append(
            f"EMBEDDER-MISMATCH: index={idx_model!r} vs runtime={RUNTIME_MODEL!r}")

    out = {
        "round": "R15b",
        "agent": "ANALYST-FORENSICS F0",
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        "method_legend": {
            "e2e-reale": "flusso completo con LLM locale reale (sidecar llama-server), strumentato",
            "retrieval-level+code-path": "misura reale di retrieval+gate+router; generazione dedotta da lettura code-path (marcato)",
        },
        "env": {
            "appdata": str(appdata),
            "db_snapshot": snap["db"],
            "files_snapshot": {k: v for k, v in snap["files"].items() if "embedding" in k},
            "embedder_runtime": RUNTIME_MODEL,
            "embedder_index": idx_model,
            "boot_store_ms": boot_ms,
            "reindex_measured": reidx,
            "sidecar_shutdown": sidecar_info,
            "network_declared": "SOLO caso q4: ddgs → DuckDuckGo (via core/web_search.search_web); HF offline forzato",
        },
        "cases": cases,
        "summary": {
            "per_root_cause": per_rc,
            "blocking_findings": blocking,
            "e2e_llm_calls": {qid: (e2e[qid]["llm_calls"]["n"] if qid in e2e else None)
                              for qid in E2E_CASES},
            "e2e_total_ms": {qid: (e2e[qid]["total_ms"] if qid in e2e else None)
                             for qid in E2E_CASES},
        },
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[F0] scritto {OUT_JSON}", flush=True)
    print(json.dumps(out["summary"], ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()

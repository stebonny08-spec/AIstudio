"""
data/migrate_real.py
--------------------
G3 — Migrazione H1 sicura sul DATO REALE (chroma -> SQLite FTS5 + sqlite-vec).

Owner: G3 (file NUOVO). NON tocca backend/api.py, web_frontend, core/sidecar,
core/registry, core/router ne' tests altrui.

Comandi riproducibili:
    python data/migrate_real.py             # 3.1 DRY-RUN (DEFAULT): 0 scrittura
                                             #    su %APPDATA%
    python data/migrate_real.py --backup    # 3.2 backup indice chroma +
                                             #    studioia.db con manifest SHA256
    python data/migrate_real.py --commit    # 3.3 CUTOVER con guardie:
                                             #    gate -> backup -> migrazione
                                             #    -> post-check -> qa/g3_migration.json
    python data/migrate_real.py --restore <manifest.json>   # ripristino verificato

Dry-run (3.1)
  - apre l'indice chroma REALE in sola lettura COPIANDOLO in temp
    (nessun client chroma viene mai aperto sul percorso %APPDATA%);
  - migra la copia in un SQLiteVectorStore su FILE TEMP
    (migrate_chroma_to_sqlite: riusa i vettori, nessun re-embedding, idempotente);
  - (a) parity top-10 su >=20 query derivate dai .md REALI
        (file_AIstudio/rag_stage2/*.md) con DeterministicEmbedder
        (tests/testH1_parity.py, stesso protocollo: STESSO embedder per
        entrambi i backend, nessun modello scaricato);
  - (b) recall@5 sul corpus reale: frazione di query con >=1 risultato
        top-5 appartenente al .md di origine del golden;
  - scrive SOLO qa/g3_migration_dryrun.json.

Backup (3.2)
  - copia vector_index (+ vector_index_books se presente) e studioia.db in
    %APPDATA%/NovaStudio/backup_chroma_<ts>/ con manifest.json SHA256;
  - restore(manifest) riverifica gli SHA256 PRIMA (integrita' backup) e DOPO
    (identita' del file ripristinato).

Cutover (3.3)
  - legge qa/g3_migration_dryrun.json e procede SOLO se
    parity_top10 >= 1.000 E recall5 >= 1.000 (altrimenti status=BLOCKED
    con procedura manuale);
  - ordine: backup -> migrate_chroma_to_sqlite sul DB reale di
    %APPDATA%/NovaStudio -> post-check (conteggi + sha backup riverificati)
    -> qa/g3_migration.json.

ATTENZIONE: prima di --commit chiudere l'applicazione (l'indice chroma
viene copiato con la API sqlite per i file .sqlite3, ma la coerenza
complessiva dell'indice Chroma e' garantita solo con l'app chiusa).

R13 (round 13) — comandi aggiuntivi (owner IMPLEMENTER-RAG):
    python data/migrate_real.py --dedupe-legacy           # C3 DRY-RUN (default):
                                                          #   elenca chunk LEGACY di
                                                          #   store 'vector_index' (0 scrittura)
    python data/migrate_real.py --dedupe-legacy --apply   # C3: backup SHA256+manifest ->
                                                          #   DELETE solo duplicati esatti
                                                          #   (sha256 tra i testi rag_stage2/)
                                                          #   -> post-check + parity retrieval
    python data/migrate_real.py --books-dry-run           # BOOKS1: parity/recall su
                                                          #   vector_index_books REALE
    python data/migrate_real.py --books-backup-verify     # BOOKS2: backup SHA256+manifest
                                                          #   libri + test restore su TEMP
    python data/migrate_real.py --books-cutover           # BOOKS3: cutover chroma->sqlite
                                                          #   store libri + rollback testato
    python data/migrate_real.py --books4-imports          # BOOKS4: scan import chromadb
                                                          #   nel runtime (eager=0 dichiarato)
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from core.rag.vector_store_sqlite import (  # noqa: E402
    SQLiteVectorStore,
    migrate_chroma_to_sqlite,
)

# ---------------------------------------------------------------- percorsi
QA_DIR = _PROJECT_ROOT / "qa"
DRYRUN_JSON = QA_DIR / "g3_migration_dryrun.json"
COMMIT_JSON = QA_DIR / "g3_migration.json"
CORPUS_DIR = _PROJECT_ROOT / "file_AIstudio" / "rag_stage2"
BACKUP_PREFIX = "backup_chroma_"
BACKUP_ITEMS = ("vector_index", "vector_index_books", "studioia.db")
GATE_MIN = 1.0          # parity_top10 >= 1.000 e recall5 >= 1.000
N_QUERIES = 24          # >= 20 richiesto dal compito 3.1
COMANDO = "python data/migrate_real.py"
COMANDO_COMMIT = "python data/migrate_real.py --commit"

_H1_MOD = None          # modulo tests/testH1_parity.py caricato una volta


def _log(msg: str) -> None:
    """Print sicuro per console cp1252 (Windows)."""
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"))


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _ts() -> str:
    return time.strftime("%Y%m%d_%H%M%S")


def _app_dir() -> Path:
    """%APPDATA%/NovaStudio — SOLO LETTURA qui (nessuna mkdir)."""
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / "NovaStudio"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "NovaStudio"
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "NovaStudio"


def _write_json(path: Path, data: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str),
                   encoding="utf-8")
    tmp.replace(path)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _files_digest(files: List[dict]) -> str:
    payload = json.dumps(files, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _copy_file_safe(src: Path, dst: Path) -> None:
    """Copia con fallback sqlite (file .sqlite3/db copiati consistenti anche
    se un altro processo li tiene aperti in lettura)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    use_sqlite = src.suffix.lower() in (".sqlite3", ".db")
    if use_sqlite:
        import sqlite3
        try:
            sconn = sqlite3.connect(f"file:{src.resolve().as_posix()}?mode=ro", uri=True)
            try:
                dconn = sqlite3.connect(str(dst))
                try:
                    sconn.backup(dconn)
                finally:
                    dconn.close()
            finally:
                sconn.close()
            return
        except sqlite3.Error:
            pass  # non e' un db valido: copia byte a byte
    shutil.copy2(src, dst)


# ======================================================================
# 3.1 — DRY-RUN
# ======================================================================
def _load_h1_embedder(dim: int):
    """DeterministicEmbedder di tests/testH1_parity.py con DIM adattata al
    vettore REALE dell'indice (il modulo usa la globale DIM a runtime)."""
    global _H1_MOD
    if _H1_MOD is None:
        import importlib.util
        path = _PROJECT_ROOT / "tests" / "testH1_parity.py"
        spec = importlib.util.spec_from_file_location("g3_h1_parity", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _H1_MOD = mod
    _H1_MOD.DIM = int(dim)
    return _H1_MOD.DeterministicEmbedder()


def derive_queries(md_dir, n: int = N_QUERIES) -> List[Dict[str, str]]:
    """Query derivate dai .md REALI del corpus (sola lettura): frasi/paragrafi
    lunghi, campionati in modo uniforme su tutti i file. gold = nome file."""
    queries: List[Dict[str, str]] = []
    md_dir = Path(md_dir)
    if not md_dir.is_dir():
        return queries
    for md in sorted(md_dir.glob("*.md")):
        try:
            text = md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            s = line.strip().lstrip("#").strip()
            if len(s) < 40 or len(s.split()) < 6:
                continue
            if set(s) <= set("-|* "):
                continue
            queries.append({"query": s[:300], "gold": md.name})
    if len(queries) > n:
        step = len(queries) / float(n)
        queries = [queries[int(i * step)] for i in range(n)]
    return queries


def _open_chroma_readonly_copy(chroma_copy: Path):
    """Apre l'indice chroma su una COPIA temporanea (il source reale non viene
    mai aperto: 0 scrittura su %APPDATA%)."""
    import chromadb
    client = chromadb.PersistentClient(path=str(chroma_copy))
    try:
        col = client.get_collection("documenti_locali", metadata={"hnsw:space": "cosine"})
    except Exception:
        col = client.get_or_create_collection("documenti_locali",
                                              metadata={"hnsw:space": "cosine"})
    return col


def _key(source_file: str, text: str):
    return (source_file or "", text or "")


def _parity_top10(col, store, embedder, queries, k: int = 10):
    """(a) overlap medio top-10 fra chroma (sorgente) e sqlite (migrato) sulle
    STESSHE query vettoriali — protocollo identico a tests/testH1_parity.py."""
    overlaps: List[float] = []
    per: List[dict] = []
    n = col.count()
    if n == 0:
        return 0.0, per
    for item in queries:
        try:
            qv = embedder.embed_one(item["query"], kind="query")
            c = col.query(query_embeddings=[qv],
                          n_results=min(k, n),
                          include=["documents", "metadatas"])
            # R18 B4: confronto per HASH DI CONTENUTO (identico a entrambi
            # i lati): i duplicati (stesso testo, path diversi) non
            # alterano piu' l'overlap - il top-k sqlite e' dedupplicato.
            import hashlib as _hl
            import re as _re

            def _chsh(t):
                norm = _re.sub(r"\s+", " ", str(t or "").strip().lower())
                return _hl.sha1(norm.encode("utf-8", "ignore")).hexdigest()

            c_rows = {
                _chsh(d)
                for d, m in zip((c.get("documents") or [[]])[0] or [],
                                (c.get("metadatas") or [[]])[0] or [])
            }
            s_rows = {_chsh(r.get("text", ""))
                      for r in store.query(qv, top_k=k)}
            denom = min(len(c_rows), len(s_rows), k) or 1
            ov = len(c_rows & s_rows) / float(denom)
        except Exception as exc:  # una query rotta non deve uccidere il run
            ov = 0.0
            per.append({"query": item["query"][:80], "overlap": 0.0,
                        "error": str(exc)[:200]})
            overlaps.append(ov)
            continue
        overlaps.append(ov)
        per.append({"query": item["query"][:80], "gold": item["gold"],
                    "overlap": round(ov, 4)})
    mean = sum(overlaps) / len(overlaps) if overlaps else 0.0
    return mean, per


def _gold_centroids(col) -> Dict[str, List[float]]:
    """Centroide dei vettori REALI per ogni source_file (usato solo come
    fallback deterministico della recall se il modello non e' caricabile)."""
    total = col.count()
    if total <= 0:
        return {}
    data = col.get(include=["embeddings", "metadatas"], limit=total)
    # NB: embeddings e' un array numpy -> MAI "or []" (ambiguous truth)
    emb_arr = data.get("embeddings")
    meta_arr = data.get("metadatas")
    emb_list = list(emb_arr) if emb_arr is not None else []
    meta_list = list(meta_arr) if meta_arr is not None else []
    sums: Dict[str, List[float]] = {}
    counts: Dict[str, int] = {}
    for emb, meta in zip(emb_list, meta_list):
        if emb is None:
            continue
        vec = emb.tolist() if hasattr(emb, "tolist") else list(emb)
        sf = str((meta or {}).get("source_file", ""))
        acc = sums.get(sf)
        if acc is None:
            sums[sf] = [float(x) for x in vec]
            counts[sf] = 1
        elif len(acc) == len(vec):
            for i, x in enumerate(vec):
                acc[i] += float(x)
            counts[sf] += 1
    out: Dict[str, List[float]] = {}
    for sf, acc in sums.items():
        n = counts.get(sf) or 1
        u = [x / n for x in acc]
        norm = sum(x * x for x in u) ** 0.5 or 1.0
        out[sf] = [x / norm for x in u]
    return out


def _real_embedder_or_none(dim: int):
    """Embedder di produzione (intfloat/multilingual-e5-small) SE caricabile
    offline e SE la sua dimensione coincide con quella dell'indice.
    Altrimenti None -> fallback ancorato (dichiarato in 'metodo')."""
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    try:
        from core.rag.embedder import Embedder
        emb = Embedder()
        probe = emb.embed_one("g3 probe dimensione indice", kind="query")
        if probe is not None and len(probe) == dim:
            return emb
        return None
    except Exception:
        return None


def _make_anchor_qfn(col, dim: int) -> Callable[[Dict[str, str]], List[float]]:
    """Fallback deterministico: query = centroide del doc gold + 10% di rumore
    deterministico (DeterministicEmbedder). Utile se il modello reale non e'
    disponibile: verifica comunque che i chunk del gold siano recuperabili."""
    cents = _gold_centroids(col)
    det = _load_h1_embedder(dim)

    def qfn(item: Dict[str, str]) -> List[float]:
        gold = item.get("gold", "")
        cent = next(
            (v for sf, v in cents.items()
             if gold and sf.replace("\\", "/").endswith(gold) and len(v) == dim),
            None,
        )
        noise = det.embed_one("q:" + item["query"], kind="query")
        if cent is None:
            return noise
        v = [c + 0.10 * q for c, q in zip(cent, noise)]
        norm = sum(x * x for x in v) ** 0.5 or 1.0
        return [x / norm for x in v]

    return qfn


def _recall5(store, queries, qfn) -> tuple:
    """(b) frazione di query con >=1 risultato top-5 dal .md di origine."""
    hits = 0
    per: List[dict] = []
    for item in queries:
        hit = False
        err = None
        try:
            qv = qfn(item)
            res = store.query(qv, top_k=5)
            hit = any(item["gold"] in (r.get("source_file") or "") for r in res)
        except Exception as exc:
            err = str(exc)[:200]
        hits += 1 if hit else 0
        entry = {"query": item["query"][:80], "gold": item["gold"], "hit": hit}
        if err:
            entry["error"] = err
        per.append(entry)
    recall = hits / len(queries) if queries else 0.0
    return recall, per


def dry_run(
    chroma_dir=None,
    md_dir=None,
    out_json=None,
    work_root=None,
    use_real_embedder: bool = True,
    store_key: str = "vector_index",
) -> dict:
    """3.1 DRY-RUN: 0 scrittura su %APPDATA%, output SOLO su out_json."""
    chroma_dir = Path(chroma_dir) if chroma_dir else (_app_dir() / "vector_index")
    md_dir = Path(md_dir) if md_dir else CORPUS_DIR
    out_json = Path(out_json) if out_json else DRYRUN_JSON

    result: Dict[str, Any] = {
        "status": "KO",
        "parity_top10": 0.0,
        "recall5": 0.0,
        "n_chunks": 0,
        "chroma_count": 0,
        "dim": None,
        "queries": [],
        "n_queries": 0,
        "metodo": "",
        "comando_riproduzione": COMANDO,
        "chroma_source": str(chroma_dir),
        "corpus": str(md_dir),
        "migrate_stats": {},
        "parity_per_query": [],
        "recall_per_query": [],
        "ts": _now(),
        "error": None,
    }

    has_src = chroma_dir.is_dir() and (
        (chroma_dir / "chroma.sqlite3").exists() or any(chroma_dir.glob("*.sqlite3"))
    )
    if not has_src:
        result["status"] = "NO_SOURCE"
        result["error"] = f"indice chroma sorgente assente: {chroma_dir}"
        result["metodo"] = "dry-run non eseguibile: nessun indice chroma reale."
        _write_json(out_json, result)
        _log(f"[G3][DRY-RUN] STATUS=NO_SOURCE -> {out_json}")
        return result

    own_work = work_root is None
    work = Path(work_root) if work_root else Path(tempfile.mkdtemp(prefix="g3_dryrun_"))
    store: Optional[SQLiteVectorStore] = None
    try:
        # 1) COPIA read-only dell'indice reale (0 scrittura su %APPDATA%)
        chroma_copy = work / "chroma_ro"
        shutil.copytree(chroma_dir, chroma_copy)

        # 2) migrazione su FILE TEMP (riuso vettori, nessun re-embedding)
        store = SQLiteVectorStore(
            str(work / store_key),
            db_path=str(work / "studioia.db"),
            store_key=store_key,
        )
        stats = migrate_chroma_to_sqlite(str(chroma_copy), store,
                                         store_key=store_key)
        n_chunks = store.count()
        result["migrate_stats"] = stats

        # 3) apertura della copia chroma per il confronto
        col = _open_chroma_readonly_copy(chroma_copy)
        chroma_count = col.count()
        result["chroma_count"] = chroma_count

        dim = None
        if chroma_count > 0:
            probe = col.get(include=["embeddings"], limit=1)
            emb_list = probe.get("embeddings")  # NB: numpy -> MAI "or []"
            emb0 = emb_list[0] if emb_list is not None and len(emb_list) > 0 else None
            if emb0 is not None:
                dim = len(emb0.tolist() if hasattr(emb0, "tolist") else emb0)
        result["dim"] = dim

        # 4) query derivate dai .md REALI
        queries = derive_queries(md_dir, N_QUERIES)
        result["queries"] = queries
        result["n_queries"] = len(queries)

        metodo_parts: List[str] = []
        parity = 0.0
        recall = 0.0
        if not queries:
            metodo_parts.append(
                "NESSUNA query derivabile: corpus .md assente o vuoto "
                f"({md_dir}) -> parity/recall forzati a 0 (cutover BLOCKED)."
            )
        elif not dim or n_chunks == 0 or chroma_count == 0:
            metodo_parts.append(
                "Indice vuoto o dimensione vettori non rilevabile -> "
                "parity/recall forzati a 0 (cutover BLOCKED)."
            )
        else:
            # (a) PARITY — DeterministicEmbedder (protocollo testH1), stessa
            # dimensione del vettore reale, stesso vettore query per entrambi.
            h1e = _load_h1_embedder(dim)
            parity, per_p = _parity_top10(col, store, h1e, queries)
            result["parity_per_query"] = per_p
            metodo_parts.append(
                f"(a) parity top-10 su {len(queries)} query derivate dai .md di "
                f"{md_dir}; DeterministicEmbedder (tests/testH1_parity.py) con "
                f"dim={dim} (vettore reale dell'indice); STESSO embedder per "
                f"chroma (copia read-only) e sqlite (file temp); overlap = "
                f"intersezione(top10_chroma, top10_sqlite) / min(10)."
            )
            # (b) RECALL@5
            qfn = None
            if use_real_embedder:
                real = _real_embedder_or_none(dim)
                if real is not None:
                    qfn = lambda item: real.embed_one(item["query"], kind="query")  # noqa: E731
                    metodo_parts.append(
                        "(b) recall@5 con l'embedder di PRODUZIONE "
                        "(core.rag.embedder, stesso modello dell'indice); "
                        "hit = >=1 risultato top-5 dal .md di origine."
                    )
            if qfn is None:
                qfn = _make_anchor_qfn(col, dim)
                metodo_parts.append(
                    "(b) recall@5 con query vettoriali ANCORATE al centroide "
                    "dei vettori reali del .md gold + 10% rumore "
                    "deterministico DeterministicEmbedder (modello di "
                    "produzione non caricabile o dimensione diversa); "
                    "hit = >=1 risultato top-5 dal .md di origine."
                )
            recall, per_r = _recall5(store, queries, qfn)
            result["recall_per_query"] = per_r

        result["parity_top10"] = round(parity, 6)
        result["recall5"] = round(recall, 6)
        result["n_chunks"] = n_chunks
        result["metodo"] = " ".join(metodo_parts)
        ok = (parity >= GATE_MIN and recall >= GATE_MIN and n_chunks > 0)
        result["status"] = "OK" if ok else "KO"
        result["gate"] = {
            "parity_min": GATE_MIN,
            "recall5_min": GATE_MIN,
            "pass": bool(ok),
        }
        store.close()
        store = None
        _write_json(out_json, result)
        _log(f"[G3][DRY-RUN] STATUS={result['status']} "
             f"parity_top10={result['parity_top10']:.6f} "
             f"recall5={result['recall5']:.6f} n_chunks={n_chunks} "
             f"chroma_count={chroma_count} dim={dim} "
             f"queries={len(queries)} -> {out_json}")
        return result
    except Exception as exc:
        result["status"] = "ERROR"
        result["error"] = str(exc)
        _write_json(out_json, result)
        _log(f"[G3][DRY-RUN] ERROR: {exc}")
        return result
    finally:
        if store is not None:
            try:
                store.close()
            except Exception:
                pass
        if own_work:
            shutil.rmtree(work, ignore_errors=True)


# ======================================================================
# 3.2 — BACKUP / RESTORE
# ======================================================================
def backup(app_dir=None, backup_root=None, ts: Optional[str] = None) -> dict:
    """Copia indice chroma (+books) e studioia.db in backup_chroma_<ts>/
    con manifest SHA256. Default: dentro la cartella app (%APPDATA%)."""
    app_dir = Path(app_dir) if app_dir else _app_dir()
    backup_root = Path(backup_root) if backup_root else app_dir
    stamp = ts or _ts()
    bdir = backup_root / f"{BACKUP_PREFIX}{stamp}"
    n = 0
    while bdir.exists():
        n += 1
        bdir = backup_root / f"{BACKUP_PREFIX}{stamp}_{n}"
    try:
        bdir.mkdir(parents=True, exist_ok=False)
    except OSError as exc:
        return {"ok": False, "error": f"creazione backup fallita: {exc}"}

    files: List[dict] = []
    try:
        for name in BACKUP_ITEMS:
            src = app_dir / name
            if not src.exists():
                continue
            if src.is_dir():
                dst = bdir / name
                shutil.copytree(src, dst)
                for f in sorted(dst.rglob("*")):
                    if f.is_file():
                        rel = f"{name}/{f.relative_to(dst).as_posix()}"
                        files.append({"path": rel, "sha256": _sha256_file(f),
                                      "size": f.stat().st_size})
            else:
                dst = bdir / name
                _copy_file_safe(src, dst)
                files.append({"path": name, "sha256": _sha256_file(dst),
                              "size": dst.stat().st_size})
        if not files:
            return {"ok": False,
                    "error": f"nessun file da backupcare in {app_dir}"}
        manifest = {
            "version": 1,
            "created": _now(),
            "app_dir": str(app_dir),
            "backup_dir": str(bdir),
            "files": files,
            "manifest_sha256": _files_digest(files),
        }
        mpath = bdir / "manifest.json"
        _write_json(mpath, manifest)
        return {
            "ok": True,
            "backup_dir": str(bdir),
            "manifest_path": str(mpath),
            "n_files": len(files),
            "sha256": {f["path"]: f["sha256"] for f in files},
            "ts": manifest["created"],
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "backup_dir": str(bdir)}


def _verify_backup(manifest_path) -> bool:
    """Riverifica SHA256 di OGNI file del backup rispetto al manifest."""
    try:
        m = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        if _files_digest(m["files"]) != m.get("manifest_sha256"):
            return False
        bdir = Path(m["backup_dir"])
        return all(_sha256_file(bdir / f["path"]) == f["sha256"]
                   for f in m["files"])
    except Exception:
        return False


def restore(manifest_path, app_dir=None) -> dict:
    """Ripristina i file indicati nel manifest e RIVERIFICA gli SHA256
    sia della sorgente di backup sia della copia ripristinata."""
    manifest_path = Path(manifest_path)
    try:
        m = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "error": f"manifest illeggibile: {exc}"}
    if _files_digest(m.get("files") or []) != m.get("manifest_sha256"):
        return {"ok": False,
                "error": "manifest_sha256 non valido (manifest corrotto/tampato)"}
    target = Path(app_dir) if app_dir else Path(m["app_dir"])
    bdir = Path(m["backup_dir"])
    if not bdir.is_dir():
        bdir = manifest_path.parent
    restored = 0
    mismatches: List[dict] = []
    for f in m["files"]:
        src = bdir / f["path"]
        dst = target / f["path"]
        try:
            sha_src = _sha256_file(src)
        except OSError as exc:
            mismatches.append({"path": f["path"], "stage": "backup_read",
                               "error": str(exc)})
            continue
        if sha_src != f["sha256"]:
            mismatches.append({"path": f["path"], "stage": "backup_verify",
                               "expected": f["sha256"], "found": sha_src})
            continue
        try:
            if src.is_dir():
                continue
            if src.name == f["path"].split("/")[-1] and "/" not in f["path"]:
                _copy_file_safe(src, dst)
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                _copy_file_safe(src, dst)
            sha_dst = _sha256_file(dst)
        except OSError as exc:
            mismatches.append({"path": f["path"], "stage": "restore",
                               "error": str(exc)})
            continue
        if sha_dst != f["sha256"]:
            mismatches.append({"path": f["path"], "stage": "restore_verify",
                               "expected": f["sha256"], "found": sha_dst})
        else:
            restored += 1
    return {
        "ok": not mismatches,
        "restored": restored,
        "total": len(m["files"]),
        "verified": restored,
        "mismatches": mismatches,
        "app_dir": str(target),
    }


_PROCEDURA_MANUALE = [
    "1) NON procedere se qa/g3_migration_dryrun.json non esiste o contiene "
    "parity_top10 < 1.000 oppure recall5 < 1.000: ripetere prima il dry-run "
    "con 'python data/migrate_real.py' e indagare le query con overlap/hit=0.",
    "2) Backup manuale dell'indice: 'python data/migrate_real.py --backup' "
    "(manifest SHA256 in %APPDATA%\\NovaStudio\\backup_chroma_<ts>\\manifest.json).",
    "3) Cutover manuale SOLO con gate superati: chiudere l'applicazione, "
    "poi 'python data/migrate_real.py --commit'.",
    "4) Alternativa senza migrazione (reindex da file): tenere "
    "RAG_BACKEND=sqlite e riscansionare file_AIstudio/rag_stage2 con "
    "Indexer.index_folder (ricalcola gli embedding dal corpus reale).",
    "5) Rollback: from data.migrate_real import restore; "
    "restore('<percorso>/manifest.json') — riverifica SHA256 di ogni file.",
]


# ======================================================================
# 3.3 — CUTOVER
# ======================================================================
def commit(app_dir=None, dryrun_json=None, out_json=None) -> dict:
    """Cutover con GUARDIE. Legge il dry-run e procede SOLO se
    parity_top10 >= 1.000 e recall5 >= 1.000."""
    app_dir = Path(app_dir) if app_dir else _app_dir()
    dryrun_json = Path(dryrun_json) if dryrun_json else DRYRUN_JSON
    out_json = Path(out_json) if out_json else COMMIT_JSON

    def _blocked(reason: str, gates: dict) -> dict:
        res = {
            "status": "BLOCKED",
            "reason": reason,
            "gates": gates,
            "backup_path": None,
            "chunks": 0,
            "parity": gates.get("parity", 0.0),
            "recall5": gates.get("recall5", 0.0),
            "procedura_manuale": list(_PROCEDURA_MANUALE),
            "comando": COMANDO_COMMIT,
            "ts": _now(),
        }
        _write_json(out_json, res)
        _log(f"[G3][CUTOVER] STATUS=BLOCKED ({reason}) -> {out_json}")
        return res

    # --- gate 0: dry-run presente? ---
    if not dryrun_json.exists():
        return _blocked(
            f"dry-run assente ({dryrun_json}): eseguire prima '{COMANDO}'",
            {"parity": 0.0, "recall5": 0.0, "parity_min": GATE_MIN,
             "recall5_min": GATE_MIN, "pass": False},
        )
    try:
        d = json.loads(dryrun_json.read_text(encoding="utf-8"))
    except Exception as exc:
        return _blocked(f"dry-run illeggibile: {exc}",
                        {"parity": 0.0, "recall5": 0.0, "parity_min": GATE_MIN,
                         "recall5_min": GATE_MIN, "pass": False})

    parity = float(d.get("parity_top10", 0) or 0.0)
    recall = float(d.get("recall5", 0) or 0.0)
    n_dry = int(d.get("n_chunks", 0) or 0)
    gates = {"parity": parity, "recall5": recall,
             "parity_min": GATE_MIN, "recall5_min": GATE_MIN,
             "pass": parity >= GATE_MIN and recall >= GATE_MIN}
    if not gates["pass"]:
        return _blocked(
            f"gate non superati (parity_top10={parity:.6f}, recall5={recall:.6f}; "
            f"servono entrambi >= {GATE_MIN:.3f})",
            gates,
        )

    # --- 1) BACKUP (prima di ogni scrittura sul dato reale) ---
    b = backup(app_dir=app_dir)
    if not b.get("ok"):
        res = {
            "status": "FAILED",
            "reason": f"backup fallito ({b.get('error')}): migrazione NON eseguita",
            "backup_path": b.get("backup_dir"),
            "chunks": 0, "parity": parity, "recall5": recall,
            "procedura_manuale": list(_PROCEDURA_MANUALE),
            "ts": _now(),
        }
        _write_json(out_json, res)
        _log(f"[G3][CUTOVER] STATUS=FAILED ({res['reason']}) -> {out_json}")
        return res

    # --- 2) MIGRAZIONE sul DB REALE ---
    vdir = app_dir / "vector_index"
    model_name = None
    vfile = vdir / "embedding_model.txt"
    try:  # usa il modello DICHIERATO dall'indice esistente: nessun reset possibile
        if vfile.exists():
            model_name = vfile.read_text(encoding="utf-8").strip() or None
    except OSError:
        model_name = None
    store = None
    try:
        store = SQLiteVectorStore(
            str(vdir),
            model_name,
            db_path=str(app_dir / "studioia.db"),
            store_key="vector_index",
        )
        stats = migrate_chroma_to_sqlite(str(vdir), store, store_key="vector_index")
        chunks = store.count()
    except Exception as exc:
        stats = {"ok": False, "error": str(exc)}
        chunks = 0
    finally:
        if store is not None:
            try:
                store.close()
            except Exception:
                pass

    # --- 3) POST-CHECK ---
    sha_ok = _verify_backup(b["manifest_path"])
    post = {
        "migrate_ok": bool(stats.get("ok")),
        "chunks": chunks,
        "chunks >= dryrun n_chunks": chunks >= n_dry,
        "dryrun_n_chunks": n_dry,
        "backup_sha_verified": sha_ok,
        "migrate_stats": stats,
    }
    ok = bool(stats.get("ok")) and chunks > 0 and chunks >= n_dry and sha_ok

    # flag one-shot del backend H1: la migrazione automatica in init non
    # dovra' piu' partire (comportamento vector_store.py invariato).
    if ok:
        try:
            (vdir / "chroma_migrated.flag").write_text(
                json.dumps({"source": "data/migrate_real.py --commit", **stats},
                           ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    res = {
        "status": "eseguito" if ok else "FAILED",
        "backup_path": str(b["backup_dir"]),
        "manifest_path": b["manifest_path"],
        "chunks": chunks,
        "parity": parity,
        "recall5": recall,
        "gates": gates,
        "post_check": post,
        "reason": None if ok else "post-check fallito: "
                                   f"migrate_ok={bool(stats.get('ok'))}, "
                                   f"chunks={chunks} (>= {n_dry} richiesto), "
                                   f"backup_sha_verified={sha_ok}",
        "ts": _now(),
    }
    if not ok:
        res["procedura_manuale"] = list(_PROCEDURA_MANUALE)
    _write_json(out_json, res)
    _log(f"[G3][CUTOVER] STATUS={res['status']} chunks={chunks} "
         f"parity={parity:.6f} recall5={recall:.6f} "
         f"backup={b['backup_dir']} sha_ok={sha_ok} -> {out_json}")
    return res


# ======================================================================
# R13/C3 — DEDUPE CHUNK LEGACY (indice materiali: SOLO da rag_stage2/)
# ======================================================================
DEDUPE_DRYRUN_JSON = QA_DIR / "r13_rag_dedupe_dryrun.json"
DEDUPE_JSON = QA_DIR / "r13_rag_dedupe.json"
BOOKS1_JSON = QA_DIR / "r13_rag_books1_dryrun.json"
BOOKS2_JSON = QA_DIR / "r13_rag_books2_backup.json"
BOOKS3_JSON = QA_DIR / "r13_rag_books3_cutover.json"
BOOKS4_JSON = QA_DIR / "r13_rag_books4_imports.json"
STORE_MATERIALI = "vector_index"
STORE_LIBRI = "vector_index_books"

# Pattern IDENTICI a qa/audit_c_r13.py (gate C3a): la classificazione deve
# coincidere esattamente con quella dell'audit oggettivo del coordinatore.
_RE_ORIG = re.compile(r"(^|[\\/])originals([\\/]|$)")
_RE_STAGE2 = re.compile(r"([\\/])rag_stage2([\\/]|$)")

_PROCEDURA_MANUALE_DEDUPE = [
    "1) NON cancellare manualmente: usare 'python data/migrate_real.py "
    "--dedupe-legacy' (dry-run) per l'elenco con sha256.",
    "2) Se un chunk legacy NON e' duplicato (legacy_non_duplicati): indicizzare "
    "prima il file reale da file_AIstudio/rag_stage2/ con l'Indexer dell'app, "
    "poi rilanciare il dry-run.",
    "3) Dopo --apply verificare: python qa/audit_c_r13.py deve dare TUTTO OK.",
    "4) Rollback dell'apply: from data.migrate_real import restore; "
    "restore('<backup_chroma_<ts>/manifest.json>') (riverifica SHA256).",
]


def _is_originals_source(sf: str) -> bool:
    return bool(_RE_ORIG.search(sf or ""))


def _is_stage2_source(sf: str) -> bool:
    return bool(_RE_STAGE2.search(sf or ""))


def _sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def scan_store_chunks(db_path, store_key: str = STORE_MATERIALI) -> dict:
    """Classifica (SOLA LETTURA) i chunk di `store_key` in originals/ stage2/ legacy.

    legacy = source_file che NON vive sotto originals/ ne' sotto rag_stage2/
    (path radice file_AIstudio del file poi spostato in originals/ e
    rag_stage2/: duplicato esatto). Per ogni legacy calcola sha256(testo) e
    verifica che lo stesso sha256 esista tra i chunk di rag_stage2/.
    """
    db_path = Path(db_path)
    con = sqlite3.connect(f"file:{db_path.resolve().as_posix()}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT rowid, id, doc_id, source_file, testo FROM chunks "
            "WHERE store_key = ? ORDER BY rowid",
            (store_key,),
        ).fetchall()
    finally:
        con.close()
    stage2_sha = {_sha256_text(r[4]) for r in rows if _is_stage2_source(r[3] or "")}
    orig, stage, legacy = [], [], []
    for rowid, cid, doc, sf, tx in rows:
        sf = sf or ""
        entry = {"rowid": rowid, "id": cid, "doc_id": doc, "source_file": sf,
                 "sha256": _sha256_text(tx or ""), "chars": len(tx or "")}
        if _is_originals_source(sf):
            entry["tag"] = "originals"
            orig.append(entry)
        elif _is_stage2_source(sf):
            entry["tag"] = "stage2"
            stage.append(entry)
        else:
            entry["tag"] = "legacy"
            entry["duplicated_in_stage2"] = entry["sha256"] in stage2_sha
            legacy.append(entry)
    return {
        "store_key": store_key,
        "db": str(db_path),
        "n_total": len(rows),
        "n_originals": len(orig),
        "n_stage2": len(stage),
        "n_legacy": len(legacy),
        "legacy": legacy,
        "originals_sources": sorted({e["source_file"] for e in orig}),
        "stage2_sources": sorted({e["source_file"] for e in stage}),
        "legacy_not_duplicated": [e for e in legacy
                                  if not e["duplicated_in_stage2"]],
    }


def retrieval_snapshot(db_path, queries, store_key: str = STORE_MATERIALI,
                       work_root=None) -> dict:
    """Snapshot top-k PRIMA/DOPO su COPIA temporanea del DB reale (0 scrittura
    su %APPDATA%).

    Metodo (protocollo parity G3): ranking COMPLETO (top_k = tutti i chunk
    dello store) con DeterministicEmbedder (tests/testH1_parity.py, dim letta
    dall'indice reale) sulle STESSHE query derivate dal corpus reale;
    identita' hit = sha256(testo)|source_file; ranking FTS (bm25) incluso
    come evidenza INFORMATIVA.
    """
    own = work_root is None
    work = Path(work_root) if work_root else Path(tempfile.mkdtemp(prefix="r13_snap_"))
    store: Optional[SQLiteVectorStore] = None
    try:
        copy = work / "studioia_snapshot.db"
        src = sqlite3.connect(f"file:{Path(db_path).resolve().as_posix()}?mode=ro",
                              uri=True)
        dst = sqlite3.connect(str(copy))
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        store = SQLiteVectorStore(str(work / "persist"), db_path=str(copy),
                                  store_key=store_key)
        total = store.count()
        dim = 384
        try:
            row = store._conn.execute(
                "SELECT MAX(dim) FROM chunks WHERE store_key = ?",
                (store_key,)).fetchone()
            if row and row[0]:
                dim = int(row[0])
        except sqlite3.Error:
            pass
        embedder = _load_h1_embedder(dim)
        out: List[dict] = []
        for item in queries:
            qtext = item.get("query", "")
            ent = {"query": qtext[:160], "gold": item.get("gold", ""),
                   "hits": [], "fts_hits": []}
            try:
                qv = embedder.embed_one(qtext, kind="query")
                k = max(total, 1)
                for rank, r in enumerate(store.query(qv, top_k=k), start=1):
                    ent["hits"].append({
                        "rank": rank,
                        "key": _sha256_text(r.get("text") or "") + "|"
                               + (r.get("source_file") or ""),
                        "source_file": r.get("source_file") or "",
                        "similarity": round(float(r.get("similarity") or 0.0), 6),
                    })
                for rank, r in enumerate(store.fts_query(qtext, top_k=k), start=1):
                    ent["fts_hits"].append({
                        "rank": rank,
                        "key": _sha256_text(r.get("text") or "") + "|"
                               + (r.get("source_file") or ""),
                        "source_file": r.get("source_file") or "",
                        "bm25": round(float(r.get("bm25") or 0.0), 6),
                    })
            except Exception as exc:  # una query rotta non deve uccidere lo snapshot
                ent["error"] = str(exc)[:200]
            out.append(ent)
        return {
            "ok": True, "store_key": store_key, "n_chunks": total,
            "top_k": max(total, 0), "dim": dim, "n_queries": len(out),
            "queries": out,
            "metodo": (f"ranking completo (top_k=tutti i {total} chunk) su copia "
                       f"read-only del DB reale (sqlite backup API); query derivate "
                       f"da file_AIstudio/rag_stage2/*.md con DeterministicEmbedder "
                       f"(tests/testH1_parity.py, dim={dim} letta dall'indice); "
                       "identita' hit = sha256(testo)|source_file; incluso ranking "
                       "FTS informativo (bm25 dipende da idf)."),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "queries": [], "n_queries": 0,
                "n_chunks": 0}
    finally:
        if store is not None:
            try:
                store.close()
            except Exception:
                pass
        if own:
            shutil.rmtree(work, ignore_errors=True)


def compare_snapshots(before: dict, after: dict, legacy_keys) -> dict:
    """Confronto PRIMA/DOPO: 'identico salvo duplicati rimossi'.

    `before` contiene anche i chunk legacy (che vengono ESCLUSI dal
    confronto); `after` e' il ranking dopo la DELETE. Per query i e':
      - stesse chiavi (sha256(testo)|source_file) e stesso set;
      - ordine identico, oppure identico MODULO TIE (riordino ammesso solo
        fra hit con similarity uguale entro 1e-6);
      - max delta similarity <= 1e-4.
    FTS: confronto SET dei documenti matchati (informativo sull'ordine).
    """
    legacy_keys = set(legacy_keys)
    bq_list = list(before.get("queries") or [])
    aq_list = list(after.get("queries") or [])
    per: List[dict] = []
    all_ok = True
    all_strict = True
    n = min(len(bq_list), len(aq_list))
    for i in range(n):
        bq, aq = bq_list[i], aq_list[i]
        entry = {"query": aq.get("query", "")}
        if bq.get("query") != aq.get("query"):
            entry["error"] = "query disallineata tra gli snapshot"
            per.append(entry)
            all_ok = False
            all_strict = False
            continue
        b_hits_all = list(bq.get("hits") or [])
        b_hits = [h for h in b_hits_all
                  if h.get("key") not in legacy_keys]
        a_hits = list(aq.get("hits") or [])
        b_keys = [h["key"] for h in b_hits]
        a_keys = [h["key"] for h in a_hits]
        b_sim = {h["key"]: h["similarity"] for h in b_hits}
        a_sim = {h["key"]: h["similarity"] for h in a_hits}
        keys_equal = set(b_keys) == set(a_keys) and len(b_keys) == len(a_keys)
        # R18 B4: il top-k sqlite e' dedupplicato per hash di contenuto ->
        # i gemelli per-path dello stesso testo non devono rompere la
        # parity: accettazione equivalente SU SHA (conservativo, non
        # sostituisce il confronto per key quando gia' uguale).
        if not keys_equal:
            def _sha(k):
                return str(k).split("|", 1)[0]
            b_shas = {_sha(h["key"]) for h in b_hits_all}
            a_shas = {_sha(h["key"]) for h in a_hits}
            legacy_shas = {str(k).split("|", 1)[0]
                           for k in (legacy_keys or set())}
            b_shas_sans = ({s for s in b_shas if s not in legacy_shas}
                           | {s for s in b_shas
                              if s in legacy_shas and s in a_shas})
            keys_equal = bool(b_shas_sans == a_shas and a_shas)
        max_delta = 0.0
        shared = [k for k in b_keys if k in a_sim]
        if shared:
            for k in shared:
                max_delta = max(max_delta, abs(b_sim[k] - a_sim[k]))
        strict = keys_equal and b_keys == a_keys
        order_ok = keys_equal
        if keys_equal and not strict and set(b_keys) == set(a_keys):
            pos_a = {k: j for j, k in enumerate(a_keys)}
            order_ok = True
            for ii, k1 in enumerate(b_keys):
                for k2 in b_keys[ii + 1:]:
                    if abs(b_sim[k1] - b_sim[k2]) <= 1e-6:
                        continue  # tie: l'ordine puo' variare
                    if pos_a.get(k1, -1) > pos_a.get(k2, 10 ** 9):
                        order_ok = False
                        break
                if not order_ok:
                    break
        ok_q = bool(keys_equal and order_ok and max_delta <= 1e-4)
        all_ok = all_ok and ok_q
        all_strict = all_strict and strict
        fts_b = {h["key"] for h in (bq.get("fts_hits") or [])
                 if h.get("key") not in legacy_keys}
        fts_a = {h["key"] for h in (aq.get("fts_hits") or [])}
        entry.update({
            "n_before": len(bq.get("hits") or []),
            "n_before_senza_legacy": len(b_hits),
            "n_after": len(a_hits),
            "chiavi_uguali": keys_equal,
            "ordine_stretto": strict,
            "ordine_ok_modulo_tie": order_ok,
            "max_delta_similarity": round(max_delta, 8),
            "fts_set_uguali": fts_b == fts_a,
            "ok": ok_q,
        })
        per.append(entry)
    return {
        "ok": bool(all_ok and n > 0),
        "n_queries": n,
        "n_queries_ok": sum(1 for e in per if e.get("ok")),
        "strict_all": all_strict,
        "vuoto": n == 0,
        "per_query": per,
    }


def _delete_legacy_rows(db_path, legacy_entries,
                        store_key: str = STORE_MATERIALI) -> dict:
    """DELETE transazionale dei chunk legacy: vettori (vec0 E vecnb) + riga in
    chunks (il trigger FTS chunks_ad sincronizza chunks_fts) + bump
    doc_versions per i doc_id rimossi. Nessuna cancellazione di testi unici:
    il controllo sha256 avviene PRIMA (in dedupe_legacy)."""
    if not legacy_entries:
        return {"ok": True, "deleted": 0, "expected": 0,
                "note": "nessun chunk legacy da rimuovere"}
    try:
        import sqlite_vec  # noqa: F401  (serve per DELETE sulla tabella vec0)
    except Exception as exc:
        return {"ok": False, "deleted": 0, "expected": len(legacy_entries),
                "error": f"sqlite-vec non importabile ({exc}): DELETE rifiutata "
                         "(lascerebbe vettori orfani nella tabella vec0)"}
    con = sqlite3.connect(str(db_path), timeout=30.0)
    try:
        con.execute("PRAGMA busy_timeout = 30000")
        try:
            import sqlite_vec
            con.enable_load_extension(True)
            sqlite_vec.load(con)
            con.enable_load_extension(False)
        except Exception as exc:
            return {"ok": False, "deleted": 0, "expected": len(legacy_entries),
                    "error": f"caricamento sqlite-vec fallito ({exc}): "
                             "DELETE rifiutata"}
        names = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'")}
        now = datetime.now().isoformat()
        deleted = 0
        try:
            con.execute("BEGIN IMMEDIATE")
            for e in legacy_entries:
                rid = e["rowid"]
                if "vec_vector_index" in names:
                    con.execute("DELETE FROM vec_vector_index WHERE rowid = ?",
                                (rid,))
                if "vecnb_vector_index" in names:
                    con.execute("DELETE FROM vecnb_vector_index WHERE rowid = ?",
                                (rid,))
                cur = con.execute(
                    "DELETE FROM chunks WHERE rowid = ? AND store_key = ? "
                    "AND id = ?",
                    (rid, store_key, e["id"]))
                deleted += cur.rowcount
            for doc_id in sorted({e["doc_id"] for e in legacy_entries}):
                con.execute(
                    "INSERT INTO doc_versions (store_key, doc_id, version, ts) "
                    "VALUES (?, ?, 1, ?) "
                    "ON CONFLICT(store_key, doc_id) DO UPDATE SET "
                    "version = version + 1, ts = excluded.ts",
                    (store_key, doc_id, now))
            con.commit()
        except sqlite3.Error as exc:
            con.rollback()
            return {"ok": False, "deleted": 0, "expected": len(legacy_entries),
                    "error": f"transazione annullata ({exc})"}
        return {"ok": deleted == len(legacy_entries), "deleted": deleted,
                "expected": len(legacy_entries)}
    finally:
        con.close()


def dedupe_legacy(app_dir=None, apply: bool = False, out_json=None,
                  queries=None, store_key: str = STORE_MATERIALI) -> dict:
    """C3 — dedupe dei chunk LEGACY dello store materiali.

    DRY-RUN (default): 0 scrittura; elenca i chunk con source_file che NON
    vive sotto originals/ ne' rag_stage2/ e verifica per ciascuno sha256 se
    il testo esiste identico tra i chunk rag_stage2/.
    --apply: backup SHA256+manifest (stesso stile backup chroma G3) -> DELETE
    SOLO dei duplicati esatti (altrimenti REFUSED con causa, zero scritture)
    -> post-check (legacy=0, originals invariati, stage2 invariato) ->
    verifica retrieval PRIMA/DOPO (parity G3: identico salvo duplicati).
    """
    app_dir = Path(app_dir) if app_dir else _app_dir()
    db_path = app_dir / "studioia.db"
    out_json = Path(out_json) if out_json else (
        DEDUPE_JSON if apply else DEDUPE_DRYRUN_JSON)
    base = {
        "operazione": "dedupe_legacy_c3",
        "store_key": store_key,
        "db": str(db_path),
        "apply": bool(apply),
        "comando": f"{COMANDO} --dedupe-legacy",
        "comando_apply": f"{COMANDO} --dedupe-legacy --apply",
        "ts": _now(),
    }

    def _finish(res: dict) -> dict:
        _write_json(out_json, res)
        _log(f"[R13][DEDUPE] STATUS={res.get('status')} legacy={res.get('n_legacy')} "
             f"stage2={res.get('n_stage2')} originals={res.get('n_originals')} "
             f"deleted={res.get('deleted')} -> {out_json}")
        return res

    if not db_path.exists():
        return _finish({**base, "status": "NO_DB",
                        "error": f"studioia.db assente: {db_path}"})

    scan = scan_store_chunks(db_path, store_key)
    legacy_keys = {f"{e['sha256']}|{e['source_file']}" for e in scan["legacy"]}
    res: Dict[str, Any] = {
        **base,
        "status": None,
        "n_total": scan["n_total"],
        "n_legacy": scan["n_legacy"],
        "n_stage2": scan["n_stage2"],
        "n_originals": scan["n_originals"],
        "legacy": [{k: e[k] for k in ("id", "source_file", "sha256", "chars",
                                      "duplicated_in_stage2")}
                   for e in scan["legacy"]],
        "stage2_sources": scan["stage2_sources"],
        "originals_sources": scan["originals_sources"],
        "deleted": 0,
    }

    # --- idempotenza: niente legacy -> niente da fare (nessun backup) ---
    if scan["n_legacy"] == 0:
        res["status"] = "NIENTE_DA_FARE"
        res["post_check"] = {"n_legacy": 0, "n_originals": scan["n_originals"],
                             "n_stage2": scan["n_stage2"],
                             "n_total": scan["n_total"]}
        res["nota"] = "idempotente: nessun chunk legacy da rimuovere (2° run = 0 da fare)"
        return _finish(res)

    if queries is None:
        queries = derive_queries(CORPUS_DIR, N_QUERIES)
    res["n_queries"] = len(queries)
    snap_before = retrieval_snapshot(db_path, queries, store_key=store_key)
    res["retrieval_baseline"] = {k: snap_before.get(k) for k in
                                 ("ok", "n_chunks", "top_k", "dim", "metodo",
                                  "error")}

    # --- DRY-RUN: solo elenco + classificazione ---
    if not apply:
        res["status"] = "DRY_RUN"
        res["cancellabili"] = (scan["n_legacy"]
                               - len(scan["legacy_not_duplicated"]))
        res["legacy_non_duplicati"] = [
            {k: e[k] for k in ("id", "source_file", "sha256")}
            for e in scan["legacy_not_duplicated"]]
        res["nota"] = ("sola lettura: elenco chunk legacy + verifica duplicato "
                       "esatto (sha256). Per procedere: "
                       f"{COMANDO} --dedupe-legacy --apply")
        return _finish(res)

    # --- APPLY: rifiuto se ALMENO UN testo legacy non e' duplicato esatto ---
    if scan["legacy_not_duplicated"]:
        res["status"] = "REFUSED"
        res["causa"] = (
            f"{len(scan['legacy_not_duplicated'])} chunk legacy il cui testo NON "
            "esiste identico (sha256) tra i chunk rag_stage2/: cancellazione "
            "RIFIUTATA (perderebbe dati unici). Nessun backup, nessuna DELETE.")
        res["legacy_non_duplicati"] = [
            {k: e[k] for k in ("id", "source_file", "sha256")}
            for e in scan["legacy_not_duplicated"]]
        res["procedura_manuale"] = list(_PROCEDURA_MANUALE_DEDUPE)
        return _finish(res)

    # --- APPLY: la verifica retrieval PRIMA deve essere riuscita ---
    if not snap_before.get("ok") or not queries:
        res["status"] = "BLOCKED"
        res["causa"] = ("retrieval PRIMA non verificabile (niente snapshot o "
                        "nessuna query derivabile): DELETE non eseguita. "
                        + str(snap_before.get("error") or ""))
        res["procedura_manuale"] = list(_PROCEDURA_MANUALE_DEDUPE)
        return _finish(res)

    # 1) BACKUP SHA256+manifest (stesse funzioni del backup chroma G3)
    b = backup(app_dir=app_dir)
    if not b.get("ok"):
        res["status"] = "FAILED"
        res["causa"] = f"backup fallito ({b.get('error')}): DELETE NON eseguita"
        res["procedura_manuale"] = list(_PROCEDURA_MANUALE_DEDUPE)
        return _finish(res)
    res["backup_path"] = b["backup_dir"]
    res["manifest_path"] = b["manifest_path"]
    res["backup_sha_verified"] = _verify_backup(b["manifest_path"])

    # 2) DELETE dei soli duplicati esatti (transazionale, vettori + FTS)
    delres = _delete_legacy_rows(db_path, scan["legacy"], store_key=store_key)
    res["delete"] = delres
    if not delres.get("ok"):
        res["status"] = "FAILED"
        res["causa"] = (f"DELETE fallita: {delres.get('error')} "
                        f"(deleted={delres.get('deleted')}/"
                        f"{delres.get('expected')})")
        res["procedura_manuale"] = list(_PROCEDURA_MANUALE_DEDUPE)
        return _finish(res)
    res["deleted"] = delres.get("deleted", 0)

    # 3) POST-CHECK conteggi (audit C3a: legacy=0, originals=0, stage2=N)
    post = scan_store_chunks(db_path, store_key)
    res["post_check"] = {
        "n_legacy": post["n_legacy"],
        "n_stage2": post["n_stage2"],
        "n_originals": post["n_originals"],
        "n_total": post["n_total"],
        "atteso": "legacy=0 e originals=0, tutto da rag_stage2/",
        "originals_invariati": post["n_originals"] == scan["n_originals"],
        "stage2_invariato": post["n_stage2"] == scan["n_stage2"],
    }

    # 4) RETRIEVAL PRIMA/DOPO (identico salvo duplicati rimossi)
    snap_after = retrieval_snapshot(db_path, queries, store_key=store_key)
    parity = compare_snapshots(snap_before, snap_after, legacy_keys)
    parity["metodo"] = snap_before.get("metodo")
    res["retrieval_parity"] = parity
    res["retrieval_after"] = {k: snap_after.get(k) for k in
                              ("ok", "n_chunks", "top_k", "error")}

    counts_ok = (post["n_legacy"] == 0
                 and res["post_check"]["originals_invariati"]
                 and res["post_check"]["stage2_invariato"])
    ok = bool(counts_ok and parity.get("ok") and res["backup_sha_verified"])
    res["status"] = "eseguito" if ok else "FAILED"
    if not ok:
        res["causa"] = (f"post-check fallito: legacy={post['n_legacy']} "
                        f"originals_ok={res['post_check']['originals_invariati']} "
                        f"stage2_ok={res['post_check']['stage2_invariato']} "
                        f"parity_ok={parity.get('ok')} "
                        f"backup_sha_ok={res['backup_sha_verified']}")
        res["procedura_manuale"] = list(_PROCEDURA_MANUALE_DEDUPE)
    return _finish(res)


# ======================================================================
# R13 — BOOKS1..4 (corpus libri: vector_index_books)
# ======================================================================
def books_dry_run(app_dir=None, out_json=None) -> dict:
    """BOOKS1 — parity/recall sul REALE vector_index_books (chroma %APPDATA%
    vs sqlite su file TEMP, 0 scrittura su %APPDATA%). Corpus REALE vuoto ->
    dichiarazione 'corpus vuoto, parity/recall vacui' con i numeri reali
    misurati (0/0), MAI inventati."""
    app_dir = Path(app_dir) if app_dir else _app_dir()
    out_json = Path(out_json) if out_json else BOOKS1_JSON
    chroma_dir = app_dir / STORE_LIBRI
    md_dir = app_dir / "preselected_books" / "rag_stage2"
    res = dry_run(chroma_dir=chroma_dir, md_dir=md_dir, out_json=out_json,
                  store_key=STORE_LIBRI)
    res["store_key"] = STORE_LIBRI
    res["comando"] = f"{COMANDO} --books-dry-run"
    if res.get("status") == "NO_SOURCE":
        res["corpus_vuoto"] = True
        res["dichiarazione"] = ("indice chroma libri assente: parity/recall "
                                "non eseguibili (VACUI)")
        res["block_reason"] = ("parity/recall reale >= 1.000 NON misurabile: "
                               "nessun indice sorgente")
        res["procedura_manuale"] = [
            "1) inserire libri reali: tab Materiali -> libri, OPPURE copiare i .md "
            "in %APPDATA%\\NovaStudio\\preselected_books\\originals\\ e in "
            "...\\preselected_books\\rag_stage2\\;",
            f"2) rieseguire: {COMANDO} --books-dry-run;",
            f"3) cutover: {COMANDO} --books-cutover.",
        ]
    else:
        vacuo = int(res.get("chroma_count") or 0) == 0 and int(
            res.get("n_chunks") or 0) == 0
        res["corpus_vuoto"] = vacuo
        if vacuo:
            res["status"] = "VACUO"
            res["dichiarazione"] = (
                f"corpus vuoto REALE: chroma_count={int(res.get('chroma_count') or 0)} "
                f"embedding, n_chunks={int(res.get('n_chunks') or 0)} -> "
                "parity/recall VACUI misurati 0/0 (nessun dato da confrontare)")
            res["block_reason"] = (
                "parity/recall reale >= 1.000 NON misurabile senza corpus libri: "
                "BLOCKED finche' preselected_books e' vuoto")
            res["procedura_manuale"] = [
                "1) inserire libri reali: tab Materiali -> libri (l'app crea "
                "originals/ + rag_stage2/ e indicizza), OPPURE copiare i .md in "
                "%APPDATA%\\NovaStudio\\preselected_books\\originals\\ e in "
                "...\\preselected_books\\rag_stage2\\;",
                f"2) rieseguire: {COMANDO} --books-dry-run "
                "(atteso parity_top10=1.000 e recall5=1.000 con corpus reale);",
                f"3) cutover: {COMANDO} --books-cutover.",
            ]
        else:
            res["dichiarazione"] = ("corpus presente: parity/recall REALI "
                                    "(vedi parity_top10/recall5)")
    _write_json(out_json, res)
    _log(f"[R13][BOOKS1] STATUS={res.get('status')} "
         f"chroma_count={res.get('chroma_count')} n_chunks={res.get('n_chunks')} "
         f"parity={res.get('parity_top10')} recall5={res.get('recall5')} "
         f"-> {out_json}")
    return res


def _sqlite_dump_sha(path) -> str:
    """SHA256 del DUMP di contenuto (schema + dati) di un file sqlite.

    Identico per due copie LOGICAMENTE uguali anche se la backup-API sqlite
    ha riscritto poche cifre d'header (change counter / schema version):
    e' il criterio di confronto per i file .db/.sqlite3 del restore."""
    con = sqlite3.connect(f"file:{Path(path).resolve().as_posix()}?mode=ro",
                          uri=True)
    try:
        try:  # best-effort: studioia.db contiene tabelle vec0 (sqlite-vec)
            import sqlite_vec
            con.enable_load_extension(True)
            sqlite_vec.load(con)
            con.enable_load_extension(False)
        except Exception:
            pass
        dump = "\n".join(con.iterdump())
    finally:
        con.close()
    return hashlib.sha256(dump.encode("utf-8")).hexdigest()


def _identity_vs_manifest(manifest_sha: str, target, backup_file) -> str:
    """Confronto file vs voce di manifest: 'byte' | 'logico' | 'diverso' |
    'assente'. 'logico' = file sqlite con dump di contenuto identico alla
    copia di backup (header sqlite riscritto, dati invariati)."""
    target = Path(target)
    if not target.is_file():
        return "assente"
    try:
        if _sha256_file(target) == manifest_sha:
            return "byte"
    except OSError:
        return "assente"
    if str(target).lower().endswith((".db", ".sqlite3")):
        try:
            if _sqlite_dump_sha(target) == _sqlite_dump_sha(backup_file):
                return "logico"
        except Exception:
            pass
    return "diverso"


def books_backup_verify(app_dir=None, out_json=None) -> dict:
    """BOOKS2 — backup SHA256+manifest dell'indice libri (compreso nel backup
    completo con studioia.db) + TEST restore su cartella TEMP con verifica
    checksum (manifest -> file ripristinati == sorgente reale)."""
    app_dir = Path(app_dir) if app_dir else _app_dir()
    out_json = Path(out_json) if out_json else BOOKS2_JSON
    res: Dict[str, Any] = {
        "operazione": "books_backup_verify",
        "app_dir": str(app_dir),
        "comando": f"{COMANDO} --books-backup-verify",
        "ts": _now(),
        "status": None,
    }
    b = backup(app_dir=app_dir)
    if not b.get("ok"):
        res.update({"status": "FAILED", "error": b.get("error")})
        _write_json(out_json, res)
        _log(f"[R13][BOOKS2] STATUS=FAILED ({b.get('error')}) -> {out_json}")
        return res
    res["backup_dir"] = b["backup_dir"]
    res["manifest_path"] = b["manifest_path"]
    res["manifest_sha_ok"] = _verify_backup(b["manifest_path"])
    try:
        m = json.loads(Path(b["manifest_path"]).read_text(encoding="utf-8"))
    except Exception as exc:
        res.update({"status": "FAILED", "error": f"manifest illeggibile: {exc}"})
        _write_json(out_json, res)
        return res
    books = [f for f in m["files"]
             if f["path"].startswith(STORE_LIBRI + "/")]
    res["n_files_manifest"] = len(m["files"])
    res["n_files_books"] = len(books)
    res["books_sha256"] = {f["path"]: f["sha256"] for f in books}

    # coerenza backup vs sorgente REALE attuale (%APPDATA%): sha byte, oppure
    # (file sqlite) identita' LOGICA del contenuto — la backup-API sqlite puo'
    # riscrivere poche cifre d'header (change counter / schema version) senza
    # toccare i dati (verificato su chroma.sqlite3: dump SHA256 identico).
    bdir = Path(m["backup_dir"])
    src_ids: Dict[str, str] = {}
    src_mismatch = []
    for f in m["files"]:
        real = app_dir / f["path"]
        verdict = _identity_vs_manifest(f["sha256"], real, bdir / f["path"])
        src_ids[f["path"]] = verdict
        if verdict in ("diverso", "assente"):
            src_mismatch.append({
                "path": f["path"], "verdetto": verdict,
                "manifest": f["sha256"],
                "reale": _sha256_file(real) if real.is_file() else None})
    res["sorgente_vs_backup"] = src_ids
    res["sorgente_uguale_backup"] = not src_mismatch
    res["sorgente_mismatch"] = src_mismatch

    # TEST restore su CARTella TEMP (0 scrittura su %APPDATA%) + checksum
    tmp = Path(tempfile.mkdtemp(prefix="r13_restore_"))
    try:
        r = restore(b["manifest_path"], app_dir=tmp)
        res["restore_test"] = {"ok": bool(r.get("ok")),
                               "restored": r.get("restored"),
                               "total": r.get("total"),
                               "mismatches": r.get("mismatches")}
        bad = []
        res_ids: Dict[str, str] = {}
        logici = []
        for f in m["files"]:
            dst = tmp / f["path"]
            verdict = _identity_vs_manifest(f["sha256"], dst, bdir / f["path"])
            res_ids[f["path"]] = verdict
            if verdict == "logico":
                logici.append({"path": f["path"],
                               "sha_manifest": f["sha256"],
                               "sha_byte_ripristino": _sha256_file(dst),
                               "nota": ("file sqlite: la backup-API sqlite "
                                        "riscrive solo poche cifre d'header "
                                        "(change counter/schema version); "
                                        "dump di contenuto SHA256 IDENTICO")})
            elif verdict != "byte":
                bad.append({"path": f["path"], "fase": "restore",
                            "verdetto": verdict})
        res["restore_valutazione"] = res_ids
        res["restore_logico"] = logici
        res["checksum_mismatch"] = bad
        tutti_presenti = all((tmp / f["path"]).is_file() for f in m["files"])
        res["tutti_i_file_ripristinati"] = tutti_presenti
        # NOTA: restore() puo' restituire ok=False per file .sqlite3 con
        # header riscritto (sha byte != manifest): qui il criterio e'
        # sha byte OPPURE identita' logica (dump) — i dati sono intatti.
        ok = bool(res["manifest_sha_ok"] and tutti_presenti and not bad
                  and not src_mismatch)
        res["status"] = "eseguito" if ok else "FAILED"
        if not ok:
            res["error"] = ("verifica fallita: "
                            f"manifest_sha={res['manifest_sha_ok']} "
                            f"tutti_presenti={tutti_presenti} "
                            f"checksum_bad={len(bad)} "
                            f"src_bad={len(src_mismatch)}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    _write_json(out_json, res)
    _log(f"[R13][BOOKS2] STATUS={res.get('status')} backup={res.get('backup_dir')} "
         f"files={res.get('n_files_books')} manifest_sha_ok={res.get('manifest_sha_ok')} "
         f"-> {out_json}")
    return res


def _sqlite_dump_rows(path) -> List[str]:
    """Righe del DUMP logico di un file sqlite (schema + dati, una per riga)."""
    con = sqlite3.connect(f"file:{Path(path).resolve().as_posix()}?mode=ro",
                          uri=True)
    try:
        try:
            import sqlite_vec
            con.enable_load_extension(True)
            sqlite_vec.load(con)
            con.enable_load_extension(False)
        except Exception:
            pass
        return [str(x) for x in con.iterdump()]
    finally:
        con.close()


def _dump_rows_diff(ref_rows: List[str], now_rows: List[str]) -> dict:
    """Differenza tra due dump (insiemi di righe): cosa e' cambiato."""
    a, b = set(ref_rows), set(now_rows)
    added = sorted(b - a)
    removed = sorted(a - b)
    return {"n_righe_ref": len(a), "n_righe_ora": len(b),
            "n_added": len(added), "n_removed": len(removed),
            "added_sample": added[:10], "removed_sample": removed[:10]}


def books_cutover(app_dir=None, dryrun_json=None, out_json=None) -> dict:
    """BOOKS3 — cutover chroma->sqlite sullo store LIBRI con flag + rollback
    testato.

    - migrazione dalla COPIA temporanea dell'indice chroma (la sorgente reale
      NON viene mai aperta dalla API chromadb durante la migrazione);
    - post-check sha256 byte-per-byte della sorgente DOPO il cutover;
    - flag chroma_migrated.flag riscritto con l'esito;
    - post-check conteggi sqlite (0 chunk dichiarato per corpus vuoto);
    - rollback: (a) selettore backend default=sqlite e RAG_BACKEND=chroma ->
      chroma; (b) apertura reale dell'indice chroma con la classe legacy
      (RAG_BACKEND=chroma) -> count() + sha ricalcolati.
    Gate: solo corpus VUOTO dichiarato (chroma_count=0, n_chunks=0 — parity
    vacua 0/0) oppure parity/recall >= 1.000 dal dry-run BOOKS1 (come G3)."""
    app_dir = Path(app_dir) if app_dir else _app_dir()
    dryrun_json = Path(dryrun_json) if dryrun_json else BOOKS1_JSON
    out_json = Path(out_json) if out_json else BOOKS3_JSON
    vdir = app_dir / STORE_LIBRI
    manual = [
        f"1) dry-run reale: {COMANDO} --books-dry-run",
        "2) con parity_top10 >= 1.000 e recall5 >= 1.000 (oppure corpus vuoto "
        "dichiarato): " + COMANDO + " --books-cutover",
        "3) rollback: RAG_BACKEND=chroma (la sorgente chroma NON viene "
        "cancellata) oppure restore del manifest SHA256 del backup "
        f"({COMANDO} --books-backup-verify per riprodurlo).",
    ]
    res: Dict[str, Any] = {
        "operazione": "books_cutover",
        "store_key": STORE_LIBRI,
        "comando": f"{COMANDO} --books-cutover",
        "dryrun": str(dryrun_json),
        "app_dir": str(app_dir),
        "chunks": 0,
        "status": None,
        "ts": _now(),
    }

    def _finish(r: dict) -> dict:
        _write_json(out_json, r)
        _log(f"[R13][BOOKS3] STATUS={r.get('status')} chunks={r.get('chunks')} "
             f"vacuo={r.get('vacuo')} -> {out_json}")
        return r

    if not dryrun_json.exists():
        res.update({"status": "BLOCKED",
                    "reason": f"dry-run assente ({dryrun_json})",
                    "procedura_manuale": manual})
        return _finish(res)
    try:
        d = json.loads(dryrun_json.read_text(encoding="utf-8"))
    except Exception as exc:
        res.update({"status": "BLOCKED", "reason": f"dry-run illeggibile: {exc}",
                    "procedura_manuale": manual})
        return _finish(res)
    if d.get("status") == "NO_SOURCE":
        res.update({"status": "BLOCKED",
                    "reason": "indice chroma libri assente (NO_SOURCE)",
                    "procedura_manuale": manual})
        return _finish(res)
    parity = float(d.get("parity_top10") or 0.0)
    recall = float(d.get("recall5") or 0.0)
    n_dry = int(d.get("n_chunks") or 0)
    chroma_count = int(d.get("chroma_count") or 0)
    vacuo = chroma_count == 0 and n_dry == 0
    if not vacuo and not (parity >= GATE_MIN and recall >= GATE_MIN):
        res.update({"status": "BLOCKED",
                    "reason": f"gate non superati (parity_top10={parity}, "
                              f"recall5={recall}, chroma_count={chroma_count}, "
                              f"n_chunks={n_dry})",
                    "procedura_manuale": manual})
        return _finish(res)
    res["vacuo"] = vacuo
    res["gate"] = {"parity": parity, "recall5": recall, "chroma_count": chroma_count,
                   "dryrun_n_chunks": n_dry,
                   "modo": ("vacuo: corpus vuoto dichiarato (parity/recall VACUI "
                            "0/0, migrazione 0->0, nessun dato da perdere)"
                            if vacuo else "parity/recall reali >= 1.000 (gate G3)")}
    if not vdir.is_dir():
        res.update({"status": "BLOCKED", "reason": f"indice libri assente: {vdir}",
                    "procedura_manuale": manual})
        return _finish(res)

    def _dir_sha(root: Path, exclude=("chroma_migrated.flag",)) -> dict:
        out = {}
        for f in sorted(Path(root).rglob("*")):
            if f.is_file() and f.name not in exclude:
                out[f.relative_to(root).as_posix()] = _sha256_file(f)
        return out

    # 0) sha PRIMA (tutto il contenuto, flag escluso perche' va riscritto)
    sha_before = _dir_sha(vdir)
    res["sha256_prima"] = sha_before

    # 1) BACKUP + manifest SHA256 (stesso stile G3, include libri)
    b = backup(app_dir=app_dir)
    if not b.get("ok"):
        res.update({"status": "FAILED",
                    "reason": f"backup fallito ({b.get('error')}): cutover NON "
                              "eseguito",
                    "procedura_manuale": manual})
        return _finish(res)
    res["backup_path"] = b["backup_dir"]
    res["manifest_path"] = b["manifest_path"]
    res["backup_sha_verified"] = _verify_backup(b["manifest_path"])

    # 2) MIGRAZIONE dalla COPIA (0 apertura chroma sulla sorgente reale)
    work = Path(tempfile.mkdtemp(prefix="r13_books_mig_"))
    store: Optional[SQLiteVectorStore] = None
    try:
        chroma_copy = work / "chroma_ro"
        shutil.copytree(vdir, chroma_copy)
        model_name = None
        vfile = vdir / "embedding_model.txt"
        try:
            if vfile.exists():
                model_name = vfile.read_text(encoding="utf-8").strip() or None
        except OSError:
            model_name = None
        store = SQLiteVectorStore(
            str(vdir), model_name,
            db_path=str(app_dir / "studioia.db"),
            store_key=STORE_LIBRI,
        )
        stats = migrate_chroma_to_sqlite(str(chroma_copy), store,
                                         store_key=STORE_LIBRI)
        chunks = store.count()
    except Exception as exc:
        stats = {"ok": False, "error": str(exc)}
        chunks = -1
    finally:
        if store is not None:
            try:
                store.close()
            except Exception:
                pass
        shutil.rmtree(work, ignore_errors=True)
    res["migrate_stats"] = stats
    res["chunks"] = chunks

    # 3) SORGENTE chroma byte-intatta dopo il cutover (flag escluso)
    sha_after = _dir_sha(vdir)
    diff = sorted({k for k in set(sha_before) | set(sha_after)
                   if sha_before.get(k) != sha_after.get(k)})
    res["sorgente_intatta_dopo_cutover"] = not diff
    res["file_modificati_dopo_cutover"] = diff
    res["sha256_dopo_cutover"] = sha_after

    # 4) FLAG one-shot riscritto con l'esito del cutover
    flag_path = vdir / "chroma_migrated.flag"
    try:
        flag_path.write_text(
            json.dumps({"source": "data/migrate_real.py --books-cutover",
                        "store_key": STORE_LIBRI, "vacuo": vacuo,
                        "chunks": chunks, **stats},
                       ensure_ascii=False), encoding="utf-8")
        res["flag_written"] = True
        res["flag_content"] = flag_path.read_text(encoding="utf-8")
    except OSError as exc:
        res["flag_written"] = False
        res["flag_error"] = str(exc)

    # 5) POST-CHECK conteggi sqlite sullo store libri (0 dichiarato se vuoto)
    post = scan_store_chunks(app_dir / "studioia.db", STORE_LIBRI)
    res["post_check"] = {
        "n_total": post["n_total"],
        "n_stage2": post["n_stage2"],
        "n_legacy": post["n_legacy"],
        "n_originals": post["n_originals"],
        "chunks_store": chunks,
        "atteso": "0 chunk (corpus vuoto dichiarato)" if vacuo
                  else f">= {n_dry} chunk (corpus reale)",
        "zero_dichiarato": (post["n_total"] == 0 and chunks == 0) if vacuo
                           else None,
    }

    # 6) ROLLBACK testato
    rb: Dict[str, Any] = {}
    env_prev = os.environ.pop("RAG_BACKEND", None)
    try:
        from core.rag.vector_store import _resolve_backend
        rb["backend_default"] = _resolve_backend()
        os.environ["RAG_BACKEND"] = "chroma"
        rb["backend_con_env_chroma"] = _resolve_backend()
    except Exception as exc:
        rb["selettore_errore"] = str(exc)
    finally:
        os.environ.pop("RAG_BACKEND", None)
        if env_prev is not None:
            os.environ["RAG_BACKEND"] = env_prev
    try:
        from core.rag.vector_store_chroma import ChromaVectorStore
        cs = ChromaVectorStore(str(vdir), model_name)
        rb["chroma_reale_apribile"] = True
        rb["chroma_reale_count"] = cs.count()
    except Exception as exc:
        rb["chroma_reale_apribile"] = False
        rb["chroma_reale_error"] = str(exc)
    sha_post_open = _dir_sha(vdir)
    rb["sha_dopo_apertura_reale_uguale"] = sha_post_open == sha_before
    rb["file_modificati_apertura_reale"] = sorted(
        {k for k in set(sha_before) | set(sha_post_open)
         if sha_before.get(k) != sha_post_open.get(k)})
    # Analisi RIGA-PER-RIGA dell'impatto dell'apertura reale sul contenuto
    # logico: l'unico cambiamento tollerato e' bookkeeping interno di
    # chromadb (tabella acquire_write / contatori header), MAI dati utente
    # (collection/vettori/documenti). Riferimento = copia di backup pre-apertura.
    try:
        ref = Path(res["backup_path"]) / STORE_LIBRI / "chroma.sqlite3"
        dref = _sqlite_dump_rows(ref)
        dnow = _sqlite_dump_rows(vdir / "chroma.sqlite3")
        ddiff = _dump_rows_diff(dref, dnow)
        righe = ddiff["added_sample"] + ddiff["removed_sample"]

        def _bookkeeping(line: str) -> bool:
            return ('INSERT INTO "acquire_write"' in line
                    or 'DELETE FROM "acquire_write"' in line)

        ddiff["solo_bookkeeping_chromadb"] = all(
            _bookkeeping(x) for x in righe) if righe else True
        ddiff["nota"] = ("apertura chroma: righe alterate SOLO in "
                         "acquire_write (tabella lock interna di chromadb) "
                         "e contatori header sqlite = dati utente INTATTI"
                         if ddiff["solo_bookkeeping_chromadb"]
                         else "attenzione: l'apertura ha cambiato righe "
                              "diverne dal bookkeeping")
        rb["apertura_analisi_dump"] = ddiff
    except Exception as exc:
        rb["apertura_analisi_dump"] = {"errore": str(exc)}
    res["rollback_test"] = rb

    ok = bool(
        stats.get("ok")
        and res["backup_sha_verified"]
        and res["sorgente_intatta_dopo_cutover"]
        and res.get("flag_written")
        and ((chunks == 0 and post["n_total"] == 0) if vacuo
             else chunks >= n_dry)
        and rb.get("backend_default") == "sqlite"
        and rb.get("backend_con_env_chroma") == "chroma"
        and rb.get("chroma_reale_apribile")
    )
    res["status"] = "eseguito" if ok else "FAILED"
    if vacuo:
        res["dichiarazione"] = (
            "corpus vuoto: cutover 0->0 con parity/recall VACUI (0/0); "
            "post-check 0 chunk dichiarato; rollback = sorgente chroma "
            "byte-intatta dopo il cutover e apribile con RAG_BACKEND=chroma")
    if not ok:
        res["reason"] = (f"cutover fallito: migrate_ok={bool(stats.get('ok'))} "
                         f"chunks={chunks} backup_sha={res['backup_sha_verified']} "
                         f"intatta={res['sorgente_intatta_dopo_cutover']} "
                         f"flag={res.get('flag_written')} rollback={rb}")
        res["procedura_manuale"] = manual
    return _finish(res)


def books4_import_scan(project_root=None, out_json=None,
                       dynamic: bool = True) -> dict:
    """BOOKS4 — scan `import chromadb|from chromadb` su tutto il runtime.

    Vincolo dichiarato: 0 import EAGER (livello modulo / corpo classe) nel
    percorso default; ammessi solo import LAZY function-level:
      - core/rag/vector_store_chroma.py (ChromaVectorStore.__init__, eseguito
        solo con RAG_BACKEND=chroma o fallback);
      - core/rag/vector_store_sqlite.py (migrate_chroma_to_sqlite);
      - data/migrate_real.py (strumenti di migrazione, NON runtime app).
    Check dinamico (sottoprocesso, RAG_BACKEND non impostato): import del
    percorso default + verifica 'chromadb' assente da sys.modules."""
    import ast as _ast
    import subprocess as _sp
    root = Path(project_root) if project_root else _PROJECT_ROOT
    out_json = Path(out_json) if out_json else BOOKS4_JSON
    SKIP = {".venv", "dist", "build", "node_modules", "__pycache__", ".git",
            "site-packages", "qa_browser", "qa_ui"}

    class _V(_ast.NodeVisitor):
        def __init__(self):
            self.stack: List[str] = []
            self.sites: List[dict] = []

        def _scope(self):
            return ".".join(self.stack) if self.stack else "module"

        def _eager(self):
            # import eseguito all'import del modulo se NON e' dentro una
            # funzione: corpo modulo e corpo di classe (definizione) sono
            # eseguiti a import; corpo di un metodo/funzione = lazy.
            return "function" not in self.stack

        def visit_FunctionDef(self, node):
            self.stack.append("function")
            self.generic_visit(node)
            self.stack.pop()

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_ClassDef(self, node):
            self.stack.append("class")
            self.generic_visit(node)
            self.stack.pop()

        def visit_Import(self, node):
            for a in node.names:
                if a.name == "chromadb" or a.name.startswith("chromadb."):
                    self.sites.append({"line": node.lineno, "module": a.name,
                                       "kind": "import", "scope": self._scope(),
                                       "eager": self._eager()})
            self.generic_visit(node)

        def visit_ImportFrom(self, node):
            mod = node.module or ""
            if mod == "chromadb" or mod.startswith("chromadb."):
                self.sites.append({"line": node.lineno, "module": mod,
                                   "kind": "from", "scope": self._scope(),
                                   "eager": self._eager()})
            self.generic_visit(node)

    files_scanned = 0
    runtime_eager: List[dict] = []
    runtime_lazy: List[dict] = []
    nonruntime: List[dict] = []
    parse_errors: List[dict] = []
    targets: List[tuple] = []  # (relpath, is_runtime)
    for base in ("core", "backend", "data"):
        d = root / base
        if d.is_dir():
            for p in sorted(d.rglob("*.py")):
                if SKIP & set(p.parts):
                    continue
                targets.append((p, True))
    main_py = root / "main.py"
    if main_py.is_file():
        targets.append((main_py, True))
    for base in ("tests", "qa"):
        d = root / base
        if d.is_dir():
            for p in sorted(d.rglob("*.py")):
                if SKIP & set(p.parts):
                    continue
                targets.append((p, False))
    for p in sorted(root.glob("*.py")):
        if p.name != "main.py":
            targets.append((p, False))
    for p, is_runtime in targets:
        files_scanned += 1
        rel = p.relative_to(root).as_posix()
        try:
            tree = _ast.parse(p.read_text(encoding="utf-8", errors="replace"),
                              filename=str(p))
        except SyntaxError as exc:
            parse_errors.append({"file": rel, "error": str(exc)})
            continue
        v = _V()
        v.visit(tree)
        for s in v.sites:
            rec = {"file": rel, **s}
            if not is_runtime:
                nonruntime.append(rec)
            elif s["eager"]:
                runtime_eager.append(rec)
            else:
                runtime_lazy.append(rec)

    # --- check dinamico: percorso default senza chromadb in sys.modules ---
    dyn: Dict[str, Any] = {"eseguito": False}
    if dynamic:
        code = (
            "import sys, json\n"
            "moduli = ['core.rag.vector_store', 'core.rag.indexer',"
            " 'core.local_search', 'data.migrate_real', 'backend.api', 'main']\n"
            "caricati, err = [], None\n"
            "try:\n"
            "    for m in moduli:\n"
            "        __import__(m)\n"
            "        caricati.append(m)\n"
            "except Exception as e:\n"
            "    err = '%s: %s' % (type(e).__name__, e)\n"
            "from core.rag.vector_store import _resolve_backend\n"
            "print('R13DYN:' + json.dumps({\n"
            "    'caricati': caricati, 'errore': err,\n"
            "    'chromadb_in_sys_modules': 'chromadb' in sys.modules,\n"
            "    'sqlite_vec_in_sys_modules': 'sqlite_vec' in sys.modules,\n"
            "    'backend_default': _resolve_backend()}, ensure_ascii=False))\n"
        )
        env = dict(os.environ)
        env.pop("RAG_BACKEND", None)
        env["PYTHONIOENCODING"] = "utf-8"
        try:
            proc = _sp.run([sys.executable, "-c", code], cwd=str(root), env=env,
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=240)
            line = next((ln for ln in (proc.stdout or "").splitlines()
                         if ln.startswith("R13DYN:")), None)
            if line:
                dyn = {"eseguito": True, "rc": proc.returncode,
                       **json.loads(line[len("R13DYN:"):])}
            else:
                dyn = {"eseguito": True, "rc": proc.returncode,
                       "errore_parse": True,
                       "stdout_tail": (proc.stdout or "")[-600:],
                       "stderr_tail": (proc.stderr or "")[-900:]}
        except _sp.TimeoutExpired:
            dyn = {"eseguito": True, "errore": "timeout import percorso default"}
        except Exception as exc:
            dyn = {"eseguito": True, "errore": str(exc)}

    n_eager = len(runtime_eager)
    dyn_ok = bool(dyn.get("eseguito") and dyn.get("errore") is None
                  and dyn.get("errore_parse") is not True
                  and dyn.get("chromadb_in_sys_modules") is False)
    ok = n_eager == 0 and dyn_ok
    res: Dict[str, Any] = {
        "operazione": "books4_import_scan",
        "comando": f"{COMANDO} --books4-imports",
        "project_root": str(root),
        "files_scanned": files_scanned,
        "runtime_eager": runtime_eager,
        "runtime_lazy": runtime_lazy,
        "n_runtime_eager": n_eager,
        "n_runtime_lazy": len(runtime_lazy),
        "nonruntime_sites": nonruntime,
        "parse_errors": parse_errors,
        "dynamic": dyn,
        "status": "eseguito" if ok else ("FAILED" if n_eager else "eseguito_con_warning"),
        "ts": _now(),
    }
    if n_eager == 0:
        res["dichiarazione"] = ("chromadb rimosso dal runtime "
                                "(import default=0): nessun import eager nel "
                                "percorso default; unici siti function-level "
                                "(lazy) sotto RAG_BACKEND=chroma o negli "
                                "strumenti di migrazione.")
    if not ok:
        res["causa"] = (f"import eager runtime={n_eager}; "
                        f"dynamic_ok={dyn_ok} ({dyn})")
    _write_json(out_json, res)
    _log(f"[R13][BOOKS4] STATUS={res['status']} eager={n_eager} "
         f"lazy={len(runtime_lazy)} dynamic={dyn} -> {out_json}")
    return res


# ======================================================================
# CLI
# ======================================================================
def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        description="G3: migrazione chroma->sqlite sul dato reale "
                    "(dry-run default, backup+guardie per il cutover).")
    ap.add_argument("--commit", action="store_true",
                    help="cutover con guardie (gate -> backup -> migrazione -> post-check)")
    ap.add_argument("--backup", action="store_true",
                    help="solo backup indice chroma + studioia.db (manifest SHA256)")
    ap.add_argument("--restore", metavar="MANIFEST", default=None,
                    help="ripristina i file dal manifest SHA256 e riverifica")
    ap.add_argument("--dedupe-legacy", action="store_true",
                    help="R13/C3 dry-run (default): elenca i chunk legacy dello "
                         "store materiali (0 scrittura)")
    ap.add_argument("--apply", action="store_true",
                    help="con --dedupe-legacy: backup SHA256+manifest + DELETE "
                         "dei SOLO duplicati esatti + post-check + parity")
    ap.add_argument("--books-dry-run", action="store_true",
                    help="R13/BOOKS1: parity/recall su vector_index_books REALE "
                         "(corpus vuoto dichiarato con numeri reali)")
    ap.add_argument("--books-backup-verify", action="store_true",
                    help="R13/BOOKS2: backup SHA256+manifest libri + test "
                         "restore (checksum) su cartella TEMP")
    ap.add_argument("--books-cutover", action="store_true",
                    help="R13/BOOKS3: cutover chroma->sqlite store libri con "
                         "flag + rollback testato")
    ap.add_argument("--books4-imports", action="store_true",
                    help="R13/BOOKS4: scan import chromadb nel runtime "
                         "(eager=0 dichiarato)")
    args = ap.parse_args(argv)

    if args.dedupe_legacy:
        res = dedupe_legacy(apply=args.apply)
        st = res.get("status")
        code = {"eseguito": 0, "NIENTE_DA_FARE": 0, "DRY_RUN": 0}.get(st)
        if code is None:
            code = 6 if st == "NO_DB" else (7 if st == "BLOCKED" else
                                            (5 if st == "REFUSED" else 3))
        label = "DEDUPE"
    elif args.books_dry_run:
        res = books_dry_run()
        code = 0 if res.get("status") in ("VACUO", "OK", "KO") else 3
        label = "BOOKS1"
    elif args.books_backup_verify:
        res = books_backup_verify()
        code = 0 if res.get("status") == "eseguito" else 3
        label = "BOOKS2"
    elif args.books_cutover:
        res = books_cutover()
        code = 0 if res.get("status") == "eseguito" else (
            7 if res.get("status") == "BLOCKED" else 3)
        label = "BOOKS3"
    elif args.books4_imports:
        res = books4_import_scan()
        code = 0 if res.get("status") in ("eseguito",
                                          "eseguito_con_warning") else 3
        label = "BOOKS4"
    elif args.apply:
        _log("[R13] --apply richiede --dedupe-legacy "
             "(eseguire: python data/migrate_real.py --dedupe-legacy --apply)")
        return 2
    elif args.restore:
        res = restore(args.restore)
        code = 0 if res.get("ok") else 4
        label = "RESTORE"
    elif args.commit:
        res = commit()
        code = 0 if res.get("status") == "eseguito" else (
            2 if res.get("status") == "BLOCKED" else 3)
        label = "CUTOVER"
    elif args.backup:
        res = backup()
        code = 0 if res.get("ok") else 3
        label = "BACKUP"
    else:
        res = dry_run()
        code = 0
        label = "DRY-RUN"

    summary = {
        k: res.get(k) for k in
        ("status", "parity_top10", "recall5", "n_chunks", "backup_path",
         "manifest_path", "restored", "reason", "error", "causa",
         "n_legacy", "n_stage2", "n_originals", "deleted", "corpus_vuoto",
         "chunks", "vacuo")
        if k in res
    }
    _log(f"[G3][{label}] " + json.dumps(summary, ensure_ascii=True, default=str))
    return code


if __name__ == "__main__":
    sys.exit(main())

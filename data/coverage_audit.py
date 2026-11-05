# -*- coding: utf-8 -*-
"""data/coverage_audit.py — R15b-I (I2): audit copertura RAG + repair one-click.

Verifica (per ogni base RAG a due livelli, originals/ + rag_stage2/):
  (a) ogni file in originals/ ha la copia in rag_stage2/  (altrimenti orfano);
  (b) ogni file supportato in rag_stage2/ ha >=1 chunk in `chunks`
      (match su source_file, per store_key);
  (c) stato indexed_files vs reale (riga assente / stale size+mtime /
      riga per file inesistente) + chunk per file inesistente.

Output: qa/coverage_report.json — per-file: originals/rag/chunks/indexed +
sezione orfani per base + summary.

  python data/coverage_audit.py              # solo audit (scrittura report)
  python data/coverage_audit.py --repair     # audit + repair one-click:
      1) copia originals -> rag_stage2 (no-overwrite; .md + sidecar;
         i non-.md vengono segnalati "needs_converter", niente conversioni
         automatiche fuori dal converter dell'app);
      2) rimozione righe/chunk orfani (file non piu' su disco);
      3) reindex CONTROLLATO dei soli file mancanti/parziali tramite
         Indexer.index_folder (incrementale: reconcilia le righe
         indexed_files senza re-embed quando la firma nei meta combacia) + ripristino righe indexed_files.
  Idempotente: 2a esecuzione = 0 azioni.

Tutto locale, nessuna rete, nessuna pip nuova.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from core.rag.indexer import (  # noqa: E402
    ORIGINALS_DIR_NAME,
    STAGE2_DIR_NAME,
    ensure_rag_layout,
)

_MD_SUFFIXES = {".md", ".markdown"}
_SIDECAR_SUFFIX = ".images.json"
_DEFAULT_REPORT = _ROOT / "qa" / "coverage_report.json"


# ======================================================================
# CONTESTO
# ======================================================================
def _appdata() -> Path:
    try:
        from data.config_manager import get_app_data_dir
        return Path(get_app_data_dir())
    except Exception:
        return Path.home() / "AppData" / "Roaming" / "NovaStudio"


def discover_bases(project_root: Optional[Path] = None,
                   appdata: Optional[Path] = None) -> List[dict]:
    """Basi RAG note: note L1 (file_AIstudio/ nel progetto) e libri L2
    (%APPDATA%/NovaStudio/preselected_books)."""
    root = Path(project_root or _ROOT)
    ad = Path(appdata or _appdata())
    return [
        {"base": root / "file_AIstudio",
         "store_key": "vector_index",
         "persist_dir": ad / "vector_index"},
        {"base": ad / "preselected_books",
         "store_key": "vector_index_books",
         "persist_dir": ad / "vector_index_books"},
    ]


def _norm(p) -> str:
    """Path normalizzato per confronti (case-insensitive su Windows)."""
    try:
        return os.path.normcase(os.path.abspath(str(p)))
    except (OSError, ValueError):
        return str(p).lower()


def _is_supported(path) -> bool:
    try:
        from core.parsers import is_supported
        return bool(is_supported(str(path)))
    except Exception:
        return Path(path).suffix.lower() in _MD_SUFFIXES | {".txt", ".pdf"}


def _list_dir(d: Path) -> List[str]:
    """File diretti (non ricorsivi) di una cartella, ordinati."""
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.iterdir() if p.is_file())


def _read_db(db_path: Path) -> dict:
    """Snapshot read-only del DB: chunks per (store, sorgente) + righe
    indexed_files + meta indice. DB assente/ilegibile → struttura vuota."""
    out = {"chunks": {}, "indexed": {}, "index_meta": {}, "ok": False, "error": None}
    if not Path(db_path).exists():
        out["error"] = "db_assente"
        return out
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            for store_key, src, n in con.execute(
                "SELECT store_key, source_file, COUNT(*) FROM chunks "
                "GROUP BY store_key, source_file"
            ):
                out["chunks"].setdefault(store_key, {})[src] = int(n)
            for row in con.execute(
                "SELECT percorso_file, dimensione, data_modifica, num_chunk, "
                "data_ultima_indicizzazione FROM indexed_files"
            ):
                out["indexed"][row[0]] = {
                    "dimensione": row[1],
                    "data_modifica": row[2],
                    "num_chunk": row[3],
                    "data_ultima_indicizzazione": row[4],
                }
            try:
                for store_key, key, value in con.execute(
                    "SELECT store_key, key, value FROM index_meta"
                ):
                    out["index_meta"].setdefault(store_key, {})[key] = value
            except sqlite3.Error:
                pass  # tabella index_meta ancora da creare (boot store)
            out["ok"] = True
        finally:
            con.close()
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
    return out


# ======================================================================
# AUDIT
# ======================================================================
def _audit_base(binfo: dict, db: dict) -> dict:
    base = Path(binfo["base"])
    store_key = binfo["store_key"]
    originals = base / ORIGINALS_DIR_NAME
    stage2 = base / STAGE2_DIR_NAME
    orig_names = _list_dir(originals)
    stage_names = _list_dir(stage2)

    chunks_map = db["chunks"].get(store_key, {})
    chunks_by_norm: Dict[str, int] = {}
    for src, n in chunks_map.items():
        chunks_by_norm[_norm(src)] = chunks_by_norm.get(_norm(src), 0) + int(n)

    indexed_by_norm: Dict[str, dict] = {}
    for p, row in db["indexed"].items():
        indexed_by_norm[_norm(p)] = {"percorso_file": p, **row}

    stage_norms = {_norm(stage2 / n): n for n in stage_names}
    orig_norms = {_norm(originals / n): n for n in orig_names}
    all_names = sorted(set(orig_names) | set(stage_names))

    files = []
    orphans = {
        "originals_without_stage2": [],
        "unsupported_originals_needs_converter": [],
        "stage2_without_chunks": [],
        "stage2_missing_indexed_row": [],
        "stage2_stale_indexed_rows": [],
        "indexed_rows_missing_file": [],
        "chunks_without_file": [],
    }

    for name in all_names:
        in_orig = name in orig_names
        in_stage = name in stage_names
        s_path = stage2 / name
        supported = _is_supported(s_path) or _is_supported(originals / name)
        is_sidecar = name.endswith(_SIDECAR_SUFFIX)
        n_chunks = chunks_by_norm.get(_norm(s_path), 0) if in_stage else 0
        row = indexed_by_norm.get(_norm(s_path)) if in_stage else None

        issues = []
        if not in_stage:
            issues.append("missing_stage2")
            if in_orig:
                if is_sidecar:
                    # sidecar: copiato insieme al .md (trattato come copia)
                    orphans["originals_without_stage2"].append(name)
                elif supported and Path(name).suffix.lower() in _MD_SUFFIXES:
                    orphans["originals_without_stage2"].append(name)
                else:
                    orphans["unsupported_originals_needs_converter"].append(name)
        else:
            if supported and not is_sidecar:
                if n_chunks <= 0:
                    issues.append("missing_chunks")
                    orphans["stage2_without_chunks"].append(name)
                if row is None:
                    issues.append("missing_indexed_row")
                    orphans["stage2_missing_indexed_row"].append(name)
                else:
                    try:
                        st = os.stat(s_path)
                        stale = (int(row["dimensione"]) != int(st.st_size)
                                 or abs(float(row["data_modifica"]) - st.st_mtime) >= 1.0)
                    except OSError:
                        stale = True
                    if stale:
                        issues.append("stale_indexed_row")
                        orphans["stage2_stale_indexed_rows"].append(name)

        if not issues and in_stage and supported and not is_sidecar and row is None:
            issues.append("missing_indexed_row")  # difensivo (non dovrebbe)
        files.append({
            "name": name,
            "original": in_orig,
            "stage2": in_stage,
            "supported": bool(supported),
            "sidecar": bool(is_sidecar),
            "chunks": int(n_chunks),
            "indexed": row,
            "status": issues[0] if issues else "ok",
            "issues": issues,
        })

    # --- reverse: righe/chunk il cui FILE non esiste piu' sotto base ---
    base_norm = _norm(base)
    stage_norm_set = set(stage_norms)
    for npath, row in list(indexed_by_norm.items()):
        if npath.startswith(base_norm) and npath not in stage_norm_set:
            orphans["indexed_rows_missing_file"].append(row["percorso_file"])
    for nsrc, n in chunks_by_norm.items():
        if nsrc.startswith(base_norm) and nsrc not in stage_norm_set:
            orphans["chunks_without_file"].append(nsrc)

    counts = {
        "originals": len(orig_names),
        "stage2": len(stage_names),
        "files": len(files),
        "chunks": int(sum(chunks_map.values())),
        "indexed_rows": int(sum(
            1 for p in indexed_by_norm if p.startswith(base_norm)
        )),
        "ok": sum(1 for f in files if f["status"] == "ok"),
        "orphans": int(sum(len(v) for v in orphans.values())),
    }
    return {
        "base": str(base),
        "store_key": store_key,
        "persist_dir": str(binfo.get("persist_dir", "")),
        "files": files,
        "orphans": orphans,
        "counts": counts,
        "index_meta": db["index_meta"].get(store_key, {}),
    }


def run_audit(bases: Optional[List[dict]] = None,
              db_path=None,
              report_path=None,
              write_report: bool = True) -> dict:
    """Esegue l'audit completo e (di default) scrive il report JSON."""
    t0 = time.time()
    if bases is None:
        bases = discover_bases()
    if db_path is None:
        db_path = _appdata() / "studioia.db"
    db = _read_db(Path(db_path))

    base_reports = [_audit_base(b, db) for b in bases]
    summary = {
        "bases": len(base_reports),
        "files_total": sum(r["counts"]["files"] for r in base_reports),
        "files_ok": sum(r["counts"]["ok"] for r in base_reports),
        "chunks_total": sum(r["counts"]["chunks"] for r in base_reports),
        "indexed_rows_total": sum(r["counts"]["indexed_rows"] for r in base_reports),
        "orphans_total": sum(r["counts"]["orphans"] for r in base_reports),
        "db_ok": bool(db["ok"]),
        "db_error": db["error"],
    }
    report = {
        "round": "R15b",
        "agent": "IMPLEMENTER-INDEX (blocco I)",
        "tool": "data/coverage_audit.py",
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        "db_path": str(db_path),
        "db_indexed_files_rows": len(db["indexed"]),
        "db_chunks_total": int(sum(
            n for store in db["chunks"].values() for n in store.values()
        )),
        "bases": base_reports,
        "summary": summary,
        "elapsed_ms": round((time.time() - t0) * 1000, 2),
    }
    if write_report:
        _write_report(Path(report_path or _DEFAULT_REPORT), report)
    return report


def _write_report(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ======================================================================
# REPAIR (one-click, idempotente)
# ======================================================================
def run_repair(bases: Optional[List[dict]] = None,
               db_path=None,
               embedder=None,
               report_path=None) -> dict:
    """Audit + repair one-click. Ritorna {"audit", "repair", "post"}.

    - copia originals→rag_stage2 no-overwrite (.md + sidecar; non-.md
      segnalati needs_converter, conversione lasciata al converter app);
    - rimuove righe/chunk orfani (file non piu' su disco);
    - reindex controllato SOLO di file mancanti/parziali (Indexer
      incrementale: riscrive le righe indexed_files, reconcile senza
      re-embed quando la firma nei meta combacia);
    - idempotente: 2a esecuzione → actions tutte a 0.
    """
    if bases is None:
        bases = discover_bases()
    if db_path is None:
        db_path = _appdata() / "studioia.db"
    db_path = Path(db_path)

    audit = run_audit(bases, db_path, report_path=None, write_report=False)
    actions = {"copied": [], "needs_converter": [], "rows_removed": [],
               "chunks_removed": [], "reindex_stats": [], "notes": []}

    # ---- 1) copia originals -> rag_stage2 (no-overwrite) ----
    for b in bases:
        base = Path(b["base"])
        originals = base / ORIGINALS_DIR_NAME
        stage2 = base / STAGE2_DIR_NAME
        if not originals.is_dir():
            continue
        ensure_rag_layout(base)
        for src in sorted(originals.iterdir()):
            if not src.is_file():
                continue
            dst = stage2 / src.name
            if dst.exists():
                continue
            is_md = src.suffix.lower() in _MD_SUFFIXES
            is_sidecar = src.name.endswith(_SIDECAR_SUFFIX)
            if is_md or is_sidecar:
                try:
                    shutil.copy2(str(src), str(dst))
                    actions["copied"].append(str(dst))
                except OSError as exc:
                    actions["notes"].append(f"copia fallita {src.name}: {exc}")
            else:
                actions["needs_converter"].append(str(src))

    # ---- 2) pulizia orfani (file non piu' su disco) ----
    for b in bases:
        base = Path(b["base"])
        rep = next(r for r in audit["bases"] if _norm(r["base"]) == _norm(base))
        orph = rep["orphans"]
        if orph["indexed_rows_missing_file"] or orph["chunks_without_file"]:
            from data.db import Database
            dbobj = Database(db_path=db_path)
            store = None
            for p in orph["indexed_rows_missing_file"]:
                try:
                    dbobj.remove_indexed_file(p)
                    actions["rows_removed"].append(p)
                except Exception as exc:
                    actions["notes"].append(f"rimozione riga fallita {p}: {exc}")
            if orph["chunks_without_file"]:
                try:
                    from core.rag.vector_store import VectorStore
                    store = VectorStore(str(b["persist_dir"]), db_path=str(db_path),
                                        store_key=b["store_key"])
                    for p in orph["chunks_without_file"]:
                        try:
                            store.delete_by_source_file(p)
                            actions["chunks_removed"].append(p)
                        except Exception as exc:
                            actions["notes"].append(
                                f"rimozione chunk fallita {p}: {exc}")
                except Exception as exc:
                    actions["notes"].append(f"store non disponibile: {exc}")
            if store is not None:
                try:
                    store.close()
                except Exception:
                    pass

    # ---- 3) reindex controllato dei soli file mancanti/parziali ----
    need_reindex = any(
        r["orphans"]["originals_without_stage2"]
        or r["orphans"]["stage2_without_chunks"]
        or r["orphans"]["stage2_missing_indexed_row"]
        or r["orphans"]["stage2_stale_indexed_rows"]
        for r in audit["bases"]
    ) or bool(actions["copied"])

    if need_reindex:
        from core.rag.indexer import Indexer
        from data.db import Database
        dbobj = Database(db_path=db_path)
        for b in bases:
            stage2 = Path(b["base"]) / STAGE2_DIR_NAME
            if not stage2.is_dir():
                continue
            try:
                from core.rag.vector_store import VectorStore
                vstore = VectorStore(str(b["persist_dir"]), db_path=str(db_path),
                                     store_key=b["store_key"])
                indexer = Indexer(dbobj, vstore, embedder=embedder)
                stats = indexer.index_folder(str(stage2), ocr_enabled=True)
                actions["reindex_stats"].append({"store_key": b["store_key"], **stats})
                try:
                    vstore.close()
                except Exception:
                    pass
            except Exception as exc:
                actions["notes"].append(
                    f"reindex fallito per {b['store_key']}: {type(exc).__name__}: {exc}"
                )

    # ---- post-stato (idempotenza verificabile) ----
    post = run_audit(bases, db_path, report_path=None, write_report=False)
    result = {
        "round": "R15b",
        "agent": "IMPLEMENTER-INDEX (blocco I)",
        "tool": "data/coverage_audit.py --repair",
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        "audit": audit,
        "repair": actions,
        "post": {
            "summary": post["summary"],
            "orphans_by_base": {
                r["base"]: r["orphans"] for r in post["bases"]
            },
        },
        "idempotent_check": {
            "copied": len(actions["copied"]),
            "rows_removed": len(actions["rows_removed"]),
            "chunks_removed": len(actions["chunks_removed"]),
            "files_reindexed": int(sum(
                s.get("changed", 0) for s in actions["reindex_stats"]
            )),
            "rows_reconciled": int(sum(
                s.get("reconciled", 0) for s in actions["reindex_stats"]
            )),
            "orphans_after": post["summary"]["orphans_total"],
        },
    }
    _write_report(Path(report_path or _DEFAULT_REPORT), result)
    return result


# ======================================================================
# CLI
# ======================================================================
def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Audit copertura RAG (R15b-I)")
    ap.add_argument("--repair", action="store_true",
                    help="esegue il repair one-click dopo l'audit")
    ap.add_argument("--json", dest="json_path", default=None,
                    help="path report JSON (default: qa/coverage_report.json)")
    ap.add_argument("--db", dest="db_path", default=None,
                    help="path studioia.db (default: %APPDATA%)")
    args = ap.parse_args(argv)

    report_path = Path(args.json_path) if args.json_path else _DEFAULT_REPORT
    db_path = Path(args.db_path) if args.db_path else None

    if args.repair:
        result = run_repair(db_path=db_path, report_path=report_path)
        chk = result["idempotent_check"]
        print(f"[coverage_audit] repair: copied={chk['copied']} "
              f"reindexed={chk['files_reindexed']} "
              f"rows_reconciled={chk['rows_reconciled']} "
              f"rows_removed={chk['rows_removed']} "
              f"chunks_removed={chk['chunks_removed']} "
              f"orphans_after={chk['orphans_after']}")
    else:
        result = run_audit(db_path=db_path, report_path=report_path)
        s = result["summary"]
        print(f"[coverage_audit] files={s['files_total']} ok={s['files_ok']} "
              f"chunks={s['chunks_total']} indexed_rows={s['indexed_rows_total']} "
              f"orfani={s['orphans_total']}")
    print(f"[coverage_audit] report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

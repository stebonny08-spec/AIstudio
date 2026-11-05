# -*- coding: utf-8 -*-
"""data/migrate_dedup.py - R18 B4: migrazione ONE-SHOT dei duplicati
dell'indice (hash contenuto per documento).

- assicura la colonna content_hash + backfill;
- rimuove i duplicati (stessa chiave store_key+source_file+hash) tenendo
  la riga piu' vecchia, con i relativi vettori, SENZA perdere chunk unici;
- crea l'indice unico ux_chunks_hash_doc;
- scrive il report su qa/r18_dedup_migration.json.

Il vincolo e' inoltre riapplicato a ogni boot da
SQLiteVectorStore._ensure_schema (sweep idempotente, B4.1).
Uso:  python data/migrate_dedup.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def content_hash(text: str) -> str:
    norm = re.sub(r"\s+", " ", str(text or "").strip().lower())
    return hashlib.sha1(norm.encode("utf-8", "ignore")).hexdigest()


def main() -> int:
    from data.config_manager import get_app_data_dir
    db = Path(get_app_data_dir()) / "studioia.db"
    con = sqlite3.connect(str(db), timeout=15.0)
    cur = con.cursor()

    def vec_tables():
        rows = cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND (name LIKE 'vec\\_%' ESCAPE '\\' "
            "OR name LIKE 'vecnb\\_%' ESCAPE '\\')").fetchall()
        return [r[0] for r in rows]

    before = {"chunks": cur.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]}

    # 1) colonna + backfill
    try:
        cur.execute("ALTER TABLE chunks ADD COLUMN content_hash TEXT")
    except sqlite3.OperationalError:
        pass
    rows = cur.execute(
        "SELECT rowid, testo FROM chunks WHERE content_hash IS NULL").fetchall()
    for rid, txt in rows:
        cur.execute("UPDATE chunks SET content_hash = ? WHERE rowid = ?",
                    (content_hash(txt), rid))

    # 2) duplicati per (store_key, source_file, hash)
    groups = cur.execute(
        "SELECT store_key, source_file, content_hash, MIN(rowid), COUNT(*) "
        "FROM chunks WHERE content_hash IS NOT NULL "
        "GROUP BY store_key, source_file, content_hash "
        "HAVING COUNT(*) > 1").fetchall()
    vt = vec_tables()
    removed = []
    for sk, sf, ch, keep, n in groups:
        orphans = cur.execute(
            "SELECT rowid, substr(testo,1,60) FROM chunks WHERE store_key=? "
            "AND source_file=? AND content_hash=? AND rowid<>?",
            (sk, sf, ch, keep)).fetchall()
        for rid, head in orphans:
            for t in vt:
                try:
                    cur.execute(f"DELETE FROM {t} WHERE rowid=?", (rid,))
                except sqlite3.Error:
                    pass
            cur.execute("DELETE FROM chunks WHERE rowid=?", (rid,))
            removed.append({"store": sk, "doc": sf, "hash": ch,
                            "rowid": rid, "head": head, "group_size": n})

    # 3) indice unico
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_chunks_hash_doc "
                "ON chunks(store_key, source_file, content_hash)")
    con.commit()

    after = {"chunks": cur.execute("SELECT COUNT(*) FROM chunks").fetchone()[0],
             "unique_doc_hash": cur.execute(
                 "SELECT COUNT(*) FROM (SELECT 1 FROM chunks GROUP BY "
                 "store_key, source_file, content_hash)").fetchone()[0],
             "unique_index": bool(cur.execute(
                 "SELECT name FROM sqlite_master WHERE type='index' AND "
                 "name='ux_chunks_hash_doc'").fetchone())}
    con.close()

    report = {
        "round": "18", "block": "B4", "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "db": str(db), "before": before, "after": after,
        "duplicati_rimossi": removed, "n_rimossi": len(removed),
        "vincolo": "ux_chunks_hash_doc (store_key, source_file, content_hash)",
        "notes": ("chroma legacy (vector_index/chroma.sqlite3, 17 hash x2) "
                  "e' archivio non attivo: NON toccato (backend attivo = "
                  "sqlite); le copie su disco originals/ e rag_stage2/ "
                  "restano, originals/ e' escluso dal retrieval (C4)"),
    }
    out = ROOT / "qa" / "r18_dedup_migration.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print(f"R18 B4 migration: prima={before['chunks']} dopo={after['chunks']} "
          f"rimossi={len(removed)} -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

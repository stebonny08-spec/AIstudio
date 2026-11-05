# -*- coding: utf-8 -*-
"""qa/_inspect_books.py — stato indice libri (chroma.sqlite3) + file preselected_books (lettura)."""
import os
import sqlite3
from pathlib import Path

app = Path(os.environ.get("APPDATA", "")) / "NovaStudio"
chroma = app / "vector_index_books" / "chroma.sqlite3"
print("chroma books esiste:", chroma.exists(), chroma.stat().st_size if chroma.exists() else 0)
if chroma.exists():
    con = sqlite3.connect(f"file:{chroma}?mode=ro", uri=True)
    cur = con.cursor()
    tabs = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print("tabelle:", tabs)
    for t in ("embeddings", "collections", "segments"):
        if t in tabs:
            try:
                n = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                print(f"  {t}: {n}")
            except Exception as e:
                print(f"  {t}: errore {e}")
    # quartetti embedding: quanti vettori reali
    try:
        row = cur.execute(
            "SELECT COUNT(*) FROM embeddings e JOIN segments s ON e.segment_id=s.id "
            "WHERE s.scope='METADATA'"  # solo conteggio base
        ).fetchone()
        print("  embeddings join segments:", row)
    except Exception as e:
        print("  join errore:", e)
    # collections
    try:
        for r in cur.execute("SELECT id, name FROM collections"):
            print("  collection:", r)
    except Exception as e:
        print("  collections errore:", e)
    con.close()

# flag
flag = app / "vector_index_books" / "chroma_migrated.flag"
if flag.exists():
    print("flag:", flag.read_text(encoding="utf-8", errors="replace"))

# file libri
pb = app / "preselected_books"
print("--- preselected_books tree ---")
for p in sorted(pb.rglob("*")):
    rel = p.relative_to(pb)
    print("  ", rel, "(dir)" if p.is_dir() else p.stat().st_size)

# indice sqlite per libri dentro studioia.db
db = app / "studioia.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
n = con.execute("SELECT COUNT(*) FROM chunks WHERE store_key='vector_index_books'").fetchone()[0]
print("studioia.db chunks libri:", n)
con.close()

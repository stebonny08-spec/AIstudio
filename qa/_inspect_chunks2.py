# -*- coding: utf-8 -*-
"""qa/_inspect_chunks2.py — confronto i due set di chunk + stato indice libri (lettura)."""
import hashlib
import os
import sqlite3
from pathlib import Path

app = Path(os.environ.get("APPDATA", "")) / "NovaStudio"
db = app / "studioia.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = con.cursor()
rows = cur.execute(
    "SELECT source_file, id, doc_id, testo FROM chunks ORDER BY source_file, id"
).fetchall()
by_src = {}
for sf, cid, did, txt in rows:
    by_src.setdefault(sf, []).append((did, hashlib.sha256((txt or "").encode()).hexdigest()))
print("sorgenti:", {k: len(v) for k, v in by_src.items()})
srcs = list(by_src)
if len(srcs) == 2:
    a = sorted(by_src[srcs[0]])
    b = sorted(by_src[srcs[1]])
    print("doc_id identici:", [x[0] for x in a] == [x[0] for x in b])
    print("hash testo identici:", [x[1] for x in a] == [x[1] for x in b])
    print("esempi doc_id:", [x[0] for x in a[:3]])
# indexed_files
print("--- indexed_files ---")
try:
    for r in cur.execute("SELECT * FROM indexed_files LIMIT 20"):
        print("  ", r)
except Exception as e:
    print("  errore:", e)
con.close()

# indice libri: tabelle presenti?
print("--- store 'vector_index_books'? ---")
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
try:
    n = con.execute("SELECT COUNT(*) FROM chunks WHERE store_key='vector_index_books'").fetchone()[0]
    srcs2 = con.execute(
        "SELECT source_file, COUNT(*) FROM chunks WHERE store_key='vector_index_books' "
        "GROUP BY source_file"
    ).fetchall()
    print("  chunks libri:", n, "sorgenti:", srcs2[:10])
except Exception as e:
    print("  errore:", e)
con.close()
print("--- cartella APPDATA NovaStudio ---")
for p in sorted(app.iterdir()):
    print("  ", p.name, "(dir)" if p.is_dir() else p.stat().st_size)

# -*- coding: utf-8 -*-
"""qa/r15_gt_inspect.py — lettura (sola) dell'indice per costruire il GT."""
import io
import json
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
from data.config_manager import get_app_data_dir          # noqa: E402

DB = str(get_app_data_dir() / "studioia.db")
con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
out = {"db": DB}
out["tables"] = [r[0] for r in con.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
out["fts_tables"] = [r[0] for r in con.execute(
    "SELECT name FROM sqlite_master WHERE name LIKE '%fts%'")]
try:
    out["per_store"] = [dict(r) for r in con.execute(
        "SELECT store_key, count(*) AS n FROM chunks GROUP BY store_key")]
except Exception as e:
    out["per_store_err"] = str(e)
try:
    out["n_fts_rows"] = con.execute("SELECT count(*) FROM chunks_fts").fetchone()[0]
except Exception as e:
    out["n_fts_rows_err"] = str(e)
rows = []
for r in con.execute(
        "SELECT store_key, source_file, substr(testo,1,260) AS t, length(testo) AS L "
        "FROM chunks ORDER BY store_key, source_file, rowid"):
    rows.append(dict(r))
out["chunks"] = rows
out["n_chunks"] = len(rows)
try:
    out["vec_tables"] = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'vec%' OR name LIKE 'vecnb%')")]
    for t in out["vec_tables"]:
        out["cnt_" + t] = con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
except Exception as e:
    out["vec_err"] = str(e)
con.close()
p = os.path.join(ROOT, "qa", "r15_gt_inspect.json")
with io.open(p, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print(json.dumps({k: v for k, v in out.items() if k != "chunks"},
                 ensure_ascii=False, indent=2))
print("--- chunks ---")
for i, r in enumerate(rows):
    print(i, r["store_key"], "|", os.path.basename(r["source_file"])[:50], "| L",
          r["L"], "|", r["t"][:110].replace("\n", " "))

# -*- coding: utf-8 -*-
"""Smoke P1b.2: flag OFF == sqlite-vec; flag ON = layer reale (rebuild+save);
secondo processo -> load (nessun rebuild). Output: qa/_x_p1b_smoke.out"""
import json, os, sys, subprocess, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT); sys.path.insert(0, str(ROOT))

CODE_OFF = r'''
import sys, json, time
sys.path.insert(0, ".")
from data.config_manager import get_app_data_dir
from core.rag.vector_store_sqlite import SQLiteVectorStore
vs = SQLiteVectorStore(str(get_app_data_dir() / "vector_index"))
row = vs._conn.execute("SELECT embedding FROM " + vs._vec_table + " LIMIT 1").fetchone()
q = list(__import__("struct").unpack("<%df" % (len(row[0]) // 4), row[0]))
t0 = time.perf_counter()
hits = vs._vec_query(q, 5)
ms = (time.perf_counter() - t0) * 1000
print("OFF", json.dumps({"n": len(hits), "ms": round(ms, 3),
      "ids": [h["rowid"] if isinstance(h, dict) and "rowid" in h else None for h in hits],
      "sims": [round(h.get("similarity", -1), 6) for h in hits] if hits and isinstance(hits[0], dict) else []}))
'''
CODE_ON = r'''
import sys, json, time, os
sys.path.insert(0, ".")
from data.config_manager import get_app_data_dir
from core.rag.vector_store_sqlite import SQLiteVectorStore
vs = SQLiteVectorStore(str(get_app_data_dir() / "vector_index"))
row = vs._conn.execute("SELECT embedding FROM " + vs._vec_table + " LIMIT 1").fetchone()
q = list(__import__("struct").unpack("<%df" % (len(row[0]) // 4), row[0]))
t0 = time.perf_counter()
hits = vs._vec_query(q, 5)
ms = (time.perf_counter() - t0) * 1000
layer = getattr(vs, "_usearch_layer", None)
print("ON", json.dumps({"n": len(hits), "ms": round(ms, 3),
      "ids": [h["rowid"] if isinstance(h, dict) and "rowid" in h else None for h in hits],
      "sims": [round(h.get("similarity", -1), 6) for h in hits] if hits and isinstance(hits[0], dict) else [],
      "layer": (layer.stats_snapshot() if layer else None)}))
'''
env = dict(os.environ)
env["PYTHONIOENCODING"] = "utf-8"
env.pop("RAG_USEARCH", None)
r1 = subprocess.run([sys.executable, "-c", CODE_OFF], capture_output=True,
                    text=True, encoding="utf-8", errors="replace", env=env, timeout=120)
print(r1.stdout.strip() or r1.stderr[-400:])
env["RAG_USEARCH"] = "1"
r2 = subprocess.run([sys.executable, "-c", CODE_ON], capture_output=True,
                    text=True, encoding="utf-8", errors="replace", env=env, timeout=120)
print(r2.stdout.strip() or r2.stderr[-400:])
r3 = subprocess.run([sys.executable, "-c", CODE_ON], capture_output=True,
                    text=True, encoding="utf-8", errors="replace", env=env, timeout=120)
print(r3.stdout.strip() or r3.stderr[-400:])

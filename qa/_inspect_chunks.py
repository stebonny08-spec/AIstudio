# -*- coding: utf-8 -*-
"""qa/_inspect_chunks.py — lettura dettaglio chunks reali (audit C3, sola lettura)."""
import os
import sqlite3
from pathlib import Path

db = Path(os.environ.get("APPDATA", "")) / "NovaStudio" / "studioia.db"
if not db.exists():
    from data.config_manager import get_app_data_dir
    db = Path(get_app_data_dir()) / "studioia.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = con.cursor()
print("DB:", db)
print("--- tabelle ---")
for r in cur.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')"):
    print("  ", r[0])
print("--- chunks per store/source ---")
for r in cur.execute(
    "SELECT store_key, source_file, COUNT(*) FROM chunks GROUP BY store_key, source_file"
):
    print("  ", r)
print("--- meta colonne chunks ---")
for r in cur.execute("PRAGMA table_info(chunks)"):
    print("  ", r)
con.close()

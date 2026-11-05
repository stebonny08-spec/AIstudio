# -*- coding: utf-8 -*-
"""Verifica staging per il push verso GitHub (solo lettura + git status)."""
import subprocess, sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
os.chdir(r"C:\Users\stebo\Desktop\progetti app\StudioIA_7")

def git(*a):
    r = subprocess.run(["git", *a], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (r.stdout or "") + (r.stderr or "")

st = git("diff", "--cached", "--name-status").splitlines()
print("righe staged:", len(st))
from collections import Counter
print("conteggi:", dict(Counter(l.split("\t")[0][0] for l in st if l)))

names = [l.split("\t")[-1] for l in st]

bad_pat = [
    ("node_modules", lambda p: "node_modules" in p),
    ("png qa", lambda p: p.startswith("qa/") and p.endswith(".png")),
    ("seed privato", lambda p: "r27_seed" in p),
    ("venv", lambda p: ".venv" in p.split(os.sep)[0] or "/.venv/" in p.replace("\\", "/") or p.startswith(".venv")),
    ("pesanti", lambda p: p.split("/")[0] in ("build", "dist", "models", "tesseract")),
    ("gguf/pyc", lambda p: p.endswith((".gguf", ".pyc")) or "__pycache__" in p),
    ("dati utente", lambda p: p.startswith("file_AIstudio/") or p.startswith("tmp/") or p.startswith("qa/tmp/")),
    ("db", lambda p: p.endswith((".db", ".sqlite", ".sqlite3"))),
]
print("--- pattern vietati presenti (atteso: nessuno) ---")
found = False
for name, fn in bad_pat:
    hits = [p for p in names if fn(p)]
    if hits:
        found = True
        print("VIOLATO", name, "->", hits[:8], "..." if len(hits) > 8 else "")
if not found:
    print("OK nessuna violazione")

tools = [p for p in names if p.startswith("tools/")]
print("tools staged:", tools if tools else "NESSUNO")

big, total = [], 0.0
missing = 0
for p in names:
    if os.path.isfile(p):
        n = os.path.getsize(p)
        total += n
        if n > 5 * 1024 * 1024:
            big.append((round(n / 1048576, 1), p))
    else:
        missing += 1
print("file staged presenti su disco:", len(names) - missing, "mancanti:", missing)
print("byte totali staged: %.1f MB" % (total / 1048576))
print("file >5MB:", big if big else "NESSUNO")

# quali path top-level saranno nel commit
tops = Counter(p.split("/")[0] for p in names)
print("top-level nel commit:", dict(tops))

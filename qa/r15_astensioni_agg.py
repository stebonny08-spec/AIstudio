# -*- coding: utf-8 -*-
"""qa/r15_astensioni_agg.py — aggregato astensioni.jsonl per il report G3."""
import collections
import json
import os
import time

p = os.path.join(os.environ["APPDATA"], "NovaStudio", "astensioni.jsonl")
rec = [json.loads(l) for l in open(p, encoding="utf-8")]
print("righe_totali:", len(rec))
print("finestra:", time.strftime("%H:%M:%S", time.localtime(min(r["ts"] for r in rec))),
      "->", time.strftime("%H:%M:%S", time.localtime(max(r["ts"] for r in rec))))
print("per_causa:", dict(collections.Counter(r["causa"] for r in rec)))
print("per_outcome:", dict(collections.Counter(r["outcome"] for r in rec)))
print("web_tentato:", sum(1 for r in rec if r.get("web_attempted")))

last = {}
for r in rec:
    if r["threshold"] == 0.70:
        last[r["query"]] = r          # ultima decisione per query a soglia tarata
print("query_distinte@0.70:", len(last))
print("esiti@0.70:", dict(collections.Counter(r["outcome"] for r in last.values())))
print("cause@0.70:", dict(collections.Counter(r["causa"] for r in last.values())))
parz = [r for r in last.values() if r["outcome"] == "parziale"]
for r in parz:
    print("  PARZ:", r["query"][:60], "| score", r["score"], "| near_miss",
          len(r["near_miss"]))

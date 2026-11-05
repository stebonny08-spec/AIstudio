# -*- coding: utf-8 -*-
"""qa/p1b_hyde_cost.py — costo REALE della generazione HyDE con sidecar up.

Il bench A/B non ha potuto eseguire il ramo LLM (auto_start=False + porta
processo-locale -> 9/9 fallback llm_down). Qui si misura IL COSTO del ramo:
SidecarClient(auto_start=True) porta il server su (cold start dichiarato),
poi generate_hypothetical con client reale -> ms end-to-end.
Output: qa/p1b_hyde_llm_cost.json
"""
from __future__ import annotations
import json, os, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
from core.sidecar.client import SidecarClient
from core.rag.hyde import generate_hypothetical, HYDE_PROMPT  # noqa

t_cold = time.perf_counter()
cli = SidecarClient(auto_start=True)
# forza l'avvio con una completion breve (cold start misurato a parte)
cold = None
try:
    t0 = time.perf_counter()
    cli.complete("Rispondi con una sola parola: si", profile="fast",
                 classe="micro", max_tokens=8, stream=False)
    cold = round((time.perf_counter() - t0) * 1000, 1)
except Exception as e:
    cold = "ERR:" + str(e)[:200]

t0 = time.perf_counter()
text, info = generate_hypothetical(
    "Spiega in due frasi il funzionamento della fotosintesi clorofilliana.",
    client=cli)
total = round((time.perf_counter() - t0) * 1000, 1)
out = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
       "cold_start_ms": cold,
       "hyde_ms_total": total,
       "hyde_info": info,
       "hyp_len": len(text or ""),
       "hyp_head": (text or "")[:80],
       "rule_ms_p95": 150,
       "verdict_note": ("costo reale del ramo LLM HyDE vs soglia150ms "
                        "p95 aggiunti al retrieval")}
(out_path := ROOT / "qa" / "p1b_hyde_llm_cost.json").write_text(
    json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
print("HYDE_COST", json.dumps(out, ensure_ascii=False), flush=True)

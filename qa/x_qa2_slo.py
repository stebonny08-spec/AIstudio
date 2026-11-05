# -*- coding: utf-8 -*-
"""qa/x_qa2_slo.py — R23 QA-2: SLO TTFT con motore scelto, su LIVELLO REALE
sidecar (core.sidecar.client -> llama-server, stesso path dell'app).

Soglie R23/R16-R18: TTFT p50 <=1500 ms su MISS (prompt fresco, prefix cache
vuota) e p50 <=1500 ms su HIT? NO: hit <=1500 ms, miss <=4000 ms (dal prompt
R23: "TTFT p50 <=1500 hit / <=4000 miss").

Metodo (nessuna simulazione):
- motore: la config REALE (llama.engine, default auto->upstream R23) risolta
  dallo SidecarServer reale all'avvio (client auto_start).
- MISS: 5 prompt con prefisso UNICO all'inizio (zero riuso prefix cache) +
  corpo comune; HIT: 1 prompt identico ripetuto 6 volte (1 warm scartato + 5).
- TTFT = da prima di complete(stream=True) al PRIMO chunk SSE del client
  reale; streaming confermato = n_chunk>=2 e fine generazione raggiunta;
  risposta completa = testo non vuoto e stream concluso senza eccezione.
- p50/p95 nearest-rank sui campioni.
Output: qa/x_qa2_slo.json (+ stampa PASS/FAIL per soglia).
Uso:  PYTHONIOENCODING=utf-8 python qa/x_qa2_slo.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from core.sidecar.client import SidecarClient, AiUnavailable  # noqa: E402

OUT = ROOT / "qa" / "x_qa2_slo.json"
N_MISS, N_HIT, MAXTOK = 5, 5, 60
SLO_HIT_P50 = 1500.0
SLO_MISS_P50 = 4000.0

BODY = ("Spiega in dettaglio la fotosintesi clorofilliana per uno studente "
        "universitario: struttura del cloroplasto, tilacoidi e stroma, fase "
        "luminosa con fotolisi dell'acqua e catena di trasporto degli elettroni, "
        "produzione di ATP e NADPH, ciclo di Calvin con fissazione della CO2, "
        "ruolo della clorofilla a e b, e importanza ecologica del processo "
        "nella catena alimentare. Usa un linguaggio preciso ma accessibile. ")
NONCE = ["zeta91", "kappa47", "theta12", "omega63", "sigma28"]
HIT_PROMPT = "Rispondi in modo conciso: " + BODY


def near_rank(vals, q):
    if not vals:
        return None
    s = sorted(vals)
    import math
    k = max(1, math.ceil(q * len(s)))
    return s[k - 1]


def run_sample(client, prompt, tag, samples):
    t0 = time.time()
    first = None
    chunks = 0
    text = []
    try:
        gen = client.complete(prompt, profile="fast", classe="standard",
                              stream=True, max_tokens=MAXTOK)
        for piece in gen:
            if piece:
                if first is None:
                    first = time.time() - t0
                chunks += 1
                text.append(str(piece))
        full = "".join(text)
        rec = {"tag": tag, "ttft_ms": round((first or 0.0) * 1000, 1),
               "first_seen": first is not None, "n_chunks": chunks,
               "len": len(full), "complete": bool(full.strip()),
               "streaming_ok": chunks >= 2 and first is not None,
               "wall_ms": round((time.time() - t0) * 1000, 1)}
    except AiUnavailable as exc:
        rec = {"tag": tag, "error": str(exc)[:300], "complete": False}
    except Exception as exc:  # nessuna eccezione ignorata: registrata
        rec = {"tag": tag, "error": type(exc).__name__ + ": " + str(exc)[:300],
               "complete": False}
    samples.append(rec)
    print("  %s -> %s" % (tag, json.dumps(rec, ensure_ascii=False)), flush=True)
    return rec


def main():
    from data.config_manager import ConfigManager
    cfg = ConfigManager()
    raw = {}
    for k in ("llama.engine", "local_model_key", "local_model_path",
              "llama.model_path", "spec.draft_model"):
        try:
            raw[k] = cfg.get(k)
        except Exception as exc:
            raw[k] = "ERR:%s" % exc
    out = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "method": ("core.sidecar.client.SidecarClient auto_start (stesso path "
                   "dell'app) -> llama-server REALE; TTFT = primo chunk SSE; "
                   "miss = prefisso unico, hit = prompt identico ripetuto"),
        "slo": {"hit_p50_le": SLO_HIT_P50, "miss_p50_le": SLO_MISS_P50},
        "config": raw,
        "n_predict": MAXTOK,
        "samples": [],
    }
    print("CONFIG: " + json.dumps(raw, ensure_ascii=False), flush=True)
    client = SidecarClient()
    # avvio ESPLICITO del sidecar reale: la proprieta' client.port non
    # risolve il singleton senza una prima complete(), quindi si parte
    # con get_server().start_on_demand() (stesso percorso reale del client).
    from core.sidecar.server import get_server
    srv = get_server()
    started = bool(srv.start_on_demand())
    deadline = time.time() + 120
    while (not srv.port or not srv.health()) and time.time() < deadline:
        time.sleep(0.5)
    out["sidecar_started"] = started
    out["port"] = srv.port
    out["engine_status"] = srv.status()
    try:
        if not srv.port:
            raise RuntimeError("sidecar non partito (porta assente): %s"
                               % srv.status())

        # warmup scartato: carica modello e apre lo slot di prefix cache
        run_sample(client, HIT_PROMPT, "warmup_hit(scartato)", out["samples"])
        out["samples"].pop()  # warmup escluso dai campioni (dichiarato)

        # MISS: 5 prefissi unici
        for i in range(N_MISS):
            p = ("[%s] " % NONCE[i]) + BODY
            run_sample(client, p, "miss_%d" % (i + 1), out["samples"])

        # HIT: stesso prompt identico (dopo warmup: prefix cache piena)
        for i in range(N_HIT):
            run_sample(client, HIT_PROMPT, "hit_%d" % (i + 1), out["samples"])
    finally:
        try:
            client.last_meta  # nessuna azione: il server singleton resta
                               # per il cleanup del processo chiamante
        except Exception:
            pass

    miss = [s for s in out["samples"] if s["tag"].startswith("miss_") and s.get("first_seen")]
    hit = [s for s in out["samples"] if s["tag"].startswith("hit_") and s.get("first_seen")]
    out["miss"] = {"n": len(miss), "p50_ms": near_rank([s["ttft_ms"] for s in miss], 0.50),
                   "p95_ms": near_rank([s["ttft_ms"] for s in miss], 0.95)}
    out["hit"] = {"n": len(hit), "p50_ms": near_rank([s["ttft_ms"] for s in hit], 0.50),
                  "p95_ms": near_rank([s["ttft_ms"] for s in hit], 0.95)}
    out["streaming_ok_all"] = all(s.get("streaming_ok")
                                  for s in out["samples"])
    out["complete_ok_all"] = all(s.get("complete")
                                 for s in out["samples"])
    out["pass"] = {
        "miss_p50": out["miss"]["p50_ms"] is not None and out["miss"]["p50_ms"] <= SLO_MISS_P50,
        "hit_p50": out["hit"]["p50_ms"] is not None and out["hit"]["p50_ms"] <= SLO_HIT_P50,
        "streaming": out["streaming_ok_all"],
        "complete": out["complete_ok_all"],
    }
    out["ok"] = all(out["pass"].values())
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print("RISULTATO QA-2: miss_p50=%s (%.0f<=%0.f) hit_p50=%s (%.0f<=%0.f) "
          "streaming=%s complete=%s -> %s"
          % (out["pass"]["miss_p50"], out["miss"]["p50_ms"] or -1, SLO_MISS_P50,
             out["pass"]["hit_p50"], out["hit"]["p50_ms"] or -1, SLO_HIT_P50,
             out["pass"]["streaming"], out["pass"]["complete"],
             "PASS" if out["ok"] else "FAIL"), flush=True)
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

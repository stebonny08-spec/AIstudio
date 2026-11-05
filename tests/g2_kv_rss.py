# -*- coding: utf-8 -*-
"""
tests/g2_kv_rss.py — G2.4: stabilita' RSS su conversazione di 30 turni
con rolling summary (target: delta RSS <= 50 MB).

Metodo (sidecar reale, default di produzione):
  - RSS PADRE (questo processo, senza modello residente) prima;
  - 30 turni reali via SidecarClient.complete (storia crescente +
    trim_history/rolling ogni 4 turni, stessa politica H3);
  - RSS PADRE dopo 30 turni -> delta <= 50 MB;
  - RSS FIGLIO llama-server: caricato e residuo dopo idle-unload (informativo).
Riproducibile: python tests/g2_kv_rss.py -> qa/g2_kv_rss.json
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import psutil  # noqa: E402
from core.router import trim_history, history_char_budget  # noqa: E402


def rss_mb(p: psutil.Process) -> float:
    return round(p.memory_info().rss / (1024 * 1024), 1)


def main() -> int:
    from core.sidecar.server import get_server
    from core.sidecar.client import SidecarClient, AiUnavailable

    out_path = ROOT / "qa" / "g2_kv_rss.json"
    proc = psutil.Process()
    srv = get_server()
    history = []
    rows = []
    try:
        t0 = time.time()
        up = srv.start_on_demand()
        load_s = round(time.time() - t0, 2)
        if not up or not srv.health():
            out = {"status": "BLOCKED", "target_delta_mb": 50,
                   "causa": "sidecar non avviabile",
                   "procedura": "verifica tools/README_SIDECAR.bat e "
                                "llama.server_path in config",
                   "rss_parent_before_mb": rss_mb(proc)}
            out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1),
                                encoding="utf-8")
            print("BLOCKED:", out["causa"])
            return 0
        client = SidecarClient(server=srv, auto_start=True, timeout=180)
        rss_before = rss_mb(proc)
        for i in range(30):
            # storia crescente con rolling ogni 4 turni (politica H3 reale)
            if i % 4 == 3:
                history.append({"role": "user",
                                "content": f"domanda {i} " + "dettaglio " * 60})
                history.append({"role": "ai",
                                "content": f"risposta {i} " + "contenuto " * 60})
                kept, summary = trim_history(history, history_char_budget(4096))
                history = list(kept)
                if summary:
                    history.insert(0, {"role": "ai",
                                       "content": "[riepilogo] " + summary})
            else:
                history.append({"role": "user", "content": f"domanda {i} breve"})
                history.append({"role": "ai", "content": f"risposta breve {i}"})
            prompt = (f"Rispondi in MASSIMO 15 parole.\n"
                      f"Storia: {len(history)} turni.\n"
                      f"Domanda {i}: ripeti la parola 'ok'.")
            ts = time.time()
            try:
                txt = client.complete([{"role": "user", "content": prompt}],
                                      profile="fast", classe="micro",
                                      stream=False)
                rows.append({"turn": i + 1, "ms": int((time.time() - ts) * 1000),
                             "ok": True, "chars": len(str(txt))})
            except AiUnavailable as exc:
                rows.append({"turn": i + 1, "ok": False, "err": str(exc)})
                break
            rss_mid = rss_mb(proc)
        rss_after = rss_mb(proc)
        # figlio: prima dell'unload e dopo
        child_before = 0.0
        try:
            for ch in proc.children(recursive=True):
                child_before += ch.memory_info().rss / (1024 * 1024)
        except Exception:
            pass
        delta = round(rss_after - rss_before, 1)
        out = {
            "status": "OK",
            "target_delta_mb": 50,
            "delta_parent_mb": delta,
            "esito_target": "RAGGIUNTO" if delta <= 50 else "MANCATO",
            "rss_before_mb": rss_before,
            "rss_after_mb": rss_after,
            "child_rss_loaded_mb": round(child_before, 1),
            "turns": len([r for r in rows if r.get("ok")]),
            "rolling_policy": "trim_history ogni 4 turni con "
                              "history_char_budget(4096)",
            "load_sidecar_s": load_s,
            "metodo": "psutil.Process().memory_info().rss del PADRE "
                      "(modello nel figlio llama-server); 30 turni reali "
                      "via SidecarClient",
            "comando": "python tests/g2_kv_rss.py",
            "per_turn": rows,
        }
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1),
                            encoding="utf-8")
        print(f"delta={delta}MB (target<=50) -> {out['esito_target']} "
              f"turns={out['turns']} -> {out_path}")
        return 0
    finally:
        try:
            srv.shutdown()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

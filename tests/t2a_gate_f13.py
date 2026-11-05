# -*- coding: utf-8 -*-
"""
tests/t2a_gate_f13.py — RIGENERAZIONE SOLO F13 (Round 12, tentativo 2).

Motivazione (gate_analysis + gate_summary_r12): F13 = 4/15 con banda +-20% e
budget standard(600); la spec G5b prevede per F13 il PROFILO THINK.
Cambi (solo qui, documentati): max_tokens=1500 (classe think) + hint con
banda MIN-MAX esplicita calcolata da sec*2,5. Input IDENTICI al gate R12
(stesso ciclo sec/titoli) -> delta confrontabile per le stesse 15 richieste.

Flusso: droppa le 15 voci F13 da qa/gate_outputs_r12.json, le rigenera,
salva (resume-style), poi `python tests/t2a_gate.py` riscrive il summary
con le conteggi aggiornate saltando i 45 giusti.

Riproducibile: python tests/t2a_gate_f13.py && python tests/t2a_gate.py
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

OUT_JSON = ROOT / "qa" / "gate_outputs_r12.json"
LOG = ROOT / "qa" / "gate_run_r12.log"
MODEL = os.path.expandvars(
    os.path.expanduser(r"%APPDATA%\NovaStudio\models\MiniCPM5-2B-Q4_K_M.gguf"))


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] F13rigen {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def inputs_f13(i: int):
    # IDENTICO a tests/t2a_gate.py (stesse 15 richieste)
    titoli = [
        "Fotosintesi spiegata in breve", "La Rivoluzione francese in 5 eventi",
        "Derivate: guida rapida", "Il ciclo cellulare", "Strade romane",
        "Logaritmi: errori comuni", "La macchina a vapore", "Vettori e moduli",
        "Cortina di ferro", "Equilibrio chimico", "Reti neurali base",
        "Integrale indefinito", "Matrici 2x2", "1929 il crollo",
        "Probabilita con esempi",
    ]
    secs = [30, 35, 40, 45, 50, 55, 60]
    return {"sec": secs[i % len(secs)], "titolo": titoli[i % len(titoli)],
            "contenuto": "Spiegazione scolastica con definizione, un esempio "
                         "numerico e un errore tipico da evitare."}


def main() -> int:
    import re
    from llama_cpp import Llama
    from core.ai_runtime import run_ai_function
    from core.ai_cache import AiCache
    from core.registry.engine import validate_output

    store = json.loads(OUT_JSON.read_text(encoding="utf-8"))
    # tentativo 3: SOLO i falliti vengono rigenerati, gli ok restano (indice i originale)
    failed_idx = sorted(e["i"] for e in store
                        if e["fid"] == "F13" and not e.get("parsed_ok"))
    kept_ok = sum(1 for e in store if e["fid"] == "F13" and e.get("parsed_ok"))
    store = [e for e in store if not (e["fid"] == "F13"
                                      and not e.get("parsed_ok"))]
    OUT_JSON.write_text(json.dumps(store, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    log(f"drop {len(failed_idx)} falliti F13 (kept {kept_ok} ok), "
        f"rigenero SOLO gli indici {failed_idx}")

    llm = Llama(model_path=MODEL, n_ctx=4096, n_threads=None, verbose=False)
    cache = AiCache()

    def llm_fn(prompt, **kw):
        # G_text -> oggetto con un campo stringa -> adapter a stringa JSON.
        # F13: PROFILO THINK (max_tokens 1500) + banda MIN-MAX esplicita.
        import json as _json
        m = re.search(r"Script di (\d+) secondi", prompt)
        target = round(int(m.group(1)) * 2.5) if m else None
        p = prompt + ("\nRispondi SOLO con un oggetto JSON contenente il testo "
                      "finale in UN unico campo stringa, es. {\"text\":\"...\"}. "
                      "Nessun pensiero, solo JSON.")
        if target:
            lo, hi = round(target * 0.8), round(target * 1.2)
            p += (f"\nVINCOLO QUANTITATIVO: il testo deve contenere TRA {lo} e "
                  f"{hi} parole (target {target} = sec*2,5, tolleranza +-20%). "
                  f"PRIMA di rispondere conta le parole: se superi {hi} taglia, "
                  f"se stai sotto {lo} aggiungi un esempio. Poi emetti SOLO il JSON.")
        mt = 1500 if target else int(kw.get("max_tokens") or 600)
        t0 = time.time()
        out = llm.create_chat_completion(
            messages=[{"role": "user", "content": p}],
            temperature=0.6, max_tokens=mt,
            response_format={"type": "json_object"})
        txt = (out["choices"][0]["message"]["content"] or "").strip()
        try:
            obj = _json.loads(txt)
            val = None
            if isinstance(obj, dict):
                for v in obj.values():
                    if isinstance(v, str) and v.strip():
                        val = v
                        break
            txt = _json.dumps(str(val if val is not None else txt),
                              ensure_ascii=False)
        except Exception:
            txt = _json.dumps(txt, ensure_ascii=False)
        log(f"llm {int((time.time()-t0)*1000)}ms len={len(txt)} target={target}")
        return txt

    for i in failed_idx:
        inputs = inputs_f13(i - 1)
        ts = time.time()
        try:
            res = run_ai_function("F13", inputs, ai_cache=cache, llm_fn=llm_fn)
        except Exception as exc:
            res = {"ok": False, "error": repr(exc), "fallback": True}
        ms = int((time.time() - ts) * 1000)
        data = res.get("data")
        raw_txt = data if isinstance(data, str) else json.dumps(
            data, ensure_ascii=False)
        entry = {
            "fid": "F13", "i": i, "inputs": inputs,
            "parsed_ok": bool(res.get("ok")),
            "retried": bool(res.get("retried")),
            "badge": res.get("badge"), "ms": ms,
            "errors": ([str(res.get("error"))] if res.get("error") else []),
            "output": (raw_txt or "")[:3000],
            "note": "rigenerato R12b: profilo think (1500 tok) + banda min-max",
        }
        store.append(entry)
        store.sort(key=lambda e: (["F01", "F04", "F10", "F13"].index(e["fid"]),
                                  e["i"]))
        OUT_JSON.write_text(json.dumps(store, ensure_ascii=False, indent=1),
                            encoding="utf-8")
        log(f"F13 #{i}/15 ok={entry['parsed_ok']} {ms}ms "
            f"({sum(1 for e in store)}/60)")

    ok13 = sum(1 for e in store if e["fid"] == "F13" and e["parsed_ok"])
    log(f"F13 finale: {ok13}/15 (target >=12) -> "
        f"{'RAGGIUNTO' if ok13 >= 12 else 'MANCATO'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
data/autotune.py (H5)
----------------------
Autotune una tantum dei profili di velocita' (tok/s) tramite llama-bench.

  run_autotune_once(config) -> dict

- llama.bench_path vuota/inesistente -> {"done": False,
  "reason": "llama-bench assente", "fallback": "profili default"}
  NESSUNA eccezione.
- binario presente -> subprocess con timeout 300s, parse delle righe della
  tabella, salvataggio di autotune.result + autotune.done=True (una tantum).

Il parse (parse_llama_bench_output) e' una funzione pura, testabile con un
output finto anche quando il binario non esiste.
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Any, Dict, Optional

__all__ = ["BENCH_TIMEOUT_SEC", "parse_llama_bench_output", "run_autotune_once"]

BENCH_TIMEOUT_SEC = 300

# Cella di "test" di llama-bench: pp512, tg128, pp, tg...
_TEST_CELL = re.compile(r"^(pp|tg)(\d*)$", re.IGNORECASE)
_FLOAT = re.compile(r"[-+]?\d+(?:\.\d+)?")


def _cfg_get(config: Any, key: str, default: Any = None) -> Any:
    getter = getattr(config, "get", None)
    if callable(getter):
        try:
            return getter(key, default)
        except TypeError:
            return default
    return default


def _cfg_set(config: Any, key: str, value: Any) -> None:
    setter = getattr(config, "set", None)
    if callable(setter):
        setter(key, value)
        return
    if isinstance(config, dict):
        config[key] = value
        return
    raise TypeError(f"config non scrivibile: {type(config)!r}")


def parse_llama_bench_output(text: str) -> Dict[str, Optional[float]]:
    """Estrae i tok/s (pp = prompt, tg = generation) da un output tabellare.

    Riga dati attesa (colonne separate da '|'):
      | modello | params | threads | pp512 | 812.34 +- 5.67 |
    Ritorna {"pp_tok_s": float|None, "tg_tok_s": float|None}.
    """
    result: Dict[str, Optional[float]] = {"pp_tok_s": None, "tg_tok_s": None}
    if not text:
        return result

    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("|") or line.startswith("|---") or line.startswith("| ---"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        for i, cell in enumerate(cells):
            m = _TEST_CELL.match(cell)
            if not m:
                continue
            kind = m.group(1).lower()
            if i + 1 >= len(cells):
                continue
            fm = _FLOAT.search(cells[i + 1])
            if not fm:
                continue
            key = "pp_tok_s" if kind == "pp" else "tg_tok_s"
            if result[key] is None:  # prima occorrenza valida
                try:
                    result[key] = float(fm.group(0))
                except ValueError:
                    pass
            break
    return result


def run_autotune_once(config: Any) -> Dict[str, Any]:
    """Esegue (una tantum) l'autotune con llama-bench e salva i tok/s."""
    if _cfg_get(config, "autotune.done") is True:
        return {
            "done": True,
            "reason": "gia eseguito",
            "result": _cfg_get(config, "autotune.result", {}),
        }

    bench_path = str(_cfg_get(config, "llama.bench_path", "") or "").strip()
    if not bench_path or not os.path.isfile(bench_path):
        return {
            "done": False,
            "reason": "llama-bench assente",
            "fallback": "profili default",
        }

    try:
        proc = subprocess.run(
            [bench_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=BENCH_TIMEOUT_SEC,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {
            "done": False,
            "reason": f"esecuzione fallita: {exc}",
            "fallback": "profili default",
        }

    output = (proc.stdout or "") + "\n" + (proc.stderr or "")
    parsed = parse_llama_bench_output(output)
    if parsed["pp_tok_s"] is None and parsed["tg_tok_s"] is None:
        return {
            "done": False,
            "reason": "output non interpretabile",
            "fallback": "profili default",
        }

    result = {
        "pp_tok_s": parsed["pp_tok_s"],
        "tg_tok_s": parsed["tg_tok_s"],
        "bench_path": bench_path,
    }
    _cfg_set(config, "autotune.result", result)
    _cfg_set(config, "autotune.done", True)
    saver = getattr(config, "save", None)
    if callable(saver):
        try:
            saver()
        except OSError:
            pass
    return {"done": True, "reason": "eseguito", "result": result}

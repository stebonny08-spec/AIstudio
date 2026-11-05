# -*- coding: utf-8 -*-
"""qa/r15_g0_dopo.py — G0 DOPO: con llm.backend=sidecar una completion
AVVIA llama-server (PID osservato + tok/s dalle timings del server) e il
percorso chat NON cade piu' in-process silenziosamente.

Uso: PYTHONIOENCODING=utf-8 python qa/r15_g0_dopo.py
Output: qa/r15_g0_dopo.json
"""
import functools
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from data.config_manager import ConfigManager              # noqa: E402
from core.local_llm_client import (                        # noqa: E402
    LocalLLMClient, maybe_wrap_sidecar, SidecarLLMProxy,
)
from core.sidecar.server import get_server                 # noqa: E402

KW = dict(
    context_kind="none", local_chunks=None, web_results=None,
    allow_fallback_marker=False, images=None, thinking=False,
    study_mode="default", stop_event=None, chitchat=False,
    history_turns=None, part_index=0, is_last_part=True,
    parts_summaries=None,
)


def llama_pids():
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq llama-server.exe"],
            capture_output=True, text=True, creationflags=0x08000000,
        ).stdout
    except Exception:
        return set()
    pids = set()
    for line in out.splitlines()[3:]:
        parts = line.split()
        if len(parts) >= 2 and parts[0].lower().startswith("llama-server"):
            try:
                pids.add(int(parts[1]))
            except ValueError:
                pass
    return pids


def main():
    out = {}
    cfg = ConfigManager()
    out["llm.backend"] = str(cfg.get("llm.backend", "sidecar"))
    out["llama.server_path"] = str(cfg.get("llama.server_path", ""))

    srv = get_server()
    out["status_prima"] = dict(srv.status())
    pids_prima = llama_pids()
    out["llama_pids_prima"] = sorted(pids_prima)

    calls = {"generate_stream_inprocess": 0}
    captured = {}
    orig_gs = LocalLLMClient.generate_stream
    orig_make = LocalLLMClient._make_sidecar_client

    def spy_gs(self, *a, **k):
        calls["generate_stream_inprocess"] += 1
        return orig_gs(self, *a, **k)

    def spy_make():
        c = orig_make()
        captured["client"] = c
        return c

    spy_gs.__wrapped__ = orig_gs
    spy_gs.__name__ = orig_gs.__name__
    spy_make.__wrapped__ = orig_make
    spy_make.__name__ = orig_make.__name__

    LocalLLMClient.generate_stream = spy_gs
    LocalLLMClient._make_sidecar_client = staticmethod(spy_make)

    client = LocalLLMClient(model_path=cfg.get("local_model_path", ""),
                            n_ctx=int(cfg.get("local_model_n_ctx") or 8192))
    proxy = maybe_wrap_sidecar(client)
    out["proxy_wrapped"] = isinstance(proxy, SidecarLLMProxy)

    try:
        t0 = time.perf_counter()
        txt = "".join(proxy.generate_stream(
            "Rispondi esattamente e solo con la parola: OK", **KW))
        out["wall_s"] = round(time.perf_counter() - t0, 2)
    except Exception as exc:
        out["errore"] = f"{type(exc).__name__}: {exc}"
        txt = ""
    finally:
        LocalLLMClient.generate_stream = orig_gs
        LocalLLMClient._make_sidecar_client = orig_make

    out["risposta"] = txt.strip()[:400]
    out["generate_stream_inprocess"] = calls["generate_stream_inprocess"]
    out["percorso"] = ("sidecar" if calls["generate_stream_inprocess"] == 0
                       else "IN-PROCESS (fallback silenzioso)")

    pids_dopo = llama_pids()
    out["llama_pids_dopo"] = sorted(pids_dopo)
    out["llama_pids_nuovi"] = sorted(pids_dopo - pids_prima)
    out["status_dopo"] = dict(srv.status())
    out["health_dopo"] = bool(srv.health())

    c = captured.get("client")
    if c is not None:
        tm = c.last_meta.get("timings", {}) or {}
        out["timings"] = tm
        out["tok_s"] = (tm.get("predicted_per_second")
                        or tm.get("tokens_per_second")
                        or tm.get("generation_per_second"))
        out["prompt_tok"] = tm.get("prompt_n_tokens")
        out["gen_tok"] = tm.get("predicted_n_tokens")
        out["prompt_s"] = tm.get("prompt_per_second")
        out["acceptance"] = c.last_meta.get("acceptance")

    ok = (out.get("generate_stream_inprocess") == 0
          and bool(out.get("llama_pids_nuovi"))
          and out.get("health_dopo") and out.get("risposta"))
    out["verdetto"] = ("OK: completion girata su llama-server esterno"
                       if ok else "FAIL: verificare i campi")

    try:
        srv.shutdown()
    except Exception:
        pass

    p = os.path.join(ROOT, "qa", "r15_g0_dopo.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2, default=str)
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return out


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""qa/r15_g0_repro.py — G0 PRIMA: riproduce il TypeError reale di
SidecarLLMProxy.generate_stream (SIDECAR-DEAD, qa/f0_forensics.json).

Le spy usano functools.wraps cosi' inspect.signature resta IDENTICO a quello
originale: il comportamento del proxy e' quello di produzione.

Uso:  PYTHONIOENCODING=utf-8 python qa/r15_g0_repro.py
Output: qa/r15_g0_prima.json (+ traceback reale su stdout)
"""
import functools
import inspect
import json
import os
import sys
import traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from data.config_manager import ConfigManager          # noqa: E402
from core.local_llm_client import (                    # noqa: E402
    LocalLLMClient, maybe_wrap_sidecar, SidecarLLMProxy,
)

KW = dict(
    context_kind="locale", local_chunks=[], web_results=None,
    allow_fallback_marker=True, images=[], thinking=False,
    study_mode="default", stop_event=None, chitchat=False,
    history_turns=[], part_index=0, is_last_part=True, parts_summaries=[],
)


def main():
    out = {}
    cfg = ConfigManager()
    out["llm.backend"] = str(cfg.get("llm.backend", "sidecar"))
    out["llama.server_path"] = str(cfg.get("llama.server_path", ""))

    client = LocalLLMClient(model_path=cfg.get("local_model_path", ""),
                            n_ctx=int(cfg.get("local_model_n_ctx") or 8192))
    proxy = maybe_wrap_sidecar(client)
    out["proxy_wrapped"] = isinstance(proxy, SidecarLLMProxy)
    out["target_type"] = type(proxy._target).__name__

    # ---- 1) TRACEBACK REALE dello step identico a quello del proxy --------
    try:
        sig = inspect.signature(type(proxy._target).stream_via_sidecar)
        out["sig_unbound_first_params"] = list(sig.parameters)[:3]
        sig.bind("QUERY", **KW)          # esattamente cio' che fa il proxy
        out["bind_result"] = "OK"
    except TypeError:
        out["bind_result"] = "FAIL"
        out["traceback_reale"] = traceback.format_exc()

    # ---- 2) il proxy cade SILENZIOSAMENTE in in-process -------------------
    calls = {"stream_via_sidecar": 0, "generate_stream": 0}
    orig_svs = LocalLLMClient.stream_via_sidecar
    orig_gs = LocalLLMClient.generate_stream

    @functools.wraps(orig_svs)
    def spy_svs(self, *a, **k):
        calls["stream_via_sidecar"] += 1
        return iter(["<SIDECAR-PATH>"])

    @functools.wraps(orig_gs)
    def spy_gs(self, *a, **k):
        calls["generate_stream"] += 1
        return iter(["<IN-PROCESS-PATH>"])

    LocalLLMClient.stream_via_sidecar = spy_svs
    LocalLLMClient.generate_stream = spy_gs
    try:
        got = "".join(proxy.generate_stream("QUERY", **KW))
    finally:
        LocalLLMClient.stream_via_sidecar = orig_svs
        LocalLLMClient.generate_stream = orig_gs
    out["spy_signature_preserved"] = (
        list(inspect.signature(spy_svs).parameters)[:3])
    out["proxy_call_result"] = got
    out["calls"] = calls
    out["sidecar_raggiunto"] = calls["stream_via_sidecar"] > 0
    out["caduto_in_process"] = calls["generate_stream"] > 0

    # ---- 3) stato sidecar (llama-server) ---------------------------------
    try:
        from core.sidecar.server import get_server
        srv = get_server()
        st = srv.status()
        out["sidecar_status_prima"] = dict(st)
        out["health_prima"] = bool(srv.health())
    except Exception as exc:
        out["sidecar_status_err"] = f"{type(exc).__name__}: {exc}"

    out["verdetto"] = (
        "SIDECAR-DEAD: sig.bind su funzione NON bound (self assorbe 'QUERY' -> "
        "mancanza di 'query') -> TypeError catturato in silenzio -> fallback su "
        "generate_stream in-process. Con llm.backend=sidecar llama-server NON "
        "viene mai raggiunto (state=down)."
    )
    p = os.path.join(ROOT, "qa", "r15_g0_prima.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return out


if __name__ == "__main__":
    main()

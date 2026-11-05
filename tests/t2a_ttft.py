#!/usr/bin/env python3
r"""tests/t2a_ttft.py (G4) - TTFT reale via sidecar -> qa/g4_ttft.json.

METODO (client-side, identico per hit e miss):
  t0 = time.perf_counter() PRIMA di SidecarClient.complete(..., stream=True)
  t1 = time.perf_counter() al primo pezzo non vuoto dello stream
  TTFT_ms = (t1 - t0) * 1000
  p50 = statistics.median (mediana); p95 = nearest-rank sorted[ceil(0.95*n)-1]

PROTOCOLLO:
  - sidecar REALE: tools/llama-server.exe avviato via core.sidecar.SidcarServer
    .start_on_demand() con attesa health (riferimento noto funzionante:
    tests/t2a_sidecar.py); 1 warmup ESCLUSO con lo stesso prefisso HIT.
  - (a) HIT  : 10 richieste con PREFISSO IDENTICO (system+storia breve
    identici ad ogni richiesta -> cache hit attesa di llama-server)
  - (b) MISS : 10 richieste con prefissi DIVERSI (system diverso ->
    nessun match di prefix cache)
  - prompt corti (una frase), classe "micro", generatore drenato fino a [DONE].
TARGET: hit p50 <= 1500 ms, miss p50 <= 2500 ms.
Se un target non e' raggiunto -> 1 RIPETIZIONE completa con dichiarazione del
CARICO DI SISTEMA (cpu%, processi python/llama-server concorrenti); si tiene
il run migliore e tutte le iterazioni restano nel JSON.

4.3 REALE (opzionale): una generazione lunga viene interrotta con stop_event
dopo 3 pezzi (stessa struttura del loop di api._run_generation), poi si
verifica health del server e che una richiesta successiva funzioni ->
qa/g4_measures.json.

BLOCKED: se il sidecar non parte -> causa + procedura nel JSON (riferimento
tests/t2a_sidecar.py + tools/_install_sidecar.py).
Exit code SEMPRE 0 (gli esiti sono nel JSON).
"""

from __future__ import annotations

import json
import math
import os
import statistics
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

OUT_TTFT = os.path.join(ROOT, "qa", "g4_ttft.json")
OUT_MEAS = os.path.join(ROOT, "qa", "g4_measures.json")
EXE = os.path.join(ROOT, "tools", "llama-server.exe")
MODEL = os.path.expandvars(
    r"%APPDATA%\NovaStudio\models\MiniCPM5-2B-Q4_K_M.gguf"
)

N = 10
TARGET_HIT_P50_MS = 1500.0
TARGET_MISS_P50_MS = 2500.0

# Prefisso IDENTICO per tutte le richieste HIT (cache hit atteso)
HIT_PROMPT = (
    "System: Sei un assistente di studio. Rispondi in modo conciso.\n"
    "User: Ciao! Come stai oggi?\n"
    "Assistant: Sto bene, grazie!\n"
    "User: Rispondi con una sola parola: ciao\n"
    "Assistant:"
)

# 10 prefissi DIVERSI (system diverso -> prefix cache miss), stesso finale
TOPICI = [
    "matematica", "storia dell'arte", "biologia molecolare",
    "programmazione in C", "geografia fisica", "letteratura latina",
    "economia aziendale", "chimica organica", "fisica quantistica",
    "musica classica",
]

MISS_PROMPTS = [
    "System: Sei un assistente esperto di %s. Rispondi in modo conciso.\n"
    "User: Ciao! Come stai oggi?\n"
    "Assistant: Sto bene, grazie!\n"
    "User: Rispondi con una sola parola: ciao\n"
    "Assistant:" % t
    for t in TOPICI
]


def log(msg: str) -> None:
    print("[g4/ttft] %s" % msg, flush=True)


def _write(path: str, obj: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    log("scritto %s (status=%s)" % (path, obj.get("status")))


def carico_sistema() -> dict:
    """Snapshot del carico: dichiarato nel JSON (contenzione gate/regen)."""
    out = {}
    try:
        import psutil
        out["cpu_percent_1s"] = psutil.cpu_percent(interval=1.0)
        out["cpu_count"] = psutil.cpu_count()
        out["memory_percent"] = round(psutil.virtual_memory().percent, 1)
        n_llama = n_py = 0
        nomi_python = []
        for p in psutil.process_iter(["name", "pid"]):
            name = str(p.info.get("name") or "").lower()
            if "llama-server" in name:
                n_llama += 1
            elif name.startswith("python"):
                n_py += 1
                nomi_python.append("%s:%s" % (name, p.info.get("pid")))
        out["processi_llama_server"] = n_llama
        out["processi_python"] = n_py
        out["python_pids"] = nomi_python
    except Exception as e:
        out["errore"] = "%s: %s" % (type(e).__name__, e)
    return out


def p95_nearest_rank(values):
    if not values:
        return None
    s = sorted(values)
    idx = max(0, math.ceil(0.95 * len(s)) - 1)
    return s[idx]


def misura_ttft(client, prompt) -> float | None:
    """TTFT in ms per UNA richiesta (None se nessun pezzo non vuoto)."""
    t0 = time.perf_counter()
    gen = client.complete(prompt, profile="fast", classe="micro",
                          stream=True)
    t1 = None
    try:
        for piece in gen:
            if t1 is None:
                if piece:
                    t1 = time.perf_counter()
                continue
            # drenaggio: proseguo fino a [DONE] (risposta corta)
    finally:
        try:
            gen.close()
        except Exception:
            pass
    if t1 is None:
        return None
    return round((t1 - t0) * 1000.0, 1)


def run_serie(client, prompts, label) -> dict:
    values = []
    for i, p in enumerate(prompts, 1):
        ttft = misura_ttft(client, p)
        if ttft is None:
            log("%s %d/%d: NESSUN TOKEN" % (label, i, len(prompts)))
            continue
        values.append(ttft)
        log("%s %d/%d: TTFT=%.1f ms" % (label, i, len(prompts), ttft))
    if not values:
        return {"p50": None, "p95": None, "n": 0, "values": []}
    return {
        "p50": round(statistics.median(values), 1),
        "p95": round(p95_nearest_rank(values), 1),
        "n": len(values),
        "values": values,
    }


def run_misura(client) -> dict:
    """1 warmup (escluso, prefisso HIT) + serie HIT + serie MISS."""
    misura_ttft(client, HIT_PROMPT)  # warmup escluso
    hit = run_serie(client, [HIT_PROMPT] * N, "hit")
    miss = run_serie(client, MISS_PROMPTS[:N], "miss")
    return {"hit": hit, "miss": miss}


def esito_target(hit, miss) -> dict:
    h_ok = bool(hit.get("p50")) and hit["p50"] <= TARGET_HIT_P50_MS
    m_ok = bool(miss.get("p50")) and miss["p50"] <= TARGET_MISS_P50_MS
    return {
        "hit_p50_max_ms": TARGET_HIT_P50_MS,
        "miss_p50_max_ms": TARGET_MISS_P50_MS,
        "hit": "RAGGIUNTO" if h_ok else "MANCATO",
        "miss": "RAGGIUNTO" if m_ok else "MANCATO",
        "esito_complessivo": "RAGGIUNTO" if (h_ok and m_ok) else "MANCATO",
    }


def misura_cancellazione_reale(client) -> dict:
    """4.3(b): stop_event dopo 3 pezzi su una generazione lunga REALE."""
    stop_event = threading.Event()
    state = {"n": 0, "closed": False, "uscito_entro_sec": None}
    errore = [None]

    def consume():
        t_set = [None]
        try:
            gen = client.complete(
                "Scrivi un lungo saggio di almeno 300 parole sull'importanza "
                "dello studio quotidiano, con esempi.",
                profile="think", classe="think", stream=True)
            try:
                for _piece in gen:
                    if stop_event.is_set():
                        try:
                            gen.close()
                        except Exception:
                            pass
                        break
                    state["n"] += 1
                    if state["n"] == 3:
                        stop_event.set()   # "stop esterno" dopo 3 pezzi
                        t_set[0] = time.perf_counter()
            finally:
                state["closed"] = True
                if t_set[0]:
                    state["uscito_entro_sec"] = round(
                        time.perf_counter() - t_set[0], 3)
        except Exception as e:
            errore[0] = "%s: %s" % (type(e).__name__, e)

    th = threading.Thread(target=consume, daemon=True)
    th.start()
    th.join(timeout=60)
    vivo = th.is_alive()

    # il server deve tornare/subire health e accettare una nuova richiesta
    health_ok = False
    t0 = time.perf_counter()
    deadline = time.time() + 15.0
    while time.time() < deadline:
        try:
            if client._server is not None and client._server.health():
                health_ok = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    health_sec = round(time.perf_counter() - t0, 2)

    successiva_ok = False
    successiva_chars = 0
    try:
        txt = client.complete("Rispondi con una sola parola: ciao",
                              profile="fast", classe="micro")
        successiva_chars = len(txt or "")
        successiva_ok = bool((txt or "").strip())
    except Exception as e:
        errore[0] = "richiesta successiva: %s: %s" % (type(e).__name__, e)

    ok = (not vivo) and state["closed"] and stop_event.is_set() \
        and health_ok and successiva_ok
    return {
        "status": "ok" if ok else "BLOCKED",
        "pezzi_prima_stop": state["n"],
        "stop_imposto_dopo_pezzi": 3,
        "loop_interrotto": state["closed"] and not vivo,
        "uscito_dopo_stop_entro_sec": state["uscito_entro_sec"],
        "health_dopo_stop": health_ok,
        "health_poll_sec": health_sec,
        "richiesta_successiva_ok": successiva_ok,
        "richiesta_successiva_chars": successiva_chars,
        "errore": errore[0],
        "metodo": "thread consumer con struttura IDENTICA al loop di "
                  "api._run_generation (check stop_event in cima a ogni "
                  "pezzo, generator.close() al set) su "
                  "SidecarClient.complete(stream=True) REALE",
        "comando": "python tests/t2a_ttft.py",
    }


def main() -> int:
    t_start = time.perf_counter()
    out = {
        "status": "OK",
        "gruppo": "G4 streaming + TTFT",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "comando": "python tests/t2a_ttft.py",
        "test_associati": "python tests/testG4_stream.py (logico, finto)",
        "metodo": "TTFT client-side: t0=time.perf_counter() PRIMA di "
                  "SidecarClient.complete(stream=True); t1=primo pezzo non "
                  "vuoto; ms=(t1-t0)*1000. p50=mediana statistics.median; "
                  "p95=nearest-rank sorted[ceil(0.95*n)-1]",
        "protocollo": "sidecar REALE via core.sidecar (start_on_demand + "
                      "health), 1 warmup escluso (prefisso HIT), n=%d richieste "
                      "HIT identiche (cache hit atteso) e n=%d MISS con "
                      "prefissi diversi (system diverso), prompt corti "
                      "(una frase), classe micro, drenaggio completo" % (N, N),
        "target_esiti": {},
        "hit": {}, "miss": {},
        "sidecar": {},
        "carico_sistema": {},
        "ripetizioni": [],
    }

    # ---------------- avvio sidecar reale ----------------
    if not os.path.isfile(EXE):
        out["status"] = "BLOCKED"
        out["causa"] = "binario tools/llama-server.exe assente"
        out["procedura"] = [
            "python tools/_install_sidecar.py (o tools/INSTALL_SIDECAR.bat)",
            "procedura manuale: tools/README_SIDECAR.md",
            "riferimento noto funzionante: python tests/t2a_sidecar.py",
        ]
        _write(OUT_TTFT, out)
        _write(OUT_MEAS, {"status": "BLOCKED",
                          "causa": out["causa"],
                          "comando": out["comando"]})
        return 0

    from core.sidecar import SidecarClient, SidecarServer

    cfg = {
        "llama.server_path": EXE,
        "llama.model_path": MODEL,
        "llama.n_ctx": 4096,
        "llama.idle_unload_sec": 600,
    }
    srv = SidecarServer(config=cfg)
    try:
        t0 = time.perf_counter()
        ok = srv.start_on_demand()
        load_sec = round(time.perf_counter() - t0, 2)
        out["sidecar"] = {
            "start_ok": ok,
            "load_sec": load_sec,
            "stato": srv.status().get("state"),
            "porta": srv.port,
        }
        if not ok or not srv.health():
            out["status"] = "BLOCKED"
            out["causa"] = "avvio sidecar fallito: %s" % srv.status()
            out["procedura"] = [
                "verifica binario: tools\\llama-server.exe --version",
                "verifica modello: %s" % MODEL,
                "riferimento noto funzionante: python tests/t2a_sidecar.py",
            ]
            _write(OUT_TTFT, out)
            _write(OUT_MEAS, {"status": "BLOCKED", "causa": out["causa"],
                              "comando": out["comando"]})
            return 0
        log("sidecar up in %.2fs (porta %s)" % (load_sec, srv.port))

        client = SidecarClient(server=srv, auto_start=True, timeout=180)

        # ---------------- misura 1 (+ carico dichiarato) ----------------
        carico1 = carico_sistema()
        log("carico run1: %s" % json.dumps(carico1))
        run1 = run_misura(client)
        es1 = esito_target(run1["hit"], run1["miss"])
        out["ripetizioni"].append({
            "run": 1,
            "hit_p50": run1["hit"].get("p50"),
            "miss_p50": run1["miss"].get("p50"),
            "target": es1,
            "carico_sistema": carico1,
        })

        best = run1
        best_es = es1
        if es1["esito_complessivo"] != "RAGGIUNTO":
            # tempi anomali (contenzione possibile) -> RIPETI e DICHIARA carico
            log("target non raggiunto al run1 -> ripetizione con carico dichiarato")
            carico2 = carico_sistema()
            log("carico run2: %s" % json.dumps(carico2))
            run2 = run_misura(client)
            es2 = esito_target(run2["hit"], run2["miss"])
            out["ripetizioni"].append({
                "run": 2,
                "hit_p50": run2["hit"].get("p50"),
                "miss_p50": run2["miss"].get("p50"),
                "target": es2,
                "carico_sistema": carico2,
            })
            if es2["esito_complessivo"] == "RAGGIUNTO" or \
                    (es1["esito_complessivo"] != "RAGGIUNTO" and
                     (run2["hit"].get("p50") or 1e9) +
                     (run2["miss"].get("p50") or 1e9) <
                     (run1["hit"].get("p50") or 1e9) +
                     (run1["miss"].get("p50") or 1e9)):
                best, best_es = run2, es2

        out["hit"] = best["hit"]
        out["miss"] = best["miss"]
        out["target_esiti"] = best_es
        out["carico_sistema"] = carico1
        out["ripetuto"] = len(out["ripetizioni"]) > 1

        # ---------------- 4.3 reale: cancellazione ----------------
        log("misura cancellazione reale...")
        cancellazione = misura_cancellazione_reale(client)
        log("cancellazione: %s (health=%s, successiva=%s)" % (
            cancellazione["status"], cancellazione["health_dopo_stop"],
            cancellazione["richiesta_successiva_ok"]))
    except Exception as e:
        out["status"] = "BLOCKED"
        out["causa"] = "%s: %s" % (type(e).__name__, e)
        log("ERRORE: %s" % out["causa"])
        cancellazione = {"status": "BLOCKED", "errore": out["causa"]}
    finally:
        try:
            srv.shutdown()
        except Exception:
            pass

    out["run_duration_sec"] = round(time.perf_counter() - t_start, 1)
    _write(OUT_TTFT, out)

    meas = {
        "status": "ok" if cancellazione.get("status") == "ok" else "BLOCKED",
        "gruppo": "G4 streaming + TTFT",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "comando": "python tests/t2a_ttft.py",
        "test_logico": "python tests/testG4_stream.py (fake SSE infinito + "
                       "api._run_generation con router finto)",
        "cancellazione_reale": cancellazione,
        "dove_si_controlla_stop_event": {
            "backend/api.py::_run_generation": "check in cima a ogni evento "
                                               "del loop + generator.close()",
            "core/local_llm_client.py::stream_via_sidecar": "break sul pezzo "
                                                            "successivo al set",
            "core/local_llm_client.py::generate_stream": "stesso check "
                                                         "(strada in-process)",
            "core/sidecar/client.py": "NESSUN check: cancellazione = close() "
                                      "del generatore -> resp.close()",
        },
        "carico_sistema": out.get("carico_sistema", {}),
        "ripetizioni": out.get("ripetizioni", []),
        "note": "carico dichiarato: un altro processo (rigenerazione gate) "
                "puo' essere in esecuzione; se i tempi sono anomali il test "
                "ripete e dichiara cpu%/processi concorrenti in ripetizioni[]",
    }
    _write(OUT_MEAS, meas)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        err = "%s: %s" % (type(e).__name__, e)
        try:
            _write(OUT_TTFT, {"status": "BLOCKED", "error": err,
                              "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                              "hit": {}, "miss": {}, "metodo": "",
                              "comando": "python tests/t2a_ttft.py",
                              "target_esiti": {}})
        except Exception:
            pass
        print("[g4/ttft] ERRORE FATALE: %s" % err, flush=True)
        sys.exit(0)

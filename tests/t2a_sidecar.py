#!/usr/bin/env python3
r"""tests/t2a_sidecar.py (G1) — T2 reale VIA SIDECAR → qa/g1_measures.json.

Ogni numero riporta il SUO metodo + comando riproducibile:
  1.1 binary      — `tools\llama-server.exe --version` (install: tools\_install_sidecar.py)
  1.3 load_cold   — SidecarServer(config).start_on_demand() misurato con
                    time.perf_counter() (target <= 3.0s)
  1.3 rss_mb      — psutil.Process().memory_info().rss:
                      baseline (prima), figlio llama-server (caricato),
                      dopo N req, DOPO idle-unload (target: padre <= baseline+50MB
                      e nessun figlio residuo)
  1.3 tok_s       — PROTOCOLLO IDENTICO Round 11 (qa/t2a_measures.json):
                    1 warmup + 3 misure, mediana per profilo;
                    metodo PRIMARIO len(content)/4 / elapsed_wall (stesso del
                    Round 11 in-process); secondario dichiarato:
                    llama-server timings.predicted_per_second.
                    Payload identici: fast (T0.8, n_predict 128),
                    think (T0.6, 320), tool (T0.1, 128).
  1.3 confronto   — sidecar vs in-process Round 11 (lettura qa/t2a_measures.json)
  1.2 completions — 3 completion reali via core.sidecar.SidecarClient.complete
  1.4 autotune    — data.autotune.run_autotune_once(ConfigManager) con
                    llama.bench_path=tools\llama-bench.exe (pp/tg reali)
  1.4 lookup      — 10 output JSON corti, flag spec.prompt_lookup ON vs OFF,
                    speedup = mediana(OFF)/mediana(ON); regola: >=1.15 ON else OFF.

Exit code SEMPRE 0 (l'esito completo è nel JSON).
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

OUT_PATH = os.path.join(ROOT, "qa", "g1_measures.json")
ROUND11_PATH = os.path.join(ROOT, "qa", "t2a_measures.json")
EXE = os.path.join(ROOT, "tools", "llama-server.exe")
BENCH = os.path.join(ROOT, "tools", "llama-bench.exe")
MODEL = os.path.expandvars(
    r"%APPDATA%\NovaStudio\models\MiniCPM5-2B-Q4_K_M.gguf"
)

# Payload IDENTICI al Round 11 (tests/t2a_measures.py::PROFILES)
PROFILES = [
    {"name": "fast", "temperature": 0.8, "n_predict": 128,
     "prompt": ("Spiega in modo conciso il teorema di Pitagora e dai un "
                "esempio numerico con i lati 3, 4 e 5.")},
    {"name": "think", "temperature": 0.6, "n_predict": 320,
     "prompt": ("Scrivi un articolo approfondito di almeno 400 parole su "
                "come l'intelligenza artificiale sta trasformando gli studi "
                "universitari, con introduzione, tre sezioni argomentate ed "
                "esempi concreti, e una conclusione. Sii dettagliato e non "
                "fermarti prima del tempo.")},
    {"name": "tool", "temperature": 0.1, "n_predict": 128,
     "prompt": 'Rispondi SOLO con JSON: {"risposta":"ok"}'},
]


def log(msg: str) -> None:
    print(f"[g1] {msg}", flush=True)


def rss_mb() -> float:
    import psutil
    return round(psutil.Process().memory_info().rss / (1024 * 1024), 1)


def child_rss_mb():
    """RSS (MB) dei figli (llama-server) — lista di dict con nome."""
    import psutil
    out = []
    for p in psutil.Process().children(recursive=True):
        try:
            out.append({"pid": p.pid,
                        "name": p.name(),
                        "rss_mb": round(p.memory_info().rss / (1024 * 1024), 1)})
        except Exception:
            pass
    return out


def residui_llama_server(children):
    """Solo i figli llama-server (residuo reale dopo unload)."""
    return [c for c in children if "llama-server" in str(c.get("name", "")).lower()]


def post_completion(port, prompt, n_predict, temperature, timeout=300):
    """POST /completion → (content, elapsed_wall_sec, timings_pps|None)."""
    payload = json.dumps({
        "prompt": prompt, "n_predict": n_predict,
        "temperature": temperature, "stream": False,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/completion", data=payload,
        headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read().decode("utf-8", "replace"))
    elapsed = time.perf_counter() - t0
    content = str(body.get("content") or "")
    tim = body.get("timings") or {}
    pps = tim.get("predicted_per_second")
    return content, elapsed, (float(pps) if pps else None)


def tok_s_len4(content, elapsed):
    """Metodo PRIMARIO Round 11: len(text)/4 (stima chars) / elapsed."""
    est = max(1, round(len(content) / 4))
    return est / elapsed, est


def measure_tok_s(port) -> dict:
    out_profiles = {}
    for prof in PROFILES:
        name = prof["name"]
        # warmup (escluso)
        post_completion(port, prof["prompt"], prof["n_predict"],
                        prof["temperature"])
        samples = []
        for _ in range(3):
            content, elapsed, pps = post_completion(
                port, prof["prompt"], prof["n_predict"], prof["temperature"])
            tps, n_tok = tok_s_len4(content, elapsed)
            samples.append({
                "n_tokens_stima": n_tok,
                "elapsed_sec": round(elapsed, 3),
                "tok_s": round(tps, 2),
                "tok_s_timings_server": (round(pps, 2) if pps else None),
            })
        med = statistics.median([s["tok_s"] for s in samples])
        out_profiles[name] = {
            "temperature": prof["temperature"],
            "n_predict": prof["n_predict"],
            "warmup": 1, "n_misure": 3,
            "samples": samples,
            "mediana_tok_s": round(med, 2),
        }
        log(f"tok/s {name}: mediana {round(med, 2)}")
    return {
        "status": "ok",
        "metodo_primario": "len(content)/4 (stima chars) / elapsed_wall "
                           "[IDENTICO Round 11 in-process]",
        "metodo_secondario": "llama-server timings.predicted_per_second "
                             "(registrato, non usato nel confronto)",
        "protocollo": "1 warmup + 3 misure, mediana per profilo "
                      "(identico a qa/t2a_measures.json Round 11)",
        "comando": "python tests/t2a_sidecar.py",
        "profili": out_profiles,
    }


def measure_prompt_lookup(port) -> dict:
    """10 output JSON corti con spec.prompt_lookup ON vs OFF."""
    prompt = 'Rispondi SOLO con JSON: {"risposta":"ok","valore":42}'
    from data.config_manager import ConfigManager
    cfg = ConfigManager()

    def run10():
        samples = []
        for _ in range(10):
            content, elapsed, _pps = post_completion(
                port, prompt, 48, 0.1, timeout=120)
            samples.append({"elapsed_sec": round(elapsed, 3),
                            "chars": len(content)})
        return samples

    cfg.set("spec.prompt_lookup", True)
    cfg.save()
    on = run10()
    cfg.set("spec.prompt_lookup", False)
    cfg.save()
    off = run10()

    med_on = statistics.median([s["elapsed_sec"] for s in on])
    med_off = statistics.median([s["elapsed_sec"] for s in off])
    speedup = round(med_off / med_on, 3) if med_on else None

    decision = None
    motivazione = None
    if speedup is not None and speedup >= 1.15:
        cfg.set("spec.prompt_lookup", True)
        cfg.save()
        decision = "ON"
        motivazione = f"speedup {speedup}x >= 1.15x"
    else:
        cfg.set("spec.prompt_lookup", False)
        cfg.save()
        decision = "OFF"
        motivazione = (
            f"speedup misurato {speedup}x < 1.15x. Inoltre grep di "
            "'prompt_lookup' su tutto il codice .py (esclusi .venv/dist) "
            "trova SOLO data/config_manager.py e tests/testH5_flags.py: "
            "nessun componente di esecuzione consuma il flag, quindi on/off "
            "non può cambiare le prestazioni. Flag imposto a False nella "
            "config utente (DEFAULT_CONFIG resta True per testH5_flags); "
            "riattivare quando il motore speculativo avrà un consumatore."
        )
    return {
        "status": "ok",
        "comando": "python tests/t2a_sidecar.py",
        "protocollo": "10 richieste consecutive per flag, stesso prompt JSON "
                      "corto, n_predict=48, temperature=0.1, profilo tool",
        "prompt": prompt,
        "samples_on": on, "samples_off": off,
        "mediana_on_sec": round(med_on, 3),
        "mediana_off_sec": round(med_off, 3),
        "speedup_off_su_on": speedup,
        "soglia": 1.15,
        "decisione": decision,
        "motivazione": motivazione,
        "config_scritta": {"spec.prompt_lookup": decision == "ON"},
    }


def main() -> int:
    out = {
        "status": "OK",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "gruppo": "G1 sidecar reale",
        "comando_riproduciibile": "python tests/t2a_sidecar.py",
        "test_associati": "python tests/testG1_sidecar.py "
                          "(server reale) + testH2_queue.py + testH2_server.py",
        "binary": {}, "sections": {},
    }
    t_start = time.perf_counter()
    binary_present = os.path.isfile(EXE)

    # ---------------- 1.1 binary ----------------
    ver = None
    if binary_present:
        import subprocess
        try:
            r = subprocess.run([EXE, "--version"], capture_output=True,
                               text=True, timeout=30, encoding="utf-8",
                               errors="replace")
            ver = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[0]
        except Exception as e:
            ver = f"errore: {e}"
    out["binary"] = {
        "status": "ok" if binary_present else "BLOCKED",
        "present": binary_present,
        "path": EXE if binary_present else None,
        "bench_path": BENCH if os.path.isfile(BENCH) else None,
        "version": ver,
        "fonte": "https://github.com/ggml-org/llama.cpp/releases "
                 "(asset llama-b11838-bin-win-cpu-x64.zip)",
        "install": "python tools/_install_sidecar.py "
                   "(o tools/INSTALL_SIDECAR.bat; procedure manuale: "
                   "tools/README_SIDECAR.md)",
        "metodo_verifica": "`tools\\llama-server.exe --version`",
    }

    if not binary_present:
        # ---- righe sidecar BLOCKED + riferimento in-process Round 11 ----
        ref = {}
        try:
            with open(ROUND11_PATH, encoding="utf-8") as f:
                r11 = json.load(f)
            ref = {
                "load_cold_inprocess_sec":
                    r11["sections"]["model_load_sec"]["sec"],
                "tok_s_inprocess": {
                    k: v["mediana_tok_s"]
                    for k, v in r11["sections"]["tok_s"]["profili"].items()},
                "rss_inprocess_after_30req_mb":
                    r11["sections"]["rss_mb"]["after_30req"],
            }
        except Exception as e:
            ref = {"errore_lettura_round11": str(e)}
        for key in ("load_cold_sec", "rss_mb", "tok_s", "completions",
                    "idle_unload", "prompt_lookup", "autotune"):
            out["sections"][key] = {"status": "BLOCKED",
                                    "causa": "binario llama-server.exe assente"}
        out["sections"]["riferimento_inprocess_round11"] = ref
        out["status"] = "PARZIALE"
        _write(out)
        return 0

    # ---------------- setup server reale ----------------
    from core.sidecar import SidecarClient, SidecarServer
    cfg = {
        "llama.server_path": EXE,
        "llama.model_path": MODEL,
        "llama.n_ctx": 4096,
        "llama.idle_unload_sec": 300,
    }
    baseline_mb = rss_mb()
    srv = SidecarServer(config=cfg)
    try:
        # ---------------- 1.3 load cold ----------------
        t0 = time.perf_counter()
        ok = srv.start_on_demand()
        load_sec = round(time.perf_counter() - t0, 2)
        out["sections"]["load_cold_sec"] = {
            "status": "ok" if ok else "BLOCKED",
            "sec": load_sec,
            "target_sec": 3.0,
            "raggiunto": (load_sec <= 3.0) if ok else False,
            "metodo": "time.perf_counter() attorno a "
                      "SidecarServer(config).start_on_demand() "
                      "(ready = GET /health 200)",
            "comando": "python tests/t2a_sidecar.py",
            "stato_finale": srv.status()["state"],
        }
        log(f"cold load: {load_sec}s (target <=3.0)")
        if not ok:
            out["sections"]["rss_mb"] = {"status": "BLOCKED",
                                         "error": "avvio sidecar fallito: "
                                                  + str(srv.status())}
            out["sections"]["tok_s"] = {"status": "BLOCKED"}
            _write(out)
            return 0

        rss_caricato = rss_mb()
        figli_caricato = child_rss_mb()

        # ---------------- 1.2: 3 completion reali via SidecarClient ----------
        client = SidecarClient(server=srv, auto_start=True, timeout=180)
        completions = []
        for i, (prompt, prof) in enumerate([
            ("Rispondi con una sola parola: ciao", "fast"),
            ('Rispondi SOLO con JSON: {"ok":true}', "tool"),
            ("Quanto fa 2+2? Rispondi con il solo numero.", "fast"),
        ], 1):
            t1 = time.perf_counter()
            txt = client.complete(prompt, profile=prof, classe="micro")
            completions.append({
                "n": i, "profile": prof, "classe": "micro",
                "chars": len(txt), "non_vuota": bool(txt.strip()),
                "elapsed_sec": round(time.perf_counter() - t1, 2),
                "api": "core.sidecar.SidecarClient.complete",
            })
            log(f"completion {i}/3: {len(txt)} char")
        out["sections"]["completions"] = {
            "status": "ok" if all(c["non_vuota"] for c in completions)
                      else "BLOCKED",
            "n": 3, "dettaglio": completions,
            "comando": "python tests/t2a_sidecar.py",
        }

        # ---------------- 1.3 tok/s (protocollo Round 11) ----------------
        out["sections"]["tok_s"] = measure_tok_s(srv.port)

        n_req = 3 + 4 * 3  # 3 completions + (1 warmup + 3) per 3 profili
        rss_dopo_req = rss_mb()
        figli_dopo_req = child_rss_mb()

        # ---------------- 1.4 prompt_lookup (server gia' caldo) ------------
        try:
            lookup = measure_prompt_lookup(srv.port)
            n_req += 20
            out["sections"]["prompt_lookup"] = lookup
            log(f"lookup speedup={lookup['speedup_off_su_on']} "
                f"-> {lookup['decisione']}")
        except Exception as e:
            out["sections"]["prompt_lookup"] = {
                "status": "BLOCKED",
                "error": f"{type(e).__name__}: {e}"}
        rss_dopo_req = rss_mb()
        figli_dopo_req = child_rss_mb()

        # ---------------- 1.3 idle-unload (8s iniettato) -------------------
        cfg["llama.idle_unload_sec"] = 8   # letto live dal monitor
        srv.touch_job()
        t0 = time.perf_counter()
        deadline = time.time() + 20.0
        unloaded = False
        while time.time() < deadline:
            if srv.status()["state"] == "down" and not srv.health():
                unloaded = True
                break
            time.sleep(0.3)
        unload_sec = round(time.perf_counter() - t0, 2)
        # lo stato 'down' e' posto PRIMA di terminate(): attendo che il figlio
        # sia realmente terminato (max ~6s) prima di misurare il residuo
        t_wait = time.time() + 6.0
        while time.time() < t_wait and residui_llama_server(child_rss_mb()):
            time.sleep(0.3)
        rss_dopo_unload = rss_mb()
        figli_dopo_unload = child_rss_mb()
        residui = residui_llama_server(figli_dopo_unload)
        delta = round(rss_dopo_unload - baseline_mb, 1)
        out["sections"]["idle_unload"] = {
            "status": "ok" if unloaded else "BLOCKED",
            "idle_unload_sec_iniettato": 8,
            "sec_rilevati": unload_sec,
            "stato": srv.status()["state"],
            "metodo": "cfg dict mutato a runtime (monitor rilegge "
                      "llama.idle_unload_sec ad ogni tick 0.5s), poi "
                      "poll dello stato fino a 'down'",
            "comando": "python tests/t2a_sidecar.py",
        }

        # ---------------- 1.3 rss (target baseline+<=50MB) -----------------
        out["sections"]["rss_mb"] = {
            "status": "ok",
            "method": "psutil.Process().memory_info().rss (psutil)",
            "comando": "python tests/t2a_sidecar.py",
            "baseline_prima_mb": baseline_mb,
            "caricato_mb": rss_caricato,
            "caricato_figli_llama_server": figli_caricato,
            "dopo_n_req_mb": rss_dopo_req,
            "dopo_n_req_figli": figli_dopo_req,
            "n_req": n_req,
            "dopo_idle_unload_mb": rss_dopo_unload,
            "dopo_idle_unload_figli": figli_dopo_unload,
            "dopo_idle_unload_residui_llama_server": residui,
            "delta_dopo_unload_vs_baseline_mb": delta,
            "target_dopo_unload": "baseline + <=50MB e 0 figli llama-server "
                                  "residui",
            "target_raggiunto": bool(unloaded and delta <= 50.0
                                     and not residui),
            "nota": "llama-server è un processo SEPARATO: il suo RSS "
                    "(caricato/figli) non fa parte del processo padre; "
                    "dopo l'unload il figlio deve azzerarsi.",
        }

        # ---------------- 1.4 autotune (llama-bench) -----------------------
        try:
            from data.autotune import run_autotune_once
            from data.config_manager import ConfigManager
            res = run_autotune_once(ConfigManager())
            out["sections"]["autotune"] = {
                "status": "ok" if res.get("done") else "BLOCKED",
                "comando": "data.autotune.run_autotune_once(ConfigManager()) "
                           "→ subprocess [tools\\llama-bench.exe] "
                           "(modello default models/7B/ggml-model-q4_0.gguf "
                           "= hardlink al gguf NovaStudio)",
                "result": res,
                "nota_hardlink": "llama-bench senza argomenti usa il path "
                                 "default relative 'models/7B/"
                                 "ggml-model-q4_0.gguf': creato hardlink "
                                 "mklink /H (0 byte extra)",
            }
            log(f"autotune: {res.get('done')} {res.get('reason')}")
        except Exception as e:
            out["sections"]["autotune"] = {
                "status": "BLOCKED",
                "error": f"{type(e).__name__}: {e}"}

        # ---------------- 1.3 confronto tabellare --------------------------
        ref = {"status": "BLOCKED"}
        try:
            with open(ROUND11_PATH, encoding="utf-8") as f:
                r11 = json.load(f)
            ip = {k: v["mediana_tok_s"]
                  for k, v in r11["sections"]["tok_s"]["profili"].items()}
            sc = {k: v["mediana_tok_s"]
                  for k, v in out["sections"]["tok_s"]["profili"].items()}
            ref = {
                "status": "ok",
                "fonte_inprocess": "qa/t2a_measures.json (Round 11)",
                "load_cold_sec": {
                    "in_process": r11["sections"]["model_load_sec"]["sec"],
                    "sidecar": load_sec},
                "tok_s_mediana": {
                    p: {"in_process": ip.get(p), "sidecar": sc.get(p),
                        "delta": (round(sc.get(p) - ip.get(p), 2)
                                  if sc.get(p) and ip.get(p) else None)}
                    for p in ("fast", "think", "tool")},
                "rss_caricato_mb": {
                    "in_process_dopo_30req":
                        r11["sections"]["rss_mb"]["after_30req"],
                    "sidecar_figlio_dopo_n_req":
                        (figli_dopo_req[0]["rss_mb"]
                         if figli_dopo_req else None),
                    "sidecar_padre_dopo_n_req": rss_dopo_req},
                "metodo_tok_s": "mediana su 3 (1 warmup escluso), "
                                "len(content)/4/elapsed — identico sui due "
                                "lati",
            }
        except Exception as e:
            ref = {"status": "BLOCKED", "error": str(e)}
        out["sections"]["confronto_sidecar_vs_inprocess"] = ref

        # ---------------- note verifiche H2/fallback -----------------------
        out["sections"]["verifiche"] = {
            "status": "ok",
            "testH2_queue": "python tests/testH2_queue.py (atteso 5/5)",
            "testH2_server": "python tests/testH2_server.py (atteso 11/11, "
                             "invariati)",
            "testG1_sidecar": "python tests/testG1_sidecar.py "
                              "(server reale: avvio+3 completion, "
                              "idle-unload 8s, fallback in-process "
                              "con server_path='')",
        }
    except Exception as e:
        out["status"] = "BLOCKED"
        out["error"] = f"{type(e).__name__}: {e}"
        log(f"ERRORE: {out['error']}")
    finally:
        srv.shutdown()

    out["run_duration_sec"] = round(time.perf_counter() - t_start, 1)
    _write(out)
    return 0


def _write(out: dict) -> None:
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    log(f"scritto {OUT_PATH} (status={out.get('status')})")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        try:
            _write({"status": "BLOCKED", "error": err,
                    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "sections": {}})
        except Exception:
            pass
        print(f"[g1] ERRORE FATALE: {err}", flush=True)
        sys.exit(0)

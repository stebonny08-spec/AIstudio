#!/usr/bin/env python3
"""
tests/t2a_measures.py (script NUOVO — nessuna modifica al codice produttivo)
----------------------------------------------------------------------------
T2A — misure REALI su modello locale (nessuna simulazione).
Scrive qa/t2a_measures.json con campo "status" per sezione.

Sezioni:
  1. model_load_sec  — tempo di caricamento modello
  2. rss_mb          — BEFORE / AFTER_LOAD / AFTER_30REQ
  3. tok_s           — 3 profili (fast / think / tool): 1 warmup + 3 misure, mediana
  4. latency_ms      — 20 chiamate brevi -> p50 / p95
  5. prompt_cache    — core.prefix_cache.PromptPrefixCache (istanza fresca, nessun modello)
  6. sidecar         — llama-server.exe su PATH + bench tok/s se presente

Exit code: SEMPRE 0 (anche su BLOCKED) — l'esito completo e' nel JSON.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import statistics
import subprocess
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

OUT_PATH = os.path.join(ROOT, "qa", "t2a_measures.json")
MODEL_PATH = os.path.join(
    os.environ.get("APPDATA", ""), "NovaStudio", "models", "MiniCPM5-2B-Q4_K_M.gguf"
)

REQ_COUNT = 0
RSS_AFTER_30 = None  # MB, catturato alla 30a chiamata completata


def log(msg: str) -> None:
    print(f"[t2a] {msg}", flush=True)


# ----------------------------------------------------------------------
# RSS (metodo dichiarato)
# ----------------------------------------------------------------------
def rss_mb() -> float:
    import psutil

    return round(psutil.Process().memory_info().rss / (1024 * 1024), 1)


def nearest_rank(vals, p: float):
    s = sorted(vals)
    k = math.ceil(p * len(s))
    k = max(1, min(len(s), k))
    return s[k - 1]


# ----------------------------------------------------------------------
# 5) prompt_cache (nessun modello richiesto)
# ----------------------------------------------------------------------
def measure_prompt_cache() -> dict:
    from core.prefix_cache import PromptPrefixCache

    pc = PromptPrefixCache()  # istanza FRESCA (non il singleton di modulo)
    # 10 registrazioni dello STESSO prefisso -> 1 MISS + 9 HIT
    for _ in range(10):
        pc.register("seg1-system-profile-v1", "seg2-rag-header", "seg3-storia-fissa")
    # 10 prefissi DISTINTI -> 10 MISS
    for i in range(10):
        pc.register("seg1-system-profile-v1", f"seg2-rag-distinto-{i}", "seg3-storia-fissa")
    stats = pc.stats()
    return {
        "status": "ok",
        "classe": "core.prefix_cache.PromptPrefixCache (istanza fresca)",
        "registrazioni_stesso_prefisso": 10,
        "registrazioni_distinte": 10,
        "hits": stats["hits"],
        "misses": stats["misses"],
        "hit_rate": round(stats["hit_rate"], 4),
        "hit_rate_atteso": 0.45,  # 9 HIT su 20 registrazioni
    }


# ----------------------------------------------------------------------
# 6) sidecar — shutil.which + bench reale se il binario esiste
# ----------------------------------------------------------------------
def measure_sidecar() -> dict:
    info = {
        "status": "ok",
        "binario_assente": True,
        "percorso": None,
        "tok_s": None,
        "metodo_tok_s": None,
        "samples_tok_s": None,
        "error": None,
    }
    bin_path = shutil.which("llama-server.exe") or shutil.which("llama-server")
    if not bin_path:
        info["binario_assente"] = True
        return info

    info["binario_assente"] = False
    info["percorso"] = bin_path

    if not os.path.exists(MODEL_PATH):
        info["status"] = "error"
        info["error"] = f"modello assente per bench sidecar: {MODEL_PATH}"
        return info

    port = 18923
    base = f"http://127.0.0.1:{port}"
    proc = None
    try:
        proc = subprocess.Popen(
            [bin_path, "-m", MODEL_PATH, "--host", "127.0.0.1",
             "--port", str(port), "-c", "4096"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 90
        ready = False
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(
                    f"llama-server terminato prematuramente (rc={proc.returncode})"
                )
            try:
                with urllib.request.urlopen(base + "/health", timeout=3) as r:
                    if r.status == 200:
                        ready = True
                        break
            except Exception:
                time.sleep(1.0)
        if not ready:
            raise RuntimeError("llama-server non pronto entro 90s")

        samples = []
        method = None
        # 1 warmup + 3 misure
        for i in range(4):
            payload = json.dumps(
                {
                    "prompt": "Spiega il teorema di Pitagora in modo conciso con un esempio.",
                    "n_predict": 128,
                    "temperature": 0.8,
                }
            ).encode("utf-8")
            req = urllib.request.Request(
                base + "/completion",
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            t0 = time.perf_counter()
            with urllib.request.urlopen(req, timeout=180) as r:
                body = json.loads(r.read().decode("utf-8"))
            elapsed = time.perf_counter() - t0
            tim = body.get("timings") or {}
            pps = tim.get("predicted_per_second")
            if pps:
                samples.append(float(pps))
                method = "llama-server timings.predicted_per_second"
            else:
                content = body.get("content") or ""
                est = max(1, round(len(content) / 4))
                samples.append(est / elapsed)
                method = "len(content)/4 (stima chars) / elapsed"

        measured = samples[1:]  # esclude il warmup
        info["tok_s"] = round(statistics.median(measured), 2)
        info["metodo_tok_s"] = method
        info["samples_tok_s"] = [round(s, 2) for s in measured]
    except Exception as e:
        info["status"] = "error"
        info["tok_s"] = None
        info["error"] = f"{type(e).__name__}: {e}"
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except Exception:
                proc.kill()
    return info


# ----------------------------------------------------------------------
# Caricamento modello
# ----------------------------------------------------------------------
def load_model():
    """Ritorna (model, loader_used, load_sec). Alza RuntimeError se tutto fallisce."""
    t0 = time.perf_counter()
    try:
        from core.local_llm_client import LocalLLMClient

        client = LocalLLMClient(model_path=MODEL_PATH, n_ctx=4096, n_gpu_layers=-1)
        model = client.load_model_blocking()
        strat = "; ".join(client._optimizations) if client._optimizations else "n/a"
        elapsed = time.perf_counter() - t0
        return model, (
            "core.local_llm_client.LocalLLMClient "
            f"(caricamento adattivo, strategia: {strat}; n_ctx=4096, verbose=False)"
        ), elapsed
    except Exception as e1:
        err1 = f"{type(e1).__name__}: {e1}"
        log(f"LocalLLMClient KO ({err1}) -> provo llama_cpp diretto")
        t1 = time.perf_counter()
        try:
            from llama_cpp import Llama

            model = Llama(model_path=MODEL_PATH, n_ctx=4096, verbose=False)
            elapsed = time.perf_counter() - t1
            return model, (
                "llama_cpp.Llama(model_path, n_ctx=4096, verbose=False) [fallback diretto]"
            ), elapsed
        except Exception as e2:
            raise RuntimeError(
                f"Caricamento modello fallito. "
                f"1) LocalLLMClient -> {err1}; "
                f"2) llama_cpp diretto -> {type(e2).__name__}: {e2}"
            )


# ----------------------------------------------------------------------
# Wrapper completamento con contatore per il checkpoint RSS alla 30a req
# ----------------------------------------------------------------------
def complete(model, prompt, temperature, max_tokens):
    global REQ_COUNT, RSS_AFTER_30
    t0 = time.perf_counter()
    resp = model.create_completion(
        prompt=prompt,
        max_tokens=max_tokens,
        temperature=temperature,
        stream=False,
    )
    elapsed = time.perf_counter() - t0
    REQ_COUNT += 1
    if REQ_COUNT == 30 and RSS_AFTER_30 is None:
        RSS_AFTER_30 = rss_mb()
        log(f"RSS catturato alla 30a chiamata: {RSS_AFTER_30} MB")
    return resp, elapsed


def tok_s_from_sample(resp, elapsed):
    """Metodo primario: timings.predicted_per_second. Fallback: len(text)/4 / elapsed."""
    timings = resp.get("timings") or {}
    pps = timings.get("predicted_per_second")
    if pps:
        n_tok = timings.get("predicted_n")
        return float(pps), n_tok, "llama_cpp timings.predicted_per_second"
    text = ""
    try:
        text = resp["choices"][0].get("text") or ""
    except Exception:
        pass
    est = max(1, round(len(text) / 4))
    return est / elapsed, est, "len(text)/4 (stima chars) / elapsed"


# ----------------------------------------------------------------------
# 3) tok_s — 3 profili
# ----------------------------------------------------------------------
PROFILES = [
    {
        "name": "fast",
        "temperature": 0.8,
        "n_predict": 128,
        "prompt": (
            "Spiega in modo conciso il teorema di Pitagora e dai un esempio "
            "numerico con i lati 3, 4 e 5."
        ),
    },
    {
        "name": "think",
        "temperature": 0.6,
        "n_predict": 320,
        "prompt": (
            "Scrivi un articolo approfondito di almeno 400 parole su come "
            "l'intelligenza artificiale sta trasformando gli studi universitari, "
            "con introduzione, tre sezioni argomentate ed esempi concreti, "
            "e una conclusione. Sii dettagliato e non fermarti prima del tempo."
        ),
    },
    {
        "name": "tool",
        "temperature": 0.1,
        "n_predict": 128,
        "prompt": 'Rispondi SOLO con JSON: {"risposta":"ok"}',
    },
]


def measure_tok_s(model) -> dict:
    out_profiles = {}
    methods_used = set()
    for prof in PROFILES:
        name = prof["name"]
        # warmup (non registrato nei sample)
        complete(model, prof["prompt"], prof["temperature"], prof["n_predict"])
        samples = []
        for i in range(3):
            resp, elapsed = complete(
                model, prof["prompt"], prof["temperature"], prof["n_predict"]
            )
            tps, n_tok, method = tok_s_from_sample(resp, elapsed)
            methods_used.add(method)
            samples.append(
                {
                    "n_tokens": n_tok,
                    "elapsed_sec": round(elapsed, 3),
                    "tok_s": round(tps, 2),
                    "method": method,
                }
            )
        med = statistics.median([s["tok_s"] for s in samples])
        out_profiles[name] = {
            "temperature": prof["temperature"],
            "n_predict": prof["n_predict"],
            "warmup": 1,
            "n_misure": 3,
            "samples": samples,
            "mediana_tok_s": round(med, 2),
        }
        log(f"profilo {name}: mediana {round(med, 2)} tok/s")
    return {
        "status": "ok",
        "metodo": sorted(methods_used),
        "mediana_su": "3 misure (warmup escluso) per profilo",
        "profili": out_profiles,
    }


# ----------------------------------------------------------------------
# 4) latency_ms — 20 chiamate brevi
# ----------------------------------------------------------------------
LATENCY_PROMPT = (
    "Spiega brevemente, in circa cinque righe, la differenza pratica tra "
    "lista e tupla in Python, con un esempio ciascuna."
)  # ~150 chars


def measure_latency(model) -> dict:
    samples = []
    for _ in range(20):
        resp, elapsed = complete(model, LATENCY_PROMPT, 0.7, 48)
        samples.append(round(elapsed * 1000, 1))
    p50 = nearest_rank(samples, 0.50)
    p95 = nearest_rank(samples, 0.95)
    return {
        "status": "ok",
        "n": len(samples),
        "prompt_chars": len(LATENCY_PROMPT),
        "n_predict": 48,
        "metodo_percentili": "nearest-rank: k = ceil(p*n), valore = sorted[k-1]",
        "samples_ms": samples,
        "p50_ms": p50,
        "p95_ms": p95,
        "min_ms": min(samples),
        "max_ms": max(samples),
        "mediana_ms": statistics.median(samples),
    }


# ----------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------
def main() -> int:
    out = {
        "status": "OK",
        "error": None,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model_path": MODEL_PATH,
        "model_esiste": os.path.exists(MODEL_PATH),
        "environment": {},
        "sections": {},
    }
    t_start = time.perf_counter()

    # --- RSS BEFORE: subito all'avvio, prima di importare llama_cpp ---
    import psutil

    rss_before = rss_mb()
    out["environment"] = {
        "python": sys.version.split()[0],
        "llama_cpp_version": __import__("llama_cpp").__version__,
        "psutil_version": psutil.__version__,
        "cpu_count": os.cpu_count(),
        "rss_method": "psutil.Process().memory_info().rss (psutil)",
    }
    log(f"RSS BEFORE: {rss_before} MB")

    # --- 5) prompt_cache (indipendente dal modello) ---
    try:
        out["sections"]["prompt_cache"] = measure_prompt_cache()
        log(f"prompt_cache: {out['sections']['prompt_cache']['hit_rate']}")
    except Exception as e:
        out["sections"]["prompt_cache"] = {
            "status": "error",
            "error": f"{type(e).__name__}: {e}",
        }

    # --- 6) sidecar (indipendente dal modello) ---
    try:
        out["sections"]["sidecar"] = measure_sidecar()
        log(f"sidecar binario_assente={out['sections']['sidecar']['binario_assente']}")
    except Exception as e:
        out["sections"]["sidecar"] = {
            "status": "error",
            "binario_assente": None,
            "tok_s": None,
            "error": f"{type(e).__name__}: {e}",
        }

    # --- 1) model_load_sec + 2) rss AFTER_LOAD ---
    model = None
    load_error = None
    try:
        model, loader_used, load_sec = load_model()
        rss_after_load = rss_mb()
        out["sections"]["model_load_sec"] = {
            "status": "ok",
            "sec": round(load_sec, 2),
            "loader": loader_used,
            "n_ctx": 4096,
        }
        log(f"model caricato in {round(load_sec, 2)} s (RSS {rss_after_load} MB)")
    except Exception as e:
        load_error = f"{type(e).__name__}: {e}"
        rss_after_load = None
        out["sections"]["model_load_sec"] = {
            "status": "BLOCKED",
            "sec": None,
            "error": load_error,
        }
        out["status"] = "BLOCKED"
        out["error"] = load_error
        log(f"BLOCKED load: {load_error}")

    # --- 2) rss ---
    out["sections"]["rss_mb"] = {
        "status": "ok" if load_error is None else "BLOCKED",
        "method": "psutil.Process().memory_info().rss (psutil)",
        "before": rss_before,
        "after_load": rss_after_load,
        "after_30req": None,  # riempito sotto (o fallback a fine run)
    }

    # --- 3) tok_s + 4) latency (solo se modello caricato) ---
    if load_error is None:
        try:
            out["sections"]["tok_s"] = measure_tok_s(model)
        except Exception as e:
            out["sections"]["tok_s"] = {
                "status": "BLOCKED",
                "error": f"{type(e).__name__}: {e}",
            }
            out["status"] = "BLOCKED"
            out["error"] = out["error"] or f"tok_s: {type(e).__name__}: {e}"

        try:
            out["sections"]["latency_ms"] = measure_latency(model)
            log(
                f"latency p50={out['sections']['latency_ms']['p50_ms']} ms "
                f"p95={out['sections']['latency_ms']['p95_ms']} ms"
            )
        except Exception as e:
            out["sections"]["latency_ms"] = {
                "status": "BLOCKED",
                "error": f"{type(e).__name__}: {e}",
            }
            out["status"] = "BLOCKED"
            out["error"] = out["error"] or f"latency: {type(e).__name__}: {e}"

    # checkpoint RSS dopo 30 req (fallback: dopo tutte le req eseguite)
    if RSS_AFTER_30 is not None:
        out["sections"]["rss_mb"]["after_30req"] = RSS_AFTER_30
        out["sections"]["rss_mb"]["after_30req_raggiunto"] = True
    else:
        out["sections"]["rss_mb"]["after_30req"] = rss_mb()
        out["sections"]["rss_mb"]["after_30req_raggiunto"] = False
        out["sections"]["rss_mb"]["after_30req_note"] = (
            f"solo {REQ_COUNT} chiamate completate (< 30): RSS misurato a fine run"
        )

    out["run_duration_sec"] = round(time.perf_counter() - t_start, 1)
    out["n_request_totali"] = REQ_COUNT

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    log(f"scritto {OUT_PATH} (status={out['status']}, durata={out['run_duration_sec']}s)")
    return 0  # SEMPRE 0, anche su BLOCKED


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        # Ultima difesa: salva comunque il JSON con l'errore e exit 0
        err = f"{type(e).__name__}: {e}"
        try:
            payload = {
                "status": "BLOCKED",
                "error": err,
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "sections": {},
            }
            os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
            with open(OUT_PATH, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        print(f"[t2a] ERRORE FATALE: {err}", flush=True)
        sys.exit(0)

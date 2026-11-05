# -*- coding: utf-8 -*-
"""qa/p1b_ngram_bench.py - P1b.1: A/B n-gram speculative decoding (server REALI).
Vedi docstring finale per il metodo. Uso: python qa/p1b_ngram_bench.py
"""
from __future__ import annotations
import hashlib, json, subprocess, sys, time, urllib.request
from pathlib import Path
import os
ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

BIN = {"up": r"tools\llama-server.exe",
       "xt": r"tools\llama-xhtoken\build\bin\llama-server.exe"}
MODELS = {"pro": r"tools\models\spark-x2.6-4b.gguf",
          "base": r"tools\models\spark-x2.6-1.7b.gguf"}
VARIANTS = ["ngram-simple", "ngram-map-k", "ngram-map-k4v", "ngram-mod"]
DRAFTS = [3, 5, 8]
L1 = ("Spiega a fondo, in modo articolato e con esempi, il funzionamento della "
      "fotosintesi clorofilliana in una pianta superiore: parti dalla struttura "
      "del cloroplasto e dei tilacoidi, descrivi la fase luminosa con la fotolisi "
      "dell'acqua e la catena di trasporto degli elettroni, indica come vengono "
      "prodotti ATP e NADPH, poi passa al ciclo di Calvin nello stroma con la "
      "fissazione della CO2 e la produzione di zuccheri. Concludi con il ruolo "
      "ecologico del processo e con alcune applicazioni pratiche in agricoltura. ")
L2 = ("Racconta in modo approfondito la storia della Retorica dall'antichita "
      "classica al Rinascimento, citando autori, opere principali e lineamenti "
      "delle principali scuole, con esempi concreti di testi e dei loro autori. ")

def variant_flags(variant, D):
    if variant == "ngram-mod":
        return ["--spec-type", "ngram-mod", "--spec-ngram-mod-n-max", str(D)]
    return ["--spec-type", variant, "--spec-" + variant + "-size-m", str(D)]

def req(url, data=None, timeout=300):
    body = json.dumps(data).encode() if data is not None else None
    hdr = {"Content-Type": "application/json"} if body else {}
    r = urllib.request.Request(url, data=body, headers=hdr)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode())

def run_case(engine, model_path, flags, prompt, tag, port):
    args = [BIN[engine], "-m", model_path, "-c", "4096",
            "--cache-type-k", "q8_0", "--cache-type-v", "q8_0",
            "--host", "127.0.0.1", "--port", str(port)] + flags
    log = open("qa/_x_p1b_ngram_" + tag + ".log", "wb")
    p = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT)
    rec = {"tag": tag, "flags": flags, "ok": False}
    try:
        up = False
        for _ in range(150):
            if p.poll() is not None:
                raise RuntimeError("server exit %s" % p.returncode)
            try:
                req("http://127.0.0.1:%d/health" % port, timeout=2)
                up = True
                break
            except Exception:
                time.sleep(0.5)
        if not up:
            raise RuntimeError("health timeout")
        t0 = time.time()
        r = req("http://127.0.0.1:%d/completion" % port,
                {"prompt": prompt, "n_predict": 200, "temperature": 0.0,
                 "top_p": 1.0, "cache_prompt": False}, timeout=300)
        wall = time.time() - t0
        t = r.get("timings") or {}
        text = str(r.get("content") or "")
        acc = None
        try:
            an = t.get("draft_n_accepted", t.get("n_accepted"))
            dn = t.get("draft_n")
            if dn and float(dn) > 0:
                acc = round(float(an) / float(dn), 4)
        except Exception:
            pass
        rec.update(ok=True, wall_s=round(wall, 2),
                   tok_s=t.get("predicted_per_second"),
                   predicted_n=t.get("predicted_n"),
                   acceptance=acc, draft_n=t.get("draft_n"),
                   out_len=len(text),
                   out_sha16=hashlib.sha256(text.encode()).hexdigest()[:16])
    except Exception as e:
        rec["error"] = str(e)[:300]
    finally:
        try:
            p.terminate(); p.wait(timeout=10)
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
        log.close()
        time.sleep(2)
    print("ERR?[%s]=%s" % (tag, rec.get("error")), flush=True)
    print("[%s] ok=%s tok/s=%s acc=%s sha=%s" % (
        tag, rec.get("ok"), rec.get("tok_s"), rec.get("acceptance"),
        rec.get("out_sha16")), flush=True)
    return rec


def main():
    out = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "engine_base": "upstream build 4231b23dc; fork build 22c0ae1 (top2)",
           "draft_max_mapping": ("ngram-mod -> --spec-ngram-mod-n-max D; "
                                 "simple/map-k/map-k4v -> --spec-<v>-size-m D "
                                 "(flag --draft-max rimosso in questa build)"),
           "prompt_quality": "L1 fisso greedy(temp0) n_predict=200 - equality vs baseline",
           "runs": []}
    port = 62711
    baselines = {}
    for m in ("pro", "base"):
        rec = run_case("up", MODELS[m], [], L1, "nospec_" + m, port)
        port += 1
        baselines[m] = rec
        out["runs"].append(dict(kind="baseline", model=m, **rec))
    results = []
    for m in ("pro", "base"):
        for var in VARIANTS:
            for D in DRAFTS:
                rec = run_case("up", MODELS[m], variant_flags(var, D), L1,
                               m + "_" + var.replace("-", "") + "_d" + str(D), port)
                port += 1
                b = baselines.get(m) or {}
                sp = None
                try:
                    sp = round(float(rec.get("tok_s")) / float(b.get("tok_s")), 3)
                except Exception:
                    pass
                row = dict(kind="matrix", model=m, variant=var, draft_max=D,
                           speedup_vs_nospec=sp,
                           quality_equal=(rec.get("out_sha16") is not None and
                                          rec.get("out_sha16") == b.get("out_sha16")),
                           **rec)
                results.append(row)
                out["runs"].append(row)
    # L2 robustezza: baseline pro L2 + top3 varianti pro
    bl2 = run_case("up", MODELS["pro"], [], L2, "nospec_pro_L2", port)
    port += 1
    out["runs"].append(dict(kind="baseline_L2", model="pro", **bl2))
    pro_rows = [r for r in results if r["model"] == "pro" and r.get("speedup_vs_nospec")]
    pro_rows.sort(key=lambda r: -(r.get("speedup_vs_nospec") or 0))
    for r in pro_rows[:3]:
        rec = run_case("up", MODELS["pro"], r["flags"], L2,
                       "pro_" + r["variant"].replace("-", "") +
                       "_d" + str(r["draft_max"]) + "_L2", port)
        port += 1
        out["runs"].append(dict(kind="robustness_L2", model="pro",
                                variant=r["variant"], draft_max=r["draft_max"],
                                quality_equal=(rec.get("out_sha16") ==
                                               bl2.get("out_sha16")), **rec))
    # top2 su FORK (pro, L1)
    for r in pro_rows[:2]:
        rec = run_case("xt", MODELS["pro"], r["flags"], L1,
                       "fork_pro_" + r["variant"].replace("-", "") +
                       "_d" + str(r["draft_max"]), port)
        port += 1
        out["runs"].append(dict(kind="fork_top2", model="pro",
                                variant=r["variant"], draft_max=r["draft_max"],
                                engine="xhtoken", **rec))
    # decisioni per regola
    thr = 1.30
    decisions = []
    best_overall = None
    for m in ("pro", "base"):
        for var in VARIANTS:
            rows = [r for r in results if r["model"] == m and r["variant"] == var]
            best = max(rows, key=lambda r: (r.get("speedup_vs_nospec") or 0))
            qok = all(r.get("quality_equal") for r in rows)
            if m == "pro":
                qok = qok and all(
                    r.get("quality_equal") for r in out["runs"]
                    if r.get("kind") == "robustness_L2" and r.get("variant") == var)
            on = (best.get("speedup_vs_nospec") or 0) >= thr and qok
            d = {"model": m, "variant": var,
                 "best_draft_max": best.get("draft_max"),
                 "best_speedup": best.get("speedup_vs_nospec"),
                 "best_acceptance": best.get("acceptance"),
                 "quality_ok": bool(qok),
                 "decision": ("ON(long-form)" if on else "OFF")}
            decisions.append(d)
            if on and (best_overall is None or
                       (best.get("speedup_vs_nospec") or 0) >
                       (best_overall.get("best_speedup") or 0)):
                best_overall = d
    try:
        x3 = json.loads(Path("qa/x3_compare.json").read_text(encoding="utf-8"))
        dsp = x3["matrix"]["speedup_draft_pro"]
    except Exception:
        dsp = {"upstream": 1.272, "xhtoken": 1.240}
    out["draft_spark_reference"] = dsp
    out["decisions"] = decisions
    if best_overall:
        out["verdict"] = {
            "winner": ("ngram " + best_overall["variant"] +
                       " d" + str(best_overall["best_draft_max"])),
            "speedup": best_overall["best_speedup"],
            "vs_draft_spark_best": max(dsp.values()),
            "rule": ("ON long-form SOLO se speedup>=1.30 E quality invariata; "
                     "altrimenti OFF. Confronto con draft Spark: mai entrambi.")}
    else:
        mx = max([0.0] + [(d.get("best_speedup") or 0) for d in decisions])
        out["verdict"] = {
            "winner": "NESSUNO (tutte OFF)",
            "best_speedup_observed": mx,
            "vs_draft_spark_best": max(dsp.values()),
            "rule": ("soglia1.30 non raggiunta (max osservato %s); draft Spark %s "
                     "<1.30 gia OFF (R23) -> tutti gli acceleratori speculativi "
                     "OFF su tutti i profili") % (mx, max(dsp.values()))}
    out["micro_standard"] = "OFF per regola (overhead non ripaga) - invariato"
    Path("qa/p1b_ngram.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print("DECISIONS", json.dumps(decisions, ensure_ascii=False), flush=True)
    print("VERDICT", json.dumps(out["verdict"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

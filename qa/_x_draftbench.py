# -*- coding: utf-8 -*-
"""qa/_x_draftbench.py â€” R23 X3/X4: draft 1.7B -> 4B su server REALI.
Casi: {upstream,xhtoken} x {draft off,on} sul pro Spark-4B.
Misure: tg tok/s (n_predict=200), acceptance (timings draft_n_accepted/draft_n),
RSS steady (psutil) per motore. Output: qa/x3_draftbench.json (timings grezzi inclusi).
Uso: python qa/_x_draftbench.py
"""
import json, subprocess, sys, time, urllib.request, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
BIN = {
    "up": r"tools\llama-server.exe",
    "xt": r"tools\llama-xhtoken\build\bin\llama-server.exe",
}
MODEL = r"tools\models\spark-x2.6-4b.gguf"
DRAFT = r"tools\models\spark-x2.6-1.7b.gguf"
PROMPT = ("Racconta la fotosintesi clorofilliana in modo dettagliato per uno studente universitario. "
          "Parti dalla struttura del cloroplasto, poi spiega le fasi luminosa e oscura, "
          "i ruoli di ATP e NADPH, e infine l'importanza ecologica del processo. "
          "Usa un linguaggio preciso ma accessibile, con esempi concreti. " * 3)
CASES = [("up", "off"), ("up", "draft"), ("xt", "off"), ("xt", "draft")]

def req(url, data=None, timeout=300):
    if data is not None:
        data = json.dumps(data).encode()
    r = urllib.request.Request(url, data=data,
                               headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode())

def rss_mb(pid):
    try:
        import psutil
        return round(psutil.Process(pid).memory_info().rss / (1024 * 1024), 1)
    except Exception:
        return None

out = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "model": MODEL, "draft": DRAFT,
       "n_predict": 200, "temperature": 0.0, "cases": {}}
for i, (eng, draft) in enumerate(CASES):
    port = 62511 + i
    args = [BIN[eng], "-m", MODEL, "-c", "4096", "--cache-type-k", "q8_0", "--cache-type-v", "q8_0", "--host", "127.0.0.1", "--port", str(port)]
    if draft == "draft":
        args += ["--model-draft", DRAFT, "--spec-type", "draft-simple"]
    rec = {"args": args, "status": "?"}
    t0 = time.time()
    proc = subprocess.Popen(args, stdout=open(f"qa/_x_srv_{eng}_{draft}.log", "wb"),
                            stderr=subprocess.STDOUT)
    try:
        up = False
        for _ in range(120):
            if proc.poll() is not None:
                raise RuntimeError("server exited early rc=%s" % proc.returncode)
            try:
                req(f"http://127.0.0.1:{port}/health", timeout=2); up = True; break
            except Exception:
                time.sleep(0.5)
        if not up:
            raise RuntimeError("health timeout")
        rec["rss_after_load_mb"] = rss_mb(proc.pid)
        r = req(f"http://127.0.0.1:{port}/completion",
                {"prompt": PROMPT, "n_predict": 200, "temperature": 0.0,
                 "top_p": 0.95, "cache_prompt": False}, timeout=300)
        t = r.get("timings") or {}
        acc = None
        try:
            an, dn = t.get("draft_n_accepted", t.get("n_accepted")), t.get("draft_n")
            if dn and float(dn) > 0:
                acc = round(float(an) / float(dn), 4)
        except Exception:
            pass
        rec.update({
            "ok": True, "wall_s": round(time.time() - t0, 1),
            "tokens_per_second": t.get("tokens_per_second") or t.get("predicted_per_second"),
            "predicted_n": t.get("predicted_n"),
            "acceptance": acc,
            "rss_peak_mb": rss_mb(proc.pid),
            "draft_n": t.get("draft_n"), "draft_n_accepted": t.get("draft_n_accepted"),
            "timings_keys": sorted(t.keys()),
        })
        if acc is None and draft == "draft":
            rec["timings_raw"] = t  # nessuna chiave nota -> grezzo, non inventato
    except Exception as e:
        rec["ok"] = False
        rec["error"] = str(e)[:500]
    finally:
        try:
            proc.terminate(); proc.wait(timeout=10)
        except Exception:
            try: proc.kill()
            except Exception: pass
        time.sleep(2)
    out["cases"][f"{eng}_{draft}"] = rec
    print(f"[{eng}_{draft}] ok={rec.get('ok')} tps={rec.get('tokens_per_second')} "
          f"acc={rec.get('acceptance')} rss={rec.get('rss_after_load_mb')}", flush=True)

# matrici derivate
def g(k, f):
    v = out["cases"].get(k) or {}
    return v.get(f)

out["derived"] = {
    "tg_up_off": g("up_off", "tokens_per_second"),
    "tg_up_draft": g("up_draft", "tokens_per_second"),
    "tg_xt_off": g("xt_off", "tokens_per_second"),
    "tg_xt_draft": g("xt_draft", "tokens_per_second"),
    "acc_up": g("up_draft", "acceptance"),
    "acc_xt": g("xt_draft", "acceptance"),
    "rss_up_mb": g("up_off", "rss_after_load_mb"),
    "rss_xt_mb": g("xt_off", "rss_after_load_mb"),
}
d = out["derived"]
def ratio(a, b):
    try: return round(float(a) / float(b), 3)
    except Exception: return None
d["speedup_up"] = ratio(d["tg_up_draft"], d["tg_up_off"])
d["speedup_xt"] = ratio(d["tg_xt_draft"], d["tg_xt_off"])
Path("qa/x3_draftbench.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
print("DERIVED", json.dumps(d), flush=True)


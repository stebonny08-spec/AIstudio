# -*- coding: utf-8 -*-
"""qa/_x_rssbase.py — RSS steady del BASE Spark-1.7B per motore (ctx4096 q8_0)."""
import json, subprocess, time, urllib.request, os
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent; os.chdir(ROOT)
BIN = {"up": r"tools\llama-server.exe", "xt": r"tools\llama-xhtoken\build\bin\llama-server.exe"}
MODEL = r"tools\models\spark-x2.6-1.7b.gguf"
def rss(pid):
    import psutil
    return round(psutil.Process(pid).memory_info().rss / 1048576, 1)
out = {}
for i, eng in enumerate(("up", "xt")):
    port = 62611 + i
    args = [BIN[eng], "-m", MODEL, "-c", "4096", "--cache-type-k", "q8_0",
            "--cache-type-v", "q8_0", "--host", "127.0.0.1", "--port", str(port)]
    p = subprocess.Popen(args, stdout=open(f"qa/_x_rssbase_{eng}.log", "wb"), stderr=subprocess.STDOUT)
    rec = {}
    try:
        for _ in range(120):
            if p.poll() is not None: raise RuntimeError("exit %s" % p.returncode)
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2); break
            except Exception: time.sleep(0.5)
        time.sleep(3)  # steady-state dopo load
        rec["rss_steady_mb"] = rss(p.pid)
        rec["ok"] = True
    except Exception as e:
        rec["ok"] = False; rec["error"] = str(e)[:300]
    finally:
        try: p.terminate(); p.wait(timeout=8)
        except Exception:
            try: p.kill()
            except Exception: pass
        time.sleep(2)
    out[eng] = rec
    print(eng, rec, flush=True)
Path("qa/x3_rssbase.json").write_text(json.dumps(out, indent=1), encoding="utf-8")

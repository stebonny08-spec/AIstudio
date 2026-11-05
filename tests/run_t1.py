# -*- coding: utf-8 -*-
"""tests/run_t1.py — runner T1 (baseline + regressione) per Round 13.

Esegue TUTTE le suite JS jsdom in tests/*.js (esclusi i patch_*) e tutte le
suite Python unittest tests/test*.py, somma pass/fail e scrive:
  - qa/t1_r13.json  (per-suite + totali + timestamp + build)
  - qa/t1_r13.log   (output completo)

Uso:  python tests/run_t1.py
Target R13: totali >= 2062 passati / 0 falliti.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

OUT_JSON = ROOT / "qa" / "t1_r13.json"
OUT_LOG = ROOT / "qa" / "t1_r13.log"
ENV = dict(os.environ)
ENV["PYTHONIOENCODING"] = "utf-8"
ENV.setdefault("PYTHONUTF8", "1")

RE_MAIN = re.compile(r"(\d+)\s*passati,\s*(\d+)\s*falliti")
RE_HOME = re.compile(r"RISULTATO[^\n]*?(\d+)\s*/\s*(\d+)\s*passati,\s*(\d+)\s*falliti")
RE_PASSLINE = re.compile(r"^\s*PASS\b", re.M)
RE_FAILLINE = re.compile(r"^\s*FAIL\b", re.M)
RE_PYTEST = re.compile(r"(\d+)\s+passed")

# Suite JS FUORI dalla baseline T1 (stessa esclusione del metodo R11/R12):
# runner "meta" che rilanciano altre suite (qaB1_fogli, qaD_blockD) e suite
# blocco con aspettative legacy note (qaF_block: pannello/toolbar pre-H11,
# qaV_blockv: punti 5.24/5.25 N/A + bug noto statC.toISOString del test).
# Restano eseguite e riportate in "js_extra", MAI nel totale del verdetto.
JS_EXTRA = {"qaB1_fogli.js", "qaD_blockD.js", "qaF_block.js", "qaV_blockv.js"}


def parse_js(out: str) -> tuple[int, int]:
    m = RE_HOME.search(out)
    if m:
        return int(m.group(2)), int(m.group(3))
    ms = list(RE_MAIN.finditer(out))
    if ms:
        return int(ms[-1].group(1)), int(ms[-1].group(2))
    return len(RE_PASSLINE.findall(out)), len(RE_FAILLINE.findall(out))


def run_js(log, only: frozenset = frozenset(),
           skip: frozenset = frozenset(JS_EXTRA)) -> list[dict]:
    results = []
    files = sorted(p for p in (ROOT / "tests").glob("*.js")
                   if not p.name.startswith("patch_") and not p.name.startswith("_")
                   and p.name not in skip
                   and (not only or p.name in only))
    for p in files:
        t0 = time.time()
        try:
            r = subprocess.run(["node", str(p)], cwd=str(ROOT), env=ENV,
                               capture_output=True, timeout=300,
                               encoding="utf-8", errors="replace")
            out = (r.stdout or "") + ("\n" + r.stderr if r.stderr else "")
            code = r.returncode
        except subprocess.TimeoutExpired as e:
            out = "TIMEOUT 300s\n" + ((e.stdout or b"").decode("utf-8", "replace")
                                      if isinstance(e.stdout, bytes) else (e.stdout or ""))
            code = -9
        pas, fal = parse_js(out)
        if code != 0 and fal == 0:
            fal = 1  # crash senza output interpretabile -> conta come 1 fallito
        results.append({"file": p.name, "pass": pas, "fail": fal,
                        "exit": code, "sec": round(time.time() - t0, 1)})
        log.write(f"\n===== {p.name} (exit={code}) =====\n{out}\n")
        log.flush()
        print(f"  {p.name:32s} {pas:5d}/{fal}", flush=True)
    return results


def run_py(log) -> list[dict]:
    results = []
    files = sorted((ROOT / "tests").glob("test*.py"))
    for p in files:
        t0 = time.time()
        try:
            r = subprocess.run([sys.executable, str(p)], cwd=str(ROOT), env=ENV,
                               capture_output=True, timeout=600,
                               encoding="utf-8", errors="replace")
            out = (r.stdout or "") + ("\n" + r.stderr if r.stderr else "")
            code = r.returncode
        except subprocess.TimeoutExpired as e:
            out = "TIMEOUT 600s"
            code = -9
        m = re.search(r"Ran (\d+) tests?", out)
        n = int(m.group(1)) if m else 0
        if n == 0 and code == 0:
            # Suite stile pytest (def test_* senza unittest.TestCase):
            # il run diretto termina 0 test -> fallback pytest dichiarato.
            try:
                r2 = subprocess.run(
                    [sys.executable, "-m", "pytest", str(p), "-q", "--no-header"],
                    cwd=str(ROOT), env=ENV, capture_output=True, timeout=600,
                    encoding="utf-8", errors="replace")
                out2 = (r2.stdout or "") + ("\n" + r2.stderr if r2.stderr else "")
                out += "\n--- pytest fallback ---\n" + out2
                m2 = RE_PYTEST.search(out2)
                if m2:
                    n = int(m2.group(1))
                    code = r2.returncode
            except Exception as e:
                out += "\npytest fallback errore: " + str(e)
        mf = re.search(r"FAILED \(.*?failures=(\d+)", out)
        me = re.search(r"FAILED \(.*?errors=(\d+)", out)
        fail = (int(mf.group(1)) if mf else 0) + (int(me.group(1)) if me else 0)
        if code != 0 and fail == 0:
            fail = 1
        results.append({"file": p.name, "tests": n, "fail": fail,
                        "exit": code, "sec": round(time.time() - t0, 1)})
        log.write(f"\n===== {p.name} (exit={code}) =====\n{out}\n")
        log.flush()
        print(f"  {p.name:32s} {n:5d}/{fail}", flush=True)
    return results


def main() -> int:
    build = None
    idx = (ROOT / "web_frontend" / "html" / "index.html").read_text(encoding="utf-8")
    m = re.search(r'var QA_TS = "([^"]+)"', idx)
    if m:
        build = m.group(1)
    print(f"BUILD QA_TS = {build}")
    with OUT_LOG.open("w", encoding="utf-8") as log:
        log.write(f"T1 run {time.strftime('%Y-%m-%dT%H:%M:%S')} build={build}\n")
        js = run_js(log)                                   # suite ufficiali (baseline)
        js_extra = run_js(log, only=frozenset(JS_EXTRA),   # meta-suite fuori baseline
                          skip=frozenset())
        py = run_py(log)
    js_pass = sum(r["pass"] for r in js)
    js_fail = sum(r["fail"] for r in js)
    py_pass = sum(r["tests"] for r in py)
    py_fail = sum(r["fail"] for r in py)
    total = js_pass + py_pass
    fails = js_fail + py_fail
    out = {
        "round": "13",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "build": build,
        "js": {"suites": len(js), "pass": js_pass, "fail": js_fail, "items": js},
        "js_extra_official_excluded": {
            "note": ("runner meta / suite blocco con aspettative legacy: esclusi dalla "
                     "baseline T1 con lo stesso metodo di R11/R12, eseguiti e riportati "
                     "a sola informativa (NON conteggiati nel verdetto)"),
            "suites": len(js_extra),
            "pass": sum(r["pass"] for r in js_extra),
            "fail": sum(r["fail"] for r in js_extra),
            "items": js_extra},
        "py": {"files": len(py), "pass": py_pass, "fail": py_fail, "items": py},
        "total_pass": total,
        "total_fail": fails,
        "target": ">=2062/0",
        "ok": fails == 0 and total >= 2062,
    }
    OUT_JSON.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nT1 TOTALE (baseline ufficiale): {total} passati / {fails} falliti "
          f"(JS {js_pass}/{js_fail} su {len(js)} suite, PY {py_pass}/{py_fail} su {len(py)} file)")
    ex = out["js_extra_official_excluded"]
    print(f"Meta-suite fuori baseline: {ex['pass']}/{ex['fail']} su {ex['suites']} suite "
          "(informativa, non conteggiata)")
    print("TARGET >=2062/0 -> " + ("OK" if out["ok"] else "NON RAGGIUNTO"))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

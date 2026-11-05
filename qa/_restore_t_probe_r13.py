# -*- coding: utf-8 -*-
"""qa/_restore_t_probe_r13.py — ripristina qa/t_probe_pywebview.json ai valori
R13 canonici (tent.6, REALI), dopo la riscrittura accidentale da parte della
sonda concorrente del blocco P (R15b, run 23:12, n=1, crash nativo llama.cpp).

Provenienza dei valori: qa/metrics_history.json round13.metrics.ttft_p50_ms/p95_ms
(95972.0 / 140964.1, scritti dal coordinatore R13 dallo stesso file) + campioni
raw registrati in qa/qa_r13_ttft_report.md (passo 8: m1=95972.0, m3=140964.1,
first_token " ok"). Nessun valore inventato: solo riscrittura documentata.
Il campo `restored_note` dichiara l'operazione.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "qa" / "t_probe_pywebview.json"

orig = {}
mp = ROOT / "qa" / "metrics_history.json"
hist = json.loads(mp.read_text(encoding="utf-8"))
r13 = [r for r in hist["rounds"] if str(r.get("round")) == "13"][0]
orig["p50_ms"] = r13["metrics"]["ttft_p50_ms"]
orig["p95_ms"] = r13["metrics"]["ttft_p95_ms"]
assert orig["p50_ms"] == 95972.0 and orig["p95_ms"] == 140964.1, orig

data = {
    "probe": "t13_ttft_pywebview",
    "round": "R13",
    "timestamp": "2026-10-24T17:05:45+0200",
    "method": ("evaluate_js -> window.pywebview.api.send_message(msg, null, 'solo_locale', "
               "false, null, '') + loop su window.pywebview.api.poll_stream(message_id, from_index) "
               "fino al PRIMO token; TTFT = performance.now() misurato nel browser da PRIMA "
               "dell'invocazione del bridge fino al primo token (end-to-end, JIT poll incluso)"),
    "poll_interval_js_ms": 25,
    "probe_mode_fe": "solo_locale",
    "model": "C:\\Users\\stebo\\AppData\\Roaming\\NovaStudio\\models\\MiniCPM5-2B-Q4_K_M.gguf",
    "llm_backend": "sidecar (da config, letta dall'app all'avvio)",
    "n": 2,
    "warmup_excluded": 1,
    "p50_ms": orig["p50_ms"],
    "p95_ms": orig["p95_ms"],
    "target_p50_ms": 2000,
    "target_hit": None,
    "raw_samples_ms": [95972.0, 140964.1],
    "samples_detail": [
        {"i": 1, "ttft_ms": 95972.0, "first_token": " ok"},
        {"i": 3, "ttft_ms": 140964.1, "first_token": " ok"},
    ],
    "hidden": True,
    "hidden_how": "create_window(hidden=True); window.hide() ha fallito: Main window failed to start",
    "blocked": None,
    "errors": ["misura 2 fallita: misura TTFT non completata entro 120s",
               "misura 4 interrotta: crash nativo 0xc0000005 ucrtbase.dll 17:11:20 (Event Log)"],
    "machine_load": {
        "declared": ("R13 tent.6: AMBIENTE NON-QUIET dichiarato nel json originale "
                     "(1 server orfano preesistente rilevato da env_scan) - vedi "
                     "qa/qa_r13_ttft_report.md passo 8"),
    },
    "restored_note": ("R15b: file riscritto il 2026-10-24T23:5x da qa/_restore_t_probe_r13.py "
                      "dopo sovrascrittura accidentale (sonda concorrente del blocco P alle 23:12, "
                      "n=1 con crash nativo). Valori REALI del run R13 tent.6 originali, "
                      "provenienza: qa/metrics_history.json round13 + qa/qa_r13_ttft_report.md "
                      "(passo 8). Nessun valore simulato."),
}
OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
print("t_probe_pywebview.json RIPRISTINATO: n=2 p50=%s p95=%s" % (data["p50_ms"], data["p95_ms"]))

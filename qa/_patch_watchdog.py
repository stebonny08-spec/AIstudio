# qa/_patch_watchdog.py — fix watchdog hang sonda TTFT (tent.3, coordinatore R13)
# Sostituisce il blocco _watchdog con versione hard-exit (json + os._exit).
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / "tests" / "t13_ttft_pywebview.py"
src = P.read_text(encoding="utf-8")

start = src.find("        # watchdog: se il worker non chiude la finestra")
end_anchor = "        watchdog = threading.Thread(target=_watchdog, daemon=True)\n        watchdog.start()"
end = src.find(end_anchor)
if start < 0 or end < 0:
    print("ANCHOR NON TROVATI start=%s end=%s" % (start, end))
    sys.exit(1)
if "os._exit(2)" in src[start:end]:
    print("GIÀ PATCHTATO")
    sys.exit(0)

NEW = '''        # watchdog: se il worker non chiude la finestra -> destroy forzato
        # FIX (coordinatore R13, tent.3): il tent.2 e' impallato perche'
        # win.destroy() su finestra hidden NON fa tornare webview.start()
        # -> processo vivo indefinitamente. Ora: dopo destroy, se entro 15s
        # il worker non ha chiuso, il watchdog scrive lui stesso il JSON e
        # esce con os._exit (mai piu' processi appesi).
        def _watchdog():
            if not res.done.wait(HARD_TIMEOUT):
                res.err("watchdog %ss scattato: destroy forzato" % HARD_TIMEOUT)
                try:
                    win.destroy()
                except Exception:
                    pass
                time.sleep(15)
                if not res.done.is_set():
                    res.err("watchdog: webview.start() non e' tornato -> "
                            "uscita forzata con scrittura JSON dal watchdog")
                    try:
                        shutdown_sidecar()
                        kill_orphan_children(children_before_main)
                        res.data["cleanup"]["llama_server_shutdown"] = True
                    except Exception as e:
                        res.err("watchdog cleanup: %s" % e)
                    res.data["blocked"] = res.data.get("blocked") or {
                        "step": "watchdog globale",
                        "reason": ("run non completato entro %ss (hang noto: "
                                   "webview.start() non torna dopo destroy su "
                                   "finestra hidden)" % HARD_TIMEOUT),
                        "manual_procedure": (
                            "ririlanciare la sonda; se si ripete, eseguire la "
                            "sonda con finestra visibile impostando "
                            "PROBE_VISIBLE=1 nell'ambiente."),
                    }
                    try:
                        OUT_JSON.write_text(
                            json.dumps(res.data, indent=2,
                                       ensure_ascii=False),
                            encoding="utf-8")
                    except Exception:
                        pass
                    os._exit(2)
'''
out = src[:start] + NEW + src[end:]
P.write_text(out, encoding="utf-8")
print("PATCH APPLICTO (%d -> %d char)" % (len(src), len(out)))

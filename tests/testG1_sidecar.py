"""Test G1 - sidecar REALE (llama-server.exe) + fallback in-process (T2 Round 12).

Requisiti verificati (skip se tools/llama-server.exe o il modello gguf assente):
  (a) avvio reale: start_on_demand() -> 'up', health TCP/HTTP ok, tempo cold;
      3 completion reali via SidecarClient.complete (profile+classe).
  (b) idle-unload: con llama.idle_unload_sec=8 (iniettato a runtime sul dict
      config, letto live dal monitor) -> stato 'down', porta None entro ~15s.
  (c) fallback in-process: singleton avvelenato con server_path='' ->
      SidecarClient solleva AiUnavailable -> LocalLLMClient.stream_via_sidecar
      cade sulla strada in-process e ritorna testo reale (mai eccezione cruda).

I test esistenti testH2_queue.py / testH2_server.py restano INVIOLATI.
"""

import functools
import os
import sys
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.sidecar import SidecarClient, SidecarServer  # noqa: E402
from core.sidecar.server import get_server  # noqa: E402
from data.config_manager import ConfigManager  # noqa: E402

EXE = os.path.join(ROOT, "tools", "llama-server.exe")
MODEL = os.path.expandvars(
    r"%APPDATA%\NovaStudio\models\MiniCPM5-2B-Q4_K_M.gguf"
)
HAVE = os.path.isfile(EXE) and os.path.isfile(MODEL)
SKIP_MSG = "binario llama-server.exe o modello gguf assente"

# --------------------------------------------------------------- R3.4
# Quarantena del flaky noto "completion 3 vuota" (flaky confermato in
# qa/r22_models_report.md sezioni 9/10: run singola OK, poi FAIL, poi OK,
# poi FAIL; baseline R24: OK/OK/FAIL su 3 run). Retry policy DICHIARATA:
# max 2 rerun per test flaky con log esplicito in stdout
#   [flake-retry] test=<nome> attempt=<k>/2 motivo=<motivo> | errore: <exc>
# se dopo i 2 retry fallisce ancora -> FAIL vero (nessun silenzio).
# Applicato SOLO ai test noti flaky (FLAKY_TESTS): gli altri test di
# questo modulo NON hanno retry (nessuna latenza nascosta).
FLAKE_RETRY_MAX = 2   # rerun massimi (3 tentativi totali)

FLAKY_TESTS = {
    "test_a_avvio_reale_e_3_completion":
        "completion 3 vuota (flaky prevalente in run di batch: "
        "qa/r22_models_report.md sezioni 9 e 10.1)",
}


def flake_retry(fn):
    """Wrapper retry per i soli test flaky dichiarati in FLAKY_TESTS.

    Per ogni rerun stampa in stdout la riga
      [flake-retry] test=<nome> attempt=<k>/2 motivo=<motivo> | errore: ...
    Dopo FLAKE_RETRY_MAX rerun falliti l'eccezione originale viene
    rilanciata (FAIL vero, nessun silenzio). fn invariata se il test non
    e' in FLAKY_TESTS."""
    name = fn.__name__
    if name not in FLAKY_TESTS:
        return fn
    motivo = FLAKY_TESTS[name]

    @functools.wraps(fn)
    def _wrapper(self, *args, **kwargs):
        last = None
        for attempt in range(FLAKE_RETRY_MAX + 1):   # 0 = run iniziale
            try:
                return fn(self, *args, **kwargs)
            except unittest.SkipTest:
                raise           # uno skip NON e' un flake: mai ritentato
            except Exception as exc:   # noqa: BLE001 - retry dichiarato
                last = exc
                if attempt >= FLAKE_RETRY_MAX:
                    break
                print("[flake-retry] test=%s attempt=%d/%d motivo=%s | "
                      "errore: %s" % (name, attempt + 1, FLAKE_RETRY_MAX,
                                      motivo, exc), flush=True)
        raise last

    return _wrapper


def _cfg(idle=300):
    return {
        "llama.server_path": EXE,
        "llama.model_path": MODEL,
        "llama.n_ctx": 4096,
        "llama.idle_unload_sec": idle,
    }


@unittest.skipUnless(HAVE, SKIP_MSG)
class TestSidecarReale(unittest.TestCase):
    """(a)+(b) server vero: avvio, 3 completion, idle-unload 8s."""

    @flake_retry   # R3.4: solo test in FLAKY_TESTS
    def test_a_avvio_reale_e_3_completion(self):
        srv = SidecarServer(config=_cfg())
        try:
            t0 = time.perf_counter()
            ok = srv.start_on_demand()
            load_sec = round(time.perf_counter() - t0, 2)
            self.assertTrue(ok, srv.status())
            self.assertEqual(srv.status()["state"], "up")
            self.assertTrue(srv.health())
            print("[G1] cold load reale: %.2fs (target <=3.0s)" % load_sec)

            # timeout esplicito: a ~10 tok/s una completion puo' superare
            # gli 8s di default del client (CONNECTION_TIMEOUT)
            client = SidecarClient(server=srv, auto_start=True, timeout=180)
            casi = [
                ("Rispondi con una sola parola: ciao", "fast"),
                ('Rispondi SOLO con JSON: {"ok":true}', "tool"),
                ("Quanto fa 2+2? Rispondi con il solo numero.", "fast"),
            ]
            for i, (prompt, prof) in enumerate(casi, 1):
                t1 = time.perf_counter()
                txt = client.complete(prompt, profile=prof, classe="micro")
                el = round(time.perf_counter() - t1, 2)
                self.assertIsInstance(txt, str)
                self.assertTrue(txt.strip(), "completion %d vuota" % i)
                print("[G1] completion %d/%d (%s): %d char in %.2fs"
                      % (i, len(casi), prof, len(txt), el))
        finally:
            srv.shutdown()

    def test_b_idle_unload_8s(self):
        srv = SidecarServer(config=_cfg(idle=300))  # parte con 300 per il req
        try:
            self.assertTrue(srv.start_on_demand(), srv.status())
            client = SidecarClient(server=srv, auto_start=True)
            txt = client.complete('Rispondi SOLO con JSON: {"ok":true}',
                                  profile="tool", classe="micro")
            self.assertTrue(txt.strip())
            # iniezione runtime: il monitor rilegge la chiave ad ogni tick
            srv_config = srv._config
            srv_config["llama.idle_unload_sec"] = 8
            srv.touch_job()
            t0 = time.perf_counter()
            deadline = time.time() + 15.0
            while time.time() < deadline:
                if srv.status()["state"] == "down" and not srv.health():
                    break
                time.sleep(0.3)
            unload_sec = round(time.perf_counter() - t0, 2)
            self.assertEqual(srv.status()["state"], "down")
            self.assertFalse(srv.health())
            self.assertIsNone(srv.port)
            print("[G1] idle-unload con 8s: verificato in %.2fs" % unload_sec)
        finally:
            srv.shutdown()


@unittest.skipUnless(HAVE, SKIP_MSG)
class TestFallbackInProcess(unittest.TestCase):
    """(c) server_path='' -> AiUnavailable -> fallback in-process reale."""

    def test_c_fallback_inprocess_funziona(self):
        # avveleno il singleton: nessun tentativo di avviare il binario
        get_server({
            "llama.server_path": "",
            "llama.model_path": MODEL,
            "llama.n_ctx": 4096,
            "llama.idle_unload_sec": 300,
        })
        try:
            from core.local_llm_client import LocalLLMClient

            client = LocalLLMClient(model_path=MODEL, n_ctx=4096,
                                    n_gpu_layers=-1)
            t0 = time.perf_counter()
            out = client.generated_via_sidecar(
                "Rispondi esattamente e solo con la parola: OK"
            )
            el = round(time.perf_counter() - t0, 2)
            self.assertIsInstance(out, str)
            self.assertTrue(out.strip(), "fallback in-process vuoto")
            print("[G1] fallback in-process ok: %d char in %.2fs"
                  % (len(out), el))
        finally:
            get_server(ConfigManager())  # ripristino singleton con config reale


if __name__ == "__main__":
    unittest.main(verbosity=2)

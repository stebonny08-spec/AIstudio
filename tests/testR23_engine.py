"""Test R23/X5 - Switch runtime duale engine + fallback (unittest, NESSUN binario reale).

Copre:
  X5.1 risoluzione engine: upstream / xhtoken / auto / invalido / assente,
       percorsi binario relativi alla root progetto, precedenza
       llama.server_path esplicito;
  X3.4 flag manuale: engine forzato batte l'auto-regola R23;
  X5.3 fallback xhtoken -> upstream: binario mancante, avvio KO (Popen),
       crash ripetuto (>=2 consecutivi, criterio dichiarato), flag runtime
       una tantum + reset, message + log '[Sidecar] engine xhtoken KO ->',
       mai eccezione che uccide la coda;
  X5.2 switch engine con restart controllato R22 (logica esistente).

Mock coerente col resto della suite: subprocess.Popen -> processo finto,
_http_ready -> True, llama.server/model = file finti (nessun lancio reale).
"""

import contextlib
import io
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.sidecar import SidecarServer  # noqa: E402
from core.sidecar import server as server_mod  # noqa: E402

UP_BIN = os.path.join(ROOT, "tools", "llama-server.exe")
XT_BIN = os.path.join(ROOT, "tools", "llama-xhtoken", "build", "bin",
                      "llama-server.exe")
GHOST = os.path.join(ROOT, "server_fantasma_r23.exe")
R23_LOG = ("[Sidecar] engine auto -> upstream (regola R23: speedup xt 1.24 "
           "< 1.30, qa/x3_compare.json)")
KO_LOG = "[Sidecar] engine xhtoken KO -> upstream:"


class _FakeProc:
    """Processo finto con la stessa interfaccia minima di subprocess.Popen."""

    def __init__(self, dead=False):
        self.pid = 4242
        self.returncode = None
        self._dead = dead
        self.terminated = False

    def poll(self):
        return 1 if self._dead else None

    def terminate(self):
        self.terminated = True

    def kill(self):
        pass

    def wait(self, timeout=None):
        return 1 if self._dead else 0


def _mk_model():
    """File modello finto esistente (temporaneo)."""
    fd, path = tempfile.mkstemp(suffix=".gguf", prefix="r23_fake_model_")
    os.close(fd)
    return path


# ------------------------------------------------- X5.1 / X3.4 / X5.4
class TestRisoluzioneEngine(unittest.TestCase):
    """_resolve_engine: (engine, binario) attesi per ogni valore di config."""

    def _resolve(self, cfg):
        srv = SidecarServer(config=cfg)
        self.addCleanup(srv.shutdown)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            eng, path = srv._resolve_engine()
        return eng, path, buf.getvalue()

    def test_upstream_forzato(self):
        eng, path, log = self._resolve({"llama.engine": "upstream"})
        self.assertEqual(eng, "upstream")
        self.assertEqual(path, UP_BIN)
        self.assertTrue(os.path.isabs(path))
        self.assertIn("engine forzato -> upstream", log)

    def test_xhtoken_forzato(self):
        eng, path, log = self._resolve({"llama.engine": "xhtoken"})
        self.assertEqual(eng, "xhtoken")
        self.assertEqual(path, XT_BIN)
        self.assertNotEqual(path, UP_BIN)
        self.assertIn("engine forzato -> xhtoken", log)

    def test_auto_default_regola_r23(self):
        # nessuna chiave llama.engine -> auto -> regola R23 = upstream
        eng, path, log = self._resolve({})
        self.assertEqual(eng, "upstream")
        self.assertEqual(path, UP_BIN)
        self.assertIn(R23_LOG, log)

    def test_engine_assente_server_path_esplicito(self):
        # llama.engine assente -> auto, ma llama.server_path esplicito vince
        eng, path, log = self._resolve({"llama.server_path": GHOST})
        self.assertEqual(eng, "upstream")
        self.assertEqual(path, GHOST)

    def test_server_path_esplicito_precede_auto(self):
        eng, path, log = self._resolve({"llama.engine": "auto",
                                        "llama.server_path": GHOST})
        self.assertEqual(eng, "upstream")
        self.assertEqual(path, GHOST)
        self.assertIn(R23_LOG, log)  # log della regola comunque esplicito

    def test_engine_invalido_ignorato(self):
        eng, path, log = self._resolve({"llama.engine": "turbo"})
        self.assertEqual(eng, "upstream")
        self.assertEqual(path, UP_BIN)
        self.assertIn("non valido", log)
        self.assertIn("-> auto", log)

    def test_xhtoken_forzato_prevale_su_server_path(self):
        # X3.4: il motore forzato deve davvero battere la config esistente
        eng, path, log = self._resolve({"llama.engine": "xhtoken",
                                        "llama.server_path": GHOST})
        self.assertEqual(eng, "xhtoken")
        self.assertEqual(path, XT_BIN)

    def test_upstream_forzato_usa_server_path(self):
        eng, path, log = self._resolve({"llama.engine": "upstream",
                                        "llama.server_path": GHOST})
        self.assertEqual(eng, "upstream")
        self.assertEqual(path, GHOST)

    def test_binari_relativi_alla_root_esistenti(self):
        # fork XHToken buildato + binario upstream: entrambi autonomi
        self.assertEqual(server_mod.ENGINE_BINARIES["upstream"], UP_BIN)
        self.assertEqual(server_mod.ENGINE_BINARIES["xhtoken"], XT_BIN)
        self.assertTrue(os.path.exists(UP_BIN))
        self.assertTrue(os.path.exists(XT_BIN))


# ----------------------------------------------------------- X5.3
class TestFallback(unittest.TestCase):
    """Fallback xhtoken -> upstream: message + log, flag una tantum, no eccezioni."""

    def test_binario_mancante_fallback_all_avvio(self):
        model = _mk_model()
        self.addCleanup(lambda: os.path.exists(model) and os.remove(model))
        srv = SidecarServer(config={"llama.engine": "xhtoken",
                                    "llama.model_path": model})
        self.addCleanup(srv.shutdown)
        fake = _FakeProc()
        buf = io.StringIO()
        with mock.patch.dict(server_mod.ENGINE_BINARIES,
                             {"xhtoken": GHOST}), \
             mock.patch.object(server_mod.subprocess, "Popen",
                               return_value=fake) as popen, \
             mock.patch.object(srv, "_http_ready", return_value=True), \
             contextlib.redirect_stdout(buf):
            ok = srv.start_on_demand()
        out = buf.getvalue()
        self.assertTrue(ok, out)
        self.assertEqual(srv.status()["state"], "up")
        self.assertEqual(srv.status()["engine"], "upstream")
        self.assertIn(KO_LOG, out)
        self.assertIn("binario xhtoken mancante", out)
        self.assertIn("ripiego su upstream", srv.message)
        # Popen chiamato SOLO con il binario upstream (nessun retry xhtoken)
        self.assertEqual(popen.call_count, 1)
        self.assertEqual(popen.call_args[0][0][0], UP_BIN)
        eng, path = srv._resolve_engine()
        self.assertEqual(eng, "upstream")
        self.assertEqual(path, UP_BIN)

    def test_avvio_ko_fallback_e_retry_upstream(self):
        model = _mk_model()
        self.addCleanup(lambda: os.path.exists(model) and os.remove(model))
        srv = SidecarServer(config={"llama.engine": "xhtoken",
                                    "llama.model_path": model})
        self.addCleanup(srv.shutdown)
        fake = _FakeProc()
        buf = io.StringIO()
        with mock.patch.object(server_mod.subprocess, "Popen",
                               side_effect=[OSError("busy"), fake]) as popen, \
             mock.patch.object(srv, "_http_ready", return_value=True), \
             contextlib.redirect_stdout(buf):
            ok = srv.start_on_demand()
        out = buf.getvalue()
        self.assertTrue(ok, out)
        self.assertEqual(popen.call_count, 2)
        self.assertEqual(popen.call_args_list[0][0][0][0], XT_BIN)  # 1°: xhtoken
        self.assertEqual(popen.call_args_list[1][0][0][0], UP_BIN)  # retry: upstream
        self.assertIn(KO_LOG, out)
        self.assertIn("avvio fallito: busy", out)
        self.assertIn("ripiego su upstream", srv.message)
        self.assertEqual(srv.status()["engine"], "upstream")

    def test_ko_senza_eccezione(self):
        # xhtoken mancante + Popen KO -> False, stato down, ZERO eccezioni
        model = _mk_model()
        self.addCleanup(lambda: os.path.exists(model) and os.remove(model))
        srv = SidecarServer(config={"llama.engine": "xhtoken",
                                    "llama.model_path": model})
        self.addCleanup(srv.shutdown)
        buf = io.StringIO()
        with mock.patch.dict(server_mod.ENGINE_BINARIES,
                             {"xhtoken": GHOST}), \
             mock.patch.object(server_mod.subprocess, "Popen",
                               side_effect=OSError("simulato")), \
             contextlib.redirect_stdout(buf):
            ok = srv.start_on_demand()      # mai eccezione
        self.assertIs(ok, False)
        self.assertEqual(srv.status()["state"], "down")
        self.assertIn(KO_LOG, buf.getvalue())

    def test_crash_ripetuto_fallback_dopo_due(self):
        # criterio dichiarato: >=2 crash consecutivi dello stesso motore
        # xhtoken (nessun avvio riuscito intermedio) -> fallback
        srv = SidecarServer(config={"llama.engine": "xhtoken"})
        self.addCleanup(srv.shutdown)
        restarts = []
        srv._restart_safe = lambda: restarts.append(True)  # nessun restart reale
        buf = io.StringIO()

        def _inietta(proc, state):
            with srv._lock:
                srv._proc = proc
                srv._state = state
                srv._port = 12345
                srv._launched_engine = "xhtoken"
                srv._launched_server_path = XT_BIN

        with contextlib.redirect_stdout(buf):
            p1 = _FakeProc(dead=True)
            _inietta(p1, "starting")
            srv._on_crash(p1, "exit 1")
            self.assertFalse(srv._xhtoken_fallback)   # 1 crash: ancora no
            p2 = _FakeProc(dead=True)
            _inietta(p2, "up")
            srv._on_crash(p2, "exit 1")               # 2° crash -> fallback
        out = buf.getvalue()
        self.assertTrue(srv._xhtoken_fallback)
        self.assertEqual(srv._xhtoken_crashes, 2)
        self.assertEqual(srv.status()["state"], "down")
        self.assertIn("ripiego su upstream", srv.message)
        self.assertIn(KO_LOG, out)
        self.assertIn("2 crash consecutivi xhtoken", out)
        # nessun retry xhtoken nel run corrente...
        buf2 = io.StringIO()
        with contextlib.redirect_stdout(buf2):
            eng, path = srv._resolve_engine()
        self.assertEqual(eng, "upstream")
        self.assertIn("non riprovato", buf2.getvalue())
        # ...ma il restart e' stato comunque programmato (la coda vive)
        deadline = time.time() + 2.0
        while time.time() < deadline and not restarts:
            time.sleep(0.05)
        self.assertGreaterEqual(len(restarts), 1)

    def test_fallback_idempotente_e_reset(self):
        srv = SidecarServer(config={"llama.engine": "xhtoken"})
        self.addCleanup(srv.shutdown)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            srv._trigger_fallback("motivo uno")
            srv._trigger_fallback("motivo due")   # gia' ripiegato: ignorato
        out = buf.getvalue()
        self.assertEqual(out.count(KO_LOG), 1)    # log una sola volta
        self.assertIn("motivo uno", srv.message)
        self.assertNotIn("motivo due", srv.message)
        self.assertTrue(srv._xhtoken_fallback)
        # reset(): il prossimo avvio sidecar puo' riprovare xhtoken (X5.3)
        with contextlib.redirect_stdout(io.StringIO()):
            srv.reset()
            eng, path = srv._resolve_engine()
        self.assertEqual(eng, "xhtoken")
        self.assertEqual(path, XT_BIN)
        self.assertEqual(srv.status()["xhtoken_fallback"], False)


# ----------------------------------------------------------- X5.2
class TestSwitchEngineRestart(unittest.TestCase):
    """Cambio engine -> restart controllato R22 (stato preservato, no crash)."""

    def test_switch_upstream_a_xhtoken_restart(self):
        model = _mk_model()
        self.addCleanup(lambda: os.path.exists(model) and os.remove(model))
        srv = SidecarServer(config={"llama.engine": "xhtoken",
                                    "llama.model_path": model,
                                    "llama.n_ctx": 4096})
        self.addCleanup(srv.shutdown)
        old = mock.MagicMock()          # processo "vecchio" finto (stile R22)
        old.poll.return_value = None
        srv._proc = old
        srv._state = "up"
        srv._port = 12345
        srv._launched_model = model
        srv._launched_engine = "upstream"
        srv._launched_server_path = UP_BIN
        fake = _FakeProc()
        buf = io.StringIO()
        with mock.patch.object(server_mod.subprocess, "Popen",
                               return_value=fake) as popen, \
             mock.patch.object(srv, "_http_ready", return_value=True), \
             contextlib.redirect_stdout(buf):
            ok = srv.start_on_demand()
        out = buf.getvalue()
        self.assertTrue(ok, out)
        old.terminate.assert_called_once()          # restart controllato R22
        self.assertEqual(popen.call_args[0][0][0], XT_BIN)  # nuovo motore
        self.assertEqual(srv.status()["engine"], "xhtoken")
        self.assertEqual(srv.status()["state"], "up")

    def test_stesso_engine_nessun_restart(self):
        model = _mk_model()
        self.addCleanup(lambda: os.path.exists(model) and os.remove(model))
        srv = SidecarServer(config={"llama.engine": "xhtoken",
                                    "llama.model_path": model})
        self.addCleanup(srv.shutdown)
        old = mock.MagicMock()
        old.poll.return_value = None
        srv._proc = old
        srv._state = "up"
        srv._port = 12345
        srv._launched_model = model
        srv._launched_engine = "xhtoken"
        srv._launched_server_path = XT_BIN
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            ok = srv.start_on_demand()   # nessun cambio -> nessun riavvio
        self.assertTrue(ok, buf.getvalue())
        old.terminate.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)

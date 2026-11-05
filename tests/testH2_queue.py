"""Test H2 - CodaPriorita (unittest stdlib, 5 test)."""

import importlib.util
import os
import sys
import threading
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

try:
    from core.sidecar import CodaPriorita
except Exception:  # fallback: import diretto del modulo (niente dipendenze)
    _qpath = os.path.join(ROOT, "core", "sidecar", "queue.py")
    _spec = importlib.util.spec_from_file_location("_h2_sidecar_queue", _qpath)
    _mod = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    CodaPriorita = _mod.CodaPriorita


def _attende(cond, timeout=5.0):
    """Polling fino a cond() True o timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cond():
            return True
        time.sleep(0.01)
    return False


class _Blocker:
    """Callback che segnala l'avvio e resta in attesa del rilascio."""

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()

    def __call__(self, payload):
        self.started.set()
        self.release.wait(5.0)


class TestCodaPriorita(unittest.TestCase):

    # (a) ordine di servizio su submit(2),(2),(0),(1) = 0,1,2,2
    def test_a_ordine_servizio(self):
        coda = CodaPriorita()
        eseguiti = []
        blocker = _Blocker()
        coda.submit("block", prio=0, callback=blocker)
        self.assertTrue(_attende(lambda: coda.stato()["running"]))
        for p in (2, 2, 0, 1):
            coda.submit(p, prio=p, callback=lambda payload: eseguiti.append(payload))
        blocker.release.set()
        self.assertTrue(_attende(lambda: len(eseguiti) == 4))
        self.assertEqual(eseguiti, [0, 1, 2, 2])
        coda.stop()

    # (b) prio2 non parte se ci sono pending prio<=1
    def test_b_prio2_non_parte_con_pending_prio_basse(self):
        coda = CodaPriorita()
        b0 = _Blocker()
        b1 = _Blocker()
        started2 = threading.Event()
        coda.submit("p0", prio=0, callback=b0)
        self.assertTrue(_attende(lambda: coda.stato()["running"]))
        coda.submit("p1", prio=1, callback=b1)
        coda.submit("p2", prio=2, callback=lambda _: started2.set())
        self.assertEqual(coda.stato()["queued"], 2)
        b0.release.set()
        # worker passa a prio1 (non a prio2)
        self.assertTrue(_attende(lambda: b1.started.is_set()))
        self.assertFalse(started2.is_set())
        self.assertEqual(coda.stato()["queued"], 1)
        self.assertEqual(coda.stato()["by_priority"], {0: 0, 1: 0, 2: 1})
        # liberato prio1, finalmente parte prio2
        b1.release.set()
        self.assertTrue(_attende(lambda: started2.is_set()))
        coda.stop()

    # (c) submit dopo stop -> RuntimeError('AI non disponibile')
    def test_c_submit_dopo_stop(self):
        coda = CodaPriorita()
        coda.submit("x", prio=0)
        coda.stop()
        with self.assertRaises(RuntimeError) as ctx:
            coda.submit("y", prio=0)
        self.assertEqual(str(ctx.exception), "AI non disponibile")

    # (d) stato() conta correttamente
    def test_d_stato(self):
        coda = CodaPriorita()
        self.assertEqual(coda.stato(),
                         {"running": False, "queued": 0,
                          "by_priority": {0: 0, 1: 0, 2: 0}})
        blocker = _Blocker()
        coda.submit("run", prio=0, callback=blocker)
        self.assertTrue(_attende(lambda: coda.stato()["running"]))
        coda.submit("a", prio=0)
        coda.submit("b", prio=1)
        coda.submit("c", prio=2)
        coda.submit("d", prio=2)
        st = coda.stato()
        self.assertTrue(st["running"])
        self.assertEqual(st["queued"], 4)
        self.assertEqual(st["by_priority"], {0: 1, 1: 1, 2: 2})
        blocker.release.set()
        self.assertTrue(_attende(lambda: coda.stato()["queued"] == 0))
        coda.stop()

    # (e) FIFO a parita': 3 job stessa prio eseguiti in ordine
    def test_e_fifo_parita(self):
        coda = CodaPriorita()
        eseguiti = []
        blocker = _Blocker()
        coda.submit("block", prio=1, callback=blocker)
        self.assertTrue(_attende(lambda: coda.stato()["running"]))
        for nome in ("j1", "j2", "j3"):
            coda.submit(nome, prio=1, callback=lambda payload: eseguiti.append(payload))
        blocker.release.set()
        self.assertTrue(_attende(lambda: len(eseguiti) == 3))
        self.assertEqual(eseguiti, ["j1", "j2", "j3"])
        coda.stop()


if __name__ == "__main__":
    unittest.main(verbosity=2)

# -*- coding: utf-8 -*-
"""Test G4 - streaming + cancellazione (unittest stdlib + sidecar FINTO).

Copre 4.3 (logico; la parte REALE e' in tests/t2a_ttft.py -> qa/g4_measures.json):
  (a) SidecarClient su server SSE FINTO infinito (thread/socket, stile
      testH2_server): stop_event dopo 3 pezzi -> il loop si interrompe,
      il generatore viene chiuso (resp.close in _iter_stream) e una
      richiesta SUCCESSIVA sullo stesso server funziona -> slot connessione
      rilasciato.
  (b) backend.api.StudioIAAPI._run_generation con router FINTO (token
      infiniti): stop_event dopo 3 pezzi -> loop interrotto,
      generator.close() chiamato, stopped=True, generation_active=False,
      s["queue"]=None -> slot coda rilasciato.
  (c) dopo lo stop una NUOVA generazione sullo stesso stream/conversazione
      funziona (slot effettivamente libero).
  (d) StudioIAAPI.stop_generation() imposta l'event delo stream.

DOVE stop_event viene controllato (verifica 4.3, letto nei sorgenti):
  - backend/api.py::_run_generation  (inizio di ogni evento del loop,
    ~riga 624: if stop_event.is_set(): generator.close(); break)
  - core/local_llm_client.py::stream_via_sidecar (~riga 748) e
    generate_stream (~riga 629): break sul pezzo successivo
  - core/sidecar/client.py::SidecarClient.complete/stream: NESSUN controllo
    stop_event -> la cancellazione lato sidecar avviene chiudendo il
    generatore (resp.close() nel finally di _iter_stream)

Esecuzione: python tests/testG4_stream.py
"""

from __future__ import annotations

import os
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.sidecar import SidecarClient  # noqa: E402


# ---------------------------------------------------------------------------
# (a) Server SSE FINTO infinito (thread + socket, stdlib)
# ---------------------------------------------------------------------------

class _InfiniteSSEHandler(BaseHTTPRequestHandler):
    """POST /completion -> SSE infinito fino a disconnessione del client."""

    protocol_version = "HTTP/1.0"  # EOF = fine stream: il client legge finche' c'e'

    def do_POST(self):  # noqa: N802 (API http.server)
        try:
            self.server.requests = getattr(self.server, "requests", 0) + 1
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            i = 0
            while True:
                i += 1
                self.wfile.write(b'data: {"content": "p%03d "}\n\n' % i)
                self.wfile.flush()
                time.sleep(0.004)
        except Exception:
            # client disconnesso (generator.close) -> handler esce, slot libero
            pass

    def log_message(self, *args):  # silenzioso
        pass


def _start_fake_sse_server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _InfiniteSSEHandler)
    srv.requests = 0
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, srv.server_address[1]


# ---------------------------------------------------------------------------
# Router/DB finti per backend.api.StudioIAAPI._run_generation
# ---------------------------------------------------------------------------

class _FakeRouter:
    """process_query_stream che yieda token infiniti (mai EOS)."""

    def __init__(self, stop_after=3):
        self.stop_after = stop_after
        self.yielded = 0
        self.closed = False

    def process_query_stream(self, message, **kwargs):
        stop_event = kwargs.get("stop_event")
        i = 0
        try:
            while i < 100000:
                i += 1
                self.yielded = i
                yield {"type": "token", "text": "tok%d " % i}
                # "stop esterno" simulato: arrivati 3 pezzi generati, chiulo'
                if i == self.stop_after and stop_event is not None:
                    stop_event.set()
        finally:
            self.closed = True  # generator.close() -> GeneratorExit -> qui


class _FakeDB:
    def __init__(self):
        self.saved = []

    def get_messages(self, conversation_id):
        return []

    def add_message(self, conversation_id, ruolo, testo, fonte=None, **kw):
        self.saved.append((conversation_id, ruolo, testo))


def _make_api(router):
    """StudioIAAPI senza __init__ (nessun thread/DB/reale), solo attributi usati."""
    from backend.api import StudioIAAPI

    api = StudioIAAPI.__new__(StudioIAAPI)
    api.llm_client = object()  # truthy: evita il ramo "Nessun modello attivo"
    api._streams_lock = threading.Lock()
    api._streams = {}
    api.router = router
    api.db = _FakeDB()
    return api


def _stream_entry(conversation_id=1):
    """Stessa struttura che send_message inserisce in self._streams."""
    return {
        "tokens": [],
        "done": False,
        "source": "nessuna",
        "error": None,
        "stop_event": threading.Event(),
        "conversation_id": conversation_id,
        "stopped": False,
        "no_save": False,
        "generation_active": True,
        "waiting_continue": False,
        "queue": None,
        "topic": "",
    }


class TestSidecarStopFinto(unittest.TestCase):
    """(a) stream SSE infinito + stop_event dopo 3 pezzi -> loop interrotto."""

    @classmethod
    def setUpClass(cls):
        cls.srv, cls.port = _start_fake_sse_server()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def test_stop_dopo_3_pezzi_e_slot_rilasciato(self):
        client = SidecarClient(port=self.port, auto_start=False, timeout=10)
        stop_event = threading.Event()

        # struttura IDENTICA al loop di api._run_generation:
        # check stop in cima a ogni evento, set dopo il 3° pezzo
        n = 0
        gen = client.complete("ciao", profile="fast", classe="micro",
                              stream=True)
        for _piece in gen:
            if stop_event.is_set():
                try:
                    gen.close()
                except Exception:
                    pass
                break
            n += 1
            if n == 3:
                stop_event.set()

        self.assertTrue(stop_event.is_set())
        self.assertEqual(n, 3, "lo stop deve interrompere dopo ~3 pezzi")
        self.assertIsNone(gen.gi_frame, "generatore non chiuso")

        # slot connessione rilasciato: una richiesta SUCCESSIVA funziona
        reqs_before = self.srv.requests
        gen2 = client.complete("ciao2", profile="fast", classe="micro",
                               stream=True)
        m = 0
        for _piece in gen2:
            m += 1
            if m >= 2:
                try:
                    gen2.close()
                except Exception:
                    pass
                break
        self.assertGreaterEqual(m, 2, "seconda richiesta fallita")
        self.assertGreater(self.srv.requests, reqs_before,
                           "il server non ha servito la richiesta successiva")
        self.assertIsNone(gen2.gi_frame)


class TestApiStopLogico(unittest.TestCase):
    """(b)+(c) _run_generation con router infinito + stop dopo 3 pezzi."""

    def test_run_generation_stop_dopo_3_pezzi_slot_coda_rilasciato(self):
        router = _FakeRouter(stop_after=3)
        api = _make_api(router)
        stop_event = threading.Event()
        entry = _stream_entry()
        api._streams["mid1"] = entry

        t0 = time.perf_counter()
        api._run_generation("mid1", "ciao", 1, "chat", False, None,
                            stop_event, "")
        elapsed = time.perf_counter() - t0

        # loop interrotto: 3 pezzi appenduti (il 4° evento e' scartato dal
        # check di cima), generatore chiuso, nessuna attesa infinita
        self.assertTrue(stop_event.is_set())
        self.assertTrue(router.closed, "generator.close() non chiamato")
        self.assertEqual(len(entry["tokens"]), 3)
        self.assertLess(elapsed, 5.0, "lo stop non ha interrotto il loop")

        # slot coda rilasciato + stato post-stop
        self.assertTrue(entry["stopped"])
        self.assertFalse(entry["generation_active"])
        self.assertTrue(entry["done"])
        self.assertIsNone(entry["queue"])

    def test_slot_rilasciato_nuova_generazione_successiva(self):
        """(c) dopo lo stop una nuova generazione sulla stessa chat funziona."""
        router = _FakeRouter(stop_after=3)
        api = _make_api(router)

        entry1 = _stream_entry(conversation_id=7)
        api._streams["mid1"] = entry1
        api._run_generation("mid1", "primo", 7, "chat", False, None,
                            threading.Event(), "")
        self.assertFalse(entry1["generation_active"])
        self.assertIsNone(entry1["queue"])

        # send_message-like: slot libero -> nuovo stream sulla stessa chat
        entry2 = _stream_entry(conversation_id=7)
        api._streams["mid2"] = entry2
        router.stop_after = 1  # seconda run: stop quasi subito (non infinito)
        api._run_generation("mid2", "secondo", 7, "chat", False, None,
                            threading.Event(), "")
        self.assertTrue(entry2["done"])
        self.assertFalse(entry2["generation_active"])
        self.assertGreaterEqual(len(entry2["tokens"]), 1)
        # niente code appese sulla conversazione
        self.assertTrue(all(s.get("queue") is None
                            for s in api._streams.values()))

    def test_stop_generation_imposta_event(self):
        router = _FakeRouter(stop_after=3)
        api = _make_api(router)
        entry = _stream_entry()
        api._streams["midS"] = entry
        self.assertFalse(entry["stop_event"].is_set())
        api.stop_generation("midS")
        self.assertTrue(entry["stop_event"].is_set(),
                        "stop_generation non ha impostato stop_event")


if __name__ == "__main__":
    unittest.main(verbosity=2)

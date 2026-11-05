"""Test R13-spec - draft long-form, contratto last_meta, backward-compat.

Nessun binario richiesto (unittest stdlib):
(a) SidecarServer.start_on_demand backward-compat: senza argomento e con
    draft=False -> identico a prima; draft=True con spec.draft_model vuoto
    -> _resolve_draft == (False, "") (fallback senza draft, nessun errore).
(b) SidecarClient.want_draft: SOLO long-form (profile/classe think),
    override esplicito draft=True/False, draft_model mancante -> False,
    spec.draft_longform=False -> False.
(c) Contratto last_meta (TELEM): timings/acceptance/draft_active/ts
    aggiornati da complete() non-stream e stream su un fake HTTP locale.
(d) W2 (R13 S3): DRAFT_LONGFORM di default True; llm() passa draft=True
    SOLO se il llm_fn lo supporta, altrimenti strada standard identica.
"""

import json
import os
import socket
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.sidecar import SidecarClient, SidecarServer  # noqa: E402
from core.workers.w2_summarizer import (  # noqa: E402
    W2SectionSummarizer,
    _supports_draft,
)

FAKE_TIMINGS = {"draft_n": 10, "draft_n_accepted": 7,
                "predicted_per_second": 12.5}


# --------------------------------------------------------------------- (a)
class TestServerBackwardCompat(unittest.TestCase):

    def test_start_senza_argomento_compat(self):
        srv = SidecarServer(config={
            "llama.server_path": "",
            "llama.model_path": os.path.join(ROOT, "non_esiste.gguf"),
            "llama.n_ctx": 4096,
            "llama.idle_unload_sec": 300,
        })
        try:
            self.assertIs(srv.start_on_demand(), False)   # nessuna eccezione
            self.assertIs(srv.draft_mode, False)
            st = srv.status()
            self.assertEqual(st["state"], "down")
            self.assertIn("draft", st)                    # chiave esposta
        finally:
            srv.shutdown()

    def test_start_draft_senza_modello_fallback(self):
        srv = SidecarServer(config={
            "llama.server_path": "",
            "llama.model_path": os.path.join(ROOT, "non_esiste.gguf"),
            "spec.draft_model": "",
        })
        try:
            # draft=True ma nessun modello draft -> degrada senza eccezioni
            self.assertIs(srv.start_on_demand(draft=True), False)
            self.assertEqual(srv._resolve_draft(True), (False, ""))
            self.assertEqual(srv._resolve_draft(False), (False, ""))
        finally:
            srv.shutdown()

    def test_resolve_draft_con_modello_esistente(self):
        # file finto esistente: _resolve_draft lo accetta (path check)
        fake = os.path.join(ROOT, "qa", "_fake_draft.gguf")
        with open(fake, "wb") as f:
            f.write(b"GGUF")
        srv = SidecarServer(config={"spec.draft_model": fake})
        try:
            self.assertEqual(srv._resolve_draft(True), (True, fake))
        finally:
            srv.shutdown()
            try:
                os.remove(fake)
            except OSError:
                pass


# --------------------------------------------------------------------- (b)
def _mk_client(spec):
    return SidecarClient(port=1, auto_start=False, spec=spec)


class TestWantDraft(unittest.TestCase):

    def test_solo_long_form(self):
        spec = {"spec.draft_model": __file__,     # esistente
                "spec.draft_longform": True}
        c = _mk_client(spec)
        self.assertTrue(c.want_draft("think", "think"))
        self.assertTrue(c.want_draft("think", "standard"))
        self.assertTrue(c.want_draft("fast", "think"))    # classe long-form
        # micro/standard/tool SENZA draft
        self.assertFalse(c.want_draft("fast", "micro"))
        self.assertFalse(c.want_draft("fast", "standard"))
        self.assertFalse(c.want_draft("tool", "micro"))
        self.assertFalse(c.want_draft("tool", "standard"))

    def test_draft_model_mancante(self):
        c = _mk_client({"spec.draft_model": "",
                        "spec.draft_longform": True})
        self.assertFalse(c.want_draft("think", "think"))

    def test_flag_longform_spegnito(self):
        c = _mk_client({"spec.draft_model": __file__,
                        "spec.draft_longform": False})
        self.assertFalse(c.want_draft("think", "think"))

    def test_override_esplicito(self):
        c = _mk_client({"spec.draft_model": "", "spec.draft_longform": True})
        self.assertTrue(c.want_draft("fast", "micro", draft=True))
        c2 = _mk_client({"spec.draft_model": __file__,
                         "spec.draft_longform": True})
        self.assertFalse(c2.want_draft("think", "think", draft=False))


# --------------------------------------------------------------- (c) fake
class _Handler(BaseHTTPRequestHandler):
    mode = "json"  # json | stream

    def log_message(self, *a):  # silenzioso
        pass

    def do_POST(self):
        ln = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(ln).decode("utf-8") or "{}")
        if _Handler.mode == "json":
            payload = json.dumps({
                "content": "ok",
                "timings": FAKE_TIMINGS,
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            chunks = [
                '{"content": "ciao "}',
                '{"content": "mondo", "timings": %s}' % json.dumps(FAKE_TIMINGS),
                '{"content": "", "stop": true}',
                "[DONE]",
            ]
            for ch in chunks:
                self.wfile.write(("data: %s\n\n" % ch).encode("utf-8"))
            self.wfile.flush()


def _free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


class TestLastMetaContract(unittest.TestCase):
    """Contratto TELEM: last_meta = {timings, acceptance, draft_active, ts}."""

    def setUp(self):
        self.port = _free_port()
        self.httpd = HTTPServer(("127.0.0.1", self.port), _Handler)
        self.th = threading.Thread(target=self.httpd.serve_forever,
                                   daemon=True)
        self.th.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def _client(self):
        return SidecarClient(port=self.port, auto_start=False)

    def test_keys_e_valori_non_stream(self):
        _Handler.mode = "json"
        c = self._client()
        out = c.complete("ciao", profile="fast", classe="micro")
        self.assertEqual(out, "ok")
        m = c.last_meta
        self.assertEqual(set(m.keys()),
                         {"timings", "acceptance", "draft_active", "ts"})
        self.assertEqual(m["timings"], FAKE_TIMINGS)
        self.assertAlmostEqual(m["acceptance"], 0.7)
        self.assertIsInstance(m["draft_active"], bool)
        self.assertGreater(m["ts"], 0.0)

    def test_stream_pubbla_meta(self):
        _Handler.mode = "stream"
        c = self._client()
        txt = "".join(c.complete("ciao", profile="fast", classe="micro",
                                 stream=True))
        self.assertEqual(txt, "ciao mondo")
        m = c.last_meta
        self.assertEqual(m["timings"], FAKE_TIMINGS)
        self.assertAlmostEqual(m["acceptance"], 0.7)
        self.assertGreater(m["ts"], 0.0)

    def test_draft_esplicito_reflessato(self):
        _Handler.mode = "json"
        c = self._client()
        c.complete("ciao", profile="fast", classe="micro", draft=True)
        self.assertIs(c.last_meta["draft_active"], True)
        c.complete("ciao", profile="think", classe="think", draft=False)
        self.assertIs(c.last_meta["draft_active"], False)

    def test_acceptance_none_se_dati_mancanti(self):
        _Handler.mode = "json"
        c = self._client()
        # acceptance non inventata: senza draft_n/draft_n_accepted -> None
        self.assertIsNone(c._acceptance_from({"predicted_per_second": 3.0}))
        self.assertIsNone(c._acceptance_from(None))
        self.assertIsNone(c._acceptance_from("nope"))


# --------------------------------------------------------------------- (d)
class TestW2DraftFlag(unittest.TestCase):

    def test_flag_di_default(self):
        self.assertTrue(W2SectionSummarizer.DRAFT_LONGFORM)

    def test_supports_draft(self):
        def with_kwarg(prompt, profile="fast", classe="micro", draft=None):
            return "x"
        def without(prompt, profile="fast", classe="micro"):
            return "x"
        def with_kwargs(prompt, **kw):
            return "x"
        self.assertTrue(_supports_draft(with_kwarg))
        self.assertFalse(_supports_draft(without))
        self.assertTrue(_supports_draft(with_kwargs))

    def test_llm_passa_draft_se_supportato(self):
        seen = {}
        def llm_fn(prompt, profile="fast", classe="micro", draft=None):
            seen["draft"] = draft
            return "riassunto"
        w = W2SectionSummarizer(llm_fn=llm_fn)
        out = w.llm("testo")
        self.assertEqual(out, "riassunto")
        self.assertIs(seen["draft"], True)

    def test_llm_backward_compat_senza_kwarg(self):
        def llm_fn(prompt, profile="fast", classe="micro"):
            return "vecchio"
        w = W2SectionSummarizer(llm_fn=llm_fn)
        self.assertEqual(w.llm("testo"), "vecchio")   # strada standard
        self.assertEqual(w.stats["llm_calls"], 1)

    def test_flag_spegnito_usa_base(self):
        seen = {}
        def llm_fn(prompt, profile="fast", classe="micro", **kw):
            seen.update(kw)      # solo i kwarg EFFETTIVAMENTE passati
            return "x"
        w = W2SectionSummarizer(llm_fn=llm_fn)
        w.DRAFT_LONGFORM = False
        w.llm("testo")
        self.assertNotIn("draft", seen)


if __name__ == "__main__":
    unittest.main(verbosity=2)

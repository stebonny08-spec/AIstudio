"""Test H2 - Sidecar server/client/profiles (unittest stdlib, NESSUN binario).

(a) clamp_max_tokens micro/standard/think + profili presenti con chiavi
(b) AiUnavailable quando la porta e' chiusa
(c) parser SSE su stringa finta
(d) SidecarServer stato down con server_path='' (nessuna eccezione)
(e) config_manager: chiavi T1 presenti con default giusti
"""

import os
import socket
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.sidecar import (  # noqa: E402
    AiUnavailable,
    SAMPLING_PROFILES,
    SidecarClient,
    SidecarServer,
    build_args,
    clamp_max_tokens,
    parse_sse_line,
    parse_sse_text,
)
from data.config_manager import DEFAULT_CONFIG, ConfigManager  # noqa: E402


class TestProfili(unittest.TestCase):
    """(a) budget clamp + struttura profili v1."""

    def test_clamp_budget(self):
        self.assertEqual(clamp_max_tokens("fast", "micro"), 200)
        self.assertEqual(clamp_max_tokens("fast", "standard"), 600)
        self.assertEqual(clamp_max_tokens("think", "think"), 1500)
        self.assertEqual(clamp_max_tokens("think", "standard"), 600)
        self.assertEqual(clamp_max_tokens("tool", "micro"), 200)
        self.assertEqual(clamp_max_tokens("tool", "standard"), 600)
        # classe sconosciuta -> standard (600)
        self.assertEqual(clamp_max_tokens("fast", "gigante"), 600)
        self.assertEqual(clamp_max_tokens("non_un_profilo", "micro"), 200)

    def test_profili_presenti_con_chiavi(self):
        self.assertEqual(SAMPLING_PROFILES.get("version"), "v1")
        profili = SAMPLING_PROFILES.get("profiles", {})
        for nome in ("fast", "think", "tool"):
            self.assertIn(nome, profili)
            prof = profili[nome]
            self.assertIn("temp", prof)
            self.assertIn("classi", prof)
        self.assertEqual(profili["fast"].get("temp"), 0.8)
        self.assertEqual(profili["fast"].get("top_p"), 0.95)
        self.assertEqual(profili["think"].get("temp"), 0.6)
        self.assertEqual(profili["tool"].get("temp"), 0.1)
        self.assertEqual(profili["tool"].get("stop"), ["\n\n"])
        self.assertTrue(profili["tool"].get("json_mode"))

    def test_build_args(self):
        args = build_args("fast", n_ctx=4096)
        self.assertEqual(args["n_ctx"], 4096)
        self.assertEqual(args["temperature"], 0.8)
        self.assertIsInstance(args, dict)


class TestClient(unittest.TestCase):
    """(b) porta chiusa -> AiUnavailable('AI non disponibile')."""

    @staticmethod
    def _porta_libera():
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]
        finally:
            s.close()

    def test_aiunavailable_porta_chiusa(self):
        port = self._porta_libera()  # nessun ascoltatore su questa porta
        client = SidecarClient(port=port, auto_start=False)
        with self.assertRaises(AiUnavailable) as ctx:
            client.complete("ciao", profile="fast", classe="micro")
        self.assertEqual(str(ctx.exception), "AI non disponibile")

    def test_aiunavailable_stream_chiuso(self):
        port = self._porta_libera()
        client = SidecarClient(port=port, auto_start=False)
        with self.assertRaises(AiUnavailable):
            list(client.complete("ciao", profile="fast", classe="micro",
                                 stream=True))


class TestSSE(unittest.TestCase):
    """(c) parser SSE su stringa finta."""

    def test_parser_riga(self):
        self.assertEqual(parse_sse_line('data: {"content": "Ciao"}'),
                         {"content": "Ciao"})
        self.assertEqual(parse_sse_line("data: [DONE]"), {"done": True})
        self.assertIsNone(parse_sse_line(""))
        self.assertIsNone(parse_sse_line(": keep-alive comment"))
        self.assertIsNone(parse_sse_line("data: {rotto"))
        self.assertIsNone(parse_sse_line("event: ping"))

    def test_parser_stringa_finta(self):
        fake = ('data: {"content": "Ciao "}\n\n'
                'data: {"content": "mondo"}\n\n'
                'data: {"stop": true, "content": "!"}\n\n'
                'data: [DONE]\n\n')
        payloads = parse_sse_text(fake)
        testo = "".join(p["content"] for p in payloads if "content" in p)
        self.assertEqual(testo, "Ciao mondo!")
        self.assertTrue(any(p.get("done") for p in payloads))
        # bytes: il client riceve righe grezze dallo stream
        self.assertEqual(parse_sse_line(b'data: {"content": "ok"}'),
                         {"content": "ok"})


class TestServer(unittest.TestCase):
    """(d) server_path='' -> stato down, False, ZERO eccezioni."""

    def test_down_senza_eccezione(self):
        srv = SidecarServer(config={
            "llama.server_path": "",
            "llama.model_path": os.path.join(ROOT, "non_esiste.gguf"),
            "llama.n_ctx": 4096,
            "llama.idle_unload_sec": 300,
        })
        try:
            ok = srv.start_on_demand()   # non deve sollevare MAI
            self.assertIs(ok, False)
            self.assertEqual(srv.status()["state"], "down")
            self.assertIs(srv.health(), False)
            self.assertIsNone(srv.port)
        finally:
            srv.shutdown()

    def test_server_path_inesistente(self):
        srv = SidecarServer(config={
            "llama.server_path": os.path.join(ROOT, "server_fantasma.exe"),
            "llama.model_path": "",
        })
        try:
            self.assertIs(srv.start_on_demand(), False)
            self.assertEqual(srv.status()["state"], "down")
        finally:
            srv.shutdown()


class TestConfig(unittest.TestCase):
    """(e) chiavi T1 presenti con default giusti."""

    def test_chiavi_default(self):
        self.assertEqual(DEFAULT_CONFIG.get("llm.backend"), "sidecar")
        self.assertEqual(DEFAULT_CONFIG.get("llama.server_path"), "")
        model = str(DEFAULT_CONFIG.get("llama.model_path", ""))
        self.assertTrue(model.endswith("MiniCPM5-2B-Q4_K_M.gguf"))
        self.assertIn("NovaStudio", model)
        self.assertEqual(DEFAULT_CONFIG.get("llama.idle_unload_sec"), 300)
        self.assertEqual(DEFAULT_CONFIG.get("llama.n_ctx"), 4096)

    def test_config_manager_espone_i_default(self):
        cfg = ConfigManager()
        self.assertEqual(cfg.get("llm.backend"), "sidecar")
        self.assertEqual(cfg.get("llama.idle_unload_sec"), 300)
        # R13: valore RUNTIME alzato 4096 -> 8192 (fix di catena TTFT:
        # prompt RAG reale 3.700-4.600 tok > 4096 rendeva il sidecar non
        # servibile -> fallback con crash nativi, vedi qa/qa_r13_ttft_report.md).
        # DEFAULT_CONFIG (test qui sopra) resta 4096; rollback: config.json
        # llama.n_ctx -> 4096 (backup config.json.bak_r13).
        self.assertEqual(cfg.get("llama.n_ctx"), 8192)
        # R25: la config UTENTE puo' legittimamente puntare a uno qualsiasi
        # dei modelli della lineup (Spark pro/base o il fallback MiniCPM):
        # si asserta che sia un GGUF di catalogo, non il singolo path storico.
        _mp = str(cfg.get("llama.model_path", "")).replace("\\", "/")
        _ok_names = {
            "MiniCPM5-2B-Q4_K_M.gguf",
            "spark-x2.6-4b.gguf",
            "spark-x2.6-1.7b.gguf",
        }
        self.assertTrue(
            _mp.endswith(".gguf") and _mp.rsplit("/", 1)[-1] in _ok_names,
            "llama.model_path non e' un GGUF della lineup: %s" % _mp)


if __name__ == "__main__":
    unittest.main(verbosity=2)

# -*- coding: utf-8 -*-
"""tests/testP1b_ngram_flags.py - P1b.1/P1b.4: flag n-gram persistiti.

COPRE:
  a) DEFAULT_CONFIG: spec.ngram_longform/variant/draft_max = esito A/B;
  b) SidecarClient.want_draft: think -> True con ngram long-form ON;
     micro/standard -> False; override spec SENZA la chiave -> R23 invariato;
  c) argv sidecar con Popen finto: --spec-type ngram-* + size-m/n-max;
  d) rollback: flag OFF -> want_draft False e nessun argv ngram.
Eseguire: python -m unittest tests.testP1b_ngram_flags
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

EXE = str(ROOT / "tools" / "llama-server.exe")
GGUF = str(ROOT / "tools" / "models" / "spark-x2.6-1.7b.gguf")


def _base_cfg(ngram_on=True, variant="ngram-map-k", dmax=5):
    return {
        "llama.server_path": EXE,
        "llama.model_path": GGUF,
        "llama.n_ctx": 4096,
        "llama.engine": "auto",
        "spec.draft_model": "",
        "spec.ngram_longform": bool(ngram_on),
        "spec.ngram_variant": variant,
        "spec.ngram_draft_max": dmax,
    }


class TestDefaultConfig(unittest.TestCase):
    def test_defaults_esito_ab(self):
        from data.config_manager import DEFAULT_CONFIG
        self.assertTrue(DEFAULT_CONFIG.get("spec.ngram_longform") is True)
        self.assertEqual(DEFAULT_CONFIG.get("spec.ngram_variant"), "ngram-map-k")
        self.assertEqual(DEFAULT_CONFIG.get("spec.ngram_draft_max"), 5)


class TestWantDraftNgram(unittest.TestCase):
    def test_think_on_micro_off_config_reale(self):
        from core.sidecar.client import SidecarClient
        c = SidecarClient()
        self.assertTrue(c.want_draft("think", "think"))
        self.assertTrue(c.want_draft("fast", "think"))
        self.assertFalse(c.want_draft("fast", "micro"))
        self.assertFalse(c.want_draft("tool", "standard"))

    def test_override_spec_storico_invariato(self):
        from core.sidecar.client import SidecarClient
        c = SidecarClient(spec={"spec.draft_model": "",
                                "spec.draft_longform": True})
        self.assertFalse(c.want_draft("think", "think"))

    def test_rollback_flag_off(self):
        import data.config_manager as cm
        old = cm.DEFAULT_CONFIG.get("spec.ngram_longform")
        cm.DEFAULT_CONFIG["spec.ngram_longform"] = False
        try:
            from core.sidecar.client import SidecarClient
            c = SidecarClient()
            self.assertFalse(c.want_draft("think", "think"))
        finally:
            cm.DEFAULT_CONFIG["spec.ngram_longform"] = old


class TestServerArgv(unittest.TestCase):
    def _run(self, ngram_on, variant="ngram-map-k", dmax=5):
        from core.sidecar.server import SidecarServer
        cfg = _base_cfg(ngram_on, variant, dmax)
        captured = {}

        def fake_popen(args, *a, **k):
            captured["args"] = list(args)

            class P:
                def poll(self):
                    return None

                def terminate(self):
                    pass

                def kill(self):
                    pass

                def wait(self, *a, **k):
                    return 0

            return P()

        with mock.patch("core.sidecar.server.subprocess.Popen", fake_popen), \
                mock.patch.object(SidecarServer, "_http_ready", return_value=True):
            srv = SidecarServer(config=cfg)
            try:
                ok = srv.start_on_demand(draft=True)
            finally:
                srv._stop.set()
                srv.shutdown()
        return ok, captured.get("args", [])

    def test_argv_ngram_mapk_d5(self):
        ok, args = self._run(True, "ngram-map-k", 5)
        self.assertTrue(ok)
        self.assertIn("--spec-type", args)
        i = args.index("--spec-type")
        self.assertEqual(args[i + 1], "ngram-map-k")
        self.assertIn("--spec-ngram-map-k-size-m", args)
        j = args.index("--spec-ngram-map-k-size-m")
        self.assertEqual(args[j + 1], "5")
        self.assertNotIn("--model-draft", args)

    def test_argv_ngram_mod(self):
        ok, args = self._run(True, "ngram-mod", 8)
        self.assertTrue(ok)
        i = args.index("--spec-type")
        self.assertEqual(args[i + 1], "ngram-mod")
        j = args.index("--spec-ngram-mod-n-max")
        self.assertEqual(args[j + 1], "8")

    def test_rollback_ngram_off_nessun_flag(self):
        ok, args = self._run(False)
        self.assertTrue(ok)
        self.assertNotIn("--spec-type", args)
        self.assertNotIn("--model-draft", args)


if __name__ == "__main__":
    unittest.main()

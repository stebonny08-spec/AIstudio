# -*- coding: utf-8 -*-
"""tests/testR23_draftflag.py — R23 X4.4: list_models espone draft_enabled.

Verifica sul CODICE REALE backend.api.StudioIAAPI.list_models (istanza
costruita senza __init__, campi iniettati - nessun sidecar/rete):
  - 3 voci in ordine pro > base > fallback (catalogo reale R23);
  - draft_enabled False con spec.draft_model vuoto (default R23: OFF);
  - draft_enabled True SOLO per voci con draft in catalogo quando
    spec.draft_model e' configurato (pro e fallback, base draft null).
Eseguire: python -m unittest tests.testR23_draftflag
"""
from __future__ import annotations

import os
import sys
import threading
import types
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# stub webview PRIMA di backend.api (stesso pattern dei QA)
if "webview" not in sys.modules:
    _wv = types.ModuleType("webview")
    _wv.FileDialog = type("FD", (), {"OPEN": "open", "SAVE": "save"})
    _wv.windows = []
    _wv.create_window = lambda *a, **k: types.SimpleNamespace(
        destroy=lambda: None, shown=False)
    _wv.start = lambda *a, **k: None
    sys.modules["webview"] = _wv

from backend.api import StudioIAAPI  # noqa: E402
from data.models_manager import ModelsManager  # noqa: E402


class _FakeCfg:
    def __init__(self, data):
        self._d = dict(data)

    def get(self, key, default=None):
        return self._d.get(key, default)


def _make_api(spec_draft_model: str):
    api = object.__new__(StudioIAAPI)
    api.config = _FakeCfg({"spec.draft_model": spec_draft_model,
                           "local_model_path": ""})
    api.models_manager = ModelsManager()
    api._model_state_lock = threading.Lock()
    api._model_state = {"state": "", "model_key": ""}
    return api


class TestDraftEnabled(unittest.TestCase):
    def test_tre_voci_in_ordine(self):
        models = _make_api("").list_models()
        keys = [m["key"] for m in models]
        self.assertEqual(keys, ["pro", "base", "fallback"], keys)
        for m in models:
            self.assertIn("draft", m)
            self.assertIn("id", m)
            self.assertIn("fallback", m)

    def test_draft_off_di_default(self):
        """R23: spec.draft_model vuoto -> nessuna voce draft_enabled."""
        for m in _make_api("").list_models():
            self.assertFalse(m["draft_enabled"],
                             "draft_enabled deve essere False con draft "
                             "non configurato: %s" % m["key"])

    def test_draft_enabled_solo_con_config(self):
        models = _make_api("/qualche/draft.gguf").list_models()
        by_key = {m["key"]: m for m in models}
        self.assertTrue(by_key["pro"]["draft_enabled"],
                        "pro ha draft in catalogo -> True con config")
        self.assertTrue(by_key["fallback"]["draft_enabled"],
                        "fallback ha draft in catalogo -> True con config")
        self.assertFalse(by_key["base"]["draft_enabled"],
                         "base senza draft in catalogo -> sempre False")

    def test_campi_x6_presenti(self):
        by_key = {m["key"]: m for m in _make_api("").list_models()}
        self.assertEqual(by_key["pro"]["id"], "spark-pro-4b")
        self.assertEqual(by_key["base"]["id"], "spark-base-1.7b")
        self.assertEqual(by_key["fallback"]["id"], "minicpm5-2b")
        self.assertTrue(by_key["fallback"]["fallback"])


if __name__ == "__main__":
    unittest.main()

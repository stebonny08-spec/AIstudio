"""tests/testR13_telem.py — R13 T1/T3: telemetria runtime via api.

Owner: IMPLEMENTER-TELEM (subagente 20261024_5). Unico file di test py
di mia competenza (insieme alla sonda tests/t13_ttft_pywebview.py).

T1 (api ai_stats/ai_stats_reset):
  1. metodi esistenti su StudioIAAPI (stub `webview` in sys.modules PRIMA
     di importare backend.api — modello tests/testC_rag.py);
  2. chiavi get_stats INVARIATE: struttura base confrontata prima/dopo
     (snapshot hardcodato dello schema G7 + confronto struttura percorso
     api vs core.ai_runtime);
  3. reset ok (chiavi base a zero, struttura uguale);
  4. payload JSON-serializzabile.

T3 (persistenza + campi live, vedi core/ai_runtime.py):
  5. chiavi NUOVE presenti (live/persist) SENZA alterare quelle base;
  6. persistenza %APPDATA%\\NovaStudio\\ai_stats.json: scrittura/lettura
     (uso una dir temporanea via override env, NON scrivo l'app reale);
  7. campi live dichiarati (hit-rate da prefix_cache in sola lettura,
     tok/s da stima tokens/ms o last_meta, acceptance null se assente).

Esecuzione:  PYTHONIOENCODING=utf-8 python tests/testR13_telem.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

# --- sys.path: root del progetto (script lanciato come `python tests/...`) ---
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# --- Stub webview PRIMA di qualsiasi import backend.* (modello testC_rag) ---
if "webview" not in sys.modules:
    try:
        import webview  # noqa: F401  (se installato, si usa quello)
    except Exception:
        _webview_stub = types.ModuleType("webview")

        class _FileDialog:
            OPEN = "open"
            SAVE = "save"

        _webview_stub.FileDialog = _FileDialog
        _webview_stub.windows = []
        sys.modules["webview"] = _webview_stub

# --- Import moduli sotto test ---
import core.ai_runtime as ai_runtime  # noqa: E402
from backend.api import StudioIAAPI  # noqa: E402

# Struttura BASE (G7) attesa in get_stats(): snapshot prima di ogni cosa.
BASE_TOP_KEYS = ("calls_total", "fids", "cache_hits", "tutor_judgments", "ai_cache")
BASE_CACHE_HITS = ("exact", "semantic", "delta")
BASE_TUTOR = ("corretto", "parziale", "errato")
BASE_FID_SLOT = ("calls", "ok", "fails", "tokens_est", "ms_total")


def _structure(sig):
    """Firma ricorsiva struttura (dict->sorted keys, list->'[]', scalari->type)."""
    if isinstance(sig, dict):
        return {k: _structure(v) for k, v in sorted(sig.items())}
    if isinstance(sig, list):
        return "list[%d]" % len(sig)
    return type(sig).__name__


class TestT1ApiStats(unittest.TestCase):
    """T1: api.ai_stats()/ai_stats_reset() stile H13."""

    def setUp(self):
        # isolamento: MAI scrivere %APPDATA% reale durante i test
        self._tmp = tempfile.TemporaryDirectory(prefix="r13_t1_")
        self._old_env = os.environ.get("STUDIOIA_TELEM_DIR")
        os.environ["STUDIOIA_TELEM_DIR"] = self._tmp.name
        ai_runtime.reset_stats()

    def tearDown(self):
        if self._old_env is None:
            os.environ.pop("STUDIOIA_TELEM_DIR", None)
        else:
            os.environ["STUDIOIA_TELEM_DIR"] = self._old_env
        self._tmp.cleanup()
        ai_runtime.reset_stats()

    def test_01_metodi_esistenti_su_api(self):
        api = StudioIAAPI.__new__(StudioIAAPI)  # senza __init__ pesante
        self.assertTrue(callable(getattr(api, "ai_stats", None)),
                        "StudioIAAPI.ai_stats assente")
        self.assertTrue(callable(getattr(api, "ai_stats_reset", None)),
                        "StudioIAAPI.ai_stats_reset assente")
        self.assertTrue(getattr(StudioIAAPI.ai_stats, "__doc__"),
                        "ai_stats senza docstring")
        self.assertTrue(getattr(StudioIAAPI.ai_stats_reset, "__doc__"),
                        "ai_stats_reset senza docstring")

    def test_02_payload_base_invariato_struttura_prima_dopo(self):
        api = StudioIAAPI.__new__(StudioIAAPI)
        # PRIMA: snapshot struttura core (fonte della verita')
        core_before = _structure(ai_runtime.get_stats())
        api_before = _structure(api.ai_stats())
        # chiavi base presenti e identiche tra core e api
        for k in BASE_TOP_KEYS:
            self.assertIn(k, core_before, "chiave base mancante: %s" % k)
            self.assertIn(k, api_before, "chiave base mancante (api): %s" % k)
        self.assertEqual(core_before, api_before,
                         "struttura api != struttura core")
        # DOPO una chiamata reale: struttura delle chiavi base identica
        from core.ai_cache import AiCache
        from core.ai_runtime import run_ai_function

        def stub(prompt, max_tokens=None, classe=None, fid=None):
            return '{"flashcards": []}'

        run_ai_function("F01", {"testo": "ciao"}, ai_cache=AiCache(), llm_fn=stub)
        core_after = _structure(ai_runtime.get_stats())
        api_after = _structure(api.ai_stats())
        self.assertEqual(core_after, api_after, "struttura api/core divergente")
        for k in BASE_TOP_KEYS:
            self.assertIn(k, core_after)
        # sottostuttura invariata
        self.assertEqual(tuple(sorted(core_after["cache_hits"].keys())),
                         tuple(sorted(BASE_CACHE_HITS)))
        self.assertEqual(tuple(sorted(core_after["tutor_judgments"].keys())),
                         tuple(sorted(BASE_TUTOR)))
        # il payload base NON deve contenere chiavi G7 rimosse/rinominate
        for k in BASE_TOP_KEYS:
            self.assertIn(k, core_before)
        json.dumps(api.ai_stats())  # serializzabile

    def test_03_reset_ok(self):
        api = StudioIAAPI.__new__(StudioIAAPI)
        from core.ai_runtime import record_tutor_judgment
        record_tutor_judgment("corretto")
        s = api.ai_stats()
        self.assertEqual(s["tutor_judgments"]["corretto"], 1)
        out = api.ai_stats_reset()
        self.assertIsInstance(out, dict)
        self.assertNotIn("error", out, out.get("error"))
        self.assertEqual(out["calls_total"], 0)
        self.assertEqual(out["fids"], {})
        self.assertEqual(out["cache_hits"]["exact"], 0)
        self.assertEqual(out["tutor_judgments"]["corretto"], 0)
        # struttura DOPO reset == struttura base attesa (solo chiavi G7+nuove)
        for k in BASE_TOP_KEYS:
            self.assertIn(k, out)
        json.dumps(out)

    def test_04_json_serializzabile(self):
        api = StudioIAAPI.__new__(StudioIAAPI)
        payload = api.ai_stats()
        json.dumps(payload)  # deve passare
        self.assertIsInstance(payload, dict)


class TestT3PersistELive(unittest.TestCase):
    """T3: campi live + persistenza su disco (env temporanea, no app reale)."""

    def setUp(self):
        # isolo la persistenza: override della cartella AppData
        self._tmp = tempfile.TemporaryDirectory(prefix="r13_telem_")
        self._old_env = os.environ.get("STUDIOIA_TELEM_DIR")
        os.environ["STUDIOIA_TELEM_DIR"] = self._tmp.name
        ai_runtime.reset_stats()

    def tearDown(self):
        if self._old_env is None:
            os.environ.pop("STUDIOIA_TELEM_DIR", None)
        else:
            os.environ["STUDIOIA_TELEM_DIR"] = self._old_env
        self._tmp.cleanup()
        ai_runtime.reset_stats()

    def test_05_chiavi_nuove_non_toccano_base(self):
        s = ai_runtime.get_stats()
        for k in BASE_TOP_KEYS:
            self.assertIn(k, s, "chiave base rimossa: %s" % k)
        # chiavi NUOVE T3
        self.assertIn("live", s, "blocco live mancante")
        self.assertIn("persist", s, "blocco persist mancante")
        live = s["live"]
        for k in ("ttft_p50_ms", "ttft_p95_ms", "tok_per_s", "tok_per_s_source",
                  "prefix_hit_rate", "prefix_hit_rate_source",
                  "acceptance", "acceptance_source", "tutor_judgments"):
            self.assertIn(k, live, "campo live mancante: %s" % k)
        json.dumps(s)

    def test_06_persistenza_su_disco(self):
        # un evento + un ttft -> snapshot persistito nel file
        ai_runtime.record_ttft(1234.5)
        s = ai_runtime.get_stats()
        f = Path(self._tmp.name) / "ai_stats.json"
        self.assertTrue(f.exists(), "ai_stats.json non creato in %s" % f)
        data = json.loads(f.read_text(encoding="utf-8"))
        self.assertIn("stats", data)
        self.assertIn("ttft_samples", data)
        self.assertIn(1234.5, data["ttft_samples"])
        # rilettura: get_stats() non perde i campi live persistiti
        self.assertIsNotNone(s["live"]["ttft_p50_ms"])
        self.assertGreaterEqual(s["persist"].get("writes", 0), 1)

    def test_07_prefix_hit_rate_reale_in_sola_lettura(self):
        from core.prefix_cache import get_prefix_cache
        pc = get_prefix_cache()
        pc.reset()
        pc.register("a", "b", "c")     # MISS
        pc.register("a", "b", "c")     # HIT
        s = ai_runtime.get_stats()
        self.assertAlmostEqual(s["live"]["prefix_hit_rate"], 0.5, places=6)
        self.assertEqual(s["live"]["prefix_hit_rate_source"], "core.prefix_cache.stats")

    def test_08_acceptance_null_se_assente(self):
        s = ai_runtime.get_stats()
        self.assertIsNone(s["live"]["acceptance"])
        self.assertIn("assente", s["live"]["acceptance_source"])

    def test_09_ttft_da_ultimi_campioni(self):
        for v in (100.0, 200.0, 300.0, 400.0, 1000.0):
            ai_runtime.record_ttft(v)
        s = ai_runtime.get_stats()
        self.assertIsNotNone(s["live"]["ttft_p50_ms"])
        self.assertIsNotNone(s["live"]["ttft_p95_ms"])
        self.assertGreaterEqual(s["live"]["ttft_n"], 5)
        json.dumps(s)


if __name__ == "__main__":
    unittest.main(verbosity=2)

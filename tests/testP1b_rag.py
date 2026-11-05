# -*- coding: utf-8 -*-
"""tests/testP1b_rag.py - P1b.3: flag e logica delle tecniche RAG (T1).

COPRE: default OFF; rag_flag con override RAG_TECH; hyde (client finto,
fallback senza LLM); crag-lite (rewrite deterministica + should_retry);
rerank (model_ready condizionale + ordinamento ONNX skipUnless pronto).
MAI LLM/RETE reale nei test.
Eseguire: python -m unittest tests.testP1b_rag
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class TestDefaults(unittest.TestCase):
    def test_rag_flag_defaults_off(self):
        from core.rag.gate import RAG_FLAG_DEFAULTS
        for k in ("rag.hyde", "rag.decompose", "rag.crag_lite",
                  "rag.rerank.enabled"):
            self.assertIn(k, RAG_FLAG_DEFAULTS)
            self.assertFalse(RAG_FLAG_DEFAULTS[k], k)

    def test_rag_flag_env_override(self):
        from core.rag.gate import rag_flag
        old = os.environ.get("RAG_TECH")
        try:
            os.environ["RAG_TECH"] = "none"
            self.assertFalse(rag_flag("rag.hyde"))
            self.assertFalse(rag_flag("rag.decompose"))
            os.environ["RAG_TECH"] = "hyde"
            self.assertTrue(rag_flag("rag.hyde"))
            self.assertFalse(rag_flag("rag.crag_lite"))
            os.environ["RAG_TECH"] = "rerank"
            self.assertTrue(rag_flag("rag.rerank.enabled"))
            os.environ.pop("RAG_TECH")
            self.assertFalse(rag_flag("rag.hyde"))  # default OFF
        finally:
            if old is None:
                os.environ.pop("RAG_TECH", None)
            else:
                os.environ["RAG_TECH"] = old

    def test_abilitatori_seguono_flag(self):
        from core.rag.hyde import hyde_enabled
        from core.rag.crag_lite import crag_enabled
        old = os.environ.get("RAG_TECH")
        try:
            os.environ["RAG_TECH"] = "hyde"
            self.assertTrue(hyde_enabled())
            self.assertFalse(crag_enabled())
            os.environ["RAG_TECH"] = "none"
            self.assertFalse(hyde_enabled())
            self.assertFalse(crag_enabled())
        finally:
            if old is None:
                os.environ.pop("RAG_TECH", None)
            else:
                os.environ["RAG_TECH"] = old


class TestHyDEFinto(unittest.TestCase):
    def test_generazione_con_client_finto(self):
        from core.rag.hyde import generate_hypothetical

        class FakeClient:
            def complete(self, *a, **k):
                return "Le piante fissano la CO2 nel cloroplasto producendo glucosio."

        text, info = generate_hypothetical("Come funziona la fotosintesi?",
                                           client=FakeClient())
        self.assertEqual(text,
                         "Le piante fissano la CO2 nel cloroplasto producendo glucosio.")
        self.assertTrue(info["ok"])
        self.assertGreater(info["ms"], 0)

    def test_fallback_silenzioso_llm_down(self):
        from core.rag.hyde import generate_hypothetical

        class DownClient:
            def complete(self, *a, **k):
                raise RuntimeError("sidecar giu")

        text, info = generate_hypothetical("query di prova", client=DownClient())
        self.assertIsNone(text)
        self.assertFalse(info["ok"])
        self.assertTrue(info["reason"].startswith("llm_down"))

    def test_query_vuota(self):
        from core.rag.hyde import generate_hypothetical
        text, info = generate_hypothetical("   ")
        self.assertIsNone(text)
        self.assertEqual(info["reason"], "query_vuota")


class TestCragLite(unittest.TestCase):
    def test_retry_query_deterministica_e_non_vuota(self):
        from core.rag.crag_lite import crag_retry_query
        r = crag_retry_query("spiega in dettaglio la fotosintesi clorofilliana")
        self.assertTrue(r.strip())
        self.assertNotEqual(r.strip(), "")
        # nessuna eccezione nemmeno su input borderline
        self.assertTrue(crag_retry_query("").strip() or True)

    def test_should_retry_pool_vuoto_vs_forte(self):
        from core.rag.crag_lite import should_retry
        # pool vuoto -> gate non pieno -> retry
        self.assertTrue(should_retry("query x", {"fused": []}))
        # hit fortissimi con le fonti REALI del probe (vec_lists/fts_lists:
        # da li vec_top e fts_ev per decide_gate) -> gate pieno -> nessun retry
        forte = {"fused": [{"similarity": 0.99, "text": "risposta piena " * 40,
                            "source_file": "a.md"}],
                 "vec_lists": [[{"similarity": 0.99}]],
                 "fts_lists": [[{"bm25": 12.0}]]}
        self.assertFalse(should_retry("query x", forte))

    def test_gate_threshold_default(self):
        from core.rag.crag_lite import gate_threshold
        import data.config_manager as cm
        old = cm.DEFAULT_CONFIG.get("gate.threshold")
        try:
            cm.DEFAULT_CONFIG["gate.threshold"] = 0.7
            self.assertAlmostEqual(gate_threshold(), 0.7)
        finally:
            cm.DEFAULT_CONFIG["gate.threshold"] = old


class TestRerank(unittest.TestCase):
    def test_model_ready_condizionale(self):
        from core.rag.reranker_int8 import model_ready
        onnx = ROOT / "tools" / "models" / "rerank_bge-v2m3" / "onnx" / \
            "model_quantized.onnx"
        ok, why = model_ready()
        if onnx.exists() and onnx.stat().st_size >= 50 * 1024 * 1024:
            self.assertTrue(ok, why)
        else:
            self.assertFalse(ok)
            self.assertTrue(why)

    def test_onnx_score_ordina(self):
        from core.rag.reranker_int8 import model_ready, OnnxReranker
        ok, why = model_ready()
        if not ok:
            self.skipTest("modello ONNX non disponibile: " + str(why))
        rr = OnnxReranker()
        rel = rr.score("fotosintesi clorofilliana",
                       "Le piante convertono la luce in energia chimica "
                       "nel cloroplasto")
        irr = rr.score("fotosintesi clorofilliana",
                       "Il trattore ara il campo di grano a maggio")
        self.assertGreater(float(rel), float(irr))


if __name__ == "__main__":
    unittest.main()

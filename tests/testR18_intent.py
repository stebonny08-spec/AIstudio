# -*- coding: utf-8 -*-
"""R18 - test intent-aware (B3.1/B3.2/B3.3) - unit, zero LLM/rete.

Esecuzione: python tests/testR18_intent.py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.rag import intent as I   # noqa: E402


HIST = [{"role": "user", "content": "cos'è la fotosintesi?"}]


class TestTaxonomia(unittest.TestCase):
    def test_nuova_domanda_fattuale(self):
        r = I.classify("cos'è la fotosintesi?", [], None)
        self.assertEqual(r["intent"], I.INTENT_NUOVA, r)
        self.assertTrue(I.is_factual("cos'è la fotosintesi?"))

    def test_chit_chat_social(self):
        for q in ("ciao", "grazie mille", "ok", "buongiorno"):
            r = I.classify(q, HIST, None)
            self.assertEqual(r["intent"], I.INTENT_CHITCHAT, (q, r))

    def test_fattuale_non_e_chit_chat(self):
        # F0.1: "cos'è la fotosintesi?" era classificata chat dal router
        # 0-LLM (marker "che cos'e" assente) -> B3.1 vincola i marker
        self.assertTrue(I.is_factual("cos'è la fotosintesi?"))
        self.assertTrue(I.is_factual("chi è dante alighieri"))
        self.assertTrue(I.is_factual("spiega la mitosi"))

    def test_sotto_domanda_anafora(self):
        r = I.classify("parlami meglio di questa produzione di ossigeno",
                       HIST, None)
        self.assertEqual(r["intent"], I.INTENT_SOTTO, r)
        self.assertIn("ref", str(r["rule"]))

    def test_sotto_domanda_shared_topic(self):
        r = I.classify("dimmi di più sui pigmenti della fotosintesi",
                       HIST, None)
        self.assertEqual(r["intent"], I.INTENT_SOTTO, r)

    def test_senza_storia_non_e_sotto(self):
        # anafora senza antecedente = domanda a se stante (cache ammissibile)
        r = I.classify("spiega questo processo in dettaglio", [], None)
        self.assertEqual(r["intent"], I.INTENT_NUOVA, r)

    def test_riformulata_sim_alta(self):
        r = I.classify("cos'è la fotosintesi?",
                       [{"role": "user",
                         "content": "cos'è la fotosintesi clorofilliana"}],
                       None)
        # jaccard sui token molto alto (stessa domanda)
        self.assertEqual(r["intent"], I.INTENT_RIFORMULATA, r)
        self.assertGreaterEqual(r["similarity"], 0.92)

    def test_tutti_intent_nella_taxonomia(self):
        self.assertEqual(set(I.INTENTS), {
            "stessa-domanda-riformulata", "sotto-domanda",
            "nuova-domanda", "chit-chat"})


class TestExpandQuery(unittest.TestCase):
    def test_espansione_con_topic(self):
        out = I.expand_query("parlami meglio di questa produzione di ossigeno",
                             HIST)
        self.assertIn("fotosintesi", out)
        self.assertNotEqual(out.strip(),
                            "parlami meglio di questa produzione di ossigeno")
        self.assertNotIn("questa", out.split())

    def test_espansione_approfondimento(self):
        out = I.expand_query(
            "voglio approfondire la parte di come viene rilasciato l'ossigeno",
            HIST)
        self.assertIn("fotosintesi", out)
        self.assertIn("ossigeno", out)

    def test_mai_vuota(self):
        out = I.expand_query("approfondisci", HIST)
        self.assertTrue(out.strip())

    def test_senza_storia_letterale(self):
        out = I.expand_query("cos'è la fotosintesi?", [])
        self.assertEqual(out, "cos'è la fotosintesi?")


if __name__ == "__main__":
    unittest.main(verbosity=2)

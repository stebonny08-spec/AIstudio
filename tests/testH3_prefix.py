"""Test H3 - Prefissi stabili + prompt cache + trim_history (unittest stdlib, 5 test)."""

import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.prefix_cache import PromptPrefixCache, get_prefix_cache
from core.router import (
    ROLLING_SUMMARY_MAX_CHARS,
    build_prompt_segments,
    trim_history,
)


class TestBuildPromptSegments(unittest.TestCase):

    # (a) determinismo: stesso input 2 volte = stringa identica + snapshot
    def test_a_deterministico_con_snapshot(self):
        args = (
            "default",
            "Materiali: capitolo 3",
            [
                {"role": "user", "content": "Domanda vecchia"},
                {"role": "assistant", "content": "Risposta vecchia"},
            ],
            "Qual e' il teorema di Pitagora?",
        )
        s1 = build_prompt_segments(*args)
        s2 = build_prompt_segments(*args)
        self.assertEqual(s1, s2)
        joined1 = "".join(s1.values())
        joined2 = "".join(s2.values())
        self.assertEqual(joined1, joined2)
        # snapshot confrontato
        expected = (
            "[system profile=default v1]\n"
            "[rag]\nMateriali: capitolo 3\n"
            "[user] Domanda vecchia\n"
            "[assistant] Risposta vecchia\n"
            "[query]\nQual e' il teorema di Pitagora?"
        )
        self.assertEqual(joined1, expected)

    # (b) ordine segmenti: system < rag < history < query nella stringa
    def test_b_ordine_segmenti(self):
        segs = build_prompt_segments(
            "ripasso",
            "fonte A",
            [
                {"role": "user", "content": "prima domanda"},
                {"role": "assistant", "content": "prima risposta"},
            ],
            "seconda domanda",
        )
        self.assertEqual(
            list(segs.keys()), ["system", "rag", "history", "query"]
        )
        joined = "".join(segs.values())
        i_sys = joined.index("[system profile")
        i_rag = joined.index("[rag]")
        i_hist = joined.index("[user] prima domanda")
        i_query = joined.index("[query]")
        self.assertTrue(i_sys < i_rag < i_hist < i_query)

    # (c) HIT/MISS: stessa query due volte con stesso history -> hit_rate>0
    def test_c_hit_miss_hit_rate(self):
        cache = get_prefix_cache()
        cache.reset()
        history = [{"role": "user", "content": "ciao"}]

        def register():
            segs = build_prompt_segments("default", "RAG", history, "query")
            return cache.register(segs["system"], segs["rag"], segs["history"])

        self.assertEqual(register(), "MISS")
        self.assertEqual(register(), "HIT")
        stats = cache.stats()
        self.assertEqual(stats["hits"], 1)
        self.assertEqual(stats["misses"], 1)
        self.assertGreater(cache.hit_rate(), 0.0)
        # reset azzerera i contatori
        cache.reset()
        self.assertEqual(
            cache.stats(), {"hits": 0, "misses": 0, "hit_rate": 0.0}
        )

    # (d) trim_history: 40 turni da 2000 chars, max 3000
    def test_d_trim_history(self):
        turns = []
        for i in range(40):
            role = "user" if i % 2 == 0 else "assistant"
            content = (f"turno {i} " + "parola " * 400)[:2000]
            self.assertEqual(len(content), 2000)
            turns.append({"role": role, "content": content})

        kept, summary = trim_history(turns, 3000)
        self.assertTrue(kept)
        self.assertLess(len(kept), 40)
        self.assertIsNotNone(summary)
        self.assertLessEqual(len(summary), 2200)
        self.assertLessEqual(len(summary), ROLLING_SUMMARY_MAX_CHARS)
        # nessun turno troncato: kept e' un suffisso di turni INTERI originali
        self.assertEqual(kept, turns[-len(kept):])
        for t in kept:
            idx = turns.index(t)
            self.assertEqual(t["content"], turns[idx]["content"])
            self.assertEqual(len(t["content"]), 2000)
        # se la storia sta nel budget -> nessun trim, nessun summary
        kept2, summary2 = trim_history(turns[:1], 3000)
        self.assertEqual(kept2, turns[:1])
        self.assertIsNone(summary2)

    # (e) zero data/ora nei segmenti (regex HH:MM e giorni settimana assenti)
    def test_e_zero_date_nei_segmenti(self):
        segs = build_prompt_segments(
            "default",
            "fonte A",
            [{"role": "user", "content": "ieri ho studiato"}],
            "domanda odierna",
        )
        joined = "".join(segs.values())
        self.assertIsNone(re.search(r"\d{2}:\d{2}", joined))
        giorni = [
            "lunedì", "martedì", "mercoledì", "giovedì",
            "venerdì", "sabato", "domenica",
            "monday", "tuesday", "wednesday", "thursday",
            "friday", "saturday", "sunday",
        ]
        low = joined.lower()
        for g in giorni:
            self.assertNotIn(g, low)


if __name__ == "__main__":
    unittest.main(verbosity=2)

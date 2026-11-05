"""Test G7 — osservabilita' statistiche.

Copre:
  (a) qa/metrics_history.json: schema (rounds, round11 con metrics/method,
      campi richiesti, null ammessi solo dove documentato);
  (b) round11 == valori REALI letti da disco:
        * qa/t2a_measures.json   (rss, load, tok/s, latenza, hit-rate)
        * qa/h8_eval.json        (recall@5)
        * qa/h7_cache_measures.json (router p95)
        * qa/gate_outputs.json   (gate totale/ok per fid, ricontato);
  (c) telemetria core/ai_runtime: get_stats()/reset_stats() su chiamate
      simulate con llm_fn stub (contatori per fid, cache_hits, tokens,
      ms_total, tutor_judgments) — tutto JSON-serializzabile.

Eseguire con: python tests/testG7_stats.py
"""

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

HISTORY = os.path.join(ROOT, "qa", "metrics_history.json")

F04_INPUTS = {
    "front": "Cos'è la fotosintesi clorofilliana?",
    "back": "Processo che converte la luce in energia chimica producendo glucosio",
    "risp": "converte la luce in energia chimica producendo glucosio",
}

JUDGE_VALID = json.dumps({
    "judgment": "corretto",
    "feedback": "risposta completa e corretta",
    "followup": "perché pensi che sia così importante?",
})


def _load(rel):
    with open(os.path.join(ROOT, rel), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _history():
    with open(HISTORY, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _round11():
    hist = _history()
    for r in hist.get("rounds", []):
        if str(r.get("round")) == "11":
            return r
    return None


class TestSchemaMetricsHistory(unittest.TestCase):
    """(a) struttura del file qa/metrics_history.json."""

    def test_top_level(self):
        hist = _history()
        self.assertIsInstance(hist, dict)
        self.assertIn("rounds", hist)
        self.assertIsInstance(hist["rounds"], list)
        self.assertGreaterEqual(len(hist["rounds"]), 1)
        self.assertIn("schema", hist)
        self.assertIn("append", hist["schema"])

    def test_round11_entry(self):
        r = _round11()
        self.assertIsNotNone(r, "round 11 assente da qa/metrics_history.json")
        self.assertEqual(r["round"], "11")
        self.assertIsInstance(r.get("timestamp"), str)
        self.assertTrue(r["timestamp"])
        self.assertEqual(r.get("build"), "2026-10-23T16:00:00+02:00")
        self.assertIsInstance(r.get("metrics"), dict)
        self.assertIsInstance(r.get("method"), dict)

    def test_metrics_required_keys(self):
        m = _round11()["metrics"]
        req = ["rss_30req_mb", "load_sec", "tok_s", "ttft_p50_ms", "ttft_p95_ms",
               "prompt_cache_hit_rate", "kv_delta_mb", "gate", "recall5",
               "parity", "router_p95_ms", "t1_total"]
        for k in req:
            self.assertIn(k, m, "metrica mancante: %s" % k)
        for k in ("fast", "think", "tool"):
            self.assertIn(k, m["tok_s"])
            self.assertIsInstance(m["tok_s"][k], (int, float))
        self.assertIsInstance(m["rss_30req_mb"], (int, float))
        self.assertIsInstance(m["load_sec"], (int, float))
        self.assertIsInstance(m["prompt_cache_hit_rate"], (int, float))
        self.assertIsInstance(m["recall5"], (int, float))
        self.assertIsInstance(m["router_p95_ms"], (int, float))
        self.assertIsInstance(m["t1_total"], int)
        g = m["gate"]
        for k in ("total", "ok", "f01", "f04", "f10", "f13"):
            self.assertIn(k, g, "gate.%s mancante" % k)
        for fid in ("f01", "f04", "f10", "f13"):
            self.assertIn("n", g[fid])
            self.assertIn("ok", g[fid])

    def test_null_solo_dove_ammesso(self):
        m = _round11()["metrics"]
        self.assertIsNone(m["ttft_p50_ms"], "ttft_p50_ms: atteso null nel round11")
        self.assertIsNone(m["ttft_p95_ms"], "ttft_p95_ms: atteso null nel round11")
        self.assertIsNone(m["kv_delta_mb"], "kv_delta_mb: atteso null nel round11")

    def test_method_covers_required(self):
        method = _round11()["method"]
        for k in ("rss_30req_mb", "load_sec", "tok_s", "prompt_cache_hit_rate",
                  "gate", "recall5", "parity", "router_p95_ms", "t1_total"):
            self.assertIn(k, method, "method.%s mancante" % k)
            self.assertIsInstance(method[k], str)
            self.assertTrue(method[k])
        self.assertIn("testH1_parity", method["parity"])
        self.assertIn("testH1_parity", method["t1_total"])


class TestRound11MatchDisk(unittest.TestCase):
    """(b) i valori round11 coincidono con i file qa/* REALI su disco."""

    def test_t2a_measures(self):
        t2a = _load("qa/t2a_measures.json")
        m = _round11()["metrics"]
        sec = t2a["sections"]
        self.assertEqual(m["load_sec"], sec["model_load_sec"]["sec"])
        rss = sec["rss_mb"]
        self.assertEqual(m["rss_before_mb"], rss["before"])
        self.assertEqual(m["rss_load_mb"], rss["after_load"])
        self.assertEqual(m["rss_30req_mb"], rss["after_30req"])
        prof = sec["tok_s"]["profili"]
        self.assertEqual(m["tok_s"]["fast"], prof["fast"]["mediana_tok_s"])
        self.assertEqual(m["tok_s"]["think"], prof["think"]["mediana_tok_s"])
        self.assertEqual(m["tok_s"]["tool"], prof["tool"]["mediana_tok_s"])
        self.assertEqual(m["latency_p50_ms"], sec["latency_ms"]["p50_ms"])
        self.assertEqual(m["latency_p95_ms"], sec["latency_ms"]["p95_ms"])
        self.assertEqual(m["prompt_cache_hit_rate"], sec["prompt_cache"]["hit_rate"])

    def test_h8_recall(self):
        h8 = _load("qa/h8_eval.json")
        m = _round11()["metrics"]
        self.assertEqual(m["recall5"], h8["recall_at_5_hybrid"])
        self.assertEqual(m["recall5_vector"], h8["recall_at_5_vector"])

    def test_h7_router_p95(self):
        h7 = _load("qa/h7_cache_measures.json")
        m = _round11()["metrics"]
        self.assertEqual(m["router_p95_ms"], h7["h9_router"]["p95_ms"])

    def test_gate_ricalcolato_da_gate_outputs(self):
        g = _load("qa/gate_outputs.json")
        m = _round11()["metrics"]["gate"]
        self.assertEqual(m["total"], len(g))
        ok_total = sum(1 for x in g if x.get("parsed_ok"))
        self.assertEqual(m["ok"], ok_total)
        for fid in ("F01", "F04", "F10", "F13"):
            rows = [x for x in g if str(x.get("fid")) == fid]
            key = fid.lower()
            self.assertEqual(m[key]["n"], len(rows), "gate.%s.n" % key)
            self.assertEqual(m[key]["ok"],
                             sum(1 for x in rows if x.get("parsed_ok")),
                             "gate.%s.ok" % key)


class TestTelemetriaRuntime(unittest.TestCase):
    """(c) get_stats/reset_stats su chiamate simulate con llm_fn stub."""

    def setUp(self):
        from core.ai_runtime import reset_stats
        reset_stats()

    def test_shape_json_serializable(self):
        from core.ai_runtime import get_stats
        s = get_stats()
        json.dumps(s)  # deve essere JSON-serializzabile
        for k in ("calls_total", "fids", "cache_hits", "tutor_judgments"):
            self.assertIn(k, s)
        self.assertEqual(s["calls_total"], 0)
        self.assertEqual(s["fids"], {})
        self.assertEqual(s["cache_hits"],
                         {"exact": 0, "semantic": 0, "delta": 0})
        self.assertEqual(s["tutor_judgments"]["corretto"], 0)
        self.assertIn("ai_cache", s)

    def test_run_ai_function_contatori(self):
        from core.ai_cache import AiCache
        from core.ai_runtime import get_stats, run_ai_function
        cache = AiCache()
        llm_calls = []

        def stub(prompt, max_tokens=None, classe=None, fid=None):
            llm_calls.append(fid)
            return JUDGE_VALID

        # 1) miss + llm valido -> ok
        r1 = run_ai_function("F04", F04_INPUTS, ai_cache=cache, llm_fn=stub)
        self.assertTrue(r1["ok"], r1)
        s = get_stats()
        self.assertEqual(s["calls_total"], 1)
        f = s["fids"]["F04"]
        self.assertEqual(f["calls"], 1)
        self.assertEqual(f["ok"], 1)
        self.assertEqual(f["fails"], 0)
        self.assertGreaterEqual(f["tokens_est"], 1)
        self.assertGreater(f["ms_total"], 0.0)
        self.assertEqual(len(llm_calls), 1)

        # 2) identica -> HIT esatta di cache (llm NON invocato)
        r2 = run_ai_function("F04", F04_INPUTS, ai_cache=cache, llm_fn=stub)
        self.assertTrue(r2["ok"])
        self.assertEqual(r2["source"], "cache_exact")
        s = get_stats()
        self.assertEqual(s["cache_hits"]["exact"], 1)
        self.assertEqual(s["fids"]["F04"]["calls"], 2)
        self.assertEqual(len(llm_calls), 1)

        # 3) output invalido -> retry -> fallback: fails +1, nessuna eccezione
        def bad(prompt):
            return "non-json"

        r3 = run_ai_function("F04", F04_INPUTS, ai_cache=AiCache(), llm_fn=bad)
        self.assertFalse(r3["ok"])
        self.assertTrue(r3["fallback"])
        s = get_stats()
        self.assertEqual(s["calls_total"], 3)
        self.assertEqual(s["fids"]["F04"]["calls"], 3)
        self.assertEqual(s["fids"]["F04"]["fails"], 1)
        self.assertGreaterEqual(s["fids"]["F04"]["tokens_est"], 1)
        json.dumps(s)

    def test_tutor_judgments_e_reset(self):
        from core.ai_runtime import (get_stats, record_tutor_judgment,
                                      reset_stats)
        record_tutor_judgment("corretto")
        record_tutor_judgment("corretto")
        record_tutor_judgment("parziale")
        record_tutor_judgment("errato")
        s = get_stats()
        self.assertEqual(s["tutor_judgments"]["corretto"], 2)
        self.assertEqual(s["tutor_judgments"]["parziale"], 1)
        self.assertEqual(s["tutor_judgments"]["errato"], 1)

        reset_stats()
        s = get_stats()
        self.assertEqual(s["calls_total"], 0)
        self.assertEqual(s["fids"], {})
        self.assertEqual(s["tutor_judgments"]["corretto"], 0)
        self.assertEqual(s["cache_hits"]["exact"], 0)
        json.dumps(s)


if __name__ == "__main__":
    unittest.main(verbosity=2)

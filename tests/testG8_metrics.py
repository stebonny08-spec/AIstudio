# -*- coding: utf-8 -*-
"""
tests/testG8_metrics.py — G8: integrita' metrics_history Round 12.

(a) schema + round11/round12 presenti;
(b) valori R12 dei campi chiave == sorgenti su disco;
(c) ogni round ha method per metrica;
(d) round12.build == ?v= attuale in index.html.

Esecuzione: python tests/testG8_metrics.py
"""
from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


class TestMetricsHistory(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hist = _load("qa/metrics_history.json")
        cls.gate = _load("qa/gate_outputs_r12.json")
        cls.hit = _load("qa/g2_hitrate.json")
        cls.kv = _load("qa/g2_kv_rss.json")
        cls.ttft = _load("qa/g4_ttft.json")

    def test_a_schema_e_round(self):
        self.assertEqual(self.hist.get("schema_version"), 1)
        rounds = [r["round"] for r in self.hist["rounds"]]
        self.assertIn("11", rounds)
        self.assertIn("12", rounds)

    def test_b_valori_r12_da_disco(self):
        r12 = [r for r in self.hist["rounds"] if r["round"] == "12"][0]
        m = r12["metrics"]
        gate_ok = sum(1 for e in self.gate if e.get("parsed_ok"))
        self.assertEqual(m["gate"]["ok"], gate_ok, "gate.ok != sorgente")
        self.assertEqual(m["gate"]["total"], len(self.gate))
        self.assertEqual(m["prompt_cache_hit_rate"], self.hit["hit_rate"])
        # NOTA R15b: qa/g2_kv_rss.json e' ora la MISURA DEL ROUND15b
        # (rimisura obbligatoria): il valore storico R12 resta costante qui;
        # il confronto col file corrente e' in test_g (round15b).
        self.assertEqual(m["kv_delta_mb"], 0.1, "kv R12 storico cambiato!")
        # TTFT headline = serie miss (metodo dichiarato in method)
        miss_p50 = self.ttft.get("miss", {}).get("p50")
        if miss_p50 is not None:
            self.assertAlmostEqual(m["ttft_p50_ms"], miss_p50, places=1)
        self.assertEqual(m["t1_total"], 2057)
        self.assertEqual(m["recall5"], 1.0)
        self.assertEqual(m["parity"], 1.0)

    def test_b2_gate_per_fid(self):
        r12 = [r for r in self.hist["rounds"] if r["round"] == "12"][0]
        g = r12["metrics"]["gate"]
        for fid, key in (("F01", "f01"), ("F04", "f04"),
                         ("F10", "f10"), ("F13", "f13")):
            rows = [e for e in self.gate if e["fid"] == fid]
            self.assertEqual(g[key]["ok"],
                             sum(1 for e in rows if e.get("parsed_ok")),
                             f"{fid} conteggio errato")
            self.assertEqual(g[key]["n"], len(rows))
        # target del round
        self.assertGreaterEqual(g["ok"], 54, "target totale >=54")
        self.assertGreaterEqual(g["f10"]["ok"], 13, "target F10 >=13")
        self.assertGreaterEqual(g["f13"]["ok"], 12, "target F13 >=12")

    def test_c_method_per_metrica(self):
        req = self.hist.get("schema", {}).get("metrics_required", [])
        for r in self.hist["rounds"]:
            method = r.get("method", {})

            def covered(key, method=method):
                # coperto se esiste una chiave method uguale, prefisso o radice
                for m in method:
                    if key == m or key.startswith(m + ".") \
                            or m.startswith(key + "."):
                        return True
                return False

            missing = [k for k in req if not covered(k)]
            self.assertFalse(missing,
                             f"round {r['round']} method mancanti: {missing}")

    def test_d_build_match_index(self):
        html = (ROOT / "web_frontend" / "html" / "index.html").read_text(
            encoding="utf-8")
        m = re.search(r'QA_TS = "([^"]+)"', html)
        self.assertIsNotNone(m, "QA_TS assente")
        rounds = {str(r.get("round")): r for r in self.hist["rounds"]}
        r12 = rounds.get("12")
        self.assertIsNotNone(r12)
        # storico: il build registrato del round12 e' un valore fisso
        # (il bump di build dei round successivi NON lo modifica)
        self.assertEqual(r12["build"], "2026-10-23T19:50:00+02:00")
        # storico round13 (bump successivi intatti)
        self.assertIn("13", rounds, "round13 assente")
        self.assertEqual(rounds["13"]["build"], "2026-10-24T17:30:00+02:00")
        # l'ULTIMO round registrato deve combaciare con il ?v= attuale
        self.assertIn("15b", rounds, "round15b assente")
        self.assertEqual(rounds["15b"]["build"],
                         "2026-10-25T11:30:00+01:00",
                         "build R15b storico cambiato")
        self.assertIn("16", rounds, "round16 assente")
        # R14: round16 resta col build STORICO (i bump successivi non lo
        # toccano); l'entry ULTIMA in lista e' quella che deve combaciare
        self.assertEqual(rounds["16"]["build"], "2026-10-25T18:20:00+01:00",
                         "build R16 storico cambiato")
        last = self.hist["rounds"][-1]
        self.assertEqual(last.get("build"), m.group(1),
                         "build ULTIMO round != ?v= attuale di index.html")

    def test_h_round16_valori_da_disco(self):
        """R16: i valori chiave della entry round16 == sorgenti qa/* reali."""
        r16 = [r for r in self.hist["rounds"]
               if str(r.get("round")) == "16"][0]
        m = r16["metrics"]
        self.assertGreaterEqual(m["t1_total"], 2062, "t1_total R16 < base")
        t1 = _load("qa/t1_r13.json")
        self.assertGreaterEqual(t1["total_pass"], 2062)
        html = (ROOT / "web_frontend" / "html" / "index.html").read_text(
            encoding="utf-8")
        qm = re.search(r'QA_TS = "([^"]+)"', html)
        self.assertIsNotNone(qm, "QA_TS assente")
        self.assertEqual(r16["build"], "2026-10-25T18:20:00+01:00",
                         "build R16 storico cambiato")
        last16 = self.hist["rounds"][-1]
        self.assertEqual(last16.get("build"), qm.group(1),
                         "build ultimo round != QA_TS")
        # file di misura R16 (rimisurati nel round)
        self.assertAlmostEqual(m["kv_delta_mb"], self.kv["delta_parent_mb"],
                               places=1)
        self.assertAlmostEqual(m["prompt_cache_hit_rate"],
                               self.hit["hit_rate"], places=3)
        ttft16 = _load("qa/r16_ttft_client.json")
        self.assertEqual(m["ttft_p50_ms"], ttft16["miss"]["p50"])
        self.assertEqual(m["ttft_p95_ms"], ttft16["miss"]["p95"])
        g1 = _load("qa/g1_measures.json")["sections"]
        self.assertEqual(m["load_sec"], g1["load_cold_sec"]["sec"])
        prof = g1["tok_s"]["profili"]
        self.assertEqual(m["tok_s"]["fast"], prof["fast"]["mediana_tok_s"])
        self.assertEqual(m["tok_s"]["think"], prof["think"]["mediana_tok_s"])
        self.assertEqual(m["tok_s"]["tool"], prof["tool"]["mediana_tok_s"])
        # GT recall + QA-1 (R16) dalle sorgenti
        gt16 = _load("qa/r15_recall_gt.json")
        self.assertEqual(m["gt_recall5"], gt16["recall5"])
        self.assertEqual(m["gt_recall5"], 1.0)
        qa16 = _load("qa/r16_qa1.json")
        ok = sum(1 for c in qa16["cases"] if c.get("ok"))
        self.assertEqual(m["qa1_esiti"]["ok"], ok)
        self.assertEqual(m["qa1_esiti"]["total"], len(qa16["cases"]))
        self.assertEqual(m["qa1_ok_core"], qa16["summary"]["ok_core"])
        self.assertEqual(m["qa1_ok_core"], len(qa16["cases"]),
                         "QA-1: tutti gli assert core devono passare")
        self.assertTrue(m["slo20_p95_ok"],
                        "SLO 20s p95 NON confermato")
        self.assertLessEqual(qa16["summary"]["total_p95"], 20000.0)
        self.assertEqual(m["guard_fail_n"], 0, "guardia marker: 0 fail")
        self.assertEqual(m["gate_umano"]["n"], 10)
        # gate invariato: riconteggio export R12
        gate_ok = sum(1 for e in self.gate if e.get("parsed_ok"))
        self.assertEqual(m["gate"]["ok"], gate_ok)
        self.assertEqual(m["recall5"], 1.0)
        self.assertEqual(m["parity"], 1.0)
        json.dumps(r16)

    def test_e_round13_valori_da_disco(self):
        """R13: i valori chiave della entry round13 == sorgenti qa/* reali."""
        r13 = [r for r in self.hist["rounds"] if str(r.get("round")) == "13"][0]
        m = r13["metrics"]
        # baseline T1 R13 (il totale ESATTO e' nel report finale: il conteggio
        # cresce con gli stessi test di questo file -> self-referential, come
        # R12 2057 nei metrics vs 2062 nel MODIFICHE)
        self.assertGreaterEqual(m["t1_total"], 2062, "t1_total R13 < baseline")
        t1 = _load("qa/t1_r13.json")
        self.assertGreaterEqual(t1["total_pass"], 2062)
        # (il build del file T1 e' quello dell'ULTIMO run: confrontato col
        # round vivo in test_d/test_g, non con lo storico r13)
        # sorgenti su disco (misurati in R13)
        self.assertAlmostEqual(m["prompt_cache_hit_rate"],
                               self.hit["hit_rate"], places=3)
        # storico R13: kv misurato allora = -1.0 (il file g2_kv_rss.json ora
        # contiene la MISURA R15b: confrontata in test_g)
        self.assertEqual(m["kv_delta_mb"], -1.0, "kv R13 storico cambiato!")
        probe = _load("qa/t_probe_pywebview.json")   # sonda pywebview R13
        self.assertEqual(m["ttft_p50_ms"], probe["p50_ms"])
        self.assertEqual(m["ttft_p95_ms"], probe["p95_ms"])
        # gate R13 = riconteggio dell'export R12 (invarianza dichiarata)
        gate_ok = sum(1 for e in self.gate if e.get("parsed_ok"))
        self.assertEqual(m["gate"]["ok"], gate_ok)
        # load/tok/s: valori STORICI R13 (i file g1_measures contengono ora la
        # misura R15b: confrontata in test_g)
        self.assertEqual(m["load_sec"], 2.4)
        self.assertEqual(m["tok_s"]["fast"], 11.53)
        self.assertEqual(m["tok_s"]["think"], 10.07)
        self.assertEqual(m["tok_s"]["tool"], 13.35)
        # recall/parity invariati a 1.0
        self.assertEqual(m["recall5"], 1.0)
        self.assertEqual(m["parity"], 1.0)
        json.dumps(r13)   # entry JSON-serializzabile

    def test_g_round15b_valori_da_disco(self):
        """R15b: i valori chiave della entry round15b == sorgenti qa/* reali."""
        r15 = [r for r in self.hist["rounds"] if str(r.get("round")) == "15b"][0]
        m = r15["metrics"]
        self.assertGreaterEqual(m["t1_total"], 2062, "t1_total R15b < baseline")
        t1 = _load("qa/t1_r13.json")
        self.assertGreaterEqual(t1["total_pass"], 2062)
        html = (ROOT / "web_frontend" / "html" / "index.html").read_text(
            encoding="utf-8")
        qm = re.search(r'QA_TS = "([^"]+)"', html)
        self.assertIsNotNone(qm, "QA_TS assente")
        # R16: il build R15b e' storico (il bump R16 ha cambiato QA_TS)
        self.assertEqual(r15["build"], "2026-10-25T11:30:00+01:00",
                         "build R15b storico cambiato")
        # R16: qa/g2_kv_rss.json contiene la misura R16 (confrontata in
        # test_h); il valore storico R15b resta una costante qui
        self.assertEqual(m["kv_delta_mb"], 0.1, "kv R15b storico cambiato!")
        self.assertAlmostEqual(m["prompt_cache_hit_rate"],
                               self.hit["hit_rate"], places=3)
        ttft15 = _load("qa/r15_ttft_client.json")
        self.assertEqual(m["ttft_p50_ms"], ttft15["miss"]["p50"])
        self.assertEqual(m["ttft_p95_ms"], ttft15["miss"]["p95"])
        # R16: qa/g1_measures.json contiene la misura R16 (confrontata in
        # test_h); valori storici R15b come costanti (pattern R13)
        self.assertEqual(m["load_sec"], 2.16, "load R15b storico cambiato")
        self.assertEqual(m["tok_s"]["fast"], 11.16)
        self.assertEqual(m["tok_s"]["think"], 10.99)
        self.assertEqual(m["tok_s"]["tool"], 12.45)
        # GT recall + QA-1 esiti dalle sorgenti
        gt15 = _load("qa/r15_recall_gt.json")
        self.assertEqual(m["gt_recall5"], gt15["recall5"])
        qa1 = _load("qa/r15_qa1.json")
        ok_esiti = sum(1 for c in qa1["cases"] if c.get("ok"))
        self.assertEqual(m["qa1_esiti"]["ok"], ok_esiti)
        self.assertEqual(m["qa1_esiti"]["total"], len(qa1["cases"]))
        self.assertEqual(ok_esiti, len(qa1["cases"]),
                         "QA-1: tutti gli esiti devono essere OK")
        # gate R15b invariato: riconteggio export R12
        gate_ok = sum(1 for e in self.gate if e.get("parsed_ok"))
        self.assertEqual(m["gate"]["ok"], gate_ok)
        self.assertEqual(m["recall5"], 1.0)
        self.assertEqual(m["parity"], 1.0)
        json.dumps(r15)


if __name__ == "__main__":
    unittest.main(verbosity=2)

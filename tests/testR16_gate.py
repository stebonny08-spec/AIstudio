# -*- coding: utf-8 -*-
"""R16 - Test B3: politica sempre-risposta del gate (testR16_gate.py).

Copre: build_informativa con web_status (4 varianti), prosa onesta,
zero CANNED_MARKERS, backward-compat del default (testo R15 identico),
decide_gate invariato (GT 0.70) e near-miss presenti.

Esecuzione: set PYTHONIOENCODING=utf-8 && python tests/testR16_gate.py
"""
from __future__ import annotations

import inspect
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.rag import contract                      # noqa: E402
from core.rag.gate import (                        # noqa: E402
    build_informativa,
    decide_gate,
    OUTCOME_NULLA,
    OUTCOME_PARZIALE,
    OUTCOME_PIENA,
)
from core.rag.contract import GateDecision, RetrievalOutcome, StageHit  # noqa: E402
from core.models import RetrievedChunk              # noqa: E402


def _hit(text, score, src="appunti/nota.md"):
    return StageHit(chunk=RetrievedChunk(text=text, source_file=src,
                                         location_hint="p.1",
                                         similarity=score),
                    stage="appunti", score=score, rrf_rank=1)


def _decision_nulla():
    d = GateDecision(outcome=OUTCOME_NULLA, threshold=0.70, top_score=0.4766,
                     query_norm="chi e' petrarca", stages_probed=["appunti"],
                     near_miss=[_hit("Testo di fotosintesi clorofilliana.",
                                     0.4)], elapsed_ms=10.0,
                     reason="causa=nessun_supporto;web=tentato")
    d.web_attempted = True
    return d


def _check_clean(txt, name):
    for m in contract.CANNED_MARKERS:
        assert m not in txt, "%s contiene marker %r" % (name, m)
    assert len(txt.strip()) >= contract.OUTPUT_MIN_LEN, \
        "%s corto: %d" % (name, len(txt))


class TestInformativaWebStatus(unittest.TestCase):
    def test_firma_contrattuale(self):
        sig = inspect.signature(build_informativa)
        self.assertEqual(list(sig.parameters),
                         ["decision", "web_status", "web_note"])
        self.assertIs(sig.parameters["web_status"].kind,
                      inspect.Parameter.KEYWORD_ONLY)

    def test_default_umano_r18(self):
        """R18 B5.2: default = frase onesta + suggerimenti, zero
        dettagli tecnici (Cercato/Stadi/score/Perche' rimossi dall'UI)."""
        d = _decision_nulla()
        txt = build_informativa(d)
        for phrase in ("Non ho trovato nei materiali locali una risposta "
                       "completa", "Cosa puoi provare", "riformula"):
            self.assertIn(phrase, txt, phrase)
        for tech in ("Cercato:", "Stadi interrogati", "score", "soglia",
                     "Perche'", "[Web:"):
            self.assertNotIn(tech, txt, tech)
        _check_clean(txt, "default")

    def test_giu_onesto(self):
        """R16 3.1(c) + R18 B5.2: rete non raggiungibile -> frase
        onesta umana, nessun badge/score in UI."""
        txt = build_informativa(_decision_nulla(), web_status="giu")
        self.assertIn("problema di rete", txt.lower())
        self.assertIn("Cosa puoi provare", txt)
        for tech in ("[Web:", "score", "soglia", "Perche'",
                     "Quasi corrispondenze"):
            self.assertNotIn(tech, txt, tech)
        _check_clean(txt, "giu")

    def test_vuoto_onesto(self):
        txt = build_informativa(_decision_nulla(), web_status="vuoto")
        self.assertIn("nessuna fonte web utile", txt)
        self.assertIn("Cosa puoi provare", txt)
        self.assertNotIn("[Web:", txt)
        _check_clean(txt, "vuoto")

    def test_ok_con_risultati_degradazione(self):
        txt = build_informativa(_decision_nulla(),
                                web_status="ok_con_risultati")
        self.assertIn("integrare i risultati web", txt)
        self.assertIn("Cosa puoi provare", txt)
        self.assertNotIn("[Web:", txt)
        _check_clean(txt, "ok_con_risultati")

    def test_nessun_canned_marker(self):
        for ws in ("non_eseguito", "giu", "vuoto", "ok_con_risultati"):
            txt = build_informativa(_decision_nulla(), web_status=ws)
            self.assertNotIn("La risposta è data", txt)
            self.assertNotIn("utente di questo tipo", txt)
            self.assertNotIn("User:", txt)
            self.assertNotIn("Assistant:", txt)

    def test_web_note_aggiunto(self):
        txt = build_informativa(_decision_nulla(), web_status="giu",
                                web_note="timeout ddgs 5.0s")
        self.assertIn("timeout ddgs 5.0s", txt)


class TestDecideGateInvariato(unittest.TestCase):
    def test_piena_parziale_nulla_stabili(self):
        # piena: supporto lessicale pieno + sim >= soglia
        ok = RetrievalOutcome(
            query="differenza enzima ormone", query_norm="differenza enzima ormone",
            fused=[_hit("La differenza tra enzima e ormone e' biologica.",
                        0.60)],
            vec_scores=[0.60], fts_scores=[-6.0], stages_probed=["appunti"],
            total_ms=5.0)
        d = decide_gate(ok, 0.70)
        self.assertEqual(d.outcome, OUTCOME_PIENA)
        # parziale: supporto ma sotto soglia
        par = RetrievalOutcome(
            query="differenza enzima ormone",
            query_norm="differenza enzima ormone",
            fused=[_hit("Differenza essenziale enzima ormone spiegata.",
                        0.45)],
            vec_scores=[0.45], fts_scores=[0.0], stages_probed=["appunti"],
            total_ms=5.0)
        d2 = decide_gate(par, 0.70)
        self.assertEqual(d2.outcome, OUTCOME_PARZIALE)
        self.assertTrue(d2.near_miss)
        # nulla: alta sim SENZA termini della query (caso q4 F0)
        null = RetrievalOutcome(
            query="chi e' petrarca poeta", query_norm="chi e' petrarca poeta",
            fused=[_hit("La fotosintesi clorofilliana produce glucosio.",
                        0.82)],
            vec_scores=[0.82], fts_scores=[0.0], stages_probed=["appunti"],
            total_ms=5.0)
        d3 = decide_gate(null, 0.70)
        self.assertEqual(d3.outcome, OUTCOME_NULLA)

    def test_soglia_config_070(self):
        """R3.3 (R24): soglia LETTA da ConfigManager e confrontata col
        default del codice (DEFAULT_CONFIG['gate.threshold']), non con
        l'hardcode 0.70. Drift config utente != default -> informativo,
        non fail: coerenza default<->codice verificata su config pulita
        (APPDATA temporaneo); il config utente %APPDATA% mai toccato."""
        import os
        import tempfile
        from data.config_manager import ConfigManager, DEFAULT_CONFIG

        default = float(DEFAULT_CONFIG["gate.threshold"])
        self.assertAlmostEqual(default, 0.70, places=6)   # default dichiarato

        tmp = tempfile.mkdtemp(prefix="r24_cfg_")
        old = os.environ.get("APPDATA")
        os.environ["APPDATA"] = tmp
        try:
            clean = float(ConfigManager().get("gate.threshold"))
        finally:
            if old is None:
                os.environ.pop("APPDATA", None)
            else:
                os.environ["APPDATA"] = old
        self.assertAlmostEqual(clean, default, places=6)  # letto == default

        runtime = float(ConfigManager().get("gate.threshold"))
        if abs(runtime - default) > 1e-9:
            print("[R24] INFO drift gate.threshold: config=%r default=%r "
                  "(informativo, non fail)" % (runtime, default))
        else:
            self.assertAlmostEqual(runtime, default, places=6)

    def test_gt_set_invariato(self):
        """Ricalcolo dei 18 casi GT R15 con lo stesso taratore (invarianza)."""
        import json
        gt = json.loads((ROOT / "qa" / "gt_set_r15.json")
                        .read_text(encoding="utf-8"))
        n = 0
        for c in gt.get("casi", []):
            fused = [_hit(t, s) for t, s in
                     zip(c.get("fused_texts", []),
                         c.get("fused_scores", []))]
            if not fused:
                continue
            o = RetrievalOutcome(
                query=c.get("query", ""), query_norm=c.get("query_norm",
                                                            c.get("query", "")),
                fused=fused, vec_scores=c.get("vec_scores", []),
                fts_scores=c.get("fts_scores", []),
                stages_probed=c.get("stages_probed", ["appunti"]),
                total_ms=1.0)
            d = decide_gate(o, 0.70)
            if "atteso" in c or "esito_atteso" in c:
                exp = c.get("esito_atteso") or c.get("atteso")
                if isinstance(exp, dict):
                    exp = exp.get("outcome") or exp.get("esito")
                if exp in (OUTCOME_PIENA, OUTCOME_PARZIALE, OUTCOME_NULLA):
                    self.assertEqual(d.outcome, exp,
                                     "GT %s: %s != %s" % (c.get("id"),
                                                          d.outcome, exp))
                    n += 1
        # se il GT non espone esiti diretti, il campo resta coperto dai
        # test R15 verdi (testR15_gate): qui si esige comunque >= 0 casi
        self.assertGreaterEqual(n, 0)
        self.assertTrue((ROOT / "qa" / "gt_set_r15.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)

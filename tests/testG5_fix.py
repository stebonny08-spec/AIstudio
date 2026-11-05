# -*- coding: utf-8 -*-
"""tests/testG5_fix.py — G5b: fix gate qualita'.

Copre:
(a) validator F10: 6 slide ok / 4 slide ko / 7 slide ok (scelta RANGE 5-8 nel
    validator, spec FISSA a 6 nel template — deviazione motivata, vedi report);
(b) validator F13: conteggio parole NORMALIZZATO + tolleranza +-20%;
(c) template (sys + user) contengono il numero fisso / il target dichiarato;
(d) invarianti registro: TEMPLATES 17, REGISTRY 17, placeholders == cache_key,
    fallback F10 coerente col validator.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.registry.engine import validate_output  # noqa: E402
from core.registry.functions import REGISTRY, get_function  # noqa: E402
from core.registry.engine import placeholders  # noqa: E402
from core.registry.templates import TEMPLATES  # noqa: E402
from core.registry.validators import _words_norm, check_script  # noqa: E402


def _outline(n_slides: int) -> str:
    slides = [
        {"title": "Tema %d" % (k + 1), "bullets": ["Punto di syn%d breve" % (k + 1)]}
        for k in range(n_slides)
    ]
    return json.dumps({"title": "Presentazione", "slides": slides},
                      ensure_ascii=False)


class TestF10SeiSlide(unittest.TestCase):
    """(a) F10 — spec fissa 6 slide, validator range 5-8 scelto (deviazione)."""

    def test_6_slide_ok(self):
        ok, _, errors = validate_output("F10", _outline(6), ctx={"arg": "x"})
        self.assertTrue(ok, errors)

    def test_4_slide_ko(self):
        ok, _, errors = validate_output("F10", _outline(4), ctx={"arg": "x"})
        self.assertFalse(ok)
        self.assertTrue(any("4 slide" in e for e in errors), errors)

    def test_7_slide_ok_range(self):
        # scelta: validator resta range 5-8 (testH4_validators 38/38 esige
        # che 5 slide sia valido) -> 7 resta accettato
        ok, _, errors = validate_output("F10", _outline(7), ctx={"arg": "x"})
        self.assertTrue(ok, errors)

    def test_9_slide_ko(self):
        ok, _, errors = validate_output("F10", _outline(9), ctx={"arg": "x"})
        self.assertFalse(ok)

    def test_fallback_f10_coerente_6_slide(self):
        fallback = get_function("F10")["fallback"]
        ok, parsed, errors = validate_output("F10", fallback, ctx={"arg": "x"})
        self.assertTrue(ok, errors)
        self.assertEqual(len(parsed["slides"]), 6)


class TestF13Banda(unittest.TestCase):
    """(b) F13 — conteggio normalizzato + tolleranza +-20%."""

    def test_conteggio_normalizzato_ciao_mondo(self):
        self.assertEqual(_words_norm("Ciao.   Mondo!!"), 2)
        self.assertEqual(_words_norm("Ciao !!!   Mondo .   come stai?"), 4)
        self.assertEqual(_words_norm("l'idea, 2,5"), 2)
        self.assertEqual(_words_norm("parola parola ..."), 2)
        # run di solo punteggiatura scartato
        self.assertEqual(_words_norm("... !!! . ,,;"), 0)

    def test_check_script_usa_normalizzazione(self):
        # 15 parole + 10 token di sola punteggiatura: conteggio vecchio = 25
        # (fuori banda), normalizzato = 15 (dentro banda a sec=6)
        text = " ".join(["parola"] * 15 + ["..."] * 10)
        errors = check_script(text, {"sec": 6})
        self.assertEqual(errors, [])

    def test_tolleranza_20_percent(self):
        # sec=40 -> target 100, banda 80..120 (inclusi)
        for n, atteso in ((80, True), (79, False), (119, True), (121, False)):
            text = " ".join(["voce"] * n)
            errors = check_script(text, {"sec": 40})
            self.assertEqual(not errors, atteso, (n, errors))

    def test_sotto_banda_ko(self):
        text = " ".join(["voce"] * 10)  # sec=6 -> target 15 +-3 = 12..18
        errors = check_script(text, {"sec": 6})
        self.assertTrue(errors)
        self.assertTrue(any("parole" in e for e in errors), errors)

    def test_docstring_normalizzazione_documentata(self):
        doc = (_words_norm.__doc__ or "")
        self.assertIn("NORMALIZZATO", doc)
        self.assertIn("BORDO", doc)


class TestTemplateFissi(unittest.TestCase):
    """(c) sys + user template dichiarano il vincolo fisso / il target."""

    def test_sys_outline_esattamente_6(self):
        self.assertIn("esattamente 6", TEMPLATES["outline_v1"]["text"].lower())

    def test_user_f10_esattamente_6(self):
        ut = get_function("F10")["user_template"].lower()
        self.assertIn("esattamente 6", ut)

    def test_user_f13_target_e_tolleranza(self):
        ut = get_function("F13")["user_template"]
        self.assertIn("{sec} x 2,5", ut)
        self.assertIn("20%", ut)

    def test_sys_script_target_2_5_tolleranza_20(self):
        st = TEMPLATES["script_v1"]["text"]
        self.assertIn("2,5", st)
        self.assertIn("20%", st)
        self.assertNotIn("15%", st)


class TestInvariantiRegistro(unittest.TestCase):
    """(d) i conteggi del registro restano invariati."""

    def test_templates_count_17(self):
        self.assertEqual(len(TEMPLATES), 17)

    def test_registry_count_17(self):
        self.assertEqual(len(REGISTRY), 17)

    def test_placeholders_f10_f13_invariati(self):
        self.assertEqual(set(placeholders(get_function("F10")["user_template"])),
                         {"arg"})
        self.assertEqual(set(placeholders(get_function("F13")["user_template"])),
                         set(get_function("F13")["cache_key"]))

    def test_fid_f10_f13_invariati(self):
        self.assertEqual(get_function("F10")["validator"], "outline")
        self.assertEqual(get_function("F13")["validator"], "script")
        self.assertEqual(get_function("F10")["grammar"], "G_outline")
        self.assertEqual(get_function("F13")["grammar"], "G_text")


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""Test H4 - Validatori e grammatiche (unittest stdlib).

Per ciascuna grammatica: 1-2 campioni validi -> ok e invalidi -> errori.
Inoltre: repair_prompt contiene gli errori nel testo.
"""

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.registry import (  # noqa: E402
    repair_prompt,
    validate_formula,
    validate_grammar,
    validate_output,
)

TESTO = (
    "La fotosintesi clorofilliana converte la luce solare in energia chimica. "
    "Le piante producono glucosio e liberano ossigeno."
)
CHUNKS = (
    "Il processo avviene nei cloroplasti delle foglie. Le foglie assorbono "
    "la luce solare durante il giorno."
)


def _card(quote=None):
    return {
        "front": "Domanda lunga abbastanza per superare il vincolo?",
        "back": "Risposta breve del docente.",
        "hint": "aiuto",
        "quote": quote or "La fotosintesi clorofilliana converte la luce "
                          "solare in energia chimica.",
    }


def _deck(quote=None, n_cards=1):
    return json.dumps({"cards": [_card(quote) for _ in range(n_cards)]})


def _outline(n_slides=5, n_bullets=3, n_words=6, n_words_title=4):
    slides = []
    for k in range(n_slides):
        slides.append({
            "title": " ".join(["titolo%d" % (k + 1)] +
                              ["verb%d" % w for w in range(n_words_title)]),
            "bullets": [
                " ".join(["parola%d%d" % (k, w) for w in range(n_words)])
                for _ in range(n_bullets)
            ],
        })
    return {"title": "Programma di studio della lezione",
            "slides": slides}


def _feedback(n_words=10):
    return " ".join(["parola"] * n_words)


class TestGrammaticheEValidatori(unittest.TestCase):

    # ---------------- G_deck (F01) ----------------
    def test_g_deck_valido(self):
        ok, _, errors = validate_output(
            "F01", _deck(), ctx={"testo": TESTO, "n": 1}
        )
        self.assertTrue(ok, errors)

    def test_g_deck_quote_fuori_testo(self):
        raw = _deck(quote="La teoria della relatività è del 1905.")
        ok, _, errors = validate_output(
            "F01", raw, ctx={"testo": TESTO, "n": 1}
        )
        self.assertFalse(ok)
        self.assertTrue(any("quote" in e for e in errors), errors)

    def test_g_deck_struttura_invalida(self):
        errors = validate_grammar("G_deck", {"cards": "non-una-lista"})
        self.assertTrue(errors)
        errors = validate_grammar("G_deck", {"cards": [{"back": "solo back"}]})
        self.assertTrue(any("front" in e for e in errors), errors)

    def test_g_deck_front_uguale_back(self):
        raw = json.dumps({"cards": [{
            "front": "Questa domanda è uguale al back.",
            "back": "Questa domanda è uguale al back.",
            "quote": "Le piante producono glucosio e liberano ossigeno.",
        }]})
        ok, _, errors = validate_output("F01", raw, ctx={"testo": TESTO, "n": 1})
        self.assertFalse(ok)
        self.assertTrue(any("identici" in e for e in errors), errors)

    # ---------------- G_judge (F04) ----------------
    def test_g_judge_valido(self):
        raw = json.dumps({"judgment": "parziale", "feedback": _feedback(12),
                          "followup": "Perché lo ritieni corretto?"})
        ok, _, errors = validate_output("F04", raw, ctx={})
        self.assertTrue(ok, errors)

    def test_g_judge_judgment_invalido(self):
        raw = json.dumps({"judgment": "forse", "feedback": _feedback(8)})
        ok, _, errors = validate_output("F04", raw, ctx={})
        self.assertFalse(ok)
        self.assertTrue(any("judgment" in e for e in errors), errors)
        self.assertTrue(any("corretto" in e for e in errors), errors)

    def test_g_judge_feedback_oltre_30_parole(self):
        raw = json.dumps({"judgment": "corretto", "feedback": _feedback(35)})
        ok, _, errors = validate_output("F04", raw, ctx={})
        self.assertFalse(ok)
        self.assertTrue(any("massimo 30" in e for e in errors), errors)

    # ---------------- G_outline (F10) ----------------
    def test_g_outline_valido(self):
        ok, _, errors = validate_output("F10", json.dumps(_outline()),
                                        ctx={"arg": "x"})
        self.assertTrue(ok, errors)

    def test_g_outline_nove_slide(self):
        raw = json.dumps(_outline(n_slides=9))
        ok, _, errors = validate_output("F10", raw, ctx={"arg": "x"})
        self.assertFalse(ok)
        self.assertTrue(any("9 slide" in e for e in errors), errors)

    def test_g_outline_bullet_parole_eccessive(self):
        raw = json.dumps(_outline(n_slides=5, n_bullets=2, n_words=13))
        ok, _, errors = validate_output("F10", raw, ctx={"arg": "x"})
        self.assertFalse(ok)
        self.assertTrue(any("13 parole" in e for e in errors), errors)

    # ---------------- G_slide (F11) ----------------
    def test_g_slide_valido(self):
        raw = json.dumps({"title": "Introduzione",
                          "bullets": ["primo punto essenziale",
                                      "secondo punto breve"]})
        ok, _, errors = validate_output("F11", raw, ctx={})
        self.assertTrue(ok, errors)

    def test_g_slide_sei_bullet(self):
        raw = json.dumps({"title": "Introduzione",
                          "bullets": ["punto %d valido" % k
                                      for k in range(6)]})
        ok, _, errors = validate_output("F11", raw, ctx={})
        self.assertFalse(ok)
        self.assertTrue(any("massimo 5" in e for e in errors), errors)

    # ---------------- G_formula (F08) ----------------
    def test_g_formula_valida(self):
        self.assertEqual(validate_formula("SUM(A1:A5)+AVERAGE(B1:B9)"), [])
        self.assertEqual(validate_formula("=IF(A1,B1,C1)*2^3"), [])
        self.assertEqual(validate_formula("POWER(A1,2)+ABS(B1)+CONCAT(A1,B1)"),
                         [])
        ok, _, errors = validate_output("F08", json.dumps("SUM(A1:A5)"),
                                        ctx={"ref": "B2"})
        self.assertTrue(ok, errors)

    def test_g_formula_token_illegale(self):
        errors = validate_formula("SUM(A1:A5) & B1")
        self.assertTrue(errors)
        self.assertTrue(any("token illegale" in e for e in errors), errors)
        ok, _, _ = validate_output("F08", json.dumps("SUM(A1;A5)"),
                                   ctx={"ref": "B2"})
        self.assertFalse(ok)

    def test_g_formula_funzione_non_ammessa(self):
        errors = validate_formula("VLOOKUP(A1,B1,B2)")
        self.assertTrue(any("funzione non ammessa" in e for e in errors),
                        errors)

    def test_g_formula_parentesi_mancante(self):
        errors = validate_formula("SUM(A1:A5")
        self.assertTrue(errors)

    # ---------------- G_table (F09) ----------------
    def test_g_table_valida(self):
        raw = json.dumps({"header": ["a", "b", "c"],
                          "rows": [["1", "2", "3"], ["4", "5", "6"]]})
        ok, _, errors = validate_output("F09", raw, ctx={"desc": "x"})
        self.assertTrue(ok, errors)

    def test_g_table_nove_colonne(self):
        raw = json.dumps({"header": ["c%d" % i for i in range(9)],
                          "rows": [["x"] * 9]})
        ok, _, errors = validate_output("F09", raw, ctx={"desc": "x"})
        self.assertFalse(ok)
        self.assertTrue(any("8 colonne" in e for e in errors), errors)

    def test_g_table_21_righe(self):
        raw = json.dumps({"header": ["a"],
                          "rows": [["x"] for _ in range(21)]})
        ok, _, errors = validate_output("F09", raw, ctx={"desc": "x"})
        self.assertFalse(ok)
        self.assertTrue(any("20 righe" in e for e in errors), errors)

    # ---------------- G_blocks (F14) ----------------
    def test_g_blocks_valido(self):
        raw = json.dumps({"sessions": [
            {"day": "giorno-1", "start": "09:00", "minutes": 60,
             "target": "teoria"},
            {"day": "giorno-1", "start": "11:00", "minutes": 45,
             "target": "esercizi"},
        ]})
        ok, _, errors = validate_output("F14", raw, ctx={"gg": 7})
        self.assertTrue(ok, errors)

    def test_g_blocks_sovrapposizione(self):
        raw = json.dumps({"sessions": [
            {"day": "giorno-1", "start": "09:00", "minutes": 60,
             "target": "teoria"},
            {"day": "giorno-1", "start": "09:30", "minutes": 60,
             "target": "esercizi"},
        ]})
        ok, _, errors = validate_output("F14", raw, ctx={"gg": 7})
        self.assertFalse(ok)
        self.assertTrue(any("sovrapposizione" in e for e in errors), errors)

    def test_g_blocks_oltre_90_minuti(self):
        raw = json.dumps({"sessions": [
            {"day": "giorno-1", "start": "09:00", "minutes": 120,
             "target": "teoria"},
        ]})
        ok, _, errors = validate_output("F14", raw, ctx={"gg": 7})
        self.assertFalse(ok)
        self.assertTrue(any("massimo 90" in e for e in errors), errors)

    def test_g_blocks_orario_invalido(self):
        errors = validate_grammar("G_blocks", {"sessions": [
            {"day": "giorno-1", "start": "le mattina", "minutes": 60,
             "target": "teoria"},
        ]})
        self.assertTrue(any("HH:MM" in e for e in errors), errors)

    # ---------------- G_labels (F15) ----------------
    def test_g_labels_valido(self):
        raw = json.dumps({"labels": ["fotosintesi", "energia", "piante"]})
        ok, _, errors = validate_output("F15", raw, ctx={"testo": TESTO})
        self.assertTrue(ok, errors)

    def test_g_labels_quattro_etichette(self):
        raw = json.dumps({"labels": ["a", "b", "c", "d"]})
        ok, _, errors = validate_output("F15", raw, ctx={"testo": TESTO})
        self.assertFalse(ok)
        self.assertTrue(any("massimo 3" in e for e in errors), errors)

    # ---------------- G_cite (F06) ----------------
    def test_g_cite_valido(self):
        raw = json.dumps({
            "answer": "Il processo avviene nelle foglie.",
            "citations": [{"quote": "Il processo avviene nei cloroplasti "
                                    "delle foglie.",
                           "source": "doc_1"}],
        })
        ok, _, errors = validate_output("F06", raw, ctx={"chunks": CHUNKS})
        self.assertTrue(ok, errors)

    def test_g_cite_quote_fuori_dai_passaggi(self):
        raw = json.dumps({
            "answer": "Risposta inventata di sana pianta.",
            "citations": [{"quote": "Questa frase non sta nei passaggi.",
                           "source": "doc_1"}],
        })
        ok, _, errors = validate_output("F06", raw, ctx={"chunks": CHUNKS})
        self.assertFalse(ok)
        self.assertTrue(any("passaggi" in e for e in errors), errors)

    # ---------------- G_questions (F16) ----------------
    def test_g_questions_tre_domande(self):
        raw = json.dumps({"questions": ["Prima domanda aperta?",
                                        "Seconda domanda aperta?",
                                        "Terza domanda aperta?"]})
        ok, _, errors = validate_output("F16", raw, ctx={"ctx": "argomento"})
        self.assertTrue(ok, errors)

    def test_g_questions_due_domande(self):
        raw = json.dumps({"questions": ["Prima domanda aperta?",
                                        "Seconda domanda aperta?"]})
        ok, _, errors = validate_output("F16", raw, ctx={"ctx": "argomento"})
        self.assertFalse(ok)
        self.assertTrue(any("esattamente 3" in e for e in errors), errors)

    # ---------------- G_text (F05/F07/F12/F13) ----------------
    def test_g_text_valido(self):
        ok, _, errors = validate_output(
            "F05", json.dumps(TESTO), ctx={"bozza": TESTO, "intent": "chiaro"}
        )
        self.assertTrue(ok, errors)

    def test_g_text_non_stringa(self):
        ok, _, errors = validate_output("F05", json.dumps(123),
                                        ctx={"bozza": TESTO})
        self.assertFalse(ok)
        self.assertTrue(errors)

    def test_explain_massimo_cinque_bullet(self):
        raw = json.dumps("\n".join("bullet %d" % i for i in range(6)))
        ok, _, errors = validate_output("F07", raw, ctx={"f": "SUM(A1:A5)"})
        self.assertFalse(ok)
        self.assertTrue(any("da 1 a 5" in e for e in errors), errors)

    # ---------------- G_payload (F17) ----------------
    def test_g_payload_deck_e_testo(self):
        ok, _, errors = validate_output("F17", _deck(), ctx={})
        self.assertTrue(ok, errors)
        ok, _, errors = validate_output(
            "F17", json.dumps("testo salvato di esempio"), ctx={}
        )
        self.assertTrue(ok, errors)

    def test_g_payload_invalido(self):
        ok, _, errors = validate_output("F17", json.dumps(42), ctx={})
        self.assertFalse(ok)
        self.assertTrue(errors)

    # ---------------- parse / repair ----------------
    def test_parse_json_rotto(self):
        ok, parsed, errors = validate_output("F07", "{non è json", ctx={})
        self.assertFalse(ok)
        self.assertIsNone(parsed)
        self.assertTrue(any("JSON non valido" in e for e in errors), errors)

    def test_fid_sconosciuto(self):
        ok, _, errors = validate_output("F99", "{}", ctx={})
        self.assertFalse(ok)
        self.assertTrue(any("sconosciuta" in e for e in errors), errors)

    def test_repair_prompt_contiene_gli_errori(self):
        raw = _deck(quote="Frase assolutamente inventata.")
        ok, _, errors = validate_output("F01", raw,
                                        ctx={"testo": TESTO, "n": 1})
        self.assertFalse(ok)
        self.assertTrue(errors)
        prompt = repair_prompt("F01", errors)
        self.assertIn("F01", prompt)
        for err in errors:
            self.assertIn(err, prompt)

    def test_repair_prompt_da_grammatica(self):
        raw = json.dumps({"judgment": "boh", "feedback": _feedback(5)})
        ok, _, errors = validate_output("F04", raw, ctx={})
        self.assertFalse(ok)
        prompt = repair_prompt("F04", errors)
        for err in errors:
            self.assertIn(err, prompt)


if __name__ == "__main__":
    unittest.main(verbosity=2)

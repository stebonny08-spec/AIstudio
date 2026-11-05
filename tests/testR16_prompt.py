# -*- coding: utf-8 -*-
"""R16 - Test B1: guardia output + fallback estrattivo (tests/testR16_prompt.py).

Copre R16 1.3: 50 generazioni SIMULATE con output malformati intenzionali ->
la guardia blocca tutti i malformati e accetta i puliti; il fallback produce
output privo di marker (>=80 char); retry + contract.RESET_TOKEN verificati.

Esecuzione: set PYTHONIOENCODING=utf-8 && python tests/testR16_prompt.py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.rag import contract                      # noqa: E402
from core.rag.output_guard import (                # noqa: E402
    _LiveSanitizer,
    check_output,
    compose_fallback,
    guarded_stream,
)

CLEAN = ("Dante Alighieri (1265-1321) fu un poeta italiano, autore della "
         "Divina Commedia e considerato il padre della lingua italiana. "
         "Nacque a Firenze intorno al 1265 e mori' a Ravenna nel 1321.")


def _malformed_cases():
    """35 malformati + 15 puliti = 50 (R16 1.3)."""
    bad = []
    # marker template in varie posizioni (15)
    for m in ("[Fonte locale: x.md]", "User:", "Assistant:", "System:",
              "DOMANDA DELL'UTENTE:\nDomanda", "</contesto>", "<contesto>",
              "La risposta è data da un utente di questo tipo.",
              "utente di questo tipo", "La risposta è data"):
        bad.append(("margine: " + m, CLEAN[:30] + "\n" + m + "\n" + CLEAN))
        bad.append(("in-coda: " + m, CLEAN + "\n" + m))
    # troppo corti (10)
    for i in range(10):
        bad.append(("corto %d" % i, "Risposta breve %d." % i))
    # system-echo (5)  -> totale malformati 20+10+5 = 35
    sys_txt = ("Sei l'assistente AI di NovaStudio, un'applicazione desktop "
               "di studio che gira interamente sul PC dell'utente, senza "
               "servizi cloud.")
    for i in range(5):
        bad.append(("system-echo %d" % i, sys_txt[:50 + i * 3] + "..."))
    good = [("pulito %d" % i, CLEAN + (" Variantazione %d." % i))
            for i in range(15)]
    assert len(bad) == 35 and len(good) == 15, (len(bad), len(good))
    return bad, good


class TestCheckOutput(unittest.TestCase):
    def test_50_generazioni_simulate(self):
        """R16 1.3: 35 malformati bloccati, 15 puliti accettati."""
        bad, good = _malformed_cases()
        cases = bad + good
        self.assertEqual(len(cases), 50)
        blocked = 0
        accepted = 0
        for name, text in cases:
            r = check_output(text, system_text="Sei l'assistente AI di "
                                               "NovaStudio, un'applicazione")
            is_bad = dict(bad).get(name) is not None
            if is_bad:
                self.assertFalse(r["ok"], "malformato non bloccato: %s" % name)
                blocked += 1
            else:
                self.assertTrue(r["ok"], "pulito bloccato: %s -> %s"
                                % (name, r["reason"]))
                accepted += 1
        self.assertEqual(blocked, 35)
        self.assertEqual(accepted, 15)

    def test_frase_canned_e_marker(self):
        r = check_output("La risposta è data da un utente di questo tipo.")
        self.assertFalse(r["ok"])
        self.assertTrue(r["canned"] or r["markers"])

    def test_min_len(self):
        self.assertFalse(check_output("breve")["ok"])
        self.assertTrue(check_output("breve", check_min_len=False)["ok"])

    def test_system_echo(self):
        sys_txt = "Sei l'assistente AI di NovaStudio, un'applicazione di test"
        r = check_output(sys_txt + " continua", system_text=sys_txt,
                         phase="early")
        self.assertFalse(r["ok"])
        self.assertTrue(r["system_echo"])


class TestSanitizer(unittest.TestCase):
    def test_taglia_ruolo_e_marker(self):
        san = _LiveSanitizer()
        out = ""
        for tok in ["Risposta corretta ", "sul tema.", "\n", "User: ",
                    "DOMANDA DELL'UTENTE:", "x"]:
            out += san.feed(tok)
        self.assertNotIn("User:", out)
        self.assertNotIn("DOMANDA", out)
        self.assertTrue(out.startswith("Risposta corretta"))
        self.assertTrue(san.killed)

    def test_marker_spezzato_tra_chunk(self):
        san = _LiveSanitizer()
        out = ""
        for tok in ["testo lungo abbastanza per essere emesso", " [Fo",
                    "nte locale: x]"]:
            out += san.feed(tok)
        self.assertNotIn("[Fonte", out)

    def test_passa_testo_pulito(self):
        san = _LiveSanitizer()
        out = "".join(san.feed(t) for t in ["Ciao", ", come stai?",
                                            "\nVa bene!"]) + san.flush()
        self.assertIn("Ciao", out)
        self.assertIn("Va bene!", out)


class TestComposeFallback(unittest.TestCase):
    def test_fallback_template_free(self):
        class C:
            text = ("La fotosintesi converte la luce in energia chimica "
                    "producendo glucosio nello stroma del cloroplasto.")
            source_file = "appunti/foto.md"
            location_hint = "p.3"

        class W:
            title = "Fotosintesi - Treccani"
            url = "https://www.treccani.it/enc/foto"
            snippet = ("La fotosintesi clorofilliana e' il processo con cui "
                       "le piante producono materia organica.")

        out = compose_fallback([C()], [W()], "cos'e' la fotosintesi?")
        self.assertGreaterEqual(len(out), contract.OUTPUT_MIN_LEN)
        chk = check_output(out, check_min_len=True)
        self.assertTrue(chk["ok"], chk)
        # R18: niente codici [F1]/[W1] e niente blocco "Fonti:" con URL
        self.assertNotIn("[F1]", out)
        self.assertNotIn("[W1]", out)
        self.assertNotIn("Fonti:", out)
        self.assertNotIn("http", out)
        self.assertNotIn("[Fonte", out)

    def test_fallback_senza_materiali(self):
        out = compose_fallback(None, None, "q")
        self.assertGreaterEqual(len(out), contract.OUTPUT_MIN_LEN)
        self.assertTrue(check_output(out)["ok"])


class TestGuardedStream(unittest.TestCase):
    def test_retry_dopo_system_echo(self):
        sys_txt = "Sei l'assistente AI di NovaStudio, x"

        def leaky():
            for i in range(4):
                yield sys_txt + " ripetuto %d. " % i
            yield "User: domanda\nAssistant: risposta"

        def repaired():
            for i in range(6):
                yield CLEAN[i * 30:(i + 1) * 30] or " "

        finals = []
        emits = []
        acc = ""
        for item in guarded_stream(leaky, system_text=sys_txt,
                                   fallback_text="FALLBACK",
                                   repair_factory=repaired,
                                   on_final=finals.append):
            if isinstance(item, dict):
                emits.append("<RESET>")
                acc = ""        # semantica consumer: il retry SOSTITUISCE
            else:
                emits.append(item)
                acc += item
        text = acc
        self.assertIn("<RESET>", emits, "retry non innescato")
        self.assertNotIn("User:", text)
        self.assertTrue(finals and finals[-1]["ok"])
        self.assertTrue(finals[-1].get("retried"))

    def test_retry_fallito_fallback(self):
        def leaky():
            yield "User: x\nAssistant: y"

        def repaired():
            yield "Ancora rotto: User: Assistant:"

        finals = []
        emits = []
        acc = ""
        for item in guarded_stream(leaky, system_text="",
                                   fallback_text=compose_fallback(
                                       None, None, "q"),
                                   repair_factory=repaired,
                                   on_final=finals.append):
            if isinstance(item, dict):
                emits.append("<RESET>")
                acc = ""
            else:
                emits.append(item)
                acc += item
        text = acc
        self.assertGreaterEqual(emits.count("<RESET>"), 2,
                                "RESET per retry + RESET per fallback")
        chk = check_output(text)
        self.assertTrue(chk["ok"], chk)
        self.assertGreaterEqual(len(text), contract.OUTPUT_MIN_LEN)

    def test_output_pulito_no_reset(self):
        finals = []
        emits = list(guarded_stream(lambda: iter([CLEAN[:40], CLEAN[40:]]),
                                    system_text="", fallback_text="FB",
                                    on_final=finals.append))
        self.assertNotIn(contract.RESET_TOKEN, emits)
        self.assertTrue(finals[0]["ok"])
        self.assertEqual(finals[0]["reason"], "ok")

    def test_no_rete_zero_llm(self):
        # il modulo non deve importare/avviare rete o LLM
        import core.rag.output_guard as m
        src = open(m.__file__, encoding="utf-8").read()
        self.assertNotIn("urllib", src)
        self.assertNotIn("requests", src)


class TestCitationRail(unittest.TestCase):
    """R18: i codici [F1]/[W1] sono BANNATI dal testo della risposta
    (la provenienza e' una riga piccola dell'UI dai metadati)."""

    def test_codice_citazione_bloccato(self):
        from core.rag.output_guard import check_output
        txt = CLEAN + " [F1] fine."
        r = check_output(txt)
        self.assertFalse(r["ok"])
        self.assertEqual(r["reason"], "citation_code")
        self.assertTrue(r["code_citation"])

    def test_testo_pulito_ok(self):
        from core.rag.output_guard import check_output
        r = check_output(CLEAN + " Le fonti restano nei metadati.")
        self.assertTrue(r["ok"], r)

    def test_retry_rimuove_codici(self):
        """1a passata con [F1] -> RESET + retry senza codici -> ok."""
        def leaky():
            for i in range(6):
                yield CLEAN[i * 40:(i + 1) * 40] or " "
            yield " Vedi [F1] e [W2]."

        def repaired():
            for i in range(6):
                yield CLEAN[i * 40:(i + 1) * 40] or " "
            yield " Le fonti sono mostrate dall'interfaccia."

        finals = []
        emits = []
        acc = ""
        for item in guarded_stream(leaky, system_text="",
                                   fallback_text="FB",
                                   repair_factory=repaired,
                                   source_texts=["x" * 200],
                                   on_final=finals.append):
            if isinstance(item, dict):
                emits.append("<RESET>")
                acc = ""
            else:
                emits.append(item)
                acc += item
        self.assertIn("<RESET>", emits, "retry per codice non innescato")
        self.assertTrue(finals[-1]["ok"], finals[-1])
        self.assertNotIn("[F1]", acc)
        self.assertNotIn("[W", acc)


if __name__ == "__main__":
    unittest.main(verbosity=2)

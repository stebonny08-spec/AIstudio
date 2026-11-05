"""Test H13 — core/tutor (FSRS + TutorSession) — unittest stdlib.

FSRS:
  * review gradito -> due futuro e monotono crescente (serie di 'good');
  * 'again' resetta la stabilità (cala sempre) e increments lapses;
  * determinismo: stessi (card, grade, now) -> stato identico;
  * gradi iniziali ordinati again < hard < good < easy.

TutorSession SENZA llm_fn (fallback deterministico):
  * 10 risposte costruite (5 corrette / 3 parziali / 2 errate) ->
    giudizi attesi >= 8/10 corretti;
  * followup presente (e che inizia con 'perché') quando non è corretto;
  * stato della sessione e dei risultati serializzabili in JSON;
  * il tutor FUNZIONA anche senza AI (badge 'AI non disponibile').
"""

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.tutor import FSRS, TutorSession, token_overlap  # noqa: E402

DAY = 86400.0
T0 = 1_700_000_000.0


def _back(i: int) -> str:
    """Back di 12 token unici e non ambigui per la card i."""
    words = ("uno", "due", "tre", "quattro", "cinque", "sei",
             "sette", "otto", "nove", "dieci", "undici", "dodici")
    return " ".join("t%02d_%s" % (i, w) for w in words)


class TestFSRS(unittest.TestCase):

    def test_init_card(self):
        c = FSRS().init_card(now=T0)
        for k in ("stability", "difficulty", "due", "reps", "lapses"):
            self.assertIn(k, c)
        self.assertEqual(c["reps"], 0)
        self.assertEqual(c["lapses"], 0)
        self.assertEqual(c["due"], T0)
        self.assertIsNone(c["last_review"])

    def test_due_futuro_monotono(self):
        fs = FSRS()
        c = fs.init_card(now=T0)
        c = fs.review(c, "good", now=T0 + 3600)
        due1, s1 = c["due"], c["stability"]
        self.assertGreater(due1, T0 + 3600)             # sempre nel futuro

        c = fs.review(c, "good", now=due1)
        due2, s2 = c["due"], c["stability"]
        c = fs.review(c, "good", now=due2)
        due3, s3 = c["due"], c["stability"]

        self.assertLess(due1, due2)                     # monotono crescente
        self.assertLess(due2, due3)
        self.assertLess(s1, s2)
        self.assertLess(s2, s3)
        self.assertEqual(c["reps"], 3)

    def test_gradi_ordinati(self):
        fs = FSRS()
        out = {}
        for g in ("again", "hard", "good", "easy"):
            c = fs.init_card(now=T0)
            out[g] = fs.review(c, g, now=T0 + 60)
        self.assertLess(out["again"]["stability"], out["hard"]["stability"])
        self.assertLess(out["hard"]["stability"], out["good"]["stability"])
        self.assertLess(out["good"]["stability"], out["easy"]["stability"])
        self.assertLess(out["again"]["due"], out["good"]["due"])
        self.assertLess(out["good"]["due"], out["easy"]["due"])

    def test_again_resetta_stability(self):
        fs = FSRS()
        c = fs.init_card(now=T0)
        c = fs.review(c, "good", now=T0 + 3600)
        c = fs.review(c, "good", now=c["due"])
        s_before = c["stability"]
        laps_before = c["lapses"]
        due_before = c["due"]

        c = fs.review(c, "again", now=c["due"])
        self.assertLess(c["stability"], s_before)       # reset della stabilità
        self.assertEqual(c["lapses"], laps_before + 1)
        self.assertEqual(c["reps"], 3)
        self.assertLess(c["due"], due_before + 10 * DAY)  # intervallo breve

    def test_determinismo(self):
        card = FSRS().init_card(now=T0)
        r1 = FSRS().review(card, "easy", now=T0 + 100)
        r2 = FSRS().review(card, "easy", now=T0 + 100)
        self.assertEqual(r1, r2)
        # stato derivato serializzabile in JSON
        json.dumps(r1)

    def test_grado_non_valido(self):
        with self.assertRaises(ValueError):
            FSRS().review(FSRS().init_card(now=T0), "boh", now=T0)

    def test_accetta_gradi_alternativi(self):
        fs = FSRS()
        base = fs.init_card(now=T0)
        self.assertEqual(fs.review(base, "GOOD", now=T0 + 1),
                         fs.review(base, 2, now=T0 + 1))
        self.assertEqual(fs.review(base, 0, now=T0 + 1)["lapses"], 1)


def _deck():
    return [{"front": "Domanda %d?" % i, "back": _back(i)} for i in range(10)]


def _answers():
    """10 risposte campionate: 5 corrette / 3 parziali / 2 errate."""
    answers, expected = [], []
    for i in range(10):
        toks = _back(i).split()
        if i < 5:                                        # 5 corrette
            answers.append(_back(i))
            expected.append("corretto")
        elif i < 8:                                      # 3 parziali (5/12)
            answers.append(" ".join(toks[:5]))
            expected.append("parziale")
        else:                                            # 2 errate (0 overlap)
            answers.append("gol calcio squadra allenamento tifo stadio")
            expected.append("errato")
    return answers, expected


class TestTutorSessionFallback(unittest.TestCase):
    """Tutor SENZA llm_fn: giudizio deterministico per token-overlap."""

    def test_giudizi_attesi(self):
        sess = TutorSession(cards=_deck(), llm_fn=None)
        answers, expected = _answers()
        results = [sess.step("Domanda %d?" % i, answers[i]) for i in range(10)]
        hits = sum(1 for r, e in zip(results, expected)
                   if r["judgment"] == e)
        # reale atteso 10/10; soglia di accettazione del test >= 8/10
        self.assertGreaterEqual(hits, 8)
        # tutti funzionano senza AI
        for r in results:
            self.assertTrue(r["ok"])
            self.assertEqual(r["badge"], "AI non disponibile")
            self.assertEqual(r["source"], "fallback")

    def test_followup_quando_non_corretto(self):
        sess = TutorSession(cards=_deck(), llm_fn=None)
        answers, expected = _answers()
        results = [sess.step("Domanda %d?" % i, answers[i]) for i in range(10)]
        for r, e in zip(results, expected):
            if e == "corretto":
                self.assertEqual(r["followup"], "")
            else:
                self.assertTrue(r["followup"],
                                "followup mancante per %s" % e)
                self.assertTrue(
                    r["followup"].lower().startswith("perché"),
                    "followup non parte con 'perché': %r" % r["followup"],
                )

    def test_stato_serializzabile(self):
        sess = TutorSession(cards=_deck(), llm_fn=None)
        answers, _ = _answers()
        last = None
        for i in range(10):
            last = sess.step("Domanda %d?" % i, answers[i])
            json.dumps(last)                            # step serializzabile
        blob = json.dumps(sess.state())
        parsed = json.loads(blob)
        self.assertEqual(len(parsed["cards"]), 10)
        self.assertEqual(parsed["n_reviews"], 10)
        state = parsed["cards"][0]["state"]
        for k in ("stability", "difficulty", "due", "reps", "lapses"):
            self.assertIn(k, state)

    def test_step_aggiorna_fsrs_e_propone_successiva(self):
        sess = TutorSession(cards=_deck(), llm_fn=None)
        r = sess.step("Domanda 0?", _back(0))
        self.assertEqual(r["card_state"]["reps"], 1)    # FSRS aggiornato
        self.assertEqual(r["grade"], "good")            # corretto -> good
        self.assertIsNotNone(r["next_question"])
        self.assertNotEqual(r["next_question"], "Domanda 0?")
        self.assertIsNotNone(r["next_card_id"])

    def test_funziona_anche_senza_deck(self):
        sess = TutorSession(llm_fn=None)
        r = sess.step("Domanda libera?", "risposta a caso")
        self.assertTrue(r["ok"])
        self.assertEqual(r["judgment"], "parziale")     # back mancante
        self.assertTrue(r["followup"].lower().startswith("perché"))


class TestTutorSessionConLLM(unittest.TestCase):
    """Se c'è un llm_fn valido, il giudizio arriva da F04 via runtime."""

    def test_judgment_da_llm_e_cache(self):
        import json as _json

        payload = _json.dumps({
            "judgment": "parziale",
            "feedback": "manca il secondo passaggio",
            "followup": "perché il secondo passaggio è necessario?",
        })
        calls = []

        def fake_llm(prompt, max_tokens=None, classe=None, fid=None):
            calls.append(prompt)
            return payload

        from core.ai_cache import AiCache
        sess = TutorSession(cards=_deck(), llm_fn=fake_llm,
                            ai_cache=AiCache())
        r = sess.step("Domanda 0?", "mezza risposta")
        self.assertEqual(r["judgment"], "parziale")
        self.assertEqual(r["source"], "ai")
        self.assertEqual(r["badge"], "generato da AI")
        self.assertEqual(r["followup"],
                         "perché il secondo passaggio è necessario?")
        self.assertEqual(r["grade"], "hard")            # parziale -> hard
        self.assertEqual(len(calls), 1)
        # 2a stessa chiamata -> hit di cache, nessuna nuova invocazione
        r2 = sess.step("Domanda 0?", "mezza risposta")
        self.assertEqual(r2["source"], "cache_exact")
        self.assertEqual(len(calls), 1)


class TestOverlap(unittest.TestCase):

    def test_soglie(self):
        back = "alpha beta gamma delta epsilon zeta"
        self.assertEqual(token_overlap(back, back), 1.0)
        self.assertEqual(token_overlap("nessun", back), 0.0)
        partial = "alpha beta gamma"                   # 3/6 = 0.5
        self.assertAlmostEqual(token_overlap(partial, back), 0.5)
        self.assertIsNone(token_overlap("x", ""))       # confronto non disp.


if __name__ == "__main__":
    unittest.main()

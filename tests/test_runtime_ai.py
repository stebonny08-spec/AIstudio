"""Test H13 — core/ai_runtime (run_ai_function / run_many) — unittest stdlib.

Copre:
  (a) SENZA llm_fn  -> fallback deterministico del registro, badge
      'AI non disponibile', MAI eccezione, output identico fra chiamate;
  (b) CON llm finto (JSON valido per F04) -> ok + cache hit ESATTA alla
      2a chiamata (llm invocato una sola volta);
  (c) output invalido -> 1 retry con repair_prompt (2 chiamate llm_fn)
      -> ancora invalido -> fallback registro, cache NON popolata;
  (d) retry che riesce al 2° tentativo -> ok con retried=True;
  (e) approval_required sempre nel risultato (F01 True, F04 False);
  (f) run_many: max 2 run_ai_function concatenati + stop al 2° fallimento.
"""

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.ai_cache import AiCache  # noqa: E402
from core.ai_runtime import run_ai_function, run_many  # noqa: E402
from core.registry.functions import get_function  # noqa: E402

F04_INPUTS = {
    "front": "Cos'è la fotosintesi clorofilliana?",
    "back": "Processo che converte la luce in energia chimica producendo glucosio",
    "risp": "converte la luce in energia chimica producendo glucosio",
}

JUDGE_VALID = {
    "judgment": "corretto",
    "feedback": "risposta completa e corretta",
    "followup": "perché pensi che sia così importante?",
}


class FakeLLM:
    """llm finto con firma dichiarata: restituisce le risposte in coda
    (l'ultima viene ripetuta) e registra ogni chiamata."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, prompt, max_tokens=None, classe=None, fid=None):
        self.calls.append({
            "prompt": prompt,
            "max_tokens": max_tokens,
            "classe": classe,
            "fid": fid,
        })
        idx = min(len(self.calls) - 1, len(self.responses) - 1)
        out = self.responses[idx]
        if isinstance(out, Exception):
            raise out
        return out


class TestFallbackSenzaLLM(unittest.TestCase):
    """(a) nessun llm_fn -> fallback deterministico del registro."""

    def test_f04_fallback_deterministico(self):
        r1 = run_ai_function("F04", F04_INPUTS, ai_cache=AiCache())
        r2 = run_ai_function("F04", F04_INPUTS, ai_cache=AiCache())
        self.assertFalse(r1["ok"])
        self.assertTrue(r1["fallback"])
        self.assertEqual(r1["data"], get_function("F04")["fallback"])
        self.assertEqual(r1["badge"], "AI non disponibile")
        self.assertEqual(r1["source"], "fallback")
        # determinismo: due chiamate identiche, nessuna eccezione
        self.assertEqual(r1, r2)

    def test_f01_fallback_con_approval(self):
        r = run_ai_function(
            "F01",
            {"materia": "Mate", "testo": "a+b=2", "n": 3},
            ai_cache=AiCache(),
        )
        self.assertFalse(r["ok"])
        self.assertEqual(r["data"], get_function("F01")["fallback"])
        self.assertEqual(r["badge"], "AI non disponibile")
        self.assertTrue(r["approval_required"])

    def test_fid_sconosciuto_niente_eccezione(self):
        r = run_ai_function("F99", {}, ai_cache=AiCache())
        self.assertFalse(r["ok"])
        self.assertTrue(r["fallback"])
        self.assertIn("error", r)
        self.assertEqual(r["badge"], "AI non disponibile")

    def test_llm_che_esplode_fallback(self):
        def boom(prompt, max_tokens=None, classe=None, fid=None):
            raise RuntimeError("connessione refused")

        r = run_ai_function("F04", F04_INPUTS, ai_cache=AiCache(), llm_fn=boom)
        self.assertFalse(r["ok"])
        self.assertTrue(r["fallback"])
        self.assertEqual(r["badge"], "AI non disponibile")


class TestLLMValidoECache(unittest.TestCase):
    """(b) llm finto con JSON valido -> ok, poi hit esatta in cache."""

    def test_ok_e_cache_hit_seconda_chiamata(self):
        cache = AiCache()
        fake = FakeLLM([json.dumps(JUDGE_VALID)])

        r1 = run_ai_function("F04", F04_INPUTS, ai_cache=cache, llm_fn=fake)
        self.assertTrue(r1["ok"])
        self.assertFalse(r1["fallback"])
        self.assertEqual(r1["source"], "ai")
        self.assertEqual(r1["badge"], "generato da AI")
        self.assertEqual(r1["data"]["judgment"], "corretto")
        self.assertEqual(r1["max_tokens"], 200)          # classe micro clamped
        self.assertEqual(r1["classe"], "micro")
        self.assertFalse(r1["retried"])
        self.assertFalse(r1["approval_required"])        # F04: sola lettura
        self.assertEqual(len(fake.calls), 1)
        # il prompt passato al llm contiene sys + user
        self.assertIn("tutor", fake.calls[0]["prompt"].lower())

        # 2a chiamata stessi input -> HIT esatta, zero chiamate llm
        r2 = run_ai_function("F04", F04_INPUTS, ai_cache=cache, llm_fn=fake)
        self.assertTrue(r2["ok"])
        self.assertEqual(r2["source"], "cache_exact")
        self.assertEqual(r2["badge"], "cache esatta")
        self.assertEqual(r2["data"]["judgment"], "corretto")
        self.assertEqual(len(fake.calls), 1)

    def test_approval_required_sempre_presente(self):
        cache = AiCache()
        r04 = run_ai_function("F04", F04_INPUTS, ai_cache=cache)
        self.assertIn("approval_required", r04)
        self.assertFalse(r04["approval_required"])
        r01 = run_ai_function(
            "F01",
            {"materia": "Mate", "testo": "a+b=2", "n": 3},
            ai_cache=AiCache(),
        )
        self.assertTrue(r01["approval_required"])


class TestRetry(unittest.TestCase):
    """(c)(d) output invalido -> 1 retry -> fallback; retry che funziona."""

    def test_output_invalido_un_retry_poi_fallback(self):
        cache = AiCache()
        fake = FakeLLM(["NON-JSON-AFFATTO", "SEMBRA JSON MA NON LO è"])
        r = run_ai_function("F04", F04_INPUTS, ai_cache=cache, llm_fn=fake)
        # 1 tentativo + 1 retry = 2 chiamate esatte
        self.assertEqual(len(fake.calls), 2)
        self.assertFalse(r["ok"])
        self.assertTrue(r["fallback"])
        self.assertEqual(r["data"], get_function("F04")["fallback"])
        self.assertEqual(r["badge"], "AI non disponibile")
        # nessuna scrittura in cache per output invalidi
        self.assertEqual(len(cache), 0)

    def test_retry_valido_alla_seconda(self):
        cache = AiCache()
        fake = FakeLLM(["prima risposta rotta", json.dumps(JUDGE_VALID)])
        r = run_ai_function("F04", F04_INPUTS, ai_cache=cache, llm_fn=fake)
        self.assertEqual(len(fake.calls), 2)
        self.assertTrue(r["ok"])
        self.assertTrue(r["retried"])
        self.assertEqual(r["data"]["judgment"], "corretto")
        self.assertEqual(len(cache), 1)                  # put SOLO se ok

    def test_json_struttura_sbagliata_retry_poi_fallback(self):
        # JSON valido ma viola la grammatica (judgment fuori enum)
        rotto = json.dumps({"judgment": "boh", "feedback": "x"})
        cache = AiCache()
        fake = FakeLLM([rotto, rotto])
        r = run_ai_function("F04", F04_INPUTS, ai_cache=cache, llm_fn=fake)
        self.assertEqual(len(fake.calls), 2)
        self.assertFalse(r["ok"])
        self.assertEqual(len(cache), 0)


class TestRunMany(unittest.TestCase):
    """(f) max 2 tool-call concatenate + stop al 2° fallimento."""

    def test_max_due_concatenate(self):
        pairs = [("F04", F04_INPUTS)] * 4
        res = run_many(pairs, ai_cache=AiCache(), llm_fn=None)
        self.assertEqual(len(res), 2)

    def test_max_due_anche_con_llm_ok(self):
        pairs = [("F04", F04_INPUTS)] * 4
        fake = FakeLLM([json.dumps(JUDGE_VALID)])
        res = run_many(pairs, ai_cache=AiCache(), llm_fn=fake)
        self.assertEqual(len(res), 2)
        self.assertTrue(all(r["ok"] for r in res))

    def test_stop_al_secondo_fallimento(self):
        pairs = [("F04", F04_INPUTS)] * 6
        res = run_many(pairs, ai_cache=AiCache(), llm_fn=None, max_calls=5)
        # 2 fallimenti -> stop prima del limite teorico (5)
        self.assertEqual(len(res), 2)
        self.assertTrue(all(r["ok"] is False for r in res))

    def test_mai_eccezione_coppie_rotte(self):
        res = run_many(["non-una-coppia", ("F04", F04_INPUTS)],
                       ai_cache=AiCache(), llm_fn=None)
        self.assertEqual(len(res), 2)
        for r in res:
            self.assertFalse(r["ok"])


if __name__ == "__main__":
    unittest.main()

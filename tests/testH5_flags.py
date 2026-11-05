"""Test H5 - Autotune + flag di configurazione (unittest stdlib, 4 test)."""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from data.autotune import parse_llama_bench_output, run_autotune_once
from data.config_manager import DEFAULT_CONFIG

# Output FINTO di llama-bench (tabella markdown)
FAKE_BENCH_OUTPUT = """\
| model | params | threads | test | t/s |
| ------------------------------ | ------ | ------- | ---- | ----------- |
| MiniCPM5-2B Q4_K_M | 2.0B | 8 | pp512 | 812.34 ± 5.67 |
| MiniCPM5-2B Q4_K_M | 2.0B | 8 | tg128 | 63.21 ± 1.02 |
"""


class TestAutotune(unittest.TestCase):

    # (a) parse di un output llama-bench finto -> tok/s estratti
    def test_a_parse_output_finto(self):
        parsed = parse_llama_bench_output(FAKE_BENCH_OUTPUT)
        self.assertEqual(parsed["pp_tok_s"], 812.34)
        self.assertEqual(parsed["tg_tok_s"], 63.21)
        # output vuoto/garbage -> nessun valore, nessuna eccezione
        self.assertEqual(
            parse_llama_bench_output(""), {"pp_tok_s": None, "tg_tok_s": None}
        )
        self.assertEqual(
            parse_llama_bench_output("qualcosa di strano"),
            {"pp_tok_s": None, "tg_tok_s": None},
        )

    # (b) run_autotune_once senza binario -> done False, nessuna eccezione
    def test_b_run_senza_binario(self):
        cases = [
            {"llama.bench_path": ""},
            {"llama.bench_path": os.path.join(ROOT, "nope", "llama-bench.exe")},
        ]
        for cfg in cases:
            out = run_autotune_once(cfg)  # non deve lanciare eccezioni
            self.assertFalse(out["done"])
            self.assertEqual(out["reason"], "llama-bench assente")
            self.assertEqual(out["fallback"], "profili default")
            self.assertFalse(cfg.get("autotune.done", False))
            self.assertEqual(cfg.get("autotune.result", {}), {})


class TestFlagConfig(unittest.TestCase):

    # (c) chiavi config presenti con default
    def test_c_chiavi_config_presenti(self):
        self.assertEqual(DEFAULT_CONFIG.get("llm.engine"), "llama.cpp")
        self.assertEqual(DEFAULT_CONFIG.get("llama.bench_path"), "")
        self.assertIs(DEFAULT_CONFIG.get("autotune.done"), False)
        self.assertEqual(DEFAULT_CONFIG.get("autotune.result"), {})
        self.assertIs(DEFAULT_CONFIG.get("spec.prompt_lookup"), True)
        self.assertEqual(DEFAULT_CONFIG.get("spec.draft_model"), "")
        self.assertIs(DEFAULT_CONFIG.get("spec.eagle3"), False)

    # (d) prompt_lookup default True; draft/eagle3 False (OPT-IN)
    def test_d_default_flag(self):
        self.assertTrue(DEFAULT_CONFIG["spec.prompt_lookup"])
        self.assertFalse(DEFAULT_CONFIG["spec.eagle3"])
        self.assertEqual(DEFAULT_CONFIG["spec.draft_model"], "")
        # tutti gli altri nuovi flag OPT-IN (tranne prompt_lookup)
        self.assertEqual(DEFAULT_CONFIG["llm.engine"], "llama.cpp")
        self.assertFalse(DEFAULT_CONFIG["autotune.done"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

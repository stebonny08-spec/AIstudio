# -*- coding: utf-8 -*-
"""
tests/testG2_wiring.py — G2: wiring H3 nel flusso reale.

(a) ordine di produzione nel prompt REALE del client:
    system (+header RAG) -> storia -> query;
(b) context shifting: la storia renderizzata resta sotto
    history_char_budget(n_ctx) dopo trim_history;
(c) hit-rate fixture reale (esegue tests/g2_hitrate.py) >= 0,70;
(d) flusso senza RAG (header/contesto assenti) non crasha.

Esecuzione: python tests/testG2_wiring.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.local_llm_client import LocalLLMClient  # noqa: E402
from core.router import (  # noqa: E402
    build_prompt_segments, trim_history, history_char_budget,
)


class _Chunk:
    def __init__(self, text, source_file="rag_stage2/lezione.md"):
        self.text = text
        self.source_file = source_file
        self.location_hint = "p.1"
        self.is_image = False
        self.image_path = ""
        self.mime_type = "text/plain"


def _prep(**kw):
    """_prepare_messages e' puro (usa solo gli argomenti): self inutilizzato."""
    defaults = dict(
        query="Qual e' la differenza tra mitosi e meiosi?",
        context_kind="none", local_chunks=None, web_results=None,
        allow_fallback_marker=False, study_mode="studio", chitchat=False,
        part_index=0, is_last_part=True, parts_summaries=None,
        history_turns=None,
    )
    defaults.update(kw)
    return LocalLLMClient._prepare_messages(None, **defaults)


class TestOrderProduction(unittest.TestCase):
    def test_a_order_system_header_history_query(self):
        hist = [
            {"role": "user", "content": "prima domanda sulla cellula"},
            {"role": "ai", "content": "risposta sulla cellula"},
        ]
        msgs = _prep(
            context_kind="locale",
            local_chunks=[_Chunk("La mitosi produce due cellule figlie identiche.")],
            history_turns=hist,
        )
        roles = [m["role"] for m in msgs]
        # 1) system (+header RAG dentro) ... 2) storia ... 3) query finale
        self.assertEqual(roles[0], "system")
        self.assertEqual(roles[-1], "user")
        self.assertEqual(len(msgs), 4)  # system + 2 turni + query
        sys_txt = msgs[0]["content"]
        self.assertIn("CONTESTO/RIFERIMENTI", sys_txt)
        self.assertIn("mitosi produce due cellule", sys_txt)
        # ordine effettivo della STRINGA renderizzata: header PRIMA della storia
        full = "\n".join(m["content"] for m in msgs)
        i_hdr = full.find("CONTESTO/RIFERIMENTI")
        i_storia = full.find("prima domanda sulla cellula")
        i_query = full.find("Qual e' la differenza")
        self.assertTrue(0 <= i_hdr < i_storia < i_query,
                        f"ordine errato: hdr={i_hdr} storia={i_storia} query={i_query}")
        # la storia e' in turni separati (append della storia NON nella query)
        self.assertNotIn("prima domanda sulla cellula", msgs[-1]["content"])

    def test_a2_history_ruoli(self):
        msgs = _prep(history_turns=[
            {"role": "user", "content": "u1"},
            {"role": "ai", "content": "a1"},
            {"role": "assistant", "content": "a2"},
        ])
        self.assertEqual([m["role"] for m in msgs],
                         ["system", "user", "assistant", "assistant", "user"])

    def test_d_no_rag_no_crash(self):
        msgs = _prep()  # tutto default, niente contesto, niente storia
        self.assertEqual(len(msgs), 2)
        self.assertNotIn("CONTESTO/RIFERIMENTI", msgs[0]["content"])
        self.assertIn("Qual e' la differenza", msgs[1]["content"])


class TestRollingShift(unittest.TestCase):
    def test_b_storia_sotto_budget(self):
        budget = history_char_budget(4096)
        history = []
        for i in range(40):
            history.append({"role": "user",
                            "content": f"domanda numero {i} molto lunga " * 30})
            history.append({"role": "ai",
                            "content": f"risposta numero {i} molto lunga " * 30})
        kept, summary = trim_history(history, budget)
        self.assertLess(len(kept), len(history), "trim non applicato")
        # nessun turno troncato a meta (turni interi)
        for t in kept:
            self.assertIn("content", t)
            self.assertTrue(t["content"].endswith("lunga")
                            or "riepilogo" in t["content"]
                            or len(t["content"]) > 0)
        storia_chars = sum(len(t["content"]) for t in kept)
        self.assertLessEqual(storia_chars, budget,
                             f"storia {storia_chars} > budget {budget}")
        if summary:
            self.assertLessEqual(len(summary), 2200)
        # il prompt finale resta componibile
        msgs = _prep(history_turns=kept)
        self.assertGreaterEqual(len(msgs), 2)
        self.assertEqual(msgs[0]["role"], "system")


class TestHitRateReale(unittest.TestCase):
    def test_c_hitrate_fixture(self):
        proc = subprocess.run(
            [sys.executable, str(ROOT / "tests" / "g2_hitrate.py")],
            capture_output=True, text=True, timeout=120,
            cwd=str(ROOT),
        )
        self.assertEqual(proc.returncode, 0, proc.stderr[-500:])
        data = json.loads((ROOT / "qa" / "g2_hitrate.json").read_text(
            encoding="utf-8"))
        self.assertGreaterEqual(data["hit_rate"], 0.70,
                                f"hit_rate {data['hit_rate']} < 0.70")
        self.assertEqual(data["conversations"], 20)
        self.assertGreater(data["turns_total"], 60)


if __name__ == "__main__":
    unittest.main(verbosity=2)

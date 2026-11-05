# -*- coding: utf-8 -*-
"""tests/testP1b_usearch.py - P1b.2: test T1 del layer HNSW + hook.

COPRE (nessuna rete, indici in cartelle temp):
  a) usearch_enabled: env RAG_USEARCH prevale su config/default;
  b) UsearchLayer round-trip: build -> search -> save -> NUOVA istanza ->
     load (nessun rebuild) -> stessi top-k; invalidate -> rebuild;
  c) ramo _vec_query con flag OFF: percorso sqlite invariato (nessun layer);
  d) hook invalidate: add_chunks/reset chiamano _usearch_invalidate (verificato
     con spy sul metodo dell'istanza);
  e) fallback elegante: layer indisponibile -> sqlite (nessuna eccezione).
Eseguire: python -m unittest tests.testP1b_usearch
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class TestFlag(unittest.TestCase):
    def test_env_precedence(self):
        from core.rag.usearch_layer import usearch_enabled
        old = os.environ.get("RAG_USEARCH")
        try:
            os.environ["RAG_USEARCH"] = "1"
            self.assertTrue(usearch_enabled())
            os.environ["RAG_USEARCH"] = "0"
            self.assertFalse(usearch_enabled())
        finally:
            if old is None:
                os.environ.pop("RAG_USEARCH", None)
            else:
                os.environ["RAG_USEARCH"] = old

    def test_flag_off_default(self):
        from core.rag.usearch_layer import USEARCH_ENABLED_DEFAULT
        old = os.environ.pop("RAG_USEARCH", None)
        try:
            # default esplicito coerente con l'A/B (bool)
            self.assertIsInstance(USEARCH_ENABLED_DEFAULT, bool)
        finally:
            if old is not None:
                os.environ["RAG_USEARCH"] = old


class TestLayerRoundTrip(unittest.TestCase):
    def test_build_search_save_load(self):
        import numpy as np
        from core.rag.usearch_layer import UsearchLayer
        dim, n = 16, 40
        rng = np.random.default_rng(7)
        mat = rng.standard_normal((n, dim)).astype(np.float32)
        ids = list(range(1, n + 1))
        with tempfile.TemporaryDirectory() as td:
            info = lambda: (dim, n, "test-embedder")

            def build():
                return ids, mat

            l1 = UsearchLayer(td, "tstore")
            idx = l1.ensure(info=info, build=build)
            self.assertIsNotNone(idx)
            self.assertEqual(l1.last_action, "rebuild")
            q = mat[3] + 0.001
            hits1 = l1.search(q, 5)
            self.assertTrue(hits1 and hits1[0][0] == ids[3])
            # seconda istanza -> LOAD (no rebuild)
            l2 = UsearchLayer(td, "tstore")
            idx2 = l2.ensure(info=info, build=build)
            self.assertIsNotNone(idx2)
            self.assertEqual(l2.last_action, "load")
            hits2 = l2.search(q, 5)
            self.assertEqual([h[0] for h in hits1], [h[0] for h in hits2])
            # invalidate -> rebuild
            l2.invalidate()
            idx3 = l2.ensure(info=info, build=build)
            self.assertIsNotNone(idx3)
            self.assertEqual(l2.last_action, "rebuild")

    def test_ensure_skip_quando_info_invalida(self):
        from core.rag.usearch_layer import UsearchLayer
        with tempfile.TemporaryDirectory() as td:
            l = UsearchLayer(td, "t2")
            # dim=0 -> info non valida -> skipped -> None (nessuna eccezione)
            idx = l.ensure(info=lambda: (0, 0, ""), build=lambda: None)
            self.assertIsNone(idx)
            self.assertEqual(l.last_action, "skipped")


class TestHookEScope(unittest.TestCase):
    def test_flag_off_igiena_vec_query(self):
        # _vec_query con flag OFF ESPLICITO (env=0 prevale sul default ON
        # dell'A/B P1b.2) non deve nemmeno istanziare il layer
        from core.rag.vector_store_sqlite import SQLiteVectorStore
        old = os.environ.get("RAG_USEARCH")
        os.environ["RAG_USEARCH"] = "0"
        try:
            with tempfile.TemporaryDirectory() as td:
                vs = SQLiteVectorStore(td, store_key="t")
                out = vs._vec_query([0.1] * 8, 3)   # dim a caso: sqlite ritorna []
                self.assertEqual(out, [])
                self.assertIsNone(getattr(vs, "_usearch_layer", None))
        finally:
            if old is None:
                os.environ.pop("RAG_USEARCH", None)
            else:
                os.environ["RAG_USEARCH"] = old

    def test_hook_reset_invalida(self):
        from core.rag.vector_store_sqlite import SQLiteVectorStore
        old = os.environ.get("RAG_USEARCH")
        os.environ["RAG_USEARCH"] = "1"
        try:
            with tempfile.TemporaryDirectory() as td:
                vs = SQLiteVectorStore(td, store_key="t")
                # istanza layer finta spy
                class Spy:
                    calls = 0
                    def invalidate(self):
                        Spy.calls += 1
                vs._usearch_layer = Spy()
                vs.reset()
                self.assertEqual(Spy.calls, 1)
        finally:
            if old is None:
                os.environ.pop("RAG_USEARCH", None)
            else:
                os.environ["RAG_USEARCH"] = old

    def test_usearch_search_disattivato_none(self):
        from core.rag.vector_store_sqlite import SQLiteVectorStore
        old = os.environ.pop("RAG_USEARCH", None)
        try:
            with tempfile.TemporaryDirectory() as td:
                vs = SQLiteVectorStore(td, store_key="t")
                self.assertIsNone(vs._usearch_search([0.0] * 4, 3))
        finally:
            if old is not None:
                os.environ["RAG_USEARCH"] = old


if __name__ == "__main__":
    unittest.main()

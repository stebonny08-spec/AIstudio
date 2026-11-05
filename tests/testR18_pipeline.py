# -*- coding: utf-8 -*-
"""R18 - test pipeline: B1 (3 stadi/breaker/provenienza), B2 (grounding),
B3 (cache intent-aware), B4 (dedup indice), B5 (profondita'/UI umana).

TUTTI mockati: zero LLM reale, zero rete reale.
Esecuzione: python tests/testR18_pipeline.py
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import core.router as rtr                            # noqa: E402
import core.web_search as webs                       # noqa: E402
from core.models import WebResult                    # noqa: E402
from core.rag import contract, grounding, web_stage  # noqa: E402
from core.rag import intent as rag_intent            # noqa: E402
from core.rag.answer_cache import AnswerCache        # noqa: E402
from core.router import Router                       # noqa: E402

try:
    from tests.testH1_parity import DeterministicEmbedder
except ImportError:
    from testH1_parity import DeterministicEmbedder   # noqa: E402

THR = 0.70
_CFG_TEST = {
    "progress_events": True, "threshold": THR, "web_mode": "auto",
    "w_appunti": 1.0, "w_libri": 1.0, "w_web": 0.8, "ttl_days": 7,
}
_ORIG_CFG_FN = rtr._read_pipeline_cfg
LONG_TEXT = "Risposta completa. " + "contenuto " * 160
SHORT_TEXT = "Troppo breve."


class _Client:
    n_ctx = 4096

    def __init__(self, text=LONG_TEXT):
        self.calls = []
        self.text = text

    def generate_stream(self, query, **kw):
        self.calls.append(dict(query=query, **kw))
        return iter([self.text])


class _FakeSearch:
    def __init__(self, rows=None, embedder=None):
        self.rows = list(rows or [])
        self.embedder = embedder
        self.vector_store = type("S", (), {"count": lambda s: len(self.rows)})()
        self.last_probe = None
        self.queries = []

    def search(self, query, top_k=5, topic=None, hybrid=False,
               variants=None):
        self.queries.append(query)
        rows = self.rows[:top_k]
        self.last_probe = {
            "query_norm": query, "embed_ms": 1.0, "fts_ms": 0.0,
            "vec_ms": 1.0, "total_ms": 5.0,
            "variants": len(variants) if variants else 1,
            "fused": [dict(r) for r in rows],
            "candidates": [dict(r) for r in rows],
            "vec_lists": [[dict(r) for r in rows]],
            "fts_lists": [],
        }

        class _Res:
            chunks = []
            confidence = 1.0
        return _Res()


def _row(text, sim, src="appunti/nota.md"):
    return {"text": text, "source_file": src, "location_hint": "p.1",
            "similarity": sim, "is_image": False, "image_path": "",
            "mime_type": ""}


class _Log:
    def __init__(self):
        self.records = []
        self._orig = contract.log_risposta

    def __enter__(self):
        contract.log_risposta = self.records.append
        return self

    def __exit__(self, *exc):
        contract.log_risposta = self._orig
        return False


class _Base(unittest.TestCase):
    def setUp(self):
        rtr._read_pipeline_cfg = lambda: dict(_CFG_TEST)
        self.addCleanup(self._restore_cfg)
        self.log = _Log()
        self.log.__enter__()
        self.addCleanup(self.log.__exit__, None, None, None)
        os.environ.pop(contract.WEB_DOWN_ENV, None)
        self.addCleanup(os.environ.pop, contract.WEB_DOWN_ENV, None)
        # breaker pulito a fine test (mai interferenze tra test)
        self.addCleanup(self._reset_breaker)

    @staticmethod
    def _restore_cfg():
        rtr._read_pipeline_cfg = _ORIG_CFG_FN

    @staticmethod
    def _reset_breaker():
        try:
            with web_stage._BREAKER_LOCK:
                web_stage._BREAKER["open_until"] = 0.0
                web_stage._BREAKER["last_error"] = None
                web_stage.LAST_STATE.update({"attempted": False,
                                             "via_breaker": False,
                                             "n_results": 0, "ok": False,
                                             "reason": "", "ts": 0.0})
        except Exception:
            pass

    def _router(self, rows, client=None, web_results=None, real_web=False):
        tmp = Path(tempfile.mkdtemp(prefix="qaR18_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        emb = DeterministicEmbedder()
        client = client or _Client()
        local = _FakeSearch(rows, embedder=emb)
        books = _FakeSearch([], embedder=emb)
        router = Router(lambda: client, local, books)

        class _Sem:
            ready = True

            def should_use_rag(self, q):
                return True, 0.9, 0.1

            def warmup(self):
                pass

        router.semantic_router = _Sem()
        router._answer_cache = AnswerCache(path=tmp / "ac.jsonl")
        self.web_calls = []
        self.web_results = list(web_results or [])
        if not real_web:
            def _fake(query, gate_outcome="", mode="auto", **kw):
                self.web_calls.append({"query": query, "mode": mode})
                return list(self.web_results)

            router._fetch_web_stage = _fake
        self.router, self.client, self.local = router, client, local
        return router, client

    def _run(self, router, query, web_override="auto", history=None):
        events = list(router.process_query_stream(
            query, mode="automatica", thinking=False, study_mode="studio",
            stop_event=None, topic="", history_turns=history,
            web_override=web_override))
        toks = [e["text"] for e in events if e["type"] == "token"]
        src_events = [e for e in events if e["type"] == "sources"]
        return {"events": events, "text": "".join(toks),
                "types": [e["type"] for e in events],
                "sources": src_events,
                "stages": (src_events[-1].get("stages")
                           if src_events else None),
                "progress": [e for e in events if e["type"] == "progress"]}


def _w(rows_n=1):
    return [_row("La fotosintesi clorofilliana converte la luce in energia "
                 "chimica producendo glucosio e rilasciando ossigeno.",
                 0.82 + 0.01 * i) for i in range(rows_n)]


# ===================================================================== B1
class TestB1TreStadi(_Base):
    def test_web_sempre_tentato_auto(self):
        # gate piena (sim 0.82) ma il web DEVE essere tentato (B1.1)
        router, client = self._router(_w(), real_web=True)
        import core.rag.web_stage as ws
        calls = []
        orig = webs.search_web

        def fake(query, max_results=5, **kw):
            calls.append(query)
            return [WebResult(title="T", url="https://www.treccani.it/x",
                              snippet="snip")]

        webs.search_web = fake
        try:
            res = self._run(router, "cos'è la fotosintesi?")
        finally:
            webs.search_web = orig
        self.assertEqual(len(calls), 1, "B1.1: web tentato nonostante gate pieno")
        self.assertEqual(len(client.calls), 1)
        self.assertNotEqual(res["stages"], [], "provenienza da contributor")

    def test_breaker_apre_su_errore_reale(self):
        # tentativo HTTP REALE fallito -> breaker aperto con ultimo errore
        import core.rag.web_stage as ws
        self._reset_breaker()
        calls = []
        orig = webs.search_web

        def failing(query, max_results=5, **kw):
            calls.append(query)
            webs.NET_LOG.append({
                "provider": "ddgs", "url": "https://example.org/x",
                "ms": 5.0, "ok": False, "n": 0,
                "note": "errore fetch: ConnectionError"})
            return []

        webs.search_web = failing
        try:
            out = ws.escalate("query di test", "nulla", "auto", 5)
            st = ws.breaker_state()
            self.assertEqual(out, [])
            self.assertTrue(st["open"])
            self.assertLessEqual(st["ttl_s"], 60.0, "TTL <= 60s (B1.2)")
            self.assertTrue(st["last_error"])
            self.assertEqual(st["last_error"]["url"], "https://example.org/x")
            self.assertIn("ConnectionError", st["last_error"]["error"])
            # seconda chiamata entro TTL: NESSUN nuovo tentativo (post-errore)
            out2 = ws.escalate("query di test 2", "nulla", "auto", 5)
            self.assertEqual(out2, [])
            self.assertEqual(len(calls), 1, "nessun retry entro TTL")
            lst = ws.web_state()
            self.assertTrue(lst["via_breaker"])
            # dopo il TTL -> retry per query (B1.2)
            with web_stage._BREAKER_LOCK:
                web_stage._BREAKER["open_until"] = time.time() - 1.0
            ws.escalate("query di test 3", "nulla", "auto", 5)
            self.assertEqual(len(calls), 2, "retry dopo TTL")
        finally:
            webs.search_web = orig

    def test_giu_solo_dopo_tentativo_reale(self):
        # errore reale -> informativa dice "problema di rete" (B1.2/B5.2)
        self._reset_breaker()
        router, client = self._router([], real_web=True)
        orig = webs.search_web

        def failing(query, max_results=5, **kw):
            webs.NET_LOG.append({
                "provider": "wikipedia", "url": "https://it.wikipedia.org/q",
                "ms": 3.0, "ok": False, "n": 0,
                "note": "errore: TimeoutError"})
            return []

        webs.search_web = failing
        try:
            res = self._run(router, "domanda fuori corpus zzz")
        finally:
            webs.search_web = orig
        self.assertEqual(len(client.calls), 0, "informativa = zero LLM")
        self.assertIn("problema di rete", res["text"].lower())
        recs = [r for r in self.log.records if r.get("esito") == "informativa"]
        self.assertTrue(recs)
        self.assertEqual(recs[-1].get("web_status"), "giu")

    def test_mai_niente_rete_e_niente_scuse_web(self):
        router, client = self._router(_w())
        res = self._run(router, "cos'è la fotosintesi?",
                        web_override="mai")
        self.assertEqual(self.web_calls, [])
        self.assertNotIn("problema di rete", res["text"].lower())


# ============================================================ B1.3 / B2.3
class TestProvenienzaContribuenti(_Base):
    def test_informativa_nessuna_fonte(self):
        router, client = self._router([])   # nessun candidato
        res = self._run(router, "domanda fuori corpus qqq")
        self.assertTrue(res["types"], "eventi attesi")
        self.assertIsNotNone(res["stages"])
        self.assertEqual(res["stages"], [],
                         "B1.3: nessun contributore -> stages vuoti")
        self.assertEqual(len(client.calls), 0)

    def test_generazione_locale_appunti(self):
        router, client = self._router(_w())
        res = self._run(router, "cos'è la fotosintesi?")
        self.assertEqual(res["stages"], ["appunti"])

    def test_senza_duplicati_nel_contesto(self):
        # B4.5: top-k del fuso mai con due entry dello stesso hash
        rows = [_row("Testo identico di prova.", 0.8),
                dict(_row("Testo identico di prova.", 0.79))]
        router, client = self._router(rows)
        self._run(router, "cos'è la fotosintesi?")
        if client.calls:
            texts = [c.text for c in
                     client.calls[0].get("local_chunks") or []]
            self.assertEqual(len(texts), len(set(texts)))


# ===================================================================== B3
class TestCacheIntentAware(_Base):
    def test_hit_ammesso_riformulata(self):
        router, client = self._router(_w())
        q = "cos'è la fotosintesi?"
        self._run(router, q)
        n1 = len(client.calls)
        # richeiesta SUBITO DOPO con la stessa domanda in storia -> riformulata
        res2 = self._run(router, q, history=[{"role": "user",
                                              "content": q}])
        self.assertGreater(len(client.calls), n1, "HIT rielaborato (>=1 call)")
        prog = [p for p in res2["progress"] if p.get("stage") == "cache"]
        self.assertTrue(prog, "branch cache emesso")

    def test_hit_bloccato_sotto_domanda(self):
        # prima run: risposta completa in cache (supporto lessicale ok)
        q = "spiega la fotosintesi clorofilliana in dettaglio"
        router, client = self._router(_w())
        self._run(router, q)
        self.assertEqual(router.answer_cache.stats()["writes"], 1,
                         "precondizione: risposta in cache")
        n1 = len(client.calls)
        # stesso testo MA storia con altro topic -> intent non riformulata
        # (B3.2: nuova/sotto-domanda forzano retrieval fresco)
        hist = [{"role": "user", "content": "chi era Napoleone Bonaparte?"}]
        res2 = self._run(router, q, history=hist)
        recs = [r for r in self.log.records if r.get("cache_decision")]
        self.assertTrue(recs)
        dec = recs[-1].get("cache_decision") or {}
        self.assertFalse(dec.get("allowed", True),
                         f"B3.2: riuso dovuto essere bloccato: {dec}")
        prog = [p for p in res2["progress"] if p.get("stage") == "cache"]
        self.assertEqual(prog, [], "nessun branch cache su nuovo/sotto")
        self.assertGreater(len(client.calls), n1, "retrieval fresco")

    def test_followup_query_espansa(self):
        router, client = self._router(_w())
        hist = [{"role": "user", "content": "cos'è la fotosintesi?"}]
        self._run(router, "parlami meglio di questa produzione di ossigeno",
                  history=hist)
        self.assertTrue(self.local.queries)
        q = self.local.queries[-1]
        self.assertIn("fotosintesi", q, "B3.3: topic in query espansa")
        self.assertNotEqual(q, "parlami meglio di questa produzione di ossigeno")

    def test_chit_chat_senza_ricerca(self):
        router, client = self._router(_w())
        res = self._run(router, "ciao")
        self.assertEqual(self.local.queries, [], "chit-chat = 0 retrieval")
        self.assertEqual(self.web_calls, [])


# ===================================================================== B5
class TestProfonditaEUm(_Base):
    def test_risposta_corta_rigenerata(self):
        router, client = self._router(_w(), client=_Client(SHORT_TEXT))
        res = self._run(router, "cos'è la fotosintesi?")
        self.assertEqual(len(client.calls), 2, "B5.1: 1 rigenerazione")
        note = client.calls[1].get("repair_note") or ""
        self.assertIn("120", note)
        self.assertIn("reset", res["types"])
        recs = [r for r in self.log.records
                if r.get("validazione") and not r["validazione"].get("skipped")]
        self.assertTrue(recs)

    def test_risposta_lunga_singola_chiamata(self):
        router, client = self._router(_w())
        res = self._run(router, "cos'è la fotosintesi?")
        self.assertEqual(len(client.calls), 1)
        val = [r for r in self.log.records if r.get("validazione")]
        self.assertTrue(val)
        self.assertTrue(val[-1]["validazione"]["depth"]["ok"])

    def test_informativa_umana(self):
        router, client = self._router([])
        res = self._run(router, "domanda fuori corpus yyy")
        txt = res["text"]
        for tech in ("Cercato:", "score", "soglia", "Perche'", "[Web:",
                     "StudioIA_7", "\\\\"):
            self.assertNotIn(tech, txt, tech)
        self.assertIn("Cosa puoi provare", txt)


# ===================================================================== B2
class TestGrounding(_Base):
    def setUp(self):
        super().setUp()
        self._orig_rc = grounding.run_check

    def tearDown(self):
        grounding.run_check = self._orig_rc

    def test_violations_rigenerazione(self):
        answers = [{"ok": False, "violations": ["afferma che la fotosintesi "
                                                "converte l'azoto"]},
                   {"ok": True, "violations": []}]
        calls = []

        def fake_rc(query, ctx, ans, **kw):
            calls.append(ans)
            return dict(answers[min(len(calls) - 1, len(answers) - 1)])

        grounding.run_check = fake_rc
        router, client = self._router(_w())
        res = self._run(router, "cos'è la fotosintesi?")
        self.assertEqual(len(calls), 2, "check rilanciato dopo la rigenerazione")
        self.assertEqual(len(client.calls), 2)
        note = client.calls[1].get("repair_note") or ""
        self.assertIn("azoto", note)
        self.assertIn("reset", res["types"])
        recs = [r for r in self.log.records if r.get("validazione")]
        self.assertEqual(recs[-1]["validazione"]["attempts"], 2)

    def test_persistenza_dichiara_limite(self):
        def always_fail(query, ctx, ans, **kw):
            return {"ok": False,
                    "violations": ["dato non confermato dalle fonti"]}

        grounding.run_check = always_fail
        router, client = self._router(_w())
        res = self._run(router, "cos'è la fotosintesi?")
        self.assertIn("Non riesco a verificare completamente", res["text"])
        recs = [r for r in self.log.records if r.get("validazione")]
        self.assertTrue(recs[-1]["validazione"].get("limit_declared"))
        # la risposta "limite" NON viene messa in cache
        self.assertEqual(router.answer_cache.stats()["writes"], 0)

    def test_parser_grammatica(self):
        ok = grounding.parse_check('```json\n{"ok": true, "violations": []}\n```')
        self.assertTrue(ok["ok"])
        bad = grounding.parse_check(
            'Ecco: {"ok": false, "violations": ["x"]} fine')
        self.assertFalse(bad["ok"])
        self.assertEqual(bad["violations"], ["x"])
        junk = grounding.parse_check("nessun json")
        self.assertFalse(junk["ok"])

    def test_depth_check_regole(self):
        self.assertFalse(grounding.depth_check("tre parole.",
                                               "sotto-domanda")["ok"])
        self.assertTrue(grounding.depth_check(" ".join(["w"] * 90),
                                              "sotto-domanda")["ok"])
        self.assertTrue(grounding.depth_check(" ".join(["w"] * 130),
                                              "nuova-domanda")["ok"])
        self.assertTrue(grounding.depth_check(
            "\n".join(f"{i}. punto {i}" for i in range(1, 4)),
            "nuova-domanda")["ok"], "3 punti strutturati OK anche <120 parole")
        self.assertTrue(grounding.depth_check("ciao!", "chit-chat")["ok"])


# ===================================================================== B4
class TestIndiceDedup(_Base):
    def _store(self, tmp):
        from core.rag.vector_store_sqlite import SQLiteVectorStore
        st = SQLiteVectorStore(str(tmp / "d"), "test/deterministic-embedder",
                               db_path=str(tmp / "s.db"), store_key="t")
        self.addCleanup(st.close)
        return st

    def test_add_chunks_dedup_per_documento(self):
        from core.rag.chunker import chunk_text
        tmp = Path(tempfile.mkdtemp(prefix="qaR18idx_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        st = self._store(tmp)
        emb = DeterministicEmbedder()
        ch = chunk_text("Testo unico di prova per il dedup R18.",
                        source_file="doc.md")
        st.add_chunks(ch, emb.embed([c.text for c in ch]))
        n1 = st.count()
        # reindex con id diversi, stesso contenuto -> nessun duplicato
        ch2 = chunk_text("Testo unico di prova per il dedup R18.",
                         source_file="doc.md")
        st.add_chunks(ch2, emb.embed([c.text for c in ch2]))
        self.assertEqual(st.count(), n1, "B4: nessun duplicato per hash/doc")
        # vincolo unico presente
        cur = st._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND "
            "name='ux_chunks_hash_doc'")
        self.assertTrue(cur.fetchone())

    def test_top_k_mai_doppio_hash(self):
        from core.rag.chunker import chunk_text
        tmp = Path(tempfile.mkdtemp(prefix="qaR18idx2_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        st = self._store(tmp)
        emb = DeterministicEmbedder()
        txt = "Contenuto identico indicizzato da due percorsi diversi."
        a = chunk_text(txt, source_file="orig_a.md")
        b = chunk_text(txt, source_file="orig_b.md")
        st.add_chunks(a + b, emb.embed([c.text for c in a + b]))
        self.assertEqual(st.count(), 2, "vincolo = per documento")
        vec = emb.embed_one(txt, kind="query")
        rows = st.query(vec, top_k=5, text=txt, hybrid=True)
        texts = [r["text"] for r in rows]
        self.assertEqual(len(texts), len(set(texts)),
                         "B4.5: top-k senza hash duplicati")
        self.assertLessEqual(len(rows), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)

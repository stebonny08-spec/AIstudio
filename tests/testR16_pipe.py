# -*- coding: utf-8 -*-
"""R16 - Test B2: pipeline web-ultimo-layer + SLO + reset + log (testR16_pipe.py).

Copre R16 2.x/3.x:
- gate nulla + web con risultati -> GENERA dal web (mai informativa)
- R16_WEB_DOWN=1 -> zero rete + informativa web_status="giu"
- piena -> nessun fetch web (ultimo layer); mai -> zero rete (compat R15)
- PARTIAL_PREFIX sui parziali; conversione RESET_TOKEN -> evento reset
- time_budget_s passato solo se il client lo dichiara (compat)
- log_risposta per ogni esito; allowlist web (post-filtro)
- progress emesso anche sul path chitchat

Esecuzione: set PYTHONIOENCODING=utf-8 && python tests/testR16_pipe.py
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import core.router as rtr                            # noqa: E402
from core.rag import contract                        # noqa: E402
from core.rag.answer_cache import AnswerCache        # noqa: E402
from core.router import Router                       # noqa: E402
from core.models import RetrievedChunk, WebResult    # noqa: E402
from core.rag.contract import (                      # noqa: E402
    OUTCOME_NULLA,
    OUTCOME_PARZIALE,
    OUTCOME_PIENA,
    PARTIAL_PREFIX,
    RESET_TOKEN,
    StageHit,
    RetrievalOutcome,
)

try:
    from tests.testH1_parity import DeterministicEmbedder
except ImportError:
    from testH1_parity import DeterministicEmbedder   # noqa: E402

THR = 0.70

_CFG_TEST = {
    "progress_events": True,
    "threshold": THR,
    "web_mode": "auto",
    "w_appunti": 1.0,
    "w_libri": 1.0,
    "w_web": 0.8,
    "ttl_days": 7,
}
_ORIG_CFG_FN = rtr._read_pipeline_cfg


class CountingClient:
    n_ctx = 4096

    def __init__(self):
        self.calls = []

    def generate_stream(self, query, **kw):
        self.calls.append(dict(query=query, **kw))
        # R18 B5.1: testo >=120 parole -> nessuna rigenerazione per depth
        return iter(["Risposta", " di prova dal client, "
                     + "contenuto " * 150])

class BudgetClient(CountingClient):
    """Client che DICHIARA time_budget_s (param esplicito)."""

    def generate_stream(self, query, time_budget_s=None, **kw):
        self.calls.append(dict(query=query, time_budget_s=time_budget_s,
                               **kw))
        return iter(["Risposta", " con budget. " + "contenuto " * 150])


class ResetClient(CountingClient):
    """Client che emette il contract.RESET_TOKEN a meta' stream."""

    def generate_stream(self, query, **kw):
        self.calls.append(dict(query=query, **kw))
        return iter(["Parziale rotto ", RESET_TOKEN, "Nuova risposta pulita."])


class _StubSemantic:
    def __init__(self, result=(True, 0.9, 0.1)):
        self.ready = True
        self.result = result
        self._warm_started = False

    def should_use_rag(self, query):
        return self.result

    def warmup(self):
        self._warm_started = True


class _FakeStore:
    def __init__(self, n=10):
        self._n = n

    def count(self):
        return self._n


class _FakeSearch:
    def __init__(self, rows=None, embedder=None):
        self.rows = list(rows or [])
        self.embedder = embedder
        self.vector_store = _FakeStore(10 if self.rows else 0)
        self.last_probe = None

    def search(self, query, top_k=5, topic=None, hybrid=False,
               variants=None):
        rows = self.rows[:top_k]
        self.last_probe = {
            "query_norm": query, "embed_ms": 1.0, "fts_ms": 0.0,
            "vec_ms": 1.0, "total_ms": 5.0, "variants": 1,
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


class _RisposteRecorder:
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
        self._log = _RisposteRecorder()
        self._log.__enter__()
        self.addCleanup(self._log.__exit__, None, None, None)
        os.environ.pop(contract.WEB_DOWN_ENV, None)
        self.addCleanup(os.environ.pop, contract.WEB_DOWN_ENV, None)

    @staticmethod
    def _restore_cfg():
        rtr._read_pipeline_cfg = _ORIG_CFG_FN

    def _router(self, rows_local, client=None, semantic=None):
        tmp = Path(tempfile.mkdtemp(prefix="qaR16pipe_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        emb = DeterministicEmbedder()
        client = client or CountingClient()
        local = _FakeSearch(rows_local, embedder=emb)
        books = _FakeSearch([], embedder=emb)
        router = Router(lambda: client, local, books)
        router.semantic_router = semantic or _StubSemantic()
        router._answer_cache = AnswerCache(path=tmp / "ac.jsonl")
        self.web_calls = []

        def _fake_web(query, gate_outcome="", mode="auto", **kw):
            self.web_calls.append({"query": query})
            return list(self.web_results)

        router._fetch_web_stage = _fake_web
        self.web_results = []
        return router, client

    def _run(self, router, query, web_override="auto", mode="automatica"):
        events = list(router.process_query_stream(
            query, mode=mode, thinking=False, study_mode="studio",
            stop_event=None, topic="", history_turns=None,
            web_override=web_override))
        toks = [e["text"] for e in events if e["type"] == "token"]
        return {"events": events, "text": "".join(toks),
                "types": [e["type"] for e in events],
                "source": next((e["value"] for e in events
                                if e["type"] == "source"), None)}


WEB_ROW = {"title": "Fotosintesi - Treccani",
           "url": "https://www.treccani.it/enc/fotosintesi",
           "snippet": "La fotosintesi clorofilliana e' il processo..."}


def _web_results():
    return [WebResult(title=WEB_ROW["title"], url=WEB_ROW["url"],
                      snippet=WEB_ROW["snippet"])]


class TestWebUltimoLayer(_Base):
    def test_nulla_con_web_genera_da_web(self):
        """F0 q3/q4 -> R16 3.1(c): gate nulla + web con risultati -> 1 LLM."""
        rows = [_row("Testo di fotosintesi clorofilliana.", 0.82)]
        router, client = self._router(rows)
        self.web_results = _web_results()
        res = self._run(router, "domanda fuori corpus totalm zzz",
                        web_override="auto")
        self.assertEqual(len(self.web_calls), 1, "escalation web attesa")
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0].get("context_kind"), "web")
        self.assertTrue(client.calls[0].get("web_results"))
        self.assertEqual(res["source"], "web")
        self.assertNotIn("Non ho trovato nei materiali locali", res["text"])

    def test_rete_giu_informativa_onesta_zero_llm(self):
        """QA-1 (v): R16_WEB_DOWN -> zero rete, informativa, 0 LLM."""
        os.environ[contract.WEB_DOWN_ENV] = "1"
        rows = [_row("Testo di fotosintesi clorofilliana.", 0.82)]
        router, client = self._router(rows)
        self.web_results = _web_results()   # non deve essere usato
        res = self._run(router, "domanda fuori corpus zzz q2",
                        web_override="auto")
        self.assertEqual(self.web_calls, [], "ZERO chiamate web")
        self.assertEqual(len(client.calls), 0, "informativa = zero LLM")
        self.assertIn("problema di rete", res["text"].lower())
        recs = [r for r in self._log.records
                if r.get("esito") == "informativa"]
        self.assertTrue(recs, "log_risposta informativa mancante")
        self.assertEqual(recs[-1].get("web_status"), "giu")

    def test_piena_comunque_tenta_web_b11(self):
        """R18 B1.1: anche con gate pieno il web e' TENTATO (l'unica
        eccezione e' il cache hit intent-aware, non qui)."""
        rows = [_row("La differenza tra enzima e ormone e' biologica.",
                     0.60)]
        router, client = self._router(rows)
        self.web_results = _web_results()
        res = self._run(router, "Che differenza c'e' tra enzima e ormone?",
                        web_override="auto")
        self.assertEqual(len(self.web_calls), 1, "B1.1: web tentato")
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0].get("context_kind"), "locale")
        self.assertIn(res["source"], ("locale", "web"))

    def test_mai_zero_rete_compat_r15(self):
        rows = [_row("Testo di fotosintesi clorofilliana.", 0.82)]
        router, client = self._router(rows)
        self.web_results = _web_results()
        res = self._run(router, "domanda fuori corpus zzz3",
                        web_override="mai")
        self.assertEqual(self.web_calls, [], "web_override=mai -> zero rete")
        self.assertEqual(len(client.calls), 0)
        self.assertIn("Non ho trovato", res["text"])
        # badge web: non_eseguito (mai esplicito)
        recs = [r for r in self._log.records
                if r.get("esito") == "informativa"]
        self.assertTrue(recs)
        self.assertEqual(recs[-1].get("web_status"), "non_eseguito")

    def test_vuoto_web_informativa_vuoto(self):
        rows = [_row("Testo di fotosintesi clorofilliana.", 0.82)]
        router, client = self._router(rows)
        self.web_results = []                # interrogato ma vuoto
        res = self._run(router, "domanda fuori corpus zzz4",
                        web_override="auto")
        self.assertEqual(len(self.web_calls), 1, "web interrogato")
        self.assertEqual(len(client.calls), 0)
        self.assertIn("nessuna fonte web utile", res["text"])
        self.assertNotIn("[Web:", res["text"])
        self.assertNotIn("score", res["text"])
        self.assertNotIn("Perche'", res["text"])


class TestParzialePrefix(_Base):
    def test_partial_prefix_r16(self):
        rows = [_row("Differenza essenziale enzima ormone spiegata.", 0.45)]
        router, client = self._router(rows)
        res = self._run(router, "Che differenza c'e' tra enzima e ormone?",
                        web_override="mai")
        self.assertEqual(len(client.calls), 1)
        self.assertTrue(res["text"].startswith(PARTIAL_PREFIX),
                        "prefisso parziale R16 mancante: %r"
                        % res["text"][:60])


class TestResetEventi(_Base):
    def test_reset_token_diventa_evento_reset(self):
        # servono candidati validi (piena) per raggiungere la generazione
        rows = [_row("La differenza tra enzima e ormone e' biologica.",
                     0.60)]
        router, client = self._router(rows, client=ResetClient())
        res = self._run(router, "Che differenza c'e' tra enzima e ormone?",
                        web_override="mai")
        self.assertIn("reset", res["types"], "evento reset mancante")
        # semantica consumer: dopo il reset resta SOLO il testo nuovo
        acc = ""
        for e in res["events"]:
            if e["type"] == "reset":
                acc = ""
            elif e["type"] == "token":
                acc += e["text"]
        self.assertTrue(acc.startswith("Nuova risposta pulita."), acc)
        # R18: NESSUN codice [F1] nel testo (provenienza = riga UI dai
        # metadati; la sources event porta stages)
        self.assertNotIn("[F1]", acc)
        self.assertNotIn("Fonti:", acc)
        prov = [e for e in res["events"] if e.get("type") == "sources"]
        self.assertTrue(prov, "sources event mancante")
        self.assertEqual((prov[-1] or {}).get("stages"), ["appunti"])


class TestTimeBudget(_Base):
    def test_budget_passato_se_dichiarato(self):
        router, client = self._router(
            [_row("La differenza tra enzima e ormone e' biologica.", 0.60)],
            client=BudgetClient())
        self._run(router, "Che differenza c'e' tra enzima e ormone?",
                  web_override="mai")
        self.assertEqual(len(client.calls), 1)
        b = client.calls[0].get("time_budget_s")
        self.assertIsNotNone(b, "time_budget_s non passato al client")
        self.assertGreaterEqual(b, 3.0)
        self.assertLessEqual(b, contract.SLO_TOTAL_S + 1.0)

    def test_compat_client_con_kwargs(self):
        """Client storici (**kwargs, es. proxy R15) RICEVONO il budget
        (fix QA-1 t1: con il filtro per-firma il budget non arrivava mai);
        nessun TypeError (compat)."""
        router, client = self._router(
            [_row("La differenza tra enzima e ormone e' biologica.", 0.60)])
        res = self._run(router, "Che differenza c'e' tra enzima e ormone?",
                        web_override="mai")
        self.assertEqual(len(client.calls), 1)
        self.assertIn("time_budget_s", client.calls[0],
                      "client **kwargs: budget inoltrato")
        self.assertTrue(res["text"])


class TestLogRisposta(_Base):
    def test_log_ogni_esito(self):
        # 1) generazione normale
        rows = [_row("La differenza tra enzima e ormone e' biologica.", 0.60)]
        router, client = self._router(rows)
        self._run(router, "Che differenza c'e' tra enzima e ormone?",
                  web_override="mai")
        # 2) informativa
        router2, client2 = self._router(
            [_row("Testo di fotosintesi clorofilliana.", 0.82)])
        self._run(router2, "domanda fuori corpus zz", web_override="mai")
        gen = [r for r in self._log.records if r.get("esito") == "piena"]
        inf = [r for r in self._log.records if r.get("esito") == "informativa"]
        self.assertEqual(len(gen), 1, [r.get("esito") for r in self._log.records])
        self.assertEqual(len(inf), 1)
        for rec in (gen + inf):
            for key in ("query", "esito", "stadi", "tempi_per_stadio",
                        "tempo_totale_ms", "output_len", "marker_check",
                        "web_status"):
                self.assertIn(key, rec, key)

    def test_log_chitchat(self):
        router, client = self._router(
            [_row("x", 0.01)],
            semantic=_StubSemantic(result=(False, 0.0, 0.0)))
        res = self._run(router, "ciao!", web_override="mai")
        self.assertIn("progress", res["types"], "progress chitchat mancante")
        ch = [r for r in self._log.records if r.get("esito") == "chitchat"]
        self.assertEqual(len(ch), 1)


class TestAllowlist(unittest.TestCase):
    def test_file_e_loader(self):
        import core.web_search as w
        al = w.load_allowlist()
        self.assertGreaterEqual(len(al), 10, "allowlist < 10 domini")
        self.assertTrue((ROOT / "data" / "web_allowlist.txt").exists())
        self.assertTrue(w._in_allowlist("https://www.treccani.it/x"))
        self.assertTrue(w._in_allowlist("https://it.wikipedia.org/y"))
        self.assertFalse(w._in_allowlist("https://spam.example-ads.biz/z"))

    def test_post_filtro_search_web(self):
        """Nessuna rete: ddgs stubbato -> fuori allowlist SCARTATO."""
        import core.web_search as w
        fake = [
            {"title": "ok", "href": "https://www.treccani.it/enc/a",
             "body": "testo"},
            {"title": "no", "href": "https://malware.example.net/p",
             "body": "spam"},
        ]
        orig = w._ddgs_search
        w._ddgs_search = lambda *a, **k: [
            WebResult(title=i["title"], url=i["href"], snippet=i["body"])
            for i in fake]
        try:
            out = w.search_web("fotosintesi", 5, searxng_url="",
                               wikipedia=False)
        finally:
            w._ddgs_search = orig
        urls = [r.url for r in out]
        self.assertIn("https://www.treccani.it/enc/a", urls)
        self.assertNotIn("https://malware.example.net/p", urls)

    def test_budget_5s(self):
        import core.web_search as w
        self.assertLessEqual(w.WEB_BUDGET_S, contract.WEB_FETCH_CAP_S)


if __name__ == "__main__":
    unittest.main(verbosity=2)

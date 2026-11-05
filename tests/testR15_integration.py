# -*- coding: utf-8 -*-
"""
tests/testR15_integration.py — R15b integrazione (IMPLEMENTER-INTEGRATION).

Copre i 3 fix dell'integrazione Round 15b + le relative non-regressioni,
con harness DETERMINISTICO (0 LLM reale, 0 rete, tempfile, client contatore):

FIX-1  Router._emit_level / _emit_single_level inoltrano
       outcome=<decision.outcome> a client.generate_stream: il flag
       parziale di G (_PARTIAL_OUTCOME_INSTRUCTION in local_llm_client)
       arriva davvero in E2E (QA-1 ii: spy outcome_kwargs != None).
       Backward-compat: senza outcome il kwarg resta None (prompt
       byte-identico — garantito dal client, verificato in testR15_gate).

FIX-2  Esito (c) (informativa build_informativa, ZERO LLM) emesso anche
       quando fused NON e' vuoto, purche la decisione FINALE del gate sia
       OUTCOME_NULLA e nessun risultato web sia stato integrato:
         - web OFF (mai) + gate nulla  -> informativa, 0 chiamate  [QA-1 iv]
         - web interrogato ma 0 utili  -> informativa, badge [Web: tentato]
         - web interrogato con risultati -> SEMPRE 1 chiamata col contesto
           finale anche se il gate resta nulla (regola P1 "1 sola chiamata
           col contesto finale"; test_03/03b di testR15_pipe.py)
         - re-gate web diventa piena/parziale -> generazione normale.

FIX-3  Taratura del supporto lessicale (LEX_MIN) sulle feature MISURATE
       del pipeline REALE (outcome.query_norm = query grezza per P):
         - lex 1/4 = 0.25 (x1/x3/x4-like)  -> supporto -> PARZIALE,
           score < soglia -> MAI piena;
         - lex 1/5 = 0.20 (n1-like)        -> senza supporto -> NULLA
           (alta somiglianza senza supporto);
         - fts/bm25 reale (positivi)        -> supporto -> PIENA.

Esecuzione: set PYTHONIOENCODING=utf-8 && python tests/testR15_integration.py
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import core.rag.gate as gate                                # noqa: E402
import core.router as rtr                                   # noqa: E402
from core.models import WebResult                           # noqa: E402
from core.rag import contract                               # noqa: E402
from core.rag.answer_cache import AnswerCache               # noqa: E402
from core.rag.contract import (                             # noqa: E402
    OUTCOME_NULLA, OUTCOME_PARZIALE, OUTCOME_PIENA,
    RetrievalOutcome, StageHit,
)
from core.router import Router                              # noqa: E402
from core.models import RetrievedChunk                      # noqa: E402

try:
    from tests.testH1_parity import DeterministicEmbedder
except ImportError:  # eseguito come "python tests/testR15_integration.py"
    from testH1_parity import DeterministicEmbedder         # noqa: E402

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


# ======================================================================
# Harness
# ======================================================================
class CountingClient:
    """Client finto: registra OGNI kwarg reale passato a generate_stream."""

    n_ctx = 4096

    def __init__(self):
        self.calls = []

    def generate_stream(self, query, **kw):
        self.calls.append(dict(query=query, **kw))
        # R18 B5.1: testo >=120 parole -> nessuna rigenerazione per depth
        return iter(["RI", "SPOSTA " + "contenuto " * 150])


class _StubSemantic:
    def __init__(self, ready=True, result=(True, 0.9, 0.1)):
        self.ready = ready
        self.result = result
        self.called = 0
        self._warm_started = False

    def should_use_rag(self, query):
        self.called += 1
        return self.result

    def warmup(self):
        self._warm_started = True


class _FakeStore:
    def __init__(self, n=10):
        self._n = n

    def count(self):
        return self._n


class _FakeSearch:
    """Sostituisce LocalSearchEngine: restituisce righe finte ma REALI per
    il resto del pipeline (probe -> _build_outcome -> decide_gate -> synth)."""

    def __init__(self, rows=None, embedder=None):
        self.rows = list(rows or [])
        self.embedder = embedder
        self.vector_store = _FakeStore(10 if self.rows else 0)
        self.last_probe = None

    def search(self, query, top_k=5, topic=None, hybrid=False,
               variants=None):
        rows = self.rows[:top_k]
        self.last_probe = {
            "query_norm": query,          # P1 rewrite opt-in: qui la GRETTA
            "embed_ms": 1.0, "fts_ms": 0.0, "vec_ms": 1.0,
            "total_ms": 5.0, "variants": 1,
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


class _LogRecorder:
    """Sostituisce contract.log_astensione: nessuna scrittura su AppData."""

    def __init__(self):
        self.records = []
        self._orig = contract.log_astensione

    def __enter__(self):
        contract.log_astensione = self.records.append
        return self

    def __exit__(self, *exc):
        contract.log_astensione = self._orig
        return False


def _hit(text, score, stage="appunti"):
    return StageHit(chunk=RetrievedChunk(text=text,
                                         source_file="appunti/nota.md",
                                         location_hint="p.1",
                                         similarity=score),
                    stage=stage, score=score, rrf_rank=1)


def _outcome(query, fused, fts=None, vecs=None):
    return RetrievalOutcome(
        query=query, query_norm=query,   # pipeline reale: query GRETTA
        fused=fused, fts_scores=fts or [],
        vec_scores=vecs or [],
        stages_probed=["appunti"], total_ms=5.0)


class _Base(unittest.TestCase):
    def setUp(self):
        rtr._read_pipeline_cfg = lambda: dict(_CFG_TEST)
        self.addCleanup(self._restore_cfg)
        self._log = _LogRecorder()
        self._log.__enter__()
        self.addCleanup(self._log.__exit__, None, None, None)

    @staticmethod
    def _restore_cfg():
        rtr._read_pipeline_cfg = _ORIG_CFG_FN

    def _router(self, rows_local, rows_books=None):
        tmp = Path(tempfile.mkdtemp(prefix="qaR15int_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        emb = DeterministicEmbedder()
        client = CountingClient()
        local = _FakeSearch(rows_local, embedder=emb)
        books = _FakeSearch(rows_books or [], embedder=emb)
        router = Router(lambda: client, local, books)
        router.semantic_router = _StubSemantic()
        router._answer_cache = AnswerCache(path=tmp / "ac.jsonl")
        self.web_calls = []

        def _fake_web(query, gate_outcome="", mode="auto", **kw):
            self.web_calls.append({"query": query, "gate_outcome":
                                   gate_outcome, "mode": mode})
            return list(self.web_results)

        router._fetch_web_stage = _fake_web
        self.web_results = []
        return router, client

    def _run(self, router, query, web_override="mai",
             mode="automatica"):
        events = list(router.process_query_stream(
            query, mode=mode, thinking=False, study_mode="studio",
            stop_event=None, topic="", history_turns=None,
            web_override=web_override))
        toks = [e["text"] for e in events if e["type"] == "token"]
        return {"events": events, "text": "".join(toks),
                "tokens": toks,
                "source": next((e["value"] for e in events
                                if e["type"] == "source"), None)}


# ======================================================================
# FIX-1 — outcome threading gate -> generate_stream
# ======================================================================
class TestFix1OutcomeKwarg(_Base):
    def test_emit_level_default_none_backward_compat(self):
        router, client = self._router([])
        list(router._emit_level(
            client, "q", "locale", [], None, False, False, "studio",
            None, "locale", {}))
        self.assertEqual(len(client.calls), 1)
        self.assertIsNone(client.calls[0].get("outcome"),
                          "senza outcome esplicito -> kwarg None "
                          "(prompt byte-identico backward-compat)")

    def test_emit_level_single_level_inoltra_outcome(self):
        router, client = self._router([])
        list(router._emit_single_level(
            client, "q", "locale", [], None, False, False, "studio",
            None, "locale", outcome=OUTCOME_PARZIALE))
        self.assertEqual(client.calls[0].get("outcome"),
                         OUTCOME_PARZIALE)

    def test_e2e_gate_parziale_arriva_al_client(self):
        """QA-1 (ii): in E2E il client DEVE ricevere outcome=parziale."""
        rows = [_row("C'era una sola differenza nel documento.", 0.50)]
        router, client = self._router(rows)
        res = self._run(router, "Che differenza c'e' tra un enzima e "
                                "un ormone?", web_override="mai")
        self.assertEqual(len(client.calls), 1,
                         "parziale -> generazione (mai informativa)")
        self.assertEqual(client.calls[0].get("outcome"),
                         OUTCOME_PARZIALE,
                         "decision.outcome NON passato a generate_stream")
        self.assertTrue(res["tokens"])

    def test_e2e_gate_piena_outcome_piena(self):
        rows = [_row("La differenza enzima ormone e la fotosintesi "
                     "clorofilliana.", 0.90)]
        router, client = self._router(rows)
        self._run(router, "Che differenza c'e' tra un enzima e un "
                          "ormone?", web_override="mai")
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0].get("outcome"), OUTCOME_PIENA)


# ======================================================================
# FIX-2 — informativa (esito c) su decisione finale nulla
# ======================================================================
class TestFix2Informativa(_Base):
    NULLA_ROWS = [_row("Testo generico senza alcuna pertinenza "
                       "alla domanda.", 0.80)]

    def _is_informativa(self, text):
        # R18 B5.2: informativa UMANA (una frase + suggerimenti);
        # i dettagli tecnici NON ci sono piu' in UI
        t = text.lower()
        return ("non ho trovato" in t
                and "cosa puoi provare" in t
                and "riformula" in t
                and "cercato:" not in t
                and "stadi interrogati" not in t
                and "score" not in t)

    def test_web_off_fused_pieno_gate_nulla_informativa_zero_llm(self):
        """QA-1 (iv): fused non vuoto (sim 0.80) ma gate nulla ->
        informativa con 0 chiamate generate_stream."""
        router, client = self._router(self.NULLA_ROWS)
        with _LogRecorder() as log:
            res = self._run(router, "domanda fuori corpus totalm zzz",
                            web_override="mai")
        self.assertEqual(len(client.calls), 0,
                         "gate nulla + web OFF -> ZERO chiamate LLM")
        self.assertTrue(self._is_informativa(res["text"]),
                        "esito (c) completo non emesso")
        self.assertEqual(res["source"], "nessuna")
        self.assertTrue(res["tokens"], "l'informativa deve emettere token")
        self.assertEqual(self.web_calls, [])
        recs = [r for r in log.records if r.get("outcome") == OUTCOME_NULLA]
        self.assertTrue(recs, "astensione outcome=nulla registrata")

    def test_web_presenti_candidati_locali_gate_nulla_informativa(self):
        """R16 3.1(c) - PRIMA (R15b): informativa zero-LLM NONOSTANTE 5
        risultati web fusi = bug WEB-NON-USATO del forensics F0 (q3/q4).
        ORA: gate finale nulla + web con risultati -> risposta BASATA SUL
        WEB (1 chiamata, citazioni url). L'informativa zero-LLM spetta a
        web vuoto/giu' (QA-1 R16 iv, rete simulata giu')."""
        router, client = self._router(self.NULLA_ROWS)
        self.web_results = [WebResult(
            title="Fonte web di prova", url="https://esempio.it/voce",
            snippet="Contenuto web di prova per la risposta.")]
        res = self._run(router, "domanda fuori corpus totalm zzz",
                        web_override="auto")
        self.assertEqual(len(self.web_calls), 1, "escalation web attesa")
        self.assertEqual(len(client.calls), 1,
                         "R16 3.1(c): gate nulla + web con risultati -> "
                         "risposta BASATA SUL WEB (1 chiamata LLM)")
        self.assertFalse(self._is_informativa(res["text"]),
                         "R16: mai informativa con risultati web utilizzabili")
        self.assertEqual(res["source"], "web")

    def test_local_vuoto_web_presenti_genera_solo_web(self):
        """Eccezione misurata (test_03/03b di testR15_pipe): candidati
        locali eligibility-H8 VUOTI + web con risultati -> 1 chiamata col
        contesto web (mai informativa da contesto vuoto)."""
        router, client = self._router([])     # nessun candidato locale
        self.web_results = [WebResult(
            title="Fonte web di prova", url="https://esempio.it/voce",
            snippet="Contenuto web di prova per la risposta.")]
        res = self._run(router, "domanda del tutto fuori corpus",
                        web_override="auto")
        self.assertEqual(len(self.web_calls), 1)
        self.assertEqual(len(client.calls), 1,
                         "locale vuoto + web -> 1 sola chiamata (regola P1)")
        self.assertFalse(self._is_informativa(res["text"]))
        self.assertEqual(client.calls[0].get("outcome"), OUTCOME_NULLA)

    def test_web_interrogato_vuoto_informativa_badge_tentato(self):
        """QA-1 (v)b variante: escalation web con 0 risultati utili ->
        informativa + badge [Web: tentato] + 0 chiamate LLM."""
        router, client = self._router(self.NULLA_ROWS)
        self.web_results = []          # interrogato ma nessun risultato
        res = self._run(router, "domanda fuori corpus totalm zzz",
                        web_override="auto")
        self.assertEqual(len(self.web_calls), 1, "web interrogato")
        self.assertEqual(len(client.calls), 0,
                         "0 risultati utili + gate nulla -> ZERO LLM")
        self.assertTrue(self._is_informativa(res["text"]))
        # R18 B5.2: niente badge [Web:] in UI - la frase onesta dice che
        # nessuna fonte web utile e' emersa (tentativo reale, 0 risultati)
        self.assertIn("nessuna fonte web utile", res["text"].lower())
        self.assertNotIn("[web:", res["text"].lower())

    def test_regate_web_piena_genera_normalmente(self):
        """Se il re-gate web diventa piena -> generazione, non informativa."""
        rows = [_row("Contenuto locale di risposta con la differenza "
                     "enzima ormone documentata.", 0.80)]
        router, client = self._router(rows)
        self.web_results = [WebResult(
            title="Voce", url="https://esempio.it/voce",
            snippet="differenza enzima ormone risposta completa.")]
        self._run(router, "Che differenza c'e' tra un enzima e un "
                          "ormone?", web_override="sempre")
        self.assertEqual(len(self.web_calls), 1)
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0].get("outcome"), OUTCOME_PIENA)

    def test_fused_vuoto_resta_informativa(self):
        """Regressione del caso storico: store vuoto -> informativa."""
        router, client = self._router([])
        res = self._run(router, "domanda totalmente fuori corpus zzz",
                        web_override="mai")
        self.assertEqual(len(client.calls), 0)
        self.assertTrue(self._is_informativa(res["text"]))


# ======================================================================
# FIX-3 — taratura supporto lessicale su feature del pipeline reale
# ======================================================================
class TestFix3CalibrazioneSupporto(_Base):
    """Outcome costruiti con le feature MISURATE sul pipeline REALE
    (qa/tmp/r15_diag_gate.json): query GRETTA in outcome.query_norm,
    vec/fts/lex esattamente come li vede decide_gate."""

    def test_x1_like_lex_25_parziale_mai_piena(self):
        """x1 live: vec 0.835, fts 0.379 (nessuna evidenza), lex 1/4 = 0.25
        -> supporto PRESENTE -> parziale, score < 0.70 -> MAI piena."""
        o = _outcome(
            "Chi ha scoperto la fotosintesi e in che anno e' avvenuta?",
            [_hit("La fotosintesi clorofilliana converte la luce in "
                  "energia chimica.", 0.835)],
            fts=[0.379], vecs=[0.835])
        with _LogRecorder():
            d = gate.decide_gate(o, THR)
        self.assertEqual(d.outcome, OUTCOME_PARZIALE,
                         f"lex 0.25 deve dare supporto: {d.reason}")
        self.assertLess(d.top_score, THR, "parziale MAI piena")
        self.assertAlmostEqual(d.top_score, 0.653, places=3)

    def test_n1_like_lex_20_senza_supporto_nulla(self):
        """n1 live: vec 0.840, fts 0.419 (nessuna evidenza), lex 1/5 = 0.20
        -> SENZA supporto -> nulla (alta somiglianza)."""
        o = _outcome(
            "Qual e' la differenza tra mitosi e meiosi nelle cellule?",
            [_hit("Differenza tra fotosintesi e respirazione: glucosio.",
                  0.840)],
            fts=[0.419], vecs=[0.840])
        with _LogRecorder() as log:
            d = gate.decide_gate(o, THR)
        self.assertEqual(d.outcome, OUTCOME_NULLA,
                         f"lex 0.20 deve restare senza supporto: {d.reason}")
        self.assertEqual(log.records[0]["causa"],
                         "alta_somiglianza_senza_supporto")
        self.assertAlmostEqual(d.top_score, 0.672, places=3)

    def test_finestra_calibrazione_025_vs_020(self):
        """La finestra di calibrazione UNICA: (0.20, 0.25]."""
        # lex = 1/4 = 0.25 -> supporto (query a 4 token, 1 hit)
        q25 = "scoperto fotosintesi anno avvenuta"
        o25 = _outcome(q25, [_hit("La fotosintesi clorofilliana convierte.",
                                  0.83)], fts=[0.0], vecs=[0.83])
        # lex = 1/5 = 0.20 -> nessun supporto (5 token, 1 hit: n1-like)
        q20 = "qual scoperto fotosintesi anno avvenuta"
        o20 = _outcome(q20, [_hit("Le cellule contengono il DNA e le "
                                  "fotosintesi.", 0.83)],
                       fts=[0.0], vecs=[0.83])
        with _LogRecorder():
            d25 = gate.decide_gate(o25, THR)
            d20 = gate.decide_gate(o20, THR)
        self.assertEqual(d25.outcome, OUTCOME_PARZIALE)
        self.assertEqual(d20.outcome, OUTCOME_NULLA)

    def test_x2_like_lex_33_parziale(self):
        o = _outcome("Che differenza c'e' tra un enzima e un ormone?",
                     [_hit("La RuBisCO e' un enzima che addiziona CO2.",
                           0.837)],
                     fts=[0.289], vecs=[0.837])
        with _LogRecorder():
            d = gate.decide_gate(o, THR)
        self.assertEqual(d.outcome, OUTCOME_PARZIALE)
        self.assertLess(d.top_score, THR)

    def test_positivo_con_fts_reale_piena(self):
        """9/9 positivi: fts bm25 reale (|bm25| >= floor) -> piena."""
        o = _outcome("valore delta g fotosintesi reazione glucosio",
                     [_hit("La reazione e' endergonica con delta G +2870 "
                           "kJ/mol nella fotosintesi.", 0.917)],
                     fts=[-8.2, -1.1], vecs=[0.917])
        with _LogRecorder() as log:
            d = gate.decide_gate(o, THR)
        self.assertEqual(d.outcome, OUTCOME_PIENA)
        self.assertEqual(log.records, [], "la piena non e' un'astensione")

    def test_lex_min_finestra_tarata(self):
        """Evidenza della taratura: la soglia accetta 0.25 e rifiuta 0.20
        (finestra unica misurata sui 18 casi GT)."""
        self.assertGreater(gate.LEX_MIN, 0.20,
                           "0.20 (n1 live) deve restare escluso")
        self.assertLessEqual(gate.LEX_MIN, 0.25,
                             "0.25 (x1/x3/x4 live) deve essere incluso")


if __name__ == "__main__":
    unittest.main(verbosity=2)

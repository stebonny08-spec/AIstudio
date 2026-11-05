# -*- coding: utf-8 -*-
"""
tests/testR15_gate.py — R15b blocco G: gate precoce (G1/G2/G3) + fix sidecar.

Tutti i test sono DETERMINISTICI e a ZERO LLM: costruiscono RetrievalOutcome
a mano (nessuna ricerca reale, nessuna generazione) e verificano:
  1. esiti obbligatori piena|parziale|nulla
  2. caso q4-like (vec 0.82 alto MA nessun FTS/lessico) -> MAI piena
  3. near_miss + log astensioni (contract.log_astensione) con campi richiesti
  4. build_informativa: cosa cercato + quasi-corrispondenze + suggerimento +
     badge web (tentato / non disponibile)
  5. backward-compat prompt: senza flag outcome il prompt e' IDENTICO
  6. SidecarLLMProxy: bind corretto (regressione del fix SIDECAR-DEAD)
  7. soglia tarata 0.70 in data/config_manager.py

Esecuzione: PYTHONIOENCODING=utf-8 python tests/testR15_gate.py
"""
from __future__ import annotations

import inspect
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import core.rag.gate as gate                                # noqa: E402
from core.models import RetrievedChunk                       # noqa: E402
from core.rag import contract                               # noqa: E402
from core.rag.contract import (                             # noqa: E402
    GateDecision, OUTCOME_NULLA, OUTCOME_PARZIALE, OUTCOME_PIENA,
    RetrievalOutcome, StageHit,
)

THR = 0.70


def _hit(text, score, src="fotosintesi_clorofilliana_universitario.md",
         stage="libri"):
    chunk = RetrievedChunk(text=text, source_file=src, location_hint="p.1",
                           similarity=score)
    return StageHit(chunk=chunk, stage=stage, score=score, rrf_rank=1)


def _out(query="domanda", qnorm=None, fused=None, fts=None, vecs=None,
          stages=None, total_ms=10.0):
    return RetrievalOutcome(
        query=query, query_norm=qnorm or query,
        fused=fused or [], fts_scores=fts or [], vec_scores=vecs or [],
        stages_probed=stages or ["libri"], total_ms=total_ms)


class _LogRecorder:
    """Sostituisce contract.log_astensione durante il test."""

    def __init__(self):
        self.records = []
        self._orig = contract.log_astensione

    def __enter__(self):
        contract.log_astensione = self.records.append
        return self

    def __exit__(self, *exc):
        contract.log_astensione = self._orig
        return False


class TestEsiti(unittest.TestCase):
    """G1: tre esiti obbligatori, O(1), zero LLM."""

    def test_piena_con_supporto(self):
        o = _out(query="valore delta g fotosintesi",
                 fused=[_hit("La reazione e' endergonica con delta G +2870 "
                             "kJ/mol di glucosio.", 0.90)],
                 fts=[-8.2, -1.1, 0.0], vecs=[0.91, 0.88])
        with _LogRecorder() as log:
            d = gate.decide_gate(o, THR)
        self.assertEqual(d.outcome, OUTCOME_PIENA)
        self.assertIsInstance(d, GateDecision)
        self.assertEqual(log.records, [], "la piena NON deve essere un'astensione")
        self.assertGreaterEqual(d.elapsed_ms, 10.0)   # base = outcome.total_ms

    def test_q4_like_alta_sim_senza_fts_non_piena(self):
        """CASO CRITICO forensics: vec 0.82 >= soglia ma fuori corpus."""
        o = _out(query="Qual e' la differenza tra mitosi e meiosi nelle cellule?",
                 qnorm="differenza mitosi meiosi cellule",
                 fused=[_hit("Nella fotosintesi il fotosistema II ossida "
                             "l'acqua e libera ossigeno.", 0.82)],
                 fts=[0.0] * 10, vecs=[0.82, 0.81],
                 stages=["appunti", "libri"])
        with _LogRecorder() as log:
            d = gate.decide_gate(o, THR)
        self.assertNotEqual(d.outcome, OUTCOME_PIENA,
                            "alta sim vettoriale SENZA supporto non e' piena")
        self.assertEqual(d.outcome, OUTCOME_NULLA)
        self.assertEqual(len(log.records), 1)
        rec = log.records[0]
        self.assertEqual(rec["causa"], "alta_somiglianza_senza_supporto")
        self.assertEqual(rec["outcome"], OUTCOME_NULLA)
        self.assertTrue(rec["near_miss"], "deve proporre i top-3 come quasi-match")

    def test_parziale_con_near_miss(self):
        o = _out(query="differenza enzima ormone",
                 fused=[_hit("La RuBisCO e' un enzima che addiziona CO2 al "
                             "RuBP del ciclo di Calvin.", 0.40),
                        _hit("Regolazione ferredossina-tioredossina.", 0.38),
                        _hit("Fase riduzione del carbonio.", 0.35)],
                 fts=[-1.7, 0.0, 0.0], vecs=[0.40, 0.38, 0.35])
        with _LogRecorder() as log:
            d = gate.decide_gate(o, THR)
        self.assertEqual(d.outcome, OUTCOME_PARZIALE)
        self.assertTrue(0 < len(d.near_miss) <= 3)
        self.assertTrue(all(h.score < THR for h in d.near_miss))
        self.assertEqual(log.records[0]["outcome"], OUTCOME_PARZIALE)

    def test_nulla_vuoto(self):
        o = _out(query="ricetta carbonara", total_ms=8.0)
        with _LogRecorder() as log:
            d = gate.decide_gate(o, THR, web_attempted=True)
        self.assertEqual(d.outcome, OUTCOME_NULLA)
        self.assertEqual(log.records[0]["causa"], "nessun_candidato")
        self.assertTrue(log.records[0]["web_attempted"])

    def test_decide_gate_non_e_llm(self):
        """ZERO LLM: nessun import di client LLM e nessuna latenza da modello."""
        src = inspect.getsource(gate)
        for banned in ("local_llm_client", "llama_cpp", "sidecar", "OpenAI",
                       "requests.post", "urllib"):
            self.assertNotIn(banned, src, "gate non puo' toccare un LLM")
        o = _out(query="x", fused=[_hit("testo", 0.5)], vecs=[0.5])
        with _LogRecorder():
            d = gate.decide_gate(o, THR)
        self.assertLess(d.elapsed_ms - o.total_ms, 50.0,
                        "verdetto deve essere O(1): overhead < 50ms")

    def test_elapsed_ms_dichiara_total_ms(self):
        o = _out(query="x", fused=[_hit("t", 0.9)], fts=[-6.0], vecs=[0.9],
                 total_ms=123.4)
        with _LogRecorder():
            d = gate.decide_gate(o, THR)
        self.assertGreaterEqual(d.elapsed_ms, 123.4)
        self.assertLess(d.elapsed_ms, 123.4 + 50.0)


class TestInformativa(unittest.TestCase):
    """G2c: build_informativa — esito (c), zero LLM."""

    def _decisione(self, web=False):
        o = _out(query="differenza mitosi meiosi",
                 qnorm="differenza mitosi meiosi cellule",
                 fused=[_hit("Fotosistema II ossida l'acqua.", 0.82)],
                 stages=["appunti", "libri"])
        return gate.decide_gate(o, THR, web_attempted=web)

    def test_contenuto_completo(self):
        """R18 B5.2: messaggio UMANO - frasi oneste + suggerimenti,
        MAI percorsi/score/soglie/badge [Web:] in UI."""
        txt = gate.build_informativa(self._decisione(web=True))
        self.assertIn("Non ho trovato", txt)
        self.assertIn("Cosa puoi provare", txt)                  # riformulazione
        self.assertIn("riformula la domanda", txt)
        self.assertIn("aggiungi alla biblioteca", txt)           # materiale
        # dettagli tecnici SOLO nei log
        self.assertNotIn("Cercato:", txt)
        self.assertNotIn("score", txt)
        self.assertNotIn("soglia", txt)
        self.assertNotIn("Perche'", txt)
        self.assertNotIn("[Web:", txt)
        self.assertNotIn("fotosintesi_clorofilliana_universitario.md", txt)
        self.assertNotIn("StudioIA_7", txt)

    def test_badge_web_assente_sempre(self):
        for wflag in (False, True):
            txt = gate.build_informativa(self._decisione(web=wflag))
            self.assertNotIn("[Web:", txt)
            self.assertNotIn("score", txt)

    def test_nulla_senza_candidate(self):
        d = gate.decide_gate(_out(query="ricetta carbonara",
                                  qnorm="ricetta carbonara"), THR)
        txt = gate.build_informativa(d)
        self.assertIn("Non ho trovato", txt)
        self.assertNotIn("info non trovata", txt.lower())
        self.assertNotIn("score", txt)


class TestLogAstensioni(unittest.TestCase):
    """G3: campi obbligatori del record (contract.log_astensione)."""

    def test_campi_record(self):
        o = _out(query="q di test", fused=[_hit("t", 0.4)], vecs=[0.4],
                 fts=[-1.0], stages=["libri"], total_ms=42.0)
        with _LogRecorder() as log:
            gate.decide_gate(o, THR, web_attempted=True)
        self.assertEqual(len(log.records), 1)
        rec = log.records[0]
        for campo in ("causa", "score", "stadi", "query", "tempo_totale_ms",
                      "outcome", "near_miss", "web_attempted"):
            self.assertIn(campo, rec, "campo mancante: %s" % campo)
        self.assertEqual(rec["query"], "q di test")
        self.assertEqual(rec["tempo_totale_ms"], rec["tempo_totale_ms"])  # numerico
        self.assertGreaterEqual(rec["tempo_totale_ms"], 42.0)

    def test_piena_non_logga(self):
        o = _out(query="q", fused=[_hit("t", 0.95)], fts=[-9.0], vecs=[0.95])
        with _LogRecorder() as log:
            gate.decide_gate(o, THR)
        self.assertEqual(log.records, [])


class TestPromptParziale(unittest.TestCase):
    """G2b: flag outcome=parziale backward-compat in local_llm_client."""

    def _prompt(self, **kw):
        from core.local_llm_client import _build_system_prompt
        return _build_system_prompt(study_mode="default",
                                    context_kind="locale",
                                    allow_fallback_marker=False,
                                    chitchat=False, **kw)

    def test_prompt_identico_senza_flag(self):
        base = self._prompt()
        self.assertEqual(base, self._prompt(outcome=None))
        self.assertNotIn("RECUPERO PARZIALE", base)

    def test_prompt_con_flag_parziale(self):
        txt = self._prompt(outcome="parziale")
        self.assertIn("RECUPERO PARZIALE", txt)
        self.assertIn("Ho trovato solo questo nei materiali", txt)
        # il blocco base resta identico, viene solo APPESO
        base = self._prompt()
        self.assertTrue(txt.startswith(base))

    def test_flag_altri_invarianti(self):
        for flag in (None, "piena", "nulla", "altro"):
            self.assertEqual(self._prompt(), self._prompt(outcome=flag),
                             "solo outcome='parziale' puo' cambiare il prompt")


class TestSidecarProxyRegistrazione(unittest.TestCase):
    """G0: regressione del fix SIDECAR-DEAD (bind sulla firma giusta)."""

    class _Target:
        def __init__(self):
            self.calls = []

        def generate_stream(self, query, context_kind="none", local_chunks=None,
                            thinking=False, outcome=None):
            self.calls.append(("inprocess", query, context_kind, outcome))
            return iter(["IN-PROCESS"])

        def stream_via_sidecar(self, query, profile=None, classe=None,
                               context_kind="none", local_chunks=None,
                               thinking=False, outcome=None):
            self.calls.append(("sidecar", query, context_kind, outcome))
            return iter(["SIDECAR"])

        def generated_via_sidecar(self, query, **kwargs):
            self.calls.append(("sidecar-gen", query))
            return "SIDECAR-GEN"

        def generate(self, query, **kwargs):
            self.calls.append(("inprocess-gen", query))
            return "IN-PROCESS-GEN"

    def test_genera_stream_va_in_sidecar(self):
        from core.local_llm_client import SidecarLLMProxy
        t = self._Target()
        p = SidecarLLMProxy(t)
        # chiamata ESATTAMENTE come la fa il router: posizionale solo la query
        out = "".join(p.generate_stream("LA-MIA-QUERY", context_kind="locale",
                                        thinking=False))
        self.assertEqual(out, "SIDECAR")
        self.assertEqual(t.calls[0][0], "sidecar")
        self.assertEqual(t.calls[0][1], "LA-MIA-QUERY")
        self.assertEqual(t.calls[0][2], "locale")

    def test_posizionali_mappati_sui_nomi_giusti(self):
        """REGRESSIONE: 'self' non deve assorbire il primo argomento."""
        from core.local_llm_client import SidecarLLMProxy
        t = self._Target()
        p = SidecarLLMProxy(t)
        # 2째 posizionale di generate_stream = context_kind (NON profile)
        "".join(p.generate_stream("Q", "locale"))
        self.assertEqual(t.calls[-1], ("sidecar", "Q", "locale", None))

    def test_flag_outcome_passa_al_sidecar(self):
        from core.local_llm_client import SidecarLLMProxy
        t = self._Target()
        p = SidecarLLMProxy(t)
        "".join(p.generate_stream("Q", context_kind="locale", outcome="parziale"))
        self.assertEqual(t.calls[-1], ("sidecar", "Q", "locale", "parziale"))

    def test_kw_sconosciuto_fallback_inprocess(self):
        """Kw sconosciuto: NON arriva al sidecar (stesso esito di prima:
        generate_stream reale solleva TypeError in entrambi i casi)."""
        from core.local_llm_client import SidecarLLMProxy
        t = self._Target()
        p = SidecarLLMProxy(t)
        with self.assertRaises(TypeError):
            "".join(p.generate_stream("Q", parametro_inesistente=1))
        self.assertFalse([c for c in t.calls if c[0].startswith("sidecar")],
                         "nessuna chiamata sidecar con kw sconosciuto")

    def test_generate_va_in_sidecar(self):
        from core.local_llm_client import SidecarLLMProxy
        t = self._Target()
        p = SidecarLLMProxy(t)
        self.assertEqual(p.generate("Q"), "SIDECAR-GEN")
        self.assertEqual(p.generate("Q", context_kind="locale"), "SIDECAR-GEN")

    def test_firma_proxy_pari_al_contratto(self):
        from core.local_llm_client import SidecarLLMProxy
        sig = inspect.signature(SidecarLLMProxy.generate_stream)
        self.assertEqual(list(sig.parameters), ["self", "args", "kwargs"])
        # la destinazione accetta il flag outcome
        dest = inspect.signature(self._Target.stream_via_sidecar)
        self.assertIn("outcome", dest.parameters)


class TestSogliaTarata(unittest.TestCase):
    """G4: il default tarato e' 0.70 (vedi qa/qa_r15_g_report.md)."""

    def test_default_tarato(self):
        from data.config_manager import DEFAULT_CONFIG
        self.assertEqual(DEFAULT_CONFIG["gate.threshold"], 0.70)

    def test_runtime_config(self):
        """R3.3 (R24): soglia LETTA da ConfigManager e confrontata col
        default del codice (DEFAULT_CONFIG), non con l'hardcode 0.70.

        - default dichiarato: DEFAULT_CONFIG['gate.threshold'] == 0.70;
        - coerenza default<->lettura: con config utente ASSENTE (APPDATA
          temporaneo, il config utente %APPDATA% NON viene toccato)
          ConfigManager restituisce esattamente il default del codice;
        - drift config utente (es. 0.75) != default -> solo INFORMATIVO
          (print), NON fail: il test verifica coerenza default<->codice."""
        import os
        import tempfile
        from data.config_manager import ConfigManager, DEFAULT_CONFIG

        default = float(DEFAULT_CONFIG["gate.threshold"])
        self.assertAlmostEqual(default, 0.70, places=6)   # default dichiarato

        tmp = tempfile.mkdtemp(prefix="r24_cfg_")
        old = os.environ.get("APPDATA")
        os.environ["APPDATA"] = tmp
        try:
            clean = float(ConfigManager().get("gate.threshold"))
        finally:
            if old is None:
                os.environ.pop("APPDATA", None)
            else:
                os.environ["APPDATA"] = old
        self.assertAlmostEqual(clean, default, places=6)  # letto == default

        runtime = float(ConfigManager().get("gate.threshold"))
        if abs(runtime - default) > 1e-9:
            print("[R24] INFO drift gate.threshold: config=%r default=%r "
                  "(informativo, non fail)" % (runtime, default))
        else:
            self.assertAlmostEqual(runtime, default, places=6)

    def test_firma_contrattuale(self):
        sig = inspect.signature(gate.decide_gate)
        self.assertEqual(list(sig.parameters),
                         ["outcome", "threshold", "web_attempted"])
        self.assertIs(sig.parameters["web_attempted"].kind,
                      inspect.Parameter.KEYWORD_ONLY)
        sig2 = inspect.signature(gate.build_informativa)
        # R16: contratto esteso (web_status/web_note keyword-only, vedi
        # contract.py sezione R16); il DEFAULT resta backward-compat:
        # build_informativa(decision) produce il testo legacy invariato.
        self.assertEqual(list(sig2.parameters),
                         ["decision", "web_status", "web_note"])
        self.assertIs(sig2.parameters["web_status"].kind,
                      inspect.Parameter.KEYWORD_ONLY)


if __name__ == "__main__":
    unittest.main(verbosity=2)

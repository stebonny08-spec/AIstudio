# -*- coding: utf-8 -*-
"""
tests/testR15_pipe.py - R15b blocco P (IMPLEMENTER-PIPE).

Copertura:
  P1  ESATTAMENTE 1 generate_stream per query:
      - caso locale forte (override mai)
      - escalation auto (gate != piena -> web stub -> 1 chiamata)
      - sempre (locale+web fusi, 1 chiamata)
      - chitchat (1 chiamata)
      - astensione (gate nulla + nessun web -> 0 chiamate, informativa)
      -> conteggio REALE chiamate via client contatore sul percorso reale;
         esito aggregato scritto in qa/r15_pipe_p1_calls.json.
  P2  warmup: Embedder.warmup/model_id presenti, Router/engine lo invocano
      (best-effort, non bloccante), SemanticRouter background (ready/warmup);
      fallback H9 deterministico quando il semantic non e' pronto.
      (misure REALI p95 encode + cold/ warm semantic -> r15_pipe_p2_*.json
       via "python tests/testR15_pipe.py --measures")
  P3  retrieve ibrido strumentato (last_probe: embed/fts/vec/total ms),
      RRF pesato per stadio, RetrievalOutcome (dump fts/vec/near_miss),
      gate subito dopo il retrieval, progress start PRIMA del lavoro,
      schema sources, web_override resolution, time-box soft dichiarato.
  P4  answer cache: chiave (query_norm + model_id + stadi), TTL 7gg,
      scrittura solo completa+con fonti, HIT = rielaborazione LLM della bozza (R16 follow-up: MAI testo identico),
      invalidazione fingerprint.

Vincoli: 100% LOCALE (nessuna rete: il web e' STUBBATO nei test; nessun
LLM reale: il client e' un contatore), tempfile ovunque, nessuna pip.

Esecuzione: set PYTHONIOENCODING=utf-8 && python tests/testR15_pipe.py
Misure reali:  set PYTHONIOENCODING=utf-8 && python tests/testR15_pipe.py --measures
"""
from __future__ import annotations

import inspect
import json
import math
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import core.router as rtr  # noqa: E402
from core.models import WebResult  # noqa: E402
from core.rag.answer_cache import (  # noqa: E402
    TTL_DAYS_DEFAULT, AnswerCache, make_key, normalize_query,
)
from core.rag.chunker import Chunk, chunk_text  # noqa: E402
from core.rag.embedder import Embedder  # noqa: E402
from core.rag.vector_store_sqlite import SQLiteVectorStore  # noqa: E402
from core.router import (  # noqa: E402
    RETRIEVE_SOFT_TIMEBOX_MS, Router,
)
from core.semantic_router import SemanticRouter  # noqa: E402
from data.db import Database  # noqa: E402

try:
    from tests.testH1_parity import DeterministicEmbedder
except ImportError:  # eseguito come "python tests/testR15_pipe.py"
    from testH1_parity import DeterministicEmbedder  # noqa: E402

# ---------------------------------------------------------------- configurazione
# Patch della config di pipeline: i test NON dipendono dalla config reale
# dell'utente (progress sempre on, web.mode auto, gate 0.45, pesi 1/1/0.8).
_CFG_TEST = {
    "progress_events": True,
    "threshold": 0.45,
    "web_mode": "auto",
    "w_appunti": 1.0,
    "w_libri": 1.0,
    "w_web": 0.8,
    "ttl_days": TTL_DAYS_DEFAULT,
}
_ORIG_CFG_FN = rtr._read_pipeline_cfg

# Report aggregato P1 (scritto da test_99_...)
CALLS_REPORT: dict = {}


def _pct(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    idx = min(len(s) - 1, max(0, int(math.ceil(p / 100.0 * len(s))) - 1))
    return round(float(s[idx]), 3)


# ---------------------------------------------------------------- corpus
_APPUNTI_DOCS = [
    ("SYN::appunti/fotosintesi.md",
     "La fotosintesi clorofilliana converte la luce in energia chimica "
     "negli organismi autotrofi del regno vegetale."),
    ("SYN::appunti/mitosi.md",
     "La mitosi produce due cellule figlie geneticamente identiche alla "
     "cellula madre grazie alla divisione ordinata dei cromosomi."),
    ("SYN::appunti/entropia.md",
     "L'entropia misura il disordine di un sistema termodinamico e "
     "aumenta in ogni trasformazione spontanea."),
    ("SYN::appunti/rivoluzione.md",
     "La rivoluzione francese del 1789 mise fine all'antico regime e "
     "introdusse i principi di liberta' ed uguaglianza."),
]
_BOOKS_DOCS = [
    ("SYN::libri/algebra.md",
     "L'algebra lineare studia vettori spazi lineari e matrici con "
     "operazioni ben definite e proprieta' dimostrabili."),
]


def _build_store(tmp: Path, name: str, docs, embedder):
    store = SQLiteVectorStore(
        str(tmp / name), "test/deterministic-embedder",
        db_path=str(tmp / "studioia.db"), store_key=name,
    )
    chunks, embeds = [], []
    for i, (src, text) in enumerate(docs):
        chunks.append(Chunk(id=f"{name}-{i}", source_file=src, text=text))
        embeds.append(embedder.embed_one(text, kind="passage"))
    if chunks:
        store.add_chunks(chunks, embeds)
    return store


class CountingClient:
    """Client LLM finto: conta le chiamate REALI a generate_stream."""

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


class _CountingEmbedder(DeterministicEmbedder):
    """DeterministicEmbedder + warmup/model_id (per i test P2)."""

    warmup_calls = 0

    @property
    def model_id(self):
        return "test/deterministic-embedder"

    @property
    def warm(self):
        return True

    def warmup(self):
        _CountingEmbedder.warmup_calls += 1
        return None


# ======================================================================
# P4 - ANSWER CACHE (unit)
# ======================================================================
class TestAnswerCacheUnit(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="qaR15ac_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.cache = AnswerCache(path=self.tmp / "ac.jsonl")

    def test_key_normalizza_e_componenti(self):
        k1 = make_key("  Che Cos'è   LA Mitosi? ", "m1", ["appunti", "web:mai"])
        k2 = make_key("che cos'è la mitosi", "m1", ["web:mai", "appunti"])
        self.assertEqual(k1, k2)  # normalizzazione + set di stadi ordinato
        k3 = make_key("che cos'è la mitosi", "m2", ["appunti", "web:mai"])
        self.assertNotEqual(k1, k3)  # model_id diverso -> chiave diversa
        k4 = make_key("che cos'è la mitosi", "m1", ["appunti", "libri", "web:auto"])
        self.assertNotEqual(k1, k4)  # stadi diversi -> chiave diversa
        self.assertEqual(normalize_query("  A  B. "), "a b")

    def test_put_rifiuta_incomplete_o_senza_fonti(self):
        key = make_key("q", "m", "appunti")
        self.assertFalse(self.cache.put(
            key, query="q", text="", source="locale",
            items=[{"stage": "appunti"}], model_id="m", stages="appunti"))
        self.assertFalse(self.cache.put(
            key, query="q", text="risposta", source="nessuna",
            items=[], model_id="m", stages="appunti"))
        self.assertTrue(self.cache.put(
            key, query="q", text="risposta completa", source="locale",
            items=[{"stage": "appunti", "title": "a.md", "url": "",
                    "source": "a.md"}],
            model_id="m", stages="appunti", fingerprint="f1"))
        rec = self.cache.get(key, fingerprint="f1")
        self.assertIsNotNone(rec)
        self.assertEqual(rec["text"], "risposta completa")
        self.assertEqual(self.cache.stats()["ttl_days"], 7)  # TTL 7gg

    def test_ttl_7_giorni_e_fingerprint(self):
        key = make_key("q2", "m", "appunti")
        self.cache.put(key, query="q2", text="t", source="locale",
                       items=[{"stage": "appunti"}], model_id="m",
                       stages="appunti", fingerprint="f1")
        # fingerprint change -> invalidata
        self.assertIsNone(self.cache.get(key, fingerprint="f2"))
        # entry scaduta (TTL) -> None
        with self.cache._lock:
            self.cache._entries.clear()
            self.cache._loaded = True
        import time as _t
        with self.cache._lock:
            self.cache._entries[key] = {
                "key": key, "text": "t", "items": [{"stage": "appunti"}],
                "ts": _t.time() - 8 * 86400, "fingerprint": "f1",
            }
        self.assertIsNone(self.cache.get(key, fingerprint="f1"))

    def test_persistenza_ricaricata_da_file(self):
        key = make_key("q3", "m", "appunti")
        self.cache.put(key, query="q3", text="persistita", source="web",
                       items=[{"stage": "web", "title": "t", "url": "u",
                               "source": "u"}],
                       model_id="m", stages="appunti")
        other = AnswerCache(path=self.tmp / "ac.jsonl")
        rec = other.get(key, fingerprint=None)
        self.assertIsNotNone(rec)
        self.assertEqual(rec["text"], "persistita")

    def test_corpus_fingerprint_dichiara_fallback(self):
        from core.rag.answer_cache import corpus_fingerprint
        # nessun store/db -> None = invalidazione solo TTL + clear (dichiarato)
        self.assertIsNone(corpus_fingerprint(stores=[], db=None))


# ======================================================================
# P3 - OUTCOME / RRF pesato / dump
# ======================================================================
def _row(text, source, sim):
    return {"text": text, "source_file": source, "location_hint": "",
            "similarity": sim, "is_image": False, "image_path": "",
            "mime_type": ""}


class TestOutcomeBuild(unittest.TestCase):
    def _probe(self, rows, vec_rows=None, fts_rows=None, stage_q="q"):
        return {
            "query_norm": stage_q,
            "embed_ms": 1.0, "fts_ms": 2.0, "vec_ms": 3.0,
            "total_ms": 6.0, "variants": 1,
            "vec_lists": [vec_rows] if vec_rows is not None else [],
            "fts_lists": [fts_rows] if fts_rows is not None else [],
            "fused": list(rows), "candidates": list(rows),
        }

    def test_rrf_pesato_per_stadio(self):
        app = self._probe([_row("t-appunti", "a.md", 0.90)])
        lib = self._probe([_row("t-libri", "b.md", 0.80)])
        out = rtr.Router._build_outcome(
            "q", [("appunti", app), ("libri", lib)],
            {"appunti": 1.0, "libri": 5.0, "web": 0.8},
            threshold=0.45, total_ms=6.0)
        # peso libri=5 -> 5/61 vince su 1/61 a parita' di rank
        self.assertEqual(out.fused[0].stage, "libri")
        self.assertEqual(len(out.fused), 2)
        self.assertEqual(out.stages_probed, ["appunti", "libri"])
        self.assertEqual(out.total_ms, 6.0)
        self.assertEqual(out.extra["weights"]["web"], 0.8)
        self.assertEqual(out.extra["soft_timebox_ms"], RETRIEVE_SOFT_TIMEBOX_MS)

    def test_dump_fts_vec_bm25_e_near_miss(self):
        rows = [
            _row("riga forte", "f1.md", 0.90),
            _row("riga debole", "f2.md", 0.40),
            _row("rumore", "f3.md", 0.20),
        ]
        vec_rows = [rows[0]]
        fts_rows = [dict(rows[1], bm25=-4.5)]
        probe = self._probe(rows, vec_rows=vec_rows, fts_rows=fts_rows,
                             stage_q="domanda")
        out = rtr.Router._build_outcome(
            "domanda", [("appunti", probe)],
            {"appunti": 1.0, "libri": 1.0, "web": 0.8},
            threshold=0.45, total_ms=6.0)
        self.assertEqual(len(out.fts_scores), len(out.fused))
        self.assertEqual(len(out.vec_scores), len(out.fused))
        # fts_scores = bm25 RAW (negativo, scala attesa dal gate G);
        # vec_scores = similarita' coseno reale; 0 = stadio non interpellato
        by_src = {h.chunk.source_file: i for i, h in enumerate(out.fused)}
        self.assertEqual(out.vec_scores[by_src["f1.md"]], 0.90)
        self.assertEqual(out.fts_scores[by_src["f1.md"]], 0.0)
        if "f2.md" in by_src:
            self.assertEqual(out.fts_scores[by_src["f2.md"]], -4.5)
        # near_miss: top-3 SOGLIA-SOTTO (esclusi i fused), score < threshold
        self.assertLessEqual(len(out.near_miss), 3)
        for h in out.near_miss:
            self.assertLess(h.score, 0.45)
        self.assertEqual(out.query_norm, "domanda")
        self.assertEqual(out.embed_ms, 1.0)
        self.assertEqual(out.fts_ms, 2.0)
        self.assertEqual(out.vec_ms, 3.0)

    def test_eligibility_nessun_rumore_sub_035(self):
        rows = [_row("rumore 1", "r1.md", 0.30),
                _row("rumore 2", "r2.md", 0.10)]
        probe = self._probe(rows)
        out = rtr.Router._build_outcome(
            "q", [("appunti", probe)],
            {"appunti": 1.0, "libri": 1.0, "web": 0.8},
            threshold=0.45)
        self.assertEqual(out.fused, [])       # nessun sub-0.35 nel contesto
        self.assertEqual(len(out.near_miss), 2)  # ma i near-miss restano


# ======================================================================
# P3 - config / web_override / time-box / decompose
# ======================================================================
class TestConfigAndOverride(unittest.TestCase):
    def test_read_pipeline_cfg_tipi_e_chiavi(self):
        cfg = rtr._read_pipeline_cfg()
        for k in ("progress_events", "threshold", "web_mode",
                  "w_appunti", "w_libri", "w_web", "ttl_days"):
            self.assertIn(k, cfg)
        self.assertIsInstance(cfg["progress_events"], bool)
        self.assertIsInstance(cfg["threshold"], float)
        self.assertGreater(cfg["threshold"], 0.0)
        for k in ("w_appunti", "w_libri", "w_web"):
            self.assertIsInstance(cfg[k], float)

    def test_web_override_resolution(self):
        r = Router
        cfg = dict(_CFG_TEST)
        self.assertEqual(r._resolve_web_override("sempre", cfg), "sempre")
        self.assertEqual(r._resolve_web_override("mai", cfg), "mai")
        self.assertEqual(r._resolve_web_override("AUTO", cfg), "auto")
        # vuoto/invalido -> config web.mode -> invalido -> auto
        cfg2 = dict(cfg, web_mode="sempre")
        self.assertEqual(r._resolve_web_override("", cfg2), "sempre")
        self.assertEqual(r._resolve_web_override("boh", cfg2), "sempre")
        cfg3 = dict(cfg, web_mode="strano")
        self.assertEqual(r._resolve_web_override("", cfg3), "auto")

    def test_signature_process_query_stream_ha_web_override(self):
        sig = inspect.signature(Router.process_query_stream)
        self.assertIn("web_override", sig.parameters)
        self.assertEqual(sig.parameters["web_override"].default, "")

    def test_timebox_soft_dichiarato(self):
        self.assertEqual(RETRIEVE_SOFT_TIMEBOX_MS, 1000.0)

    def test_cache_stages(self):
        self.assertEqual(Router._cache_stages("automatica", True, "auto"),
                         ["appunti", "libri", "web:auto"])
        self.assertEqual(Router._cache_stages("solo_locale", False, "mai"),
                         ["appunti", "web:mai"])
        self.assertEqual(Router._cache_stages("solo_online", False, "mai"),
                         ["web"])


class TestDecomposeRules(unittest.TestCase):
    def test_regole_esplicite(self):
        subs = Router._decompose(
            "spiega la mitosi e anche la meiosi inoltre confronta le differenze")
        self.assertGreaterEqual(len(subs), 2)
        subs2 = Router._decompose(
            "spiega la cellula. descrivi i mitocondri. confronta i ribosomi.")
        self.assertGreaterEqual(len(subs2), 2)
        # "tutto su" (regola R15b P1)
        subs3 = Router._decompose(
            "vorrei un riassunto preciso e completo con esempi di tutto su chimica organica")
        self.assertGreaterEqual(len(subs3), 2)
        # query semplice -> nessuna decomposizione
        self.assertEqual(Router._decompose("che cos'è la mitosi"), [])
        # intent non-rag -> nessuna decomposizione
        self.assertEqual(Router._decompose("salva come nota"), [])


# ======================================================================
# P2 - warmup (guardie; le misure reali stanno in --measures)
# ======================================================================
class TestWarmupGuards(unittest.TestCase):
    def test_embedder_surface_contratto(self):
        emb = Embedder()
        self.assertEqual(emb.model_id, "intfloat/multilingual-e5-small")
        self.assertTrue(callable(emb.warmup))
        # warmup -> None, best-effort: NON va invocato qui (caricherebbe il
        # modello); la firma e' verificata senza eseguire il caricamento.
        sig = inspect.signature(Embedder.warmup)
        self.assertEqual(len(sig.parameters), 1)  # solo self

    def test_router_init_invoca_warmup_non_bloccante(self):
        tmp = Path(tempfile.mkdtemp(prefix="qaR15warm_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        emb = _CountingEmbedder()
        store = _build_store(tmp, "vector_index", _APPUNTI_DOCS, emb)
        db = Database(db_path=tmp / "w.db")
        from core.local_search import LocalSearchEngine
        _CountingEmbedder.warmup_calls = 0
        engine = LocalSearchEngine(db, store, emb)
        self.assertGreaterEqual(_CountingEmbedder.warmup_calls, 1)
        client = CountingClient()
        t0 = time.perf_counter()
        router = Router(lambda: client, engine, engine)
        init_ms = (time.perf_counter() - t0) * 1000.0
        # best-effort: init non deve bloccare sul caricamento modelli
        self.assertLess(init_ms, 2000.0)
        self.assertGreaterEqual(_CountingEmbedder.warmup_calls, 2)
        self.assertTrue(router.semantic_router._warm_started
                        or router.semantic_router.ready)
        store.close()

    def test_semantic_router_surface(self):
        sr = SemanticRouter(_CountingEmbedder())
        self.assertTrue(hasattr(sr, "ready"))
        self.assertTrue(callable(sr.warmup))
        self.assertFalse(sr.ready)  # vettori non ancora calcolati
        sr.warmup()                 # spawn thread (DeterministicEmbedder)
        self.assertTrue(sr._warm_started)


# ======================================================================
# P1/P3/P4 - PIPELINE: conteggi REALI di generate_stream
# ======================================================================
class TestPipelineCalls(unittest.TestCase):
    """Conteggio reale generate_stream sul percorso REALE del router
    (client contatore, embedder deterministico, web STUBBATO = zero rete)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="qaR15pipe_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        rtr._read_pipeline_cfg = lambda: dict(_CFG_TEST)

        def _restore_cfg():
            rtr._read_pipeline_cfg = _ORIG_CFG_FN
        self.addCleanup(_restore_cfg)

        self.embedder = DeterministicEmbedder()
        self.store = _build_store(self.tmp, "vector_index",
                                  _APPUNTI_DOCS, self.embedder)
        self.books = _build_store(self.tmp, "vector_index_books",
                                  _BOOKS_DOCS, self.embedder)
        self.db = Database(db_path=self.tmp / "pipe.db")
        from core.local_search import LocalSearchEngine
        self.local = LocalSearchEngine(self.db, self.store, self.embedder)
        self.books_e = LocalSearchEngine(self.db, self.books, self.embedder)
        self.client = CountingClient()
        self.router = Router(lambda: self.client, self.local, self.books_e)
        self.router.semantic_router = _StubSemantic(ready=True,
                                                    result=(True, 0.9, 0.1))
        # cache su TEMP: mai toccare l'AppData reale nei test
        self.router._answer_cache = AnswerCache(path=self.tmp / "ac.jsonl")
        self.web_calls = []

        def _fake_web(query, gate_outcome="", mode="auto", **kw):
            self.web_calls.append({"query": query,
                                   "gate_outcome": gate_outcome,
                                   "mode": mode})
            return [
                WebResult(title="Fonte web di prova",
                          url="https://esempio.it/voce",
                          snippet="Contenuto web di prova per la risposta."),
                WebResult(title="Seconda fonte",
                          url="https://esempio.it/voce2",
                          snippet="Altro contenuto web pertinente."),
            ]

        self.router._fetch_web_stage = _fake_web
        self.addCleanup(self.store.close)
        self.addCleanup(self.books.close)

    def _run(self, query, mode="automatica", web_override=""):
        events = list(self.router.process_query_stream(
            query, mode=mode, thinking=False, study_mode="studio",
            stop_event=None, topic="", history_turns=None,
            web_override=web_override))
        toks = [e["text"] for e in events if e["type"] == "token"]
        prog = [e for e in events if e["type"] == "progress"]
        srcs = [e for e in events if e["type"] == "sources"]
        return {
            "events": events, "tokens": toks, "progress": prog,
            "sources": srcs, "calls": len(self.client.calls),
            "text": "".join(toks),
        }

    # ---------------------------------------------------------- 01: locale
    def test_01_locale_esattamente_una_chiamata(self):
        literal = _APPUNTI_DOCS[0][1]   # frase letterale del corpus
        res = self._run(literal, web_override="mai")
        CALLS_REPORT["locale_forte_mai"] = res["calls"]
        self.assertEqual(res["calls"], 1,
                         f"generate_stream chiamate {res['calls']} volte")
        call = self.client.calls[0]
        self.assertEqual(call["context_kind"], "locale")
        self.assertTrue(call["local_chunks"])
        self.assertFalse(call["web_results"])
        # ordine progress: gate start PRIMA del lavoro, synth per ultima
        stages = [(p["stage"], p["status"]) for p in res["progress"]]
        self.assertEqual(stages[0], ("gate", "start"))
        self.assertLess(stages.index(("gate", "start")),
                        stages.index(("appunti", "done")))
        self.assertLess(stages.index(("appunti", "done")),
                        stages.index(("gate", "done")))
        self.assertIn(("libri", "start"), stages)
        self.assertLess(stages.index(("gate", "done")),
                        stages.index(("synth", "start")))
        self.assertIn(("synth", "done"), stages)
        # schema progress
        for p in res["progress"]:
            self.assertEqual(p["type"], "progress")
            for k in ("stage", "status", "ms", "note"):
                self.assertIn(k, p)
            self.assertIsInstance(p["ms"], (int, float))
            self.assertGreaterEqual(p["ms"], 0.0)
            self.assertIn(p["status"], ("start", "done", "skip"))
        # schema sources
        self.assertTrue(res["sources"], "sources emesso dopo il retrieval")
        for item in res["sources"][0]["items"]:
            self.assertEqual(set(item.keys()),
                             {"stage", "title", "url", "source"})
        self.assertEqual(res["sources"][0]["items"][0]["stage"], "appunti")
        self.assertEqual(self.web_calls, [])   # mai + piena -> zero web

    # ------------------------------------------------- 02: una sola, "mai"
    def test_02_nessun_web_con_mai(self):
        literal = _APPUNTI_DOCS[1][1]
        res = self._run(literal, web_override="mai")
        self.assertEqual(res["calls"], 1)
        self.assertEqual(self.web_calls, [])

    # ------------------------------------- 03: escalation AUTO -> 1 chiamata
    def test_03_auto_escalation_web_una_chiamata(self):
        # query fuori corpus: gate NON piena (G: supporto assente) -> web
        gibberish = "zzqxv jklpwm nbvcxz quadrifoglio"
        res = self._run(gibberish, web_override="auto")
        CALLS_REPORT["auto_escalation_web"] = res["calls"]
        self.assertEqual(len(self.web_calls), 1,
                         f"web non interrogato: {self.web_calls}")
        self.assertEqual(self.web_calls[0]["mode"], "auto")
        self.assertIn(self.web_calls[0]["gate_outcome"],
                      ("parziale", "nulla"))
        # UNA sola chiamata, con il contesto FINALE (web disponibile):
        # niente generazione locale irrilevante PRIMA del web
        self.assertEqual(res["calls"], 1,
                         "vietato: generazione locale irrilevante POI web")
        call = self.client.calls[0]
        web_in_ctx = bool(call["web_results"]) or any(
            c.source_file == "https://esempio.it/voce"
            for c in (call["local_chunks"] or []))
        self.assertTrue(web_in_ctx,
                        "la chiamata deve usare il contesto web finale")
        self.assertEqual(self._source_of(res), "web")
        # sources contiene la fonte web
        stages = [i["stage"] for i in res["sources"][0]["items"]]
        self.assertIn("web", stages)
        stages_prog = [(p["stage"], p["status"]) for p in res["progress"]]
        self.assertIn(("web", "start"), stages_prog)
        self.assertIn(("web", "done"), stages_prog)

    # --------------- 03b: locale VUOTO + auto -> escalation web, 1 chiamata
    def test_03b_locale_vuoto_escalation_web_una_chiamata(self):
        # il caso forensics: contesto locale "none" che prima produceva una
        # generazione locale inutile PIU' una web (2 chiamate) -> ora 1.
        tmp = Path(tempfile.mkdtemp(prefix="qaR15esc_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        store_a = SQLiteVectorStore(str(tmp / "a"), "test/deterministic-embedder",
                                    db_path=str(tmp / "s.db"), store_key="a")
        store_b = SQLiteVectorStore(str(tmp / "b"), "test/deterministic-embedder",
                                    db_path=str(tmp / "s.db"), store_key="b")
        self.addCleanup(store_a.close)
        self.addCleanup(store_b.close)
        db = Database(db_path=tmp / "e.db")
        from core.local_search import LocalSearchEngine
        loc = LocalSearchEngine(db, store_a, self.embedder)
        bok = LocalSearchEngine(db, store_b, self.embedder)
        client = CountingClient()
        router = Router(lambda: client, loc, bok)
        router.semantic_router = _StubSemantic()
        router._answer_cache = AnswerCache(path=tmp / "ac.jsonl")
        web_calls = []

        def _fake_web(query, gate_outcome="", mode="auto", **kw):
            web_calls.append({"gate_outcome": gate_outcome, "mode": mode})
            return [WebResult(title="Fonte web",
                              url="https://esempio.it/voce",
                              snippet="Contenuto web di prova.")]

        router._fetch_web_stage = _fake_web
        events = list(router.process_query_stream(
            "domanda del tutto fuori corpus", mode="automatica",
            web_override="auto"))
        CALLS_REPORT["locale_vuoto_escalation_web"] = len(client.calls)
        # gate sul locale vuoto -> NULLA; auto -> web interrogato; 1 chiamata
        self.assertEqual(len(web_calls), 1)
        self.assertEqual(web_calls[0]["gate_outcome"], "nulla")
        self.assertEqual(web_calls[0]["mode"], "auto")
        self.assertEqual(len(client.calls), 1,
                         "locale-irrilevante-poi-web BANNATO: 1 chiamata")
        call = client.calls[0]
        self.assertEqual(call["context_kind"], "web")
        self.assertTrue(call["web_results"])
        src = [e["value"] for e in events if e["type"] == "source"]
        self.assertEqual(src, ["web"])

    # ------------------------------------- 04: "sempre" -> fuso, 1 chiamata
    def test_04_sempre_fuse_locale_e_web_una_chiamata(self):
        literal = _APPUNTI_DOCS[2][1]
        res = self._run(literal, web_override="sempre")
        CALLS_REPORT["sempre_locale_web_fuso"] = res["calls"]
        self.assertEqual(len(self.web_calls), 1)
        self.assertEqual(self.web_calls[0]["mode"], "sempre")
        self.assertEqual(res["calls"], 1)
        call = self.client.calls[0]
        self.assertEqual(call["context_kind"], "locale")
        self.assertTrue(call["local_chunks"])
        # chunk pseudo-web fusi (source_file = url) + chunk locali
        sources = [c.source_file for c in call["local_chunks"]]
        self.assertIn("https://esempio.it/voce", sources)
        self.assertTrue(any(s.startswith("SYN::appunti/") for s in sources))
        self.assertEqual(self._source_of(res), "web")

    # ------------------------------------ 05: piena -> web COMUNQUE tentato
    def test_05_auto_piena_comunque_interroga_web(self):
        """R18 B1.1: gate pieno NON short-circuita piu' il web."""
        literal = _APPUNTI_DOCS[3][1]
        res = self._run(literal, web_override="auto")
        self.assertEqual(res["calls"], 1)
        self.assertEqual(len(self.web_calls), 1,
                         "B1.1: web tentato anche con gate pieno")

    # ------------------------------------- 06: astensione -> 0 chiamate LLM
    def test_06_nulla_senza_web_informativa_zero_llm(self):
        # store VUOTI: nessun candidato -> gate nulla -> web mai -> informativa
        tmp = Path(tempfile.mkdtemp(prefix="qaR15empty_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        store_e = SQLiteVectorStore(str(tmp / "e1"),
                                    "test/deterministic-embedder",
                                    db_path=str(tmp / "s.db"),
                                    store_key="e1")
        store_e2 = SQLiteVectorStore(str(tmp / "e2"),
                                     "test/deterministic-embedder",
                                     db_path=str(tmp / "s.db"),
                                     store_key="e2")
        self.addCleanup(store_e.close)
        self.addCleanup(store_e2.close)
        db = Database(db_path=tmp / "e.db")
        from core.local_search import LocalSearchEngine
        loc = LocalSearchEngine(db, store_e, self.embedder)
        bok = LocalSearchEngine(db, store_e2, self.embedder)
        client = CountingClient()
        router = Router(lambda: client, loc, bok)
        router.semantic_router = _StubSemantic()
        router._answer_cache = AnswerCache(path=tmp / "ac.jsonl")
        router._fetch_web_stage = lambda *a, **k: (_ for _ in ()).throw(
            AssertionError("web non deve essere interrogato con mai"))
        events = list(router.process_query_stream(
            "domanda fuori corpus qualunque", mode="automatica",
            web_override="mai"))
        text = "".join(e["text"] for e in events if e["type"] == "token")
        CALLS_REPORT["nulla_informativa_zero_llm"] = len(client.calls)
        self.assertEqual(len(client.calls), 0,
                         "informativa gate = ZERO chiamate LLM (dichiarato)")
        self.assertTrue(text.strip())
        self.assertIn("Non ho trovato", text)  # build_informativa (G/shim)
        self.assertEqual([e["value"] for e in events
                          if e["type"] == "source"], ["nessuna"])

    # ----------------------------------------------------- 07: chitchat x1
    def test_07_chitchat_una_chiamata(self):
        self.router.semantic_router = _StubSemantic(
            ready=True, result=(False, 0.05, 0.80))
        res = self._run("ciao")
        CALLS_REPORT["chitchat"] = res["calls"]
        self.assertEqual(res["calls"], 1)
        self.assertTrue(self.client.calls[0].get("chitchat"))
        self.assertEqual(res["events"][-1]["value"], "nessuna")
        # nessuna fonti -> nessuna scrittura di cache (vincolo P4)
        self.assertEqual(self.router.answer_cache.stats()["writes"], 0)

    # ------------------------------------------------ 08: cache completa
    def test_08_cache_miss_hit_e_fingerprint(self):
        literal = _APPUNTI_DOCS[0][1]
        res1 = self._run(literal, web_override="mai")
        n1 = len(self.client.calls)
        self.assertEqual(n1, 1)
        self.assertEqual(self.router.answer_cache.stats()["writes"], 1)
        # HIT (R16 follow-up): rielaborazione LLM della bozza salvata -
        # MAI il testo identico ("RISPOSTA" qui diventa il fallback o una
        # riformulazione del client) e progress "cache" comunque emesso.
        res2 = self._run(literal, web_override="mai")
        n2 = len(self.client.calls)
        CALLS_REPORT["cache_hit_reelabora"] = n2 - n1
        self.assertGreater(n2, n1, "HIT deve rielaborare (>=1 chiamata)")
        self.assertNotEqual(res2["text"], "RISPOSTA",
                            "HIT non deve mai servire il testo identico")
        cache_prog = [p for p in res2["progress"] if p["stage"] == "cache"]
        self.assertTrue(cache_prog)
        self.assertIn("cache", cache_prog[0]["note"])
        self.assertTrue(res2["sources"])
        # fingerprint change -> invalidata -> nuova generazione
        self.router._cache_fingerprint = lambda: "FP-DIVERSA"
        res3 = self._run(literal, web_override="mai")
        n3 = len(self.client.calls)
        self.assertEqual(n3, n2 + 1)
        self.assertEqual(self.router.answer_cache.stats()["writes"], 2)

    # --------------------------------- 09: decompose wire = ancora 1 chiamata
    def test_09_decompose_sempre_una_chiamata(self):
        q = ("spiega la fotosintesi clorofilliana negli organismi "
             "autotrofi del regno vegetale. inoltre confronta con la "
             "respirazione cellulare che avviene nei mitocondri")
        res = self._run(q, web_override="mai")
        CALLS_REPORT["decompose_una_sola_generazione"] = res["calls"]
        self.assertEqual(res["calls"], 1)
        # le sub-query hanno alimentato il retrieval (varianti > 1)
        self.assertGreaterEqual(self.local.last_probe.get("variants", 0), 2)

    # ------------------------------------------------------ 99: report JSON
    def test_99_report_p1_calls_json(self):
        out = {
            "metric": ("conteggio REALE di LocalLLMClient.generate_stream "
                       "sul percorso reale di Router.process_query_stream "
                       "(client contatore; web stubbato, zero rete)"),
            "target": ("1 chiamata per query di default; 0 solo "
                       "informativa gate; HIT di cache = rielaborazione "
                       "(R16 follow-up, >=1 chiamata)"),
            "calls": CALLS_REPORT,
            "gate_ok": (
                CALLS_REPORT.get("locale_forte_mai") == 1
                and CALLS_REPORT.get("auto_escalation_web") == 1
                and CALLS_REPORT.get("locale_vuoto_escalation_web") == 1
                and CALLS_REPORT.get("sempre_locale_web_fuso") == 1
                and CALLS_REPORT.get("chitchat") == 1
                and CALLS_REPORT.get("nulla_informativa_zero_llm") == 0
                and CALLS_REPORT.get("cache_hit_reelabora", 0) >= 1
                and CALLS_REPORT.get("decompose_una_sola_generazione") == 1
            ),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        path = ROOT / "qa" / "r15_pipe_p1_calls.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False, indent=1),
                        encoding="utf-8")
        self.assertTrue(out["gate_ok"], CALLS_REPORT)

    @staticmethod
    def _source_of(res):
        for e in res["events"]:
            if e["type"] == "source":
                return e["value"]
        return None


# ======================================================================
# P3 - strumentazione retrieval (last_probe)
# ======================================================================
class TestRetrievalInstrumentation(unittest.TestCase):
    def test_hybrid_last_probe_timings_e_liste(self):
        tmp = Path(tempfile.mkdtemp(prefix="qaR15probe_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        emb = DeterministicEmbedder()
        store = _build_store(tmp, "vector_index", _APPUNTI_DOCS, emb)
        self.addCleanup(store.close)
        from core.local_search import LocalSearchEngine
        engine = LocalSearchEngine(Database(db_path=tmp / "p.db"),
                                   store, emb)
        # default (hybrid=False): last_probe azzerato (parita' H1 intatta)
        engine.search(_APPUNTI_DOCS[0][1], top_k=5)
        self.assertEqual(engine.last_probe, {})
        # ibrido: probe strumentato
        engine.search(_APPUNTI_DOCS[0][1], top_k=5, hybrid=True)
        probe = engine.last_probe
        for k in ("query_norm", "embed_ms", "fts_ms", "vec_ms", "total_ms",
                  "variants", "vec_lists", "fts_lists", "fused",
                  "candidates"):
            self.assertIn(k, probe)
        self.assertGreaterEqual(probe["embed_ms"], 0.0)
        self.assertGreaterEqual(probe["fts_ms"], 0.0)
        self.assertGreaterEqual(probe["vec_ms"], 0.0)
        self.assertGreater(probe["total_ms"], 0.0)
        self.assertGreaterEqual(len(probe["vec_lists"]), 1)
        self.assertGreaterEqual(len(probe["candidates"]), 1)

    def test_hybrid_accetta_variants(self):
        tmp = Path(tempfile.mkdtemp(prefix="qaR15var_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        emb = DeterministicEmbedder()
        store = _build_store(tmp, "vector_index", _APPUNTI_DOCS, emb)
        self.addCleanup(store.close)
        from core.local_search import LocalSearchEngine
        engine = LocalSearchEngine(Database(db_path=tmp / "v.db"),
                                   store, emb)
        engine.search(_APPUNTI_DOCS[0][1], top_k=5, hybrid=True,
                      variants=["variante una", "variante due"])
        self.assertEqual(engine.last_probe["variants"], 3)  # query + 2


# ======================================================================
# MISURE REALI (fuori T1): python tests/testR15_pipe.py --measures
# ======================================================================
def _percentile(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    idx = min(len(s) - 1, max(0, int(math.ceil(p / 100.0 * len(s))) - 1))
    return float(s[idx])


def run_measures() -> None:
    """Misure REALI (modello E5 locale, nessuna rete, nessun LLM).

    Protocollo dichiarato nei JSON scritti in qa/r15_pipe_*.json.
    """
    qa = ROOT / "qa"
    qa.mkdir(parents=True, exist_ok=True)

    # ---------------- P2a: encode query WARM (p95 <= 100ms) -------------
    from core.rag import embedder as emb_mod
    emb = emb_mod.Embedder()
    t0 = time.perf_counter()
    emb.warmup()
    warmup_spawn_ms = (time.perf_counter() - t0) * 1000.0
    t0 = time.perf_counter()
    while not emb.warm and (time.perf_counter() - t0) < 240.0:
        time.sleep(0.1)
    model_load_ms = (time.perf_counter() - t0) * 1000.0
    n_q = 24
    queries = [
        f"domanda di prova numero {i} sulle piante e la cellula vegetale"
        for i in range(n_q)
    ]
    emb_mod.clear_query_cache()   # nessun HIT: misura encode VERO
    samples = []
    for q in queries:
        t = time.perf_counter()
        emb.embed_one(q, kind="query")
        samples.append((time.perf_counter() - t) * 1000.0)
    # cache-hit (stessa query ripetuta)
    hit_samples = []
    for _ in range(100):
        t = time.perf_counter()
        emb.embed_one(queries[0], kind="query")
        hit_samples.append((time.perf_counter() - t) * 1000.0)
    p95 = _percentile(samples, 95)
    out = {
        "metric": ("p95 latenza encode query con modello WARM; ogni query e' "
                   "DISTINTA e la LRU e' svuotata prima della misura "
                   "(encode vero, nessun hit di cache); "
                   "n=%d, singola chiamata embed_one(kind='query') "
                   "misurata con time.perf_counter" % n_q),
        "protocollo": {
            "n_query": n_q,
            "cache_lru_prima": "clear_query_cache() (miss garantiti)",
            "warmup": "Embedder.warmup() + attesa flag .warm",
            "clock": "time.perf_counter",
            "warmup_spawn_ms": round(warmup_spawn_ms, 1),
            "model_load_ms_primo_uso": round(model_load_ms, 1),
        },
        "encode_warm_ms": {
            "p50": round(_percentile(samples, 50), 3),
            "p95": round(p95, 3),
            "max": round(max(samples), 3),
            "samples": [round(s, 3) for s in samples],
        },
        "cache_hit_ms": {
            "p50": round(_percentile(hit_samples, 50), 3),
            "p95": round(_percentile(hit_samples, 95), 3),
        },
        "gate_p95_le_100ms": p95 <= 100.0,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    (qa / "r15_pipe_p2_embed.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("[P2a] encode warm p50=%.1fms p95=%.1fms gate<=100: %s"
          % (out["encode_warm_ms"]["p50"], p95, out["gate_p95_le_100ms"]))

    # ------------- P2b: semantic_router cold PRIMA vs warm DOPO ----------
    # PRIMA: process senza warmup (prima query paga modello + 115 esempi)
    if emb_mod._model is not None:
        emb_mod.release_model()      # ripristina la condizione "freddo"
    sr_cold = SemanticRouter(emb)
    t = time.perf_counter()
    sr_cold.should_use_rag("spiega la fotosintesi clorofilliana")
    ms_prima = (time.perf_counter() - t) * 1000.0
    # fallback della PRIMA query se non pronto (regole H9, 0-LLM)
    t = time.perf_counter()
    for _ in range(50):
        rtr.Router0LLM().route("spiega la fotosintesi clorofilliana")
    ms_fallback = (time.perf_counter() - t) * 1000.0 / 50.0
    # DOPO: nuovo router con warmup in background, attesa ready, poi 20 query
    sr_warm = SemanticRouter(emb)
    t = time.perf_counter()
    sr_warm.warmup()
    while not sr_warm.ready and (time.perf_counter() - t) < 240.0:
        time.sleep(0.1)
    warm_ready_ms = (time.perf_counter() - t) * 1000.0
    warm_samples = []
    for i in range(20):
        t = time.perf_counter()
        sr_warm.should_use_rag(f"domanda ripasso numero {i} sulla cellula")
        warm_samples.append((time.perf_counter() - t) * 1000.0)
    out2 = {
        "metric": ("latenza should_use_rag: PRIMA = primo accesso senza "
                   "warmup (caricamento E5 + embedding 115 esempi, "
                   "misurato con release_model() prima di nuovo SemanticRouter); "
                   "DOPO = nuovo SemanticRouter.warmup() in background + "
                   "20 query con vettori pronti (mediana/p95)"),
        "prima_prima_query_ms": round(ms_prima, 1),
        "fallback_regole_h9_ms": round(ms_fallback, 3),
        "dopo_warmup_ready_ms": round(warm_ready_ms, 1),
        "dopo_p50_ms": round(_percentile(warm_samples, 50), 3),
        "dopo_p95_ms": round(_percentile(warm_samples, 95), 3),
        "dopo_samples_ms": [round(s, 3) for s in warm_samples],
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    (qa / "r15_pipe_p2_semantic.json").write_text(
        json.dumps(out2, ensure_ascii=False, indent=1), encoding="utf-8")
    print("[P2b] semantic prima=%.1fms dopo(p50)=%.3fms fallback=%.3fms"
          % (ms_prima, out2["dopo_p50_ms"], ms_fallback))

    # ---------------- P3: retrieve ibrido reale (soft time-box 1s) -------
    tmp = Path(tempfile.mkdtemp(prefix="qaR15meas_"))
    try:
        corpus = []
        stage2 = ROOT / "file_AIstudio" / "rag_stage2"
        if stage2.is_dir():
            for p in sorted(stage2.glob("*.md"))[:4]:
                try:
                    txt = p.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                corpus.extend(chunk_text(txt, source_file=str(p)))
        if len(corpus) < 20:
            for src, txt in (_APPUNTI_DOCS + _BOOKS_DOCS):
                corpus.extend(chunk_text(txt, source_file=src))
        store = SQLiteVectorStore(str(tmp / "midx"),
                                  emb.model_id,
                                  db_path=str(tmp / "m.db"),
                                  store_key="vector_index")
        embeds = emb.embed([c.text for c in corpus], kind="passage")
        store.add_chunks(corpus, embeds)
        from core.local_search import LocalSearchEngine
        engine = LocalSearchEngine(Database(db_path=tmp / "m2.db"),
                                   store, emb)
        n_q = 20
        mqueries = []
        for i in range(n_q):
            c = corpus[i % len(corpus)]
            mqueries.append(c.text[:80] if i % 2 == 0
                            else "riassunto e spiegazione di " + c.text[:60])
        wall, probe_ms, embed_ms, fts_ms, vec_ms = [], [], [], [], []
        for q in mqueries:
            t = time.perf_counter()
            engine.search(q, top_k=5, hybrid=True)
            wall.append((time.perf_counter() - t) * 1000.0)
            pr = engine.last_probe
            probe_ms.append(pr["total_ms"])
            embed_ms.append(pr["embed_ms"])
            fts_ms.append(pr["fts_ms"])
            vec_ms.append(pr["vec_ms"])
        p95_wall = _percentile(wall, 95)
        out3 = {
            "metric": ("latenza retrieve ibrido search(hybrid=True) su "
                       "corpus REALE (rag_stage2 .md chunked) con modello "
                       "E5 reale WARM; wall = perf_counter attorno alla "
                       "chiamata; n=%d query; "
                       "soft time-box dichiarato = %.0fms"
                       % (len(wall), RETRIEVE_SOFT_TIMEBOX_MS)),
            "corpus_chunks": len(corpus),
            "n_query": len(wall),
            "wall_ms": {
                "p50": round(_percentile(wall, 50), 2),
                "p95": round(p95_wall, 2),
                "max": round(max(wall), 2),
            },
            "stage_ms": {
                "embed_p95": round(_percentile(embed_ms, 95), 2),
                "fts_p95": round(_percentile(fts_ms, 95), 2),
                "vec_p95": round(_percentile(vec_ms, 95), 2),
                "total_probe_p95": round(_percentile(probe_ms, 95), 2),
            },
            "soft_timebox_ms": RETRIEVE_SOFT_TIMEBOX_MS,
            "gate_p95_le_timebox": p95_wall <= RETRIEVE_SOFT_TIMEBOX_MS,
            "timebox_policy": ("soft: se superato il router LOGGA "
                               "'retrieve time-box SOFT superato' e "
                               "CONTINUA (mai abort)"),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        (qa / "r15_pipe_p3_retrieve.json").write_text(
            json.dumps(out3, ensure_ascii=False, indent=1), encoding="utf-8")
        print("[P3] retrieve wall p50=%.1fms p95=%.1fms gate<=1s: %s"
              % (out3["wall_ms"]["p50"], p95_wall,
                 out3["gate_p95_le_timebox"]))
        # ------------- P3b: PRIMO FEEDBACK UI (start dei progress) -------
        # Protocollo: modello E5 WARM, indice gia' costruito, Router reale
        # con client contatore e answer cache su TEMP; si misura il tempo da
        # process_query_stream() al PRIMO evento (progress "gate" start),
        # che e' cio' che l'UI riceve subito (n=5 query, mediana).
        # NOTA: rag.progress_events deve essere True nella config reale
        # (default del contratto) perche' i progress esistano.
        from core.local_search import LocalSearchEngine
        loc = LocalSearchEngine(Database(db_path=tmp / "f.db"), store, emb)
        fb_client = CountingClient()
        fb_router = Router(lambda: fb_client, loc, loc)
        fb_router._answer_cache = AnswerCache(path=tmp / "fb_ac.jsonl")
        # Router.__init__ ha gia' avviato il warmup semantico (background):
        # si attende che sia pronto per misurare il percorso reale.
        t = time.perf_counter()
        while not fb_router.semantic_router.ready \
                and (time.perf_counter() - t) < 120.0:
            time.sleep(0.1)
        first_ms = []
        for i in range(5):
            q = corpus[i % len(corpus)].text[:70]
            t = time.perf_counter()
            gen = fb_router.process_query_stream(
                q, mode="automatica", web_override="mai")
            first_event = next(gen)
            first_ms.append((time.perf_counter() - t) * 1000.0)
            gen.close()
            assert first_event["type"] == "progress", first_event
        fb_p50 = _percentile(first_ms, 50)
        out4 = {
            "metric": ("tempo da process_query_stream() al PRIMO evento "
                       "(progress 'gate' start = primo feedback UI); "
                       "modello WARM, indice costruito, n=5, mediana; "
                       "clock time.perf_counter; web_override=mai"),
            "first_event_ms": {
                "p50": round(fb_p50, 2),
                "max": round(max(first_ms), 2),
                "samples": [round(s, 2) for s in first_ms],
            },
            "first_event_stage": "gate/start",
            "gate_p50_le_2000ms": fb_p50 <= 2000.0,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        (qa / "r15_pipe_p1_feedback.json").write_text(
            json.dumps(out4, ensure_ascii=False, indent=1), encoding="utf-8")
        print("[P3b] primo feedback p50=%.1fms gate<=2s: %s"
              % (fb_p50, out4["gate_p50_le_2000ms"]))
    finally:
        shutil.rmtree(tmp, True)


if __name__ == "__main__":
    if "--measures" in sys.argv:
        run_measures()
    else:
        unittest.main(verbosity=2)

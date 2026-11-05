"""Test H12 - Worker offline (sub-agenti a prio2, resumable, progress UI).

Esecuzione: python tests/testH12_workers.py  ->  0 fail.

Copre 17 test:
 (1) ordine priorita': worker pendente + interattivo -> interattivo PRIMA
 (2) W1 output <=300 chars per ogni chunk  [validazione lingua]
 (2b) W1 batch 16 per job + merge risultati
 (3) W2 prompt contiene il chunk e il modulo NON espone funzioni utente
 (3b) W2 soglia: doc senza troppe sezioni -> nessuna chiamata LLM
 (4) W3 5 card con approved=False, suggested=True
 (4b) W3 fallback F02 (registry assente) usa prompt n=5
 (5) W4 validazione embed: 0.9 accetta, 0.8 rifiuta
 (5b) W4 embed assente -> validation='skipped'
 (6) W5 soglie: >=0.92 candidate, <0.85 no, 0.88 -> chiama llm_fn
 (6b) W5 coppie con approved=False
 (7) W6 health deterministico (stessi input -> stesso punteggio, no LLM)
 (7b) W6 refresh/eviction (item e ctx)
 (8) resume: checkpoint riprende, nessun doppio lavoro
 (9) progress snapshot shape
 (9b) llm_fn che solleva -> job 'failed' con fallback, la coda non muore
 (10) stub LLM default deterministico
"""

import importlib.util
import json
import math
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# CodaPriorita REALE (core/sidecar in sola lettura/import)
try:
    from core.sidecar.queue import CodaPriorita
except Exception:  # fallback: import diretto del modulo (niente dipendenze)
    _qpath = os.path.join(ROOT, "core", "sidecar", "queue.py")
    _spec = importlib.util.spec_from_file_location("_h12_queue", _qpath)
    _mod = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    CodaPriorita = _mod.CodaPriorita

from core.workers import (  # noqa: E402
    BaseWorker,
    W1Contextualizer,
    W2SectionSummarizer,
    W3FlashcardPregenerator,
    W4Paraphraser,
    W5Dedup,
    W6Maintenance,
    WorkerRunner,
    default_llm_fn,
)
import core.workers.w2_summarizer as _w2_mod  # noqa: E402
import core.workers.w3_flashcards as _w3_mod  # noqa: E402


def _attende(cond, timeout=5.0):
    """Polling fino a cond() True o timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cond():
            return True
        time.sleep(0.01)
    return False


class _Blocker:
    """Callback che segnala l'avvio e resta in attesa del rilascio."""

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()

    def __call__(self, payload):
        self.started.set()
        self.release.wait(5.0)


def _vec(deg):
    r = math.radians(deg)
    return (math.cos(r), math.sin(r))


class H12WorkersBase(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="h12_state_")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _coda(self):
        coda = CodaPriorita()
        self.addCleanup(coda.stop)
        return coda


# ======================================================================
# (1) PRIORITA': i worker NON degradano la latenza interattiva
# ======================================================================
class TestPrioritaWorker(H12WorkersBase):

    def test_01_priorita_worker_non_degrada_interattivo(self):
        """Worker pendente (prio2) + arrivo prio0 -> il prio0 e' servito PRIMA."""
        coda = self._coda()
        order = []
        runner = WorkerRunner(state_dir=self.tmp)

        blocker = _Blocker()
        coda.submit("block", prio=0, callback=blocker)
        self.assertTrue(_attende(lambda: coda.stato()["running"]))

        def llm(prompt, profile="fast", classe="micro"):
            order.append("worker_w1")
            return "Prefisso contestuale del worker."

        items = [{"id": "c1", "text": "Testo del chunk uno. Altra frase."}]
        records = runner.submit_all(coda, llm, None, {"w1": items})
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["prio"], 2)
        # job del worker accodato e in attesa (il thread e' occupato dal prio0)
        self.assertTrue(_attende(
            lambda: coda.stato()["by_priority"][2] == 1))

        # arrivo di un job interattivo: deve passare DAVANTI al worker
        coda.submit("interactive", prio=0,
                    callback=lambda p: order.append("interactive"))
        blocker.release.set()

        self.assertTrue(_attende(
            lambda: len(order) == 2 and records[0]["status"] != "pending"))
        self.assertEqual(order, ["interactive", "worker_w1"],
                         "il job interattivo deve essere servito PRIMA "
                         "del worker a prio 2")
        self.assertEqual(records[0]["status"], "done")


# ======================================================================
# (2) W1 contextualizer
# ======================================================================
class TestW1Contextualizer(H12WorkersBase):

    def test_02_w1_output_prefissi_validi(self):
        """Output: dict {chunk_id: prefix}, ogni prefix <=300 chars, per ogni chunk."""
        def llm(prompt, profile="fast", classe="micro"):
            return "PREFISSO_" * 100  # 900 chars -> deve essere troncato a 300

        w1 = W1Contextualizer(llm_fn=llm, state_dir=self.tmp)
        items = [
            {"id": "k1", "text": "Primo chunk di test."},
            {"id": "k2", "text": "Secondo chunk di test."},
            {"id": "k3", "text": "Terzo chunk di test."},
        ]
        out = w1.run(items, {})
        self.assertEqual(set(out.keys()), {"k1", "k2", "k3"})
        for cid, prefix in out.items():
            self.assertIsInstance(prefix, str, cid)
            self.assertLessEqual(len(prefix), 300,
                                 "prefix >300 chars per %s" % cid)
        # validazione registrata: len_ok per ogni chunk
        for cid in ("k1", "k2", "k3"):
            rep = w1.validation_report[cid]
            self.assertTrue(rep["len_ok"])
            self.assertTrue(rep["truncated"])
            self.assertTrue(rep["lang_ok"])

    def test_02b_w1_batch16_e_lingua(self):
        """Batch = 16 chunk per job; prefisso corto validato anche sulla lingua."""
        coda = self._coda()
        runner = WorkerRunner(state_dir=self.tmp)

        def llm(prompt, profile="fast", classe="micro"):
            return ("Questo documento tratta di analisi del segnale nella "
                    "sezione introduttiva del corso.")

        items = [{"id": "b%d" % i,
                  "text": "Il documento introduce l'argomento delle derivate "
                          "parziali nella sezione iniziale del corso numero %d."
                          % i}
                 for i in range(32)]
        result = runner.run_sync(coda, llm, None, {"w1": items})
        self.assertTrue(result["ok"])
        # 32 chunk -> 2 job da 16 (batch_size di W1)
        self.assertEqual(len(result["jobs"]), 2)
        self.assertTrue(all(r["prio"] == 2 for r in result["jobs"]))
        self.assertEqual(len(result["results"]["w1"]), 32)
        w1 = runner.get_worker("w1")
        rep = w1.validation_report["b0"]
        self.assertEqual(rep["lang_text"], "it")
        self.assertEqual(rep["lang_prefix"], "it")
        self.assertTrue(rep["lang_ok"])
        self.assertTrue(rep["len_ok"])


# ======================================================================
# (2b) ordine prior gia' coperto sopra; qui W2
# ======================================================================
class TestW2SectionSummarizer(H12WorkersBase):

    def test_03_w2_prompt_contiene_chunk_e_niente_funzioni_utente(self):
        """W2 usa llm_fn con prompt che contiene il chunk; il modulo non
        espone funzioni utente (nessuna registrazione feature)."""
        src_path = _w2_mod.__file__
        with open(src_path, "r", encoding="utf-8") as fh:
            source = fh.read()
        # il modulo non importa/parla di sistemi di registrazione funzioni
        self.assertNotIn("registry", source.lower())
        self.assertFalse(hasattr(_w2_mod, "register_function"))
        self.assertFalse(hasattr(_w2_mod, "FEATURE"))

        prompts = []

        def llm(prompt, profile="fast", classe="micro"):
            prompts.append(prompt)
            return "Riassunto sintetico della sezione."

        w2 = W2SectionSummarizer(llm_fn=llm, state_dir=self.tmp)
        doc = {
            "doc_id": "d1",
            "sections": [
                {"id": "s%d" % i,
                 "text": "contenuto chunk numero %d unico" % i}
                for i in range(5)
            ],
        }
        out = w2.run([doc], {})
        self.assertEqual(len(prompts), 5)
        self.assertTrue(any("contenuto chunk numero 3 unico" in p
                            for p in prompts),
                        "il prompt deve contenere il testo del chunk")
        self.assertEqual(len(out), 5)
        for summary in out.values():
            self.assertIsInstance(summary, str)
            self.assertLessEqual(len(summary), 800)

    def test_03b_w2_soglia_sezioni(self):
        """Doc con <=4 sezioni: nessuna chiamata LLM (uso interno RAG)."""
        prompts = []

        def llm(prompt, profile="fast", classe="micro"):
            prompts.append(prompt)
            return "Riassunto."

        w2 = W2SectionSummarizer(llm_fn=llm, state_dir=self.tmp)
        doc4 = {"doc_id": "d4",
                "sections": [{"id": "s%d" % i, "text": "testo %d" % i}
                             for i in range(4)]}
        out = w2.run([doc4], {})
        self.assertEqual(prompts, [])
        self.assertEqual(out, {})


# ======================================================================
# (4) W3 flashcard
# ======================================================================
class TestW3Flashcards(H12WorkersBase):

    def test_04_w3_cinque_card_suggerite(self):
        """5 card per sezione, tutte suggested=True e approved=False."""
        def llm(prompt, profile="fast", classe="micro"):
            # solo 3 parseabili -> il worker deve arrivare a 5 con pad
            return json.dumps([
                {"front": "Domanda 1", "back": "Risposta 1"},
                {"front": "Domanda 2", "back": "Risposta 2"},
                {"front": "Domanda 3", "back": "Risposta 3"},
            ])

        w3 = W3FlashcardPregenerator(llm_fn=llm, state_dir=self.tmp)
        out = w3.run([{"id": "sec1",
                       "text": "Materiale di studio sulle derivate. "
                               "Esempio pratico."}], {})
        cards = out["sec1"]
        self.assertEqual(len(cards), 5)
        for card in cards:
            self.assertTrue(card["suggested"])
            self.assertFalse(card["approved"],
                             "le card sono solo suggerimenti: "
                             "MAI salvate direttamente")
            self.assertIn("front", card)
            self.assertIn("back", card)

    def test_04b_w3_fallback_f02_n5(self):
        """Se il registry F02 non e' importabile si usa il prompt proprio n=5."""
        prompts = []

        def llm(prompt, profile="fast", classe="micro"):
            prompts.append(prompt)
            return "[]"

        w3 = W3FlashcardPregenerator(llm_fn=llm, state_dir=self.tmp)
        out = w3.run([{"id": "sec2", "text": "Testo del materiale."}], {})
        self.assertEqual(len(out["sec2"]), 5)
        if _w3_mod._F02 is None:
            self.assertTrue(
                any("esattamente 5 flashcard" in p for p in prompts),
                "fallback F02 n=5 atteso quando il registry non esiste")


# ======================================================================
# (5) W4 paraphraser
# ======================================================================
class TestW4Paraphraser(H12WorkersBase):

    def test_05_w4_validazione_embed(self):
        """embed finto: cos=0.9 accetta, cos=0.8 rifiuta."""
        def llm(prompt, profile="fast", classe="micro"):
            if "ORIG_A" in prompt:
                return "PARA_A"
            return "PARA_B"

        def embed(text):
            if text.startswith("ORIG_A") or text.startswith("ORIG_B"):
                return (1.0, 0.0)
            if text == "PARA_A":
                return (0.9, math.sqrt(1.0 - 0.81))  # cos = 0.90
            if text == "PARA_B":
                return (0.8, 0.6)                    # cos = 0.80
            return (0.0, 1.0)

        w4 = W4Paraphraser(llm_fn=llm, embed_fn=embed, state_dir=self.tmp)
        out = w4.run([{"id": "f1", "front": "ORIG_A testo front uno"},
                      {"id": "f2", "front": "ORIG_B testo front due"}], {})
        a = out["f1"]
        self.assertEqual(a["validation"], "accepted")
        self.assertTrue(a["accepted"])
        self.assertGreaterEqual(a["cosine"], 0.85)

        b = out["f2"]
        self.assertEqual(b["validation"], "rejected")
        self.assertFalse(b["accepted"])
        self.assertLess(b["cosine"], 0.85)

    def test_05b_w4_embed_assente_skipped(self):
        def llm(prompt, profile="fast", classe="micro"):
            return "Riformulazione senza validazione."

        w4 = W4Paraphraser(llm_fn=llm, embed_fn=None, state_dir=self.tmp)
        out = w4.run([{"id": "f3", "text": "Testo originale da riformulare."}],
                     {})
        entry = out["f3"]
        self.assertEqual(entry["validation"], "skipped")
        self.assertTrue(entry["accepted"])
        self.assertIsNone(entry["cosine"])


# ======================================================================
# (6) W5 dedup
# ======================================================================
class TestW5Dedup(H12WorkersBase):

    def _items(self):
        return [
            {"id": "a", "material_id": "m1", "text": "testo A"},
            {"id": "b", "material_id": "m2", "text": "testo B"},
            {"id": "c", "material_id": "m3", "text": "testo C"},
            {"id": "d", "material_id": "m4", "text": "testo D"},
        ]

    @staticmethod
    def _embed(text):
        # angoli scelti: a-b=0.95 (>=0.92), a-d=0.88 (borderline),
        # a-c=0.26 (<0.85), b-d=0.98 (>=0.92), b-c e c-d <0.85
        table = {
            "testo A": _vec(0),
            "testo B": _vec(18),
            "testo C": _vec(75),
            "testo D": _vec(28.4),
        }
        return table[text]

    def test_06_w5_soglie_e_llm_borderline(self):
        """0.92+ candidate; <0.85 non-dup; 0.88 -> chiama llm_fn (1 volta)."""
        calls = []

        def llm(prompt, profile="fast", classe="micro"):
            calls.append(prompt)
            return "SI"

        w5 = W5Dedup(llm_fn=llm, embed_fn=self._embed, state_dir=self.tmp)
        pairs = w5.run(self._items(), {})
        by_key = {(p["a"], p["b"]): p for p in pairs}
        self.assertEqual(len(pairs), 6)  # 4 item -> 6 coppie

        # a-b: cosine ~0.95 >= 0.92 -> candidate, SENZA llm
        self.assertEqual(by_key[("a", "b")]["action"], "candidate_duplicate")
        self.assertGreaterEqual(by_key[("a", "b")]["cosine"], 0.92)
        # a-c: cosine ~0.26 < 0.85 -> non duplicato
        self.assertEqual(by_key[("a", "c")]["action"], "distinct")
        self.assertLess(by_key[("a", "c")]["cosine"], 0.85)
        # a-d: cosine ~0.88 borderline -> chiama llm_fn (SI -> candidate)
        self.assertEqual(by_key[("a", "d")]["action"], "candidate_duplicate")
        self.assertGreaterEqual(by_key[("a", "d")]["cosine"], 0.85)
        self.assertLess(by_key[("a", "d")]["cosine"], 0.92)
        # b-c e c-d: < 0.85 -> nessuna chiamata
        self.assertEqual(by_key[("b", "c")]["action"], "distinct")
        self.assertEqual(by_key[("c", "d")]["action"], "distinct")
        # CONTEGGIO CHIAMATE LLM: solo la coppia borderline (a,d)
        self.assertEqual(len(calls), 1)

    def test_06b_w5_coppie_approved_false(self):
        w5 = W5Dedup(llm_fn=lambda p, profile="fast", classe="micro": "NO",
                     embed_fn=self._embed, state_dir=self.tmp)
        pairs = w5.run(self._items(), {})
        self.assertTrue(pairs)
        for pair in pairs:
            self.assertFalse(pair["approved"],
                             "le coppie sono solo proposte")
            self.assertIn(pair["action"],
                          ("candidate_duplicate", "distinct", "needs_review"))
            self.assertIn("cosine", pair)


# ======================================================================
# (7) W6 maintenance
# ======================================================================
class TestW6Maintenance(H12WorkersBase):

    def test_07_w6_health_deterministico_nessun_llm(self):
        """Stessi input -> stesso punteggio 0-100; zero chiamate LLM."""
        calls = []

        def llm(prompt, profile="fast", classe="micro"):
            calls.append(prompt)
            return "non dovrebbe essere chiamato"

        item = {
            "id": "m1",
            "counts": {"docs": 3, "chunks": 42},
            "mtimes": {"a.py": 1700000000.5, "b.py": 1700000123.0},
            "doc_ids_versionati": [],
            "cache_usage": [],
            "evict_count": 0,
        }
        w6a = W6Maintenance(llm_fn=llm, state_dir=self.tmp,
                            auto_load_state=False)
        w6b = W6Maintenance(llm_fn=llm, state_dir=self.tmp,
                            auto_load_state=False)
        h1 = w6a.health_index(item)
        h2 = w6b.health_index(item)
        self.assertEqual(h1, h2, "stessi input -> stesso punteggio")
        self.assertIsInstance(h1, int)
        self.assertGreaterEqual(h1, 0)
        self.assertLessEqual(h1, 100)

        # input diverso -> punteggio diverso (sha256 dei conteggi/mtimes)
        other = dict(item)
        other["counts"] = {"docs": 4, "chunks": 43}
        self.assertNotEqual(w6a.health_index(other), h1)

        # run() espone lo stesso health e NON usa llm
        out = w6a.run([item], {})
        self.assertEqual(out["m1"]["health"], h1)
        self.assertEqual(calls, [], "W6 non deve mai chiamare llm_fn")

    def test_07b_w6_refresh_eviction(self):
        """Refresh dei doc versionati + eviction LRU: item o ctx dal runner."""
        w6 = W6Maintenance(state_dir=self.tmp, auto_load_state=False)
        item = {
            "id": "m2",
            "doc_ids_versionati": [
                {"doc_id": "d1", "changed": True},
                {"doc_id": "d2", "changed": False},
                "d3",  # stringa = gia' filtrata dal runner -> cambiata
            ],
            "cache_usage": ["k_old1", "k_old2", "k_mid"],
            "evict_count": 2,
        }
        out = w6.run([item], {})["m2"]
        self.assertEqual(out["refresh_doc_ids"], ["d1", "d3"])
        self.assertNotIn("d2", out["refresh_doc_ids"])
        # lista ordinata per ultimo uso: i primi k sono i meno usati
        self.assertEqual(out["evicted"], ["k_old1", "k_old2"])

        # stesso flusso ma con i campi passati dal runner via ctx
        out2 = w6.run([{"id": "m3"}], {
            "doc_ids_versionati": ["d9"],
            "cache_usage": ["x", "y"],
            "evict_count": 1,
        })["m3"]
        self.assertEqual(out2["refresh_doc_ids"], ["d9"])
        self.assertEqual(out2["evicted"], ["x"])


# ======================================================================
# (8) RESUME + (9) snapshot + (9b) llm che solleva
# ======================================================================
class TestResumeEProgress(H12WorkersBase):

    def test_08_resume_checkpoint_nessun_doppio_lavoro(self):
        """Run interrotto a meta -> snapshot.done>0 -> ripresa -> nessun
        doppio lavoro su item gia' fatti."""
        coda = self._coda()
        runner = WorkerRunner(state_dir=self.tmp)
        calls = []

        def llm(prompt, profile="fast", classe="micro"):
            m = re.search(r"CHUNK_(\d+)", prompt)
            if m:
                calls.append(int(m.group(1)))
            return "Prefisso breve."

        items = [{"id": "c%d" % i, "text": "CHUNK_%d contenuto." % i}
                 for i in range(32)]

        # FASE 1: solo i primi 20 -> simula un'interruzione a meta
        r1 = runner.run_sync(coda, llm, None, {"w1": items[:20]})
        self.assertTrue(r1["ok"])
        snap1 = runner.snapshot("w1")
        self.assertGreater(snap1["done"], 0, "progresso visibile a meta")
        self.assertEqual(snap1["done"], 20)
        # checkpoint persistito su file
        self.assertTrue(os.path.exists(
            os.path.join(self.tmp, "w1.json")))

        # FASE 2: ripresa con TUTTI i 32 item
        r2 = runner.run_sync(coda, llm, None, {"w1": items})
        self.assertTrue(r2["ok"])
        snap2 = runner.snapshot("w1")
        self.assertGreater(snap2["done"], 0)

        # NESSUN DOPPIO LAVORO:ogni chunk processato esattamente una volta
        self.assertEqual(len(calls), 32, "doppio lavoro rilevato: %r" % calls)
        self.assertEqual(sorted(calls), list(range(32)))
        # risultati completi (20 della fase 1 + 12 della fase 2)
        self.assertEqual(len(runner.results["w1"]), 32)
        w1 = runner.get_worker("w1")
        self.assertEqual(len(w1.state), 32)

    def test_09_progress_snapshot_shape(self):
        runner = WorkerRunner(state_dir=self.tmp)
        snap = runner.snapshot()
        self.assertEqual(set(snap.keys()),
                         {"worker", "done", "total", "running", "paused"})
        self.assertIsInstance(snap["worker"], str)
        self.assertIsInstance(snap["done"], int)
        self.assertIsInstance(snap["total"], int)
        self.assertIsInstance(snap["running"], bool)
        self.assertIsInstance(snap["paused"], bool)

        coda = self._coda()
        runner.run_sync(
            coda,
            lambda p, profile="fast", classe="micro": "Prefisso.",
            None,
            {"w1": [{"id": "z1", "text": "testo del chunk."}]},
        )
        snap1 = runner.snapshot("w1")
        self.assertEqual(set(snap1.keys()),
                         {"worker", "done", "total", "running", "paused"})
        self.assertEqual(snap1["worker"], "w1")
        self.assertEqual(snap1["done"], 1)
        self.assertEqual(snap1["total"], 1)
        self.assertFalse(snap1["running"])

    def test_09b_llm_che_solleva_job_failed_coda_viva(self):
        """llm_fn che solleva -> status 'failed' con fallback; la coda non muore."""
        coda = self._coda()
        runner = WorkerRunner(state_dir=self.tmp)

        def boom(prompt, profile="fast", classe="micro"):
            raise RuntimeError("LLM esplode")

        items = [{"id": "e1", "text": "chunk uno"},
                 {"id": "e2", "text": "chunk due"}]
        result = runner.run_sync(coda, boom, None, {"w1": items})
        rec = result["jobs"][0]
        self.assertEqual(rec["status"], "failed",
                         "job con llm che solleva -> status 'failed'")
        # fallback: risultati degradati comunque presenti (prefissi vuoti)
        self.assertIsInstance(rec["results"], dict)
        self.assertEqual(set(rec["results"].keys()), {"e1", "e2"})
        for prefix in rec["results"].values():
            self.assertEqual(prefix, "")
        self.assertFalse(result["ok"])

        # LA CODA NON MUORE: un job interattivo successivo viene servito
        got = []
        coda.submit("dopo_il_fallimento", prio=0,
                    callback=lambda p: got.append(p))
        self.assertTrue(_attende(lambda: len(got) == 1))
        self.assertEqual(got, ["dopo_il_fallimento"])
        self.assertFalse(coda.closed)


# ======================================================================
# (10) stub LLM deterministico
# ======================================================================
class TestStubLLM(unittest.TestCase):

    def test_10_stub_deterministico(self):
        a = default_llm_fn("prompt uno")
        b = default_llm_fn("prompt uno")
        c = default_llm_fn("prompt due")
        self.assertEqual(a, b, "stesso prompt -> stessa risposta")
        self.assertNotEqual(a, c)
        self.assertIsInstance(a, str)
        # il profilo/budget entra nell'hash: 'fast'/'micro' di default
        self.assertNotEqual(default_llm_fn("p", profile="altro"),
                            default_llm_fn("p"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

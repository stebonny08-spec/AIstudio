# -*- coding: utf-8 -*-
"""
tests/testR15_index.py — R15b-I (blocco I): test IMPLEMENTER-INDEX.

Copertura (temp dirs + temp DB: mai %APPDATA%, mai file_AIstudio/):
  1. index_meta: persistenza per store_key (set/get, reopen, isolamento).
  2. ensure_embedder_consistent: bootstrap su indice vuoto → "ok";
     legacy file (embedding_model.txt) su indice preesistente → "ok";
     mismatch → lancia reindex "r15-reindex" controllato (fake embedder):
     1 solo thread, idempotente, meta allineata, vettori ricostruiti
     (anche cambio dim), 3a chiamata → "ok".
  3. add_chunks → chunks_fts: INSERT → MATCH ritorna il chunk (FTS5/BM25)
     + scope per store_key.
  4. add_chunks(embedder_id): meta["emb_id"] scritto, meta esistente del
     chunk (W: stage/url/...) conservato (fusione chiavi).
  5. Indexer scan idempotente: 1° scan scrive indexed_files; 2° scan =
     0 re-embed (contatore) + riga presente; riga persa → reconcile
     (0 re-embed) riscrive la riga.
  6. coverage_audit: orfano rilevato → --repair copia+indicizza →
     2° repair = 0 azioni (idempotente).
  7. books store: get/set_index_meta + query vuota senza errori
     (wiring runtime 0 risultati).

Esecuzione:  python tests/testR15_index.py
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from core.rag.chunker import Chunk
from core.rag.contract import EMBEDDER_ID
from core.rag.indexer import (
    ORIGINALS_DIR_NAME,
    STAGE2_DIR_NAME,
    Indexer,
    ensure_rag_layout,
)
from core.rag.vector_store_sqlite import SQLiteVectorStore
from data.coverage_audit import run_audit, run_repair
from data.db import Database


# ======================================================================
# HELPER
# ======================================================================
class CountingEmbedder:
    """Embedder finto: conta le chiamate (contatore di re-embed)."""

    def __init__(self):
        self.calls = 0
        self.texts = 0

    def embed(self, texts, kind="passage"):
        self.calls += 1
        self.texts += len(texts)
        return [[0.1] * 8 for _ in texts]

    def embed_one(self, text, kind="query"):
        return [0.1] * 8


class _TmpBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="qaR15idx_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def _store(self, name="vector_index", store_key="vector_index"):
        return SQLiteVectorStore(
            str(self.tmp / name),
            EMBEDDER_ID,
            db_path=str(self.tmp / "studioia.db"),
            store_key=store_key,
        )


# ======================================================================
# 1. index_meta — persistenza per store_key
# ======================================================================
class TestIndexMeta(_TmpBase):
    def test_persist_across_reopen(self):
        s = self._store()
        self.assertIsNone(s.get_index_meta("embedding_model_id"))
        s.set_index_meta("embedding_model_id", "model-A")
        s.set_index_meta("updated", "2026-10-24T00:00:00")
        s.close()

        s2 = self._store()  # nuova istanza, stesso db + dir
        self.assertEqual(s2.get_index_meta("embedding_model_id"), "model-A")
        self.assertEqual(s2.get_index_meta("updated"), "2026-10-24T00:00:00")
        self.assertIsNone(s2.get_index_meta("chiave_inesistente"))
        s2.close()

    def test_isolated_per_store_key(self):
        a = self._store("vi_notes", "vector_index")
        b = self._store("vi_books", "vector_index_books")
        a.set_index_meta("embedding_model_id", "model-Notes")
        self.assertEqual(a.get_index_meta("embedding_model_id"), "model-Notes")
        # stesso file DB, store_key diverso → kv separata
        self.assertIsNone(b.get_index_meta("embedding_model_id"))
        b.set_index_meta("embedding_model_id", "model-Books")
        self.assertEqual(a.get_index_meta("embedding_model_id"), "model-Notes")
        self.assertEqual(b.get_index_meta("embedding_model_id"), "model-Books")
        a.close()
        b.close()


# ======================================================================
# 2. ensure_embedder_consistent
# ======================================================================
class TestEnsureEmbedderConsistent(_TmpBase):
    def test_empty_index_bootstraps_runtime_id(self):
        s = self._store()
        self.assertEqual(s.count(), 0)
        self.assertEqual(s.ensure_embedder_consistent(EMBEDDER_ID), "ok")
        self.assertEqual(s.get_index_meta("embedding_model_id"), EMBEDDER_ID)
        # seconda chiamata: idempotente, sempre "ok"
        self.assertEqual(s.ensure_embedder_consistent(EMBEDDER_ID), "ok")
        s.close()

    def test_preexisting_index_legacy_file_declared_ok(self):
        s = self._store()
        s.add_chunks(
            [Chunk(id="p1", source_file="f.md", text="contenuto preesistente")],
            [[0.2] * 4],
        )
        # nessuna meta (indice preesistente); il file legacy dichiara il
        # modello con cui e' stato costruito → confronto con runtime
        legacy = self.tmp / "vector_index" / "embedding_model.txt"
        legacy.write_text(EMBEDDER_ID, encoding="utf-8")
        self.assertEqual(s.ensure_embedder_consistent(EMBEDDER_ID), "ok")
        self.assertEqual(s.get_index_meta("embedding_model_id"), EMBEDDER_ID)
        s.close()

    def test_mismatch_launches_single_lowprio_reindex(self):
        s = self._store()
        s.add_chunks(
            [Chunk(id="m1", source_file="f.md", text="fotosintesi clorofilliana zuccheri")],
            [[0.2] * 4],
            embedder_id="model-old",
        )
        self.assertEqual(s.get_index_meta("embedding_model_id"), "model-old")

        gate = threading.Event()
        calls = []

        def factory():
            calls.append(1)

            class _F:
                model_id = "model-new"

                def embed(self, texts, kind="passage"):
                    gate.wait(10)  # tiene il reindex "in corso" finche' il test non apre
                    return [[0.9] * 8 for _ in texts]

            return _F()

        s._reindex_embedder_factory = factory

        r1 = s.ensure_embedder_consistent("model-new")
        self.assertEqual(r1, "reindexing")
        # attende che il worker sia partito davvero
        for _ in range(100):
            if calls:
                break
            time.sleep(0.05)
        self.assertTrue(calls, "il reindex non e' partito")

        # seconda chiamata DURANTE il reindex → "reindexing", nessun dup
        r2 = s.ensure_embedder_consistent("model-new")
        self.assertEqual(r2, "reindexing")
        self.assertEqual(len(calls), 1, "reindex duplicato!")
        self.assertTrue(s._reindex_thread.is_alive())
        self.assertEqual(s._reindex_thread.name, "r15-reindex")
        self.assertTrue(s._reindex_thread.daemon)

        gate.set()
        s._reindex_thread.join(15)
        self.assertFalse(s._reindex_thread.is_alive())

        # meta allineata, vettori ricostruiti (dim 4 → 8), FTS intatto
        self.assertEqual(s.get_index_meta("embedding_model_id"), "model-new")
        self.assertEqual(s.count(), 1)
        res = s.query([0.9] * 8, top_k=3)
        self.assertTrue(res)
        self.assertGreaterEqual(res[0]["similarity"], 0.99)
        self.assertEqual(s.fts_query("fotosintesi")[0]["text"],
                         "fotosintesi clorofilliana zuccheri")
        # terza chiamata: tutto coerente → "ok" (nessun nuovo thread)
        prev_thread = s._reindex_thread
        self.assertEqual(s.ensure_embedder_consistent("model-new"), "ok")
        self.assertIs(s._reindex_thread, prev_thread)
        self.assertEqual(len(calls), 1)
        s.close()


# ======================================================================
# 3. FTS5 — add_chunks popola chunks_fts (BM25) per P (ibrido) e W
# ======================================================================
class TestFtsPopulated(_TmpBase):
    def test_add_chunks_match_returns_chunk(self):
        s = self._store()
        s.add_chunks(
            [Chunk(id="t1", source_file="fotosintesi.md",
                   text="Le clorofille assorbono la luce rossa e blu")],
            [[0.3] * 4],
        )
        # a) API FTS5 dello store (MATCH → chunk)
        rows = s.fts_query("clorofille", top_k=5)
        self.assertTrue(rows, "fts_query non ha restituito il chunk")
        self.assertIn("clorofille", rows[0]["text"])
        self.assertIn("bm25", rows[0])
        # b) MATCH diretto sulla tabella virtuale (BM25)
        n = s._conn.execute(
            "SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH ?",
            ('"clorofille"',),
        ).fetchone()[0]
        self.assertEqual(int(n), 1)
        s.close()

    def test_fts_scoped_per_store(self):
        a = self._store("vi_a", "vector_index")
        b = self._store("vi_b", "vector_index_books")
        a.add_chunks(
            [Chunk(id="s1", source_file="f.md", text="token_unico_zeta indici")],
            [[0.3] * 4],
        )
        self.assertTrue(a.fts_query("token_unico_zeta"))
        # l'altro store (stesso DB) non vede i chunk altrui
        self.assertEqual(b.fts_query("token_unico_zeta"), [])
        self.assertEqual(b.count(), 0)
        a.close()
        b.close()


# ======================================================================
# 4. add_chunks(embedder_id) — meta emb_id + fusione meta chunk (W)
# ======================================================================
class TestAddChunksEmbedderId(_TmpBase):
    def test_emb_id_written_and_chunk_meta_merged(self):
        s = self._store()
        c = Chunk(id="w1", source_file="pagina.md", text="testo web")
        # W puo' non aver ancora atterrato: meta assegnato esplicitamente
        c.meta = {"stage": "web", "url": "https://esempio.it/p", "date": "2026-10-01"}
        s.add_chunks([c], [[0.4] * 4], embedder_id="model-web")
        row = json.loads(
            s._conn.execute("SELECT meta FROM chunks WHERE id = 'w1'").fetchone()[0]
        )
        # meta esistente conservata (fusione chiavi)
        self.assertEqual(row["stage"], "web")
        self.assertEqual(row["url"], "https://esempio.it/p")
        self.assertEqual(row["date"], "2026-10-01")
        # chiavi standard dello store + emb_id del batch
        self.assertEqual(row["source_file"], "pagina.md")
        self.assertEqual(row["location_hint"], "")
        self.assertEqual(row["emb_id"], "model-web")
        # sync index_meta: bootstrap id + bump updated
        self.assertEqual(s.get_index_meta("embedding_model_id"), "model-web")
        self.assertTrue(s.get_index_meta("updated"))
        s.close()

    def test_backward_compat_two_args(self):
        # firma storica invariata in coda: add_chunks(chunks, embeddings)
        s = self._store()
        s.add_chunks(
            [Chunk(id="b1", source_file="f.md", text="backward compat")],
            [[0.4] * 4],
        )
        self.assertEqual(s.count(), 1)
        row = json.loads(
            s._conn.execute("SELECT meta FROM chunks WHERE id = 'b1'").fetchone()[0]
        )
        self.assertNotIn("emb_id", row)  # nessun embedder dichiarato → nessun claim
        s.close()


# ======================================================================
# 5. Indexer scan — indexed_files + idempotenza + reconcile
# ======================================================================
class TestIndexerScanBookkeeping(_TmpBase):
    def setUp(self):
        super().setUp()
        self.base = self.tmp / "base"
        ensure_rag_layout(self.base)
        self.note = self.base / STAGE2_DIR_NAME / "appunti_fotosintesi.md"
        self.note.write_text(
            "# Fotosintesi\nLa clorofilliana converte la luce in energia chimica. "
            "Il gluchosio prodotto viene usato dalla pianta per crescere. " * 5,
            encoding="utf-8",
        )
        self.db = Database(db_path=self.tmp / "studioia.db")
        self.store = self._store()
        self.addCleanup(self.store.close)
        self.embedder = CountingEmbedder()
        self.indexer = Indexer(self.db, self.store, self.embedder)

    def _scan(self):
        return self.indexer.index_folder(str(self.base), ocr_enabled=False)

    def test_first_scan_writes_row_second_scan_zero_reembed(self):
        st1 = self._scan()
        self.assertEqual(st1["found"], 1)
        self.assertEqual(st1["changed"], 1)
        self.assertEqual(st1["errors"], 0)
        calls_after_first = self.embedder.calls
        self.assertGreater(calls_after_first, 0)

        # (a) il file indicizzato E' finito in indexed_files
        row = self.db.get_indexed_file(str(self.note))
        self.assertIsNotNone(row, "indexed_files vuoto dopo il 1° scan (f0)")
        self.assertEqual(int(row["dimensione"]), os.stat(self.note).st_size)
        self.assertEqual(int(row["num_chunk"]), self.store.count())
        self.assertTrue(row["data_ultima_indicizzazione"])

        # (b) 2° scan = 0 file re-processati → 0 re-embed
        st2 = self._scan()
        self.assertEqual(st2["changed"], 0)
        self.assertEqual(st2["reconciled"], 0)
        self.assertEqual(st2["removed"], 0)
        self.assertEqual(self.embedder.calls, calls_after_first,
                         "2° scan ha re-embedded!")
        self.assertLess(st2["ms"], st1["ms"] + 1)

    def test_lost_row_reconciled_without_reembed(self):
        self._scan()
        calls = self.embedder.calls
        # simula il forensics f0: riga persa, chunk presenti (firma nei meta)
        self.db.remove_indexed_file(str(self.note))
        self.assertIsNone(self.db.get_indexed_file(str(self.note)))

        st = self._scan()
        self.assertEqual(st["reconciled"], 1, "reconcile non rilevato")
        self.assertEqual(st["changed"], 0)
        self.assertEqual(self.embedder.calls, calls, "reconcile ha re-embedded!")
        row = self.db.get_indexed_file(str(self.note))
        self.assertIsNotNone(row, "riga indexed_files non ristabilita")
        self.assertEqual(int(row["num_chunk"]), self.store.count())

    def test_chunk_meta_carries_file_signature(self):
        self._scan()
        sig = self.store.get_source_file_signature(str(self.note))
        self.assertIsNotNone(sig)
        st = os.stat(self.note)
        self.assertEqual(int(sig["file_size"]), st.st_size)
        self.assertAlmostEqual(float(sig["file_mtime"]), st.st_mtime, places=3)
        fh = str(sig.get("file_hash", ""))
        self.assertTrue(fh, "file_hash assente dalla firma")
        self.assertEqual(len(fh), 64, "sha256 non valido")


# ======================================================================
# 5b. Isolamento tra scan (fix f0 — root cause reale)
# ======================================================================
class TestCrossStoreScanIsolation(_TmpBase):
    """La root cause reale di "indexed_files=0 con 17 chunk": lo scan dei
    libri (found={} su cartella vuota) cancellava LE RIGHE DELLE NOTE,
    perche' get_all_indexed_paths() e' globale → ogni ciclo 300s rifaceva
    full re-parse+re-embed. Ora la rimozione e' scoped alla base scansionata."""

    def setUp(self):
        super().setUp()
        # base note (con un file) + base libri (vuoto) — stesso DB,
        # esattamente come backend/api.py (local_search + books_search
        # condividono self.db)
        self.notes_base = self.tmp / "file_AIstudio"
        ensure_rag_layout(self.notes_base)
        self.note = self.notes_base / STAGE2_DIR_NAME / "nota.md"
        self.note.write_text(
            "Fotosintesi clorofilliana e clorofille. " * 20, encoding="utf-8"
        )
        self.books_base = self.tmp / "preselected_books"
        _, self.books_stage2 = ensure_rag_layout(self.books_base)

        self.db = Database(db_path=self.tmp / "studioia.db")
        self.store = self._store()
        self.embedder = CountingEmbedder()
        self.indexer = Indexer(self.db, self.store, self.embedder)

    def test_empty_books_scan_does_not_wipe_notes_rows(self):
        st_notes = self.indexer.index_folder(str(self.notes_base), ocr_enabled=False)
        self.assertEqual(st_notes["changed"], 1)
        self.assertIsNotNone(self.db.get_indexed_file(str(self.note)))
        calls = self.embedder.calls

        # scan dei libri sullo STESSO db (cartella vuota → found=0)
        st_books = self.indexer.index_folder(str(self.books_stage2), ocr_enabled=False)
        self.assertEqual(st_books["found"], 0)
        self.assertEqual(st_books["removed"], 0,
                         "lo scan libri ha rimosso righe delle note!")

        # le righe delle note sono sopravvissute → 2° scan note = no-op
        self.assertIsNotNone(
            self.db.get_indexed_file(str(self.note)),
            "riga delle note cancellata dallo scan libri (bug f0)",
        )
        st2 = self.indexer.index_folder(str(self.notes_base), ocr_enabled=False)
        self.assertEqual(st2["changed"], 0)
        self.assertEqual(st2["removed"], 0)
        self.assertEqual(self.embedder.calls, calls, "2° scan note ha re-embedded!")

    def test_deleted_file_in_same_base_still_cleaned(self):
        self.indexer.index_folder(str(self.notes_base), ocr_enabled=False)
        self.assertGreater(self.store.count(), 0)
        # il file sparisce dalla stessa base → riga + chunk rimossi (come prima)
        self.note.unlink()
        st = self.indexer.index_folder(str(self.notes_base), ocr_enabled=False)
        self.assertEqual(st["removed"], 1)
        self.assertIsNone(self.db.get_indexed_file(str(self.note)))
        self.assertEqual(self.store.count(), 0)


# ======================================================================
# 6. coverage_audit — rilevamento orfani + repair idempotente
# ======================================================================
class TestCoverageAuditRepair(_TmpBase):
    def setUp(self):
        super().setUp()
        self.base = self.tmp / "file_AIstudio"
        ensure_rag_layout(self.base)
        orig = self.base / ORIGINALS_DIR_NAME
        stage = self.base / STAGE2_DIR_NAME
        (orig / "nota_a.md").write_text("contenuto della nota a", encoding="utf-8")
        (orig / "nota_b.md").write_text("contenuto della nota b", encoding="utf-8")
        # solo nota_a e' arrivata in rag_stage2/ → nota_b e' orfana
        (stage / "nota_a.md").write_text("contenuto della nota a", encoding="utf-8")
        self.db_path = self.tmp / "studioia.db"
        self.bases = [{
            "base": self.base,
            "store_key": "vector_index",
            "persist_dir": self.tmp / "vector_index",
        }]

    def test_audit_detects_orphan_repair_idempotent(self):
        audit = run_audit(self.bases, self.db_path, write_report=False)
        rep = audit["bases"][0]
        self.assertEqual(rep["orphans"]["originals_without_stage2"], ["nota_b.md"])
        self.assertGreaterEqual(rep["orphans"]["stage2_missing_indexed_row"], ["nota_a.md"])
        self.assertGreaterEqual(rep["counts"]["orphans"], 2)

        # --- repair #1: copia + indicizzazione controllata ---
        emb = CountingEmbedder()
        r1 = run_repair(self.bases, self.db_path, embedder=emb,
                        report_path=self.tmp / "report1.json")
        chk1 = r1["idempotent_check"]
        self.assertEqual(chk1["copied"], 1)
        self.assertGreaterEqual(chk1["files_reindexed"], 1)
        self.assertEqual(chk1["orphans_after"], 0, r1["post"])
        self.assertGreater(emb.calls, 0)

        # post: entrambi i file con chunks + riga indexed_files
        audit2 = run_audit(self.bases, self.db_path, write_report=False)
        rep2 = audit2["bases"][0]
        self.assertEqual(rep2["orphans"]["originals_without_stage2"], [])
        self.assertEqual(rep2["orphans"]["stage2_without_chunks"], [])
        self.assertEqual(rep2["orphans"]["stage2_missing_indexed_row"], [])
        for f in rep2["files"]:
            if f["name"].endswith(".md"):
                self.assertEqual(f["status"], "ok", f)
                self.assertGreaterEqual(f["chunks"], 1)
                self.assertIsNotNone(f["indexed"])

        # --- repair #2: IDEMPOTENTE → 0 azioni, 0 nuovi re-embed ---
        calls_before = emb.calls
        r2 = run_repair(self.bases, self.db_path, embedder=emb,
                        report_path=self.tmp / "report2.json")
        chk2 = r2["idempotent_check"]
        self.assertEqual(chk2["copied"], 0, "2° repair ha ricopiato file")
        self.assertEqual(chk2["files_reindexed"], 0, "2° repair ha re-indicizzato")
        self.assertEqual(chk2["rows_removed"], 0)
        self.assertEqual(chk2["chunks_removed"], 0)
        self.assertEqual(chk2["orphans_after"], 0)
        self.assertEqual(emb.calls, calls_before, "2° repair ha re-embedded!")


# ======================================================================
# 7. books store — meta API + query vuota (wiring runtime)
# ======================================================================
class TestBooksStore(_TmpBase):
    def test_books_store_meta_and_empty_query(self):
        s = self._store("vector_index_books", "vector_index_books")
        self.assertEqual(s.store_key, "vector_index_books")
        # get/set_index_meta supportati (contratto I) sullo store books
        self.assertIsNone(s.get_index_meta("embedding_model_id"))
        s.set_index_meta("embedding_model_id", EMBEDDER_ID)
        self.assertEqual(s.get_index_meta("embedding_model_id"), EMBEDDER_ID)
        # ensure su indice vuoto → "ok", nessun reindex
        self.assertEqual(s.ensure_embedder_consistent(EMBEDDER_ID), "ok")
        # query reali su corpus vuoto → 0 risultati SENZA errori
        self.assertEqual(s.count(), 0)
        self.assertEqual(s.query([0.1] * 8, top_k=5), [])
        self.assertEqual(s.query([0.1] * 8, top_k=5, text="guerra punica",
                                 hybrid=True), [])
        self.assertEqual(s.fts_query("guerra punica", top_k=5), [])
        s.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)

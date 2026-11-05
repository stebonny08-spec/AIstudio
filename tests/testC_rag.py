"""
tests/testC_rag.py
-------------------
QA-T1 — BLOCCO C: test offline della pipeline RAG a due livelli.

Owner esclusivo di questo blocco: QUI si testa, altrove NON si modifica.
Ogni bug trovato viene documentato nel report, mai corretto qui.

Copertura:
  1. core.rag.indexer.ensure_rag_layout      → crea originals/ + rag_stage2/, idempotente.
  2. core.rag.indexer.migrate_legacy_files   → migrazione .md + sidecar, idempotente,
                                               sottocartelle intoccabili, no-overwrite.
  3. core.rag.indexer.Indexer.index_folder   → potatura os.walk: originals/ MAI indicizzato
                                               (anche annidato), flusso incrementale.
  4. core.local_search                       → _is_originals_source (varianti Windows)
                                               + filtro applicato in LocalSearchEngine.search
                                               (risultati misti con stub di vector_store).
  5. backend.study_api.StudyAPI.read_material_text
                                             → lettura .md sotto radici ammesse,
                                               rifiuto di path fuori radici (con ..) e inesistenti.

Vincoli rispettati:
  - Solo stdlib (unittest, tempfile, pathlib, ...): NO chromadb, NO pywebview reali.
  - `webview` viene stubbato in sys.modules PRIMA di importare backend.study_api
    (pywebview non è necessario a livello di import per gli altri moduli).
  - TUTTE le cartelle di test sono tempfile: mai file_AIstudio/, mai %APPDATA%.
    In read_material_text si impostano SEMPRE rag_folder e books_manager fittizi
    così il fallback get_app_data_dir() (%APPDATA%) non viene mai invocato.
  - Nessuna dipendenza pesante all'import di core.rag.indexer / core.local_search:
    chromadb e sentence_transformers sono importati lazy (dentro __init__/funzioni),
    core.parsers carica i parser pesanti solo a dispatch. Verificato: si importano
    senza stub; qui si passano comunque stub a Embedder/VectorStore/Database per
    non caricare modelli né creare indice reale.

Esecuzione:  python tests/testC_rag.py
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path

# --- sys.path: root del progetto (script lanciato come `python tests/testC_rag.py`) ---
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# --- Stub webview PRIMA di qualsiasi import backend.* (pywebview non serve a import) ---
if "webview" not in sys.modules:
    try:
        import webview  # noqa: F401  (se installato, si usa quello)
    except Exception:
        _webview_stub = types.ModuleType("webview")

        class _FileDialog:  # attributo usato solo dentro i metodi study_api
            OPEN = "open"
            SAVE = "save"

        _webview_stub.FileDialog = _FileDialog
        _webview_stub.windows = []
        sys.modules["webview"] = _webview_stub

# --- Import dei soli moduli testati (tutti importabili senza pesi) ---
from core.rag.indexer import (  # noqa: E402
    ORIGINALS_DIR_NAME,
    STAGE2_DIR_NAME,
    Indexer,
    ensure_rag_layout,
    migrate_legacy_files,
)
from core.local_search import LocalSearchEngine, _is_originals_source  # noqa: E402
from backend.study_api import StudyAPI  # noqa: E402


# ======================================================================
# Stub leggeri (nessun chromadb / sentence-transformers / SQLite reale)
# ======================================================================

class FakeDB:
    """Sostituisce data.db.Database per l'indicizzatore."""

    def __init__(self):
        self.files = {}     # path -> {dimensione, data_modifica, num_chunk}
        self.upserts = []   # elenco path indicizzati (in ordine)
        self.removed = []

    def get_indexed_file(self, path):
        return self.files.get(path)

    def upsert_indexed_file(self, path, size, mtime, num_chunk=0):
        self.files[path] = {
            "dimensione": size,
            "data_modifica": mtime,
            "num_chunk": num_chunk,
        }
        self.upserts.append(path)

    def get_all_indexed_paths(self):
        return list(self.files.keys())

    def remove_indexed_file(self, path):
        self.files.pop(path, None)
        self.removed.append(path)


class FakeVectorStore:
    """Sostituisce core.rag.vector_store.VectorStore (niente ChromaDB)."""

    def __init__(self, query_results=None):
        self.added_sources = []     # source_file dei chunk aggiunti
        self.deleted_sources = []
        self.query_results = query_results or {}  # chiave = "embedding" (vedi FakeEmbedder)
        self.query_calls = []

    # --- API usate da Indexer ---
    def delete_by_source_file(self, path):
        self.deleted_sources.append(path)

    def add_chunks(self, chunks, embeddings):
        for c in chunks:
            self.added_sources.append(c.source_file)

    # --- API usate da LocalSearchEngine.search ---
    def count(self):
        return sum(len(v) for v in self.query_results.values())

    def query(self, embedding, top_k=5):
        key = str(embedding)
        self.query_calls.append(key)
        return list(self.query_results.get(key, []))[:top_k]


class FakeEmbedder:
    """embed_one ritorna il testo stesso: fa da CHIAVE per FakeVectorStore.query."""

    def embed(self, texts, kind="passage"):
        return [[0.1] * 8 for _ in texts]

    def embed_one(self, text, kind="query"):
        return text


def _mk_result(source_file, text, similarity):
    """Righe di risultato grezzo nel formato atteso da LocalSearchEngine.search."""
    return {
        "text": text,
        "source_file": source_file,
        "location_hint": "",
        "similarity": similarity,
        "is_image": False,
        "image_path": "",
        "mime_type": "",
    }


_LONG_TEXT = (
    "La fotosintesi clorofilliana converte la luce solare in energia chimica. "
    "Avviene nei cloroplasti attraverso le reazioni luminose e il ciclo di Calvin. "
    "Il gluchosio prodotto viene usato dalla pianta per crescere e respirare. "
    "Questo paragrafo e volutamente lungo affinche lo splitter crei almeno un chunk valido."
)


# ======================================================================
# 1. ensure_rag_layout
# ======================================================================

class TestEnsureRagLayout(unittest.TestCase):

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="qaC_layout_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_creates_originals_and_stage2(self):
        base = self.tmp / "base"
        originals, stage2 = ensure_rag_layout(base)
        self.assertEqual(originals, base / ORIGINALS_DIR_NAME)
        self.assertEqual(stage2, base / STAGE2_DIR_NAME)
        self.assertTrue(originals.is_dir())
        self.assertTrue(stage2.is_dir())

    def test_creates_nested_base_with_parents(self):
        base = self.tmp / "a" / "b" / "c"  # non esiste ancora
        originals, stage2 = ensure_rag_layout(base)
        self.assertTrue(originals.is_dir())
        self.assertTrue(stage2.is_dir())

    def test_second_call_idempotent(self):
        base = self.tmp / "base"
        o1, s1 = ensure_rag_layout(base)
        # seconda chiamata: nessun errore, stessi path, cartelle sempre lì
        o2, s2 = ensure_rag_layout(base)
        self.assertEqual((o1, s1), (o2, s2))
        self.assertTrue(o2.is_dir())
        self.assertTrue(s2.is_dir())


# ======================================================================
# 2. migrate_legacy_files
# ======================================================================

class TestMigrateLegacyFiles(unittest.TestCase):

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="qaC_migrate_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.base = self.tmp / "base"
        self.base.mkdir()

    def _write(self, relpath, content="contenuto"):
        p = self.base / relpath
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p

    @staticmethod
    def _fingerprint(path: Path):
        st = os.stat(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        return (st.st_size, st.st_mtime_ns, digest)

    def test_migrates_md_and_sidecar(self):
        md = self._write("appunti_foto.md", "testo originale")
        sidecar = self._write("appunti_foto.images.json", '{"images": []}')

        stats = migrate_legacy_files(self.base)

        # file in originals/ E copia in rag_stage2/
        o_md = self.base / ORIGINALS_DIR_NAME / "appunti_foto.md"
        o_sc = self.base / ORIGINALS_DIR_NAME / "appunti_foto.images.json"
        s_md = self.base / STAGE2_DIR_NAME / "appunti_foto.md"
        s_sc = self.base / STAGE2_DIR_NAME / "appunti_foto.images.json"
        for p in (o_md, o_sc, s_md, s_sc):
            self.assertTrue(p.is_file(), f"mancante: {p}")

        # radice pulita: niente .md/.sidecar rimasti
        self.assertFalse(md.exists())
        self.assertFalse(sidecar.exists())

        # contenuti corretti nei due posti
        self.assertEqual(o_md.read_text(encoding="utf-8"), "testo originale")
        self.assertEqual(s_md.read_text(encoding="utf-8"), "testo originale")

        self.assertEqual(stats["moved"], 2)
        self.assertEqual(stats["copied"], 2)
        self.assertEqual(stats["errors"], 0)

    def test_leaves_subfolders_and_other_files_untouched(self):
        # sottocartella NON toccata (iterdir non ricorsivo)
        sub_md = self._write("sotto/cartella/note.md", "sottocartella")
        # file non-md in radice: non migrato
        png = self.base / "foto.png"
        png.write_bytes(b"\x89PNG fake")

        migrate_legacy_files(self.base)

        self.assertTrue(sub_md.exists())
        self.assertEqual(sub_md.read_text(encoding="utf-8"), "sottocartella")
        self.assertFalse((self.base / ORIGINALS_DIR_NAME / "note.md").exists())
        self.assertTrue(png.exists())
        self.assertFalse((self.base / ORIGINALS_DIR_NAME / "foto.png").exists())

    def test_second_call_is_noop_no_loss(self):
        self._write("lezione_3.md", "contenuto della lezione")
        self._write("lezione_3.images.json", '{"images": []}')

        stats1 = migrate_legacy_files(self.base)
        self.assertEqual(stats1["moved"], 2)
        self.assertEqual(stats1["copied"], 2)

        fp_orig_before = self._fingerprint(self.base / ORIGINALS_DIR_NAME / "lezione_3.md")
        fp_stage_before = self._fingerprint(self.base / STAGE2_DIR_NAME / "lezione_3.md")
        fp_sc_before = self._fingerprint(
            self.base / ORIGINALS_DIR_NAME / "lezione_3.images.json"
        )

        # seconda chiamata → no-op
        stats2 = migrate_legacy_files(self.base)
        self.assertEqual(stats2["moved"], 0)
        self.assertEqual(stats2["copied"], 0)
        self.assertEqual(stats2["errors"], 0)

        # nessuna perdita: i file ci sono ancora, mtime/contenuto identici
        fp_orig_after = self._fingerprint(self.base / ORIGINALS_DIR_NAME / "lezione_3.md")
        fp_stage_after = self._fingerprint(self.base / STAGE2_DIR_NAME / "lezione_3.md")
        fp_sc_after = self._fingerprint(
            self.base / ORIGINALS_DIR_NAME / "lezione_3.images.json"
        )
        self.assertEqual(fp_orig_before, fp_orig_after)
        self.assertEqual(fp_stage_before, fp_stage_after)
        self.assertEqual(fp_sc_before, fp_sc_after)
        # radice sempre pulita
        self.assertFalse((self.base / "lezione_3.md").exists())
        self.assertFalse((self.base / "lezione_3.images.json").exists())

    def test_does_not_overwrite_existing_original(self):
        # originals/ contiene GIÀ un file omonimo → quello in radice NON deve
        # essere sovrascritto né spostato (rimane in radice per il prossimo avvio)
        orig = self.base / ORIGINALS_DIR_NAME
        orig.mkdir(parents=True, exist_ok=True)
        (orig / "conflitto.md").write_text("VERSIONE PREESISTENTE", encoding="utf-8")
        root_file = self._write("conflitto.md", "VERSIONE NUOVA")

        stats = migrate_legacy_files(self.base)

        # l'originale in originals/ NON è stato sovrascritto
        self.assertEqual(
            (orig / "conflitto.md").read_text(encoding="utf-8"),
            "VERSIONE PREESISTENTE",
        )
        # il file in radice NON è stato spostato (skipped) ed è intatto
        self.assertTrue(root_file.exists())
        self.assertEqual(root_file.read_text(encoding="utf-8"), "VERSIONE NUOVA")
        self.assertGreaterEqual(stats["skipped"], 1)
        self.assertEqual(stats["moved"], 0)
        # la copia in rag_stage2 c'è (fatta prima dello spostamento)
        self.assertEqual(
            (self.base / STAGE2_DIR_NAME / "conflitto.md").read_text(encoding="utf-8"),
            "VERSIONE NUOVA",
        )


# ======================================================================
# 3. Scan dell'indicizzatore: originals/ potato da os.walk
# ======================================================================

class TestIndexFolderSkipsOriginals(unittest.TestCase):

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="qaC_scan_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.base = self.tmp / "base"
        # struttura: stage2 (indicizzato), originals (MAI), annidato, radice
        (self.base / STAGE2_DIR_NAME).mkdir(parents=True)
        (self.base / ORIGINALS_DIR_NAME).mkdir()
        (self.base / "archivio" / ORIGINALS_DIR_NAME).mkdir(parents=True)
        self.f_stage = self.base / STAGE2_DIR_NAME / "nota_indicizzata.txt"
        self.f_orig = self.base / ORIGINALS_DIR_NAME / "originale_non_indicizzare.txt"
        self.f_nested = self.base / "archivio" / ORIGINALS_DIR_NAME / "annidato.txt"
        self.f_root = self.base / "file_di_radice.txt"
        for p in (self.f_stage, self.f_orig, self.f_nested, self.f_root):
            p.write_text(_LONG_TEXT, encoding="utf-8")

        self.db = FakeDB()
        self.vs = FakeVectorStore()
        self.embedder = FakeEmbedder()
        self.messages = []

    def _run(self, folder=None):
        indexer = Indexer(self.db, self.vs, self.embedder)
        indexer.index_folder(
            str(folder or self.base),
            ocr_enabled=False,
            progress_callback=self.messages.append,
        )

    def test_stage2_indexed_originals_never_processed(self):
        self._run()

        processed = set(self.db.upserts) | set(self.vs.added_sources)
        # file1 (stage2) e il file di radice: indicizzati
        self.assertIn(str(self.f_stage), processed)
        self.assertIn(str(self.f_root), processed)
        # file2 (originals/) e l'annidato: MAI processati
        self.assertNotIn(str(self.f_orig), processed)
        self.assertNotIn(str(self.f_nested), processed)
        # il conteggio della raccolta file esclude originals/ (esattamente 2)
        self.assertTrue(
            any("Trovati 2 file supportati" in m for m in self.messages),
            f"atteso 'Trovati 2 file supportati', ottenuto: {self.messages}",
        )
        # nessun messaggio di progresso cita i file originals
        joined = "\n".join(self.messages)
        self.assertNotIn("originale_non_indicizzare.txt", joined)
        self.assertNotIn("annidato.txt", joined)

    def test_pruning_at_any_depth_nested_originals(self):
        # anche un originals/ annidato dentro una sottocartella viene potato
        self._run()
        processed = set(self.db.upserts) | set(self.vs.added_sources)
        self.assertNotIn(str(self.f_nested), processed)
        self.assertNotIn(str(self.f_orig), processed)

    def test_index_folder_on_stage2_directly(self):
        # flusso reale: lo scan punta a rag_stage2/
        self._run(self.base / STAGE2_DIR_NAME)
        processed = set(self.db.upserts) | set(self.vs.added_sources)
        self.assertEqual(processed, {str(self.f_stage)})

    def test_incremental_second_run_reprocesses_nothing(self):
        self._run()
        upserts_after_first = list(self.db.upserts)
        self.assertTrue(upserts_after_first)
        # seconda scansione: tutto invariato → nessun re-processing, nessuna rimozione
        self._run()
        self.assertEqual(self.db.upserts, upserts_after_first)
        self.assertEqual(self.db.removed, [])
        self.assertEqual(len(self.db.files), len(upserts_after_first))


# ======================================================================
# 4. local_search: difesa originals/ (unit + filtro nei risultati)
# ======================================================================

class TestIsOriginalsSource(unittest.TestCase):

    def test_positives(self):
        self.assertTrue(_is_originals_source("/x/originals/f.md"))
        # separatori Windows
        self.assertTrue(_is_originals_source("C:\\x\\originals\\f.md"))
        self.assertTrue(_is_originals_source("C:\\x/originals\\f.md"))
        # case-insensitive (Windows)
        self.assertTrue(_is_originals_source("/X/ORIGINALS/f.MD"))
        self.assertTrue(_is_originals_source("C:\\X\\Originals\\Nota.MD"))
        # annidato a qualsiasi profondità
        self.assertTrue(_is_originals_source("/base/sub/originals/deep/f.md"))

    def test_negatives(self):
        # sotto rag_stage2 → False
        self.assertFalse(_is_originals_source("/x/rag_stage2/f.md"))
        self.assertFalse(_is_originals_source("C:\\x\\rag_stage2\\f.md"))
        # file chiamato "originals.md" in radice: il nome del file è escluso
        self.assertFalse(_is_originals_source("/x/originals.md"))
        # cartella il cui nome CONTIENE originals ma non è originals
        self.assertFalse(_is_originals_source("/x/myoriginals_backup/f.md"))
        self.assertFalse(_is_originals_source("/x/originals_old/f.md"))
        # vuoto / None
        self.assertFalse(_is_originals_source(""))
        self.assertFalse(_is_originals_source(None))


class TestSearchExcludesOriginals(unittest.TestCase):

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="qaC_search_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.base = self.tmp / "base"
        self.orig_md = str(self.base / ORIGINALS_DIR_NAME / "vecchio.md")
        self.orig_md2 = str(self.base / ORIGINALS_DIR_NAME / "altro.md")
        self.stage_md = str(self.base / STAGE2_DIR_NAME / "nuovo.md")

    def _engine(self, query_results):
        return LocalSearchEngine(
            FakeDB(),
            FakeVectorStore(query_results=query_results),
            FakeEmbedder(),
        )

    def test_search_excludes_originals_chunks(self):
        engine = self._engine({
            "domanda": [
                # >0.45: tutti "forti", ma i due originals devono sparire
                _mk_result(self.orig_md, "vecchio testo", 0.92),
                _mk_result(self.stage_md, "nuovo testo", 0.88),
                _mk_result(self.orig_md2, "altro vecchio", 0.70),
            ],
        })
        result = engine.search("domanda", top_k=5)
        source_files = [c.source_file for c in result.chunks]
        self.assertEqual(source_files, [self.stage_md])
        for c in result.chunks:
            self.assertFalse(
                _is_originals_source(c.source_file),
                f"chunk di originals/ filtrato male: {c.source_file}",
            )

    def test_search_all_originals_returns_empty(self):
        engine = self._engine({
            "domanda": [
                _mk_result(self.orig_md, "vecchio testo", 0.95),
                _mk_result(self.orig_md2, "altro vecchio", 0.80),
            ],
        })
        result = engine.search("domanda", top_k=5)
        self.assertTrue(result.is_empty)

    def test_topic_fallback_also_excludes_originals(self):
        # Il fallback del filtro topic (quando non c'è overlap tra i testi)
        # usa topic_results: anche quelli devono essere già ripuliti (C4).
        engine = self._engine({
            "domanda": [_mk_result(self.stage_md, "m1 testo", 0.60)],
            "argomento": [
                _mk_result(self.orig_md, "t1 vecchio", 0.90),   # forte ma originals
                _mk_result(self.stage_md, "t2 nuovo", 0.50),
            ],
        })
        result = engine.search("domanda", topic="argomento", top_k=5)
        source_files = [c.source_file for c in result.chunks]
        self.assertNotIn(self.orig_md, source_files)
        self.assertIn(self.stage_md, source_files)
        for c in result.chunks:
            self.assertFalse(_is_originals_source(c.source_file))


# ======================================================================
# 5. read_material_text (backend/study_api.py)
# ======================================================================

class _FakeBooksManager:
    """Evita il fallback get_app_data_dir() → %APPDATA% (mai toccato)."""

    def __init__(self, folder):
        self._folder = str(folder)

    def get_books_folder_path(self):
        return self._folder


class TestReadMaterialText(unittest.TestCase):

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="qaC_read_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        # radice L1 (file_AIstudio-like) e radice L2 (preselected_books-like)
        self.root1 = self.tmp / "radice_note"
        self.root2 = self.tmp / "radice_libri"
        (self.root1 / STAGE2_DIR_NAME).mkdir(parents=True)
        (self.root1 / ORIGINALS_DIR_NAME).mkdir()
        self.root2.mkdir()

        self.api = StudyAPI()          # mixin senza __init__
        self.api.rag_folder = str(self.root1)
        self.api.books_manager = _FakeBooksManager(self.root2)

    def test_reads_valid_md_in_stage2(self):
        f = self.root1 / STAGE2_DIR_NAME / "appunti.md"
        f.write_text("# Titolo\ncontenuto di prova", encoding="utf-8")
        out = self.api.read_material_text(str(f))
        self.assertTrue(out.get("success"), out)
        self.assertIn("contenuto di prova", out["text"])
        self.assertEqual(out["name"], "appunti.md")
        self.assertEqual(out["kind"], "md")
        self.assertEqual(out["size"], f.stat().st_size)

    def test_reads_from_originals_and_books_root(self):
        # originals/ e la radice L2 sono entrambe consentite
        f_orig = self.root1 / ORIGINALS_DIR_NAME / "originale.md"
        f_orig.write_text("testo originale", encoding="utf-8")
        f_book = self.root2 / "libro.md"
        f_book.write_text("testo del libro", encoding="utf-8")

        out1 = self.api.read_material_text(str(f_orig))
        self.assertTrue(out1.get("success"), out1)
        self.assertEqual(out1["text"], "testo originale")

        out2 = self.api.read_material_text(str(f_book))
        self.assertTrue(out2.get("success"), out2)
        self.assertEqual(out2["text"], "testo del libro")

    def test_rejects_path_outside_roots(self):
        # path assoluto fuori dalle radici ammesse
        win_ini = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "win.ini")
        out = self.api.read_material_text(win_ini)
        self.assertFalse(out.get("success"))
        self.assertEqual(out.get("error"), "Percorso non consentito")

        # path con ".." che escapesce dalla radice (file realmente esistente!)
        escape = self.tmp / "escape.md"
        escape.write_text("top secret", encoding="utf-8")
        traversal = str(self.root1 / STAGE2_DIR_NAME / ".." / ".." / "escape.md")
        out2 = self.api.read_material_text(traversal)
        self.assertFalse(out2.get("success"))
        self.assertEqual(out2.get("error"), "Percorso non consentito")

        # path relativo con ".."
        out3 = self.api.read_material_text("../qualcosa.md")
        self.assertFalse(out3.get("success"))
        self.assertEqual(out3.get("error"), "Percorso non consentito")

    def test_rejects_nonexistent_inside_root(self):
        missing = self.root1 / STAGE2_DIR_NAME / "non_esiste.md"
        out = self.api.read_material_text(str(missing))
        self.assertFalse(out.get("success"))
        self.assertEqual(out.get("error"), "File non trovato")

    def test_rejects_empty_path(self):
        out = self.api.read_material_text("")
        self.assertFalse(out.get("success"))
        self.assertEqual(out.get("error"), "Percorso mancante")


if __name__ == "__main__":
    unittest.main(verbosity=2)

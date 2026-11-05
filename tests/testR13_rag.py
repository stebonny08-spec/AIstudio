# -*- coding: utf-8 -*-
"""tests/testR13_rag.py — R13/C3 dedupe chunk legacy + BOOKS4 (IMPLEMENTER-RAG).

Cobertura (compito C3):
  1. rilevamento legacy: dry-run classifica originals/stage2/legacy e NON scrive
     (0 scrittura su DB, nessun backup);
  2. rifiuto: --apply con testo legacy NON duplicato esatto (sha256) => REFUSED,
     zero backup, zero cancellazioni;
  3. apply + idempotenza: DELETE dei duplicati esatti, post-check
     (legacy=0, stage2 invariato, originals invariato), parity retrieval e
     2° run = NIENTE_DA_FARE (0 da fare, nessun secondo backup);
  4. originals ancora esclusi: mai cancellati e mai classificati legacy;
  5. BOOKS4: nessun import chromadb EAGER nel runtime (scan AST) + check
     dinamico del percorso default.

NON tocca tests/testC_rag.py. Fixture interamente su cartella TEMP:
nessuna scrittura su %APPDATA%.

Esecuzione: set PYTHONIOENCODING=utf-8 && python tests/testR13_rag.py
"""
from __future__ import annotations

import hashlib
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import data.migrate_real as mr  # noqa: E402
from core.rag.chunker import Chunk  # noqa: E402
from core.rag.vector_store_sqlite import SQLiteVectorStore  # noqa: E402

STAGE2_SRC = str(_PROJECT_ROOT / "file_AIstudio" / "rag_stage2" / "materiale.md")
LEGACY_SRC = str(_PROJECT_ROOT / "file_AIstudio" / "materiale.md")
ORIG_SRC = str(_PROJECT_ROOT / "file_AIstudio" / "originals" / "materiale.md")

TEXTS_STAGE2 = [
    "La fotosintesi clorofilliana converte l'energia luminosa in energia "
    "chimica negli organismi autotrofi del regno vegetale.",
    "La mitosi produce due cellule figlie geneticamente identiche alla "
    "cellula madre grazie alla divisione ordinata dei cromosomi.",
    "L'algebra lineare studia vettori spazi lineari e matrici con operazioni "
    "ben definite e proprietà dimostrabili.",
]
# duplicati ESATTI di due testi gia' in rag_stage2/ (sha256 identico)
TEXT_LEGACY_DUP = [TEXTS_STAGE2[0], TEXTS_STAGE2[1]]
# testo legacy che NON esiste in rag_stage2/ (sha256 assente -> REFUSED)
TEXT_LEGACY_UNIQ = [
    "Testo unico del file legacy che NON esiste in nessun chunk di rag_stage2."
]
TEXT_ORIG = [
    "Contenuto dell'originale che l'indice NON deve mai restituire al RAG."
]

QUERIES = [
    {"query": "fotosintesi clorofilliana converte luce energia chimica",
     "gold": "materiale.md"},
    {"query": "mitosi divisione cellule figlie cromosomi", "gold": "materiale.md"},
    {"query": "algebra lineare vettori matrici spazi", "gold": "materiale.md"},
]
DIM = 64


def _emb(texts):
    e = mr._load_h1_embedder(DIM)
    return [e.embed_one(t, kind="passage") for t in texts]


def _build_db(app: Path, groups) -> Path:
    """Crea un app_dir temporaneo con studioia.db (store 'vector_index')."""
    app.mkdir(parents=True, exist_ok=True)
    store = SQLiteVectorStore(str(app / "vector_index"),
                              db_path=str(app / "studioia.db"),
                              store_key="vector_index")
    try:
        for sf, texts in groups:
            chunks = [
                Chunk(id=hashlib.sha1((sf + "|" + t).encode("utf-8")).hexdigest(),
                      source_file=sf, text=t)
                for t in texts
            ]
            store.add_chunks(chunks, _emb(texts))
    finally:
        store.close()
    return app / "studioia.db"


def _sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _raw_count(db: Path, source_file: str) -> int:
    con = sqlite3.connect(f"file:{db.resolve().as_posix()}?mode=ro", uri=True)
    try:
        return con.execute(
            "SELECT COUNT(*) FROM chunks WHERE source_file = ?",
            (source_file,)).fetchone()[0]
    finally:
        con.close()


# ======================================================================
# C3 — DEDUPE LEGACY
# ======================================================================
class TestR13DedupeLegacy(unittest.TestCase):

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="r13_rag_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.app = self.tmp / "app"
        self.db = _build_db(self.app, [
            (STAGE2_SRC, TEXTS_STAGE2),     # 3 chunk da rag_stage2/
            (LEGACY_SRC, TEXT_LEGACY_DUP),   # 2 chunk legacy DUPLICATI esatti
            (ORIG_SRC, TEXT_ORIG),           # 1 chunk in originals/
        ])
        self.out_dry = self.tmp / "dry.json"
        self.out_app = self.tmp / "apply.json"

    # 1) rilevamento legacy (dry-run, 0 scrittura)
    def test_dryrun_rileva_legacy_e_non_scrive(self):
        sha_before = _sha256_file(self.db)
        res = mr.dedupe_legacy(app_dir=self.app, apply=False,
                               out_json=self.out_dry, queries=QUERIES)
        self.assertEqual(res["status"], "DRY_RUN")
        self.assertEqual(res["n_legacy"], 2)
        self.assertEqual(res["n_stage2"], 3)
        self.assertEqual(res["n_originals"], 1)
        self.assertEqual(res["deleted"], 0)
        self.assertEqual(res["cancellabili"], 2)
        self.assertEqual(res["legacy_non_duplicati"], [])
        self.assertTrue(all(e["duplicated_in_stage2"] for e in res["legacy"]))
        self.assertTrue(self.out_dry.is_file())
        # dry-run = SOLA LETTURA: DB identico byte per byte, nessun backup
        self.assertEqual(sha_before, _sha256_file(self.db))
        self.assertFalse(any(self.app.glob("backup_chroma_*")))

    # 2) rifiuto se il testo legacy NON e' duplicato esatto
    def test_apply_rifiuta_se_non_duplicato(self):
        shutil.rmtree(self.app)
        self.db = _build_db(self.app, [
            (STAGE2_SRC, TEXTS_STAGE2),
            (LEGACY_SRC, TEXT_LEGACY_UNIQ),  # sha256 NON presente in stage2
            (ORIG_SRC, TEXT_ORIG),
        ])
        res = mr.dedupe_legacy(app_dir=self.app, apply=True,
                               out_json=self.out_app, queries=QUERIES)
        self.assertEqual(res["status"], "REFUSED")
        self.assertEqual(res["deleted"], 0)
        self.assertEqual(len(res["legacy_non_duplicati"]), 1)
        self.assertTrue(res.get("causa"))
        self.assertTrue(res.get("procedura_manuale"))
        # ZERO backup e ZERO cancellazioni
        self.assertFalse(any(self.app.glob("backup_chroma_*")))
        sc = mr.scan_store_chunks(self.db)
        self.assertEqual(sc["n_legacy"], 1)
        self.assertEqual(sc["n_stage2"], 3)
        self.assertEqual(sc["n_originals"], 1)

    # 3) apply + idempotenza (2° run = 0 da fare)
    def test_apply_dedupe_e_idempotenza(self):
        res = mr.dedupe_legacy(app_dir=self.app, apply=True,
                               out_json=self.out_app, queries=QUERIES)
        self.assertEqual(res["status"], "eseguito", res.get("causa"))
        self.assertEqual(res["deleted"], 2)
        self.assertEqual(res["delete"]["expected"], 2)
        self.assertTrue(res["backup_sha_verified"])
        self.assertTrue(Path(res["manifest_path"]).is_file())
        pc = res["post_check"]
        self.assertEqual(pc["n_legacy"], 0)
        self.assertEqual(pc["n_stage2"], 3)
        self.assertEqual(pc["n_originals"], 1)
        self.assertTrue(pc["originals_invariati"])
        self.assertTrue(pc["stage2_invariato"])
        # retrieval PRIMA/DOPO: identico salvo i duplicati rimossi
        p = res["retrieval_parity"]
        self.assertTrue(p["ok"], p)
        self.assertEqual(p["n_queries"], p["n_queries_ok"])
        self.assertGreaterEqual(p["n_queries"], len(QUERIES))
        # conteggi reali sul file
        sc = mr.scan_store_chunks(self.db)
        self.assertEqual((sc["n_legacy"], sc["n_stage2"], sc["n_originals"]),
                         (0, 3, 1))
        # 2° run: NIENTE_DA_FARE (0 da fare) e NESSUN secondo backup
        n_backup = len(list(self.app.glob("backup_chroma_*")))
        res2 = mr.dedupe_legacy(app_dir=self.app, apply=True,
                                out_json=self.tmp / "idem.json",
                                queries=QUERIES)
        self.assertEqual(res2["status"], "NIENTE_DA_FARE")
        self.assertEqual(res2["n_legacy"], 0)
        self.assertEqual(res2["deleted"], 0)
        self.assertEqual(len(list(self.app.glob("backup_chroma_*"))), n_backup)
        self.assertEqual(res2["post_check"]["n_stage2"], 3)

    # 4) originals ancora esclusi (mai cancellati, mai legacy)
    def test_originals_esclusi_da_dedupe(self):
        res = mr.dedupe_legacy(app_dir=self.app, apply=True,
                               out_json=self.out_app, queries=QUERIES)
        self.assertEqual(res["status"], "eseguito", res.get("causa"))
        sc = mr.scan_store_chunks(self.db)
        # classificazione: originals resta originals (non e' mai "legacy")
        self.assertEqual(sc["n_originals"], 1)
        self.assertEqual(sc["originals_sources"], [ORIG_SRC])
        # il chunk original e' ancora nel DB (il dedupe non lo tocca)
        self.assertEqual(_raw_count(self.db, ORIG_SRC), 1)
        # ... e i chunk stage2 sono integri
        self.assertEqual(_raw_count(self.db, STAGE2_SRC), len(TEXTS_STAGE2))
        # ... mentre il legacy duplicato e' sparito
        self.assertEqual(_raw_count(self.db, LEGACY_SRC), 0)


# ======================================================================
# BOOKS4 — import chromadb nel runtime (eager=0)
# ======================================================================
class TestR13Books4Imports(unittest.TestCase):

    def test_nessun_import_eager_chromadb_nel_runtime(self):
        tmp = Path(tempfile.mkdtemp(prefix="r13_b4_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        res = mr.books4_import_scan(out_json=tmp / "b4.json", dynamic=False)
        self.assertEqual(res["n_runtime_eager"], 0, res["runtime_eager"])
        for s in res["runtime_lazy"]:
            self.assertNotEqual(s["scope"], "module")
            self.assertFalse(s["eager"])
        self.assertNotEqual(res["status"], "FAILED")
        self.assertTrue(res.get("dichiarazione"))

    def test_dynamic_percorso_default_senza_chromadb(self):
        tmp = Path(tempfile.mkdtemp(prefix="r13_b4d_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        res = mr.books4_import_scan(out_json=tmp / "b4d.json", dynamic=True)
        dyn = res["dynamic"]
        if dyn.get("errore") is None and dyn.get("errore_parse") is not True:
            self.assertFalse(dyn.get("chromadb_in_sys_modules"),
                             f"chromadb importata nel percorso default: {dyn}")
            self.assertEqual(dyn.get("backend_default"), "sqlite", dyn)
        else:
            self.fail(f"check dinamico del percorso default non eseguibile: {dyn}")


# ======================================================================
# BOOKS1 — e2e MECCANICA su cartella TEMP (mai libri reali)
# ======================================================================
class TestBooks1E2eTemp(unittest.TestCase):
    """Test MECCANICO del pipeline dry-run books (NON sono 'libri reali'):

    costruisce in una cartella TEMP un mini-indice chroma sintetico
    (2 file .md, 6 chunk ciascuno, vettori DeterministicEmbedder) e verifica
    che il dry-run REALE del codice misuri parity_top10=1.0 e recall5=1.0
    quando il corpus ESISTE — dimostrando che il 0/0 di BOOKS1 e' dovuto al
    corpus vuoto e non a un pipeline rotto.
    """

    def test_dry_run_books_parity_recall_1_temp(self):
        try:
            import chromadb
        except Exception as exc:  # pragma: no cover
            self.skipTest(f"chromadb non disponibile: {exc}")
        tmp = Path(tempfile.mkdtemp(prefix="r13_books_e2e_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        md_dir = tmp / "md"
        md_dir.mkdir()
        chroma_dir = tmp / "vector_index_books"
        chroma_dir.mkdir()

        famiglie = {"materialeA.md": "alfaalfa", "materialeB.md": "bravobravo"}
        client = chromadb.PersistentClient(path=str(chroma_dir))
        col = client.get_or_create_collection(
            "documenti_locali", metadata={"hnsw:space": "cosine"})
        e = mr._load_h1_embedder(DIM)
        n_docs = 0
        for nome, fam in famiglie.items():
            md = md_dir / nome
            righe = []
            for i in range(6):
                righe.append(
                    f"Appunti {fam} lezione numero {i} con spiegazione "
                    f"completa del tema {fam} e esempi sviluppati nel dettaglio.")
            md.write_text("\n\n".join(righe), encoding="utf-8")
            for j, riga in enumerate(righe):
                col.add(
                    ids=[f"{nome}-{j}"],
                    documents=[riga],
                    embeddings=[e.embed_one(riga, kind="passage")],
                    metadatas=[{"source_file": str(md)}],
                )
                n_docs += 1

        out_json = _PROJECT_ROOT / "qa" / "r13_rag_books_e2e_temp.json"
        res = mr.dry_run(chroma_dir=chroma_dir, md_dir=md_dir,
                         out_json=out_json, use_real_embedder=False,
                         store_key="vector_index_books")
        # dichiarazione esplicita: e2e MECCANICA su TEMP, non libri reali
        res["nota_meccanica"] = ("test MECCANICA su cartella TEMP con corpus "
                                 "sintetico — NON sono libri reali; serve a "
                                 "provare che il pipeline misura 1.0/1.0 quando "
                                 "il corpus esiste")
        mr._write_json(out_json, res)

        self.assertEqual(res["status"], "OK", res.get("error"))
        self.assertEqual(res["chroma_count"], n_docs)
        self.assertEqual(res["n_chunks"], n_docs)
        self.assertGreaterEqual(res["n_queries"], 6)
        self.assertEqual(res["parity_top10"], 1.0, res["parity_per_query"][:3])
        self.assertEqual(res["recall5"], 1.0,
                         [x for x in res["recall_per_query"] if not x["hit"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)

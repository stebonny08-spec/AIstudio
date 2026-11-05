"""
tests/testG3_dryrun.py
----------------------
G3 — QA migrazione H1 sicura sul dato reale.

Owner: G3. Nessun test altrui viene modificato. TUTTI i percorsi dei test
sono tempfile o cartelle tmp di progetto: MAI %APPDATA% (il cutover REALE
si lancia con `python data/migrate_real.py --commit`, non qui).

Copertura:
  1. test_backup_alter_restore_sha      → backup → altera → restore →
     SHA256 identico al manifest (3.2); manifest tampato → rifiutato.
  2. test_dryrun_tmp_parity_recall      → dry_run() su un indice chroma TMP
     costruito dai .md REALI: parity_top10 >= 0.999, recall5 == 1.0,
     n_chunks > 0, JSON con tutti i campi (3.1).
  3. test_commit_gate_blocked           → gate non superati → status=BLOCKED
     con procedura manuale, NESSUN backup, dati intatti (3.3).
  4. test_commit_full_on_tmp            → cutover completo su app_dir TMP:
     backup+manifest, migrazione, post-check, chroma sorgente intatto (3.3).
  5. test_migrate_first_run_flag        → flag/env/log e nessuna migrazione
     automatica in init con il flag attivo (3.3 auto-invoco).
  6. test_e2e_upload_tmp                → 3 file (pdf, png, .md) su cartelle
     TMP: convert_file_with_images + ensure_index_updated → originals/,
     rag_stage2/, chunks>0, la ricerca trova il contenuto → qa/g3_e2e.json
     (3.4).

Esecuzione:  python tests/testG3_dryrun.py
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))
_TESTS_DIR = Path(__file__).resolve().parent
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

import data.migrate_real as mr  # noqa: E402
from core.rag.chunker import chunk_text  # noqa: E402
from core.rag.vector_store_sqlite import SQLiteVectorStore  # noqa: E402
from core.rag.vector_store_chroma import ChromaVectorStore  # noqa: E402

try:
    from testH1_parity import DeterministicEmbedder  # esecuzione diretta
except ImportError:  # pragma: no cover - fallback importlib
    import importlib.util as _ilu
    _spec = _ilu.spec_from_file_location(
        "testH1_parity", _PROJECT_ROOT / "tests" / "testH1_parity.py")
    _mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    DeterministicEmbedder = _mod.DeterministicEmbedder

try:
    import chromadb  # noqa: F401
    HAS_CHROMA = True
    CHROMA_ERR = ""
except Exception as _exc:  # pragma: no cover
    HAS_CHROMA = False
    CHROMA_ERR = str(_exc)

REAL_MD_DIR = _PROJECT_ROOT / "file_AIstudio" / "rag_stage2"
DIM = 64


# ======================================================================
# Helper: indice chroma TMP costruito dai .md REALI (sola lettura)
# ======================================================================
def _build_chroma_fixture(chroma_dir: Path) -> int:
    """Riempie un chroma TMP con i chunk dei .md reali + decoy sintetici.
    Ritorna il numero di chunk inseriti."""
    chunks = []
    for i, md in enumerate(sorted(REAL_MD_DIR.glob("*.md"))):
        text = md.read_text(encoding="utf-8", errors="replace")
        for j, c in enumerate(chunk_text(text, source_file=str(md))):
            c.id = f"real-{i}-{j}"
            chunks.append(c)
    decoys = [
        "Algebra lineare: matrici, determinanti e autovalori con esempi svolti "
        "e esercizi d'esame sulle trasposizioni delle matrici quadrate.",
        "Rivoluzione francese: cause, fasi e conseguenze storiche con schema "
        "cronologico dei fatti principali dal 1789 al 1799.",
        "Termodinamica: entropia, energia interna e principi zero-uno-due con "
        "esempi numerici di macchine cicliche e spontaneità dei processi.",
    ]
    for k, d in enumerate(decoys):
        for j, c in enumerate(chunk_text(d, source_file=str(
                REAL_MD_DIR / f"decoy_{k}.md"))):
            c.id = f"decoy-{k}-{j}"
            chunks.append(c)
    emb = DeterministicEmbedder().embed([c.text for c in chunks])
    chroma = ChromaVectorStore(str(chroma_dir), "test/g3-deterministic")
    chroma.add_chunks(chunks, emb)
    n = chroma.count()
    assert n == len(chunks), (n, len(chunks))
    return n


def _has_chroma_src(d: Path) -> bool:
    return (Path(d) / "chroma.sqlite3").exists() or any(Path(d).glob("*.sqlite3"))


# ======================================================================
# 1. BACKUP → ALTERA → RESTORE → SHA identico (3.2)
# ======================================================================
class TestBackupRestore(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="g3_backup_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.app = self.tmp / "app"
        vdir = self.app / "vector_index"
        vdir.mkdir(parents=True)
        (vdir / "chroma.sqlite3").write_bytes(os.urandom(4096))
        (vdir / "embedding_model.txt").write_text(
            "test/g3-deterministic", encoding="utf-8")
        sub = vdir / "segments"
        sub.mkdir()
        (sub / "chunk").write_bytes(os.urandom(2048))
        (self.app / "studioia.db").write_bytes(os.urandom(8192))

    def test_backup_alter_restore_sha_identico(self):
        res = mr.backup(app_dir=self.app, ts="testsha")
        self.assertTrue(res.get("ok"), res)
        self.assertGreaterEqual(res["n_files"], 4)
        manifest = json.loads(Path(res["manifest_path"]).read_text(encoding="utf-8"))
        orig = {f["path"]: f["sha256"] for f in manifest["files"]}
        # manifest auto-consistente
        self.assertEqual(mr._files_digest(manifest["files"]),
                         manifest["manifest_sha256"])

        # ALTERA il dato utente (scenario: corruzione/persione)
        vdir = self.app / "vector_index"
        (vdir / "chroma.sqlite3").write_bytes(b"CORROTTO")
        (self.app / "studioia.db").write_bytes(b"CORROTTO")

        r2 = mr.restore(res["manifest_path"], app_dir=self.app)
        self.assertTrue(r2.get("ok"), r2)
        self.assertEqual(r2["verified"], len(manifest["files"]))

        # SHA identico al pre-alterazione per OGNI file
        for f in manifest["files"]:
            p = self.app / f["path"]
            self.assertTrue(p.exists(), f"file non ripristinato: {f['path']}")
            sha = mr._sha256_file(p)
            self.assertEqual(sha, orig[f["path"]],
                             f"sha diverso dopo restore: {f['path']}")
        # sha principale stampato per il report
        print(f"\n[G3] sha256 vector_index/chroma.sqlite3 = "
              f"{orig['vector_index/chroma.sqlite3']}")
        print(f"[G3] sha256 studioia.db = {orig['studioia.db']}")

        # manifest tampato → rifiutato
        manifest["files"][0]["sha256"] = "0" * 64
        bad = self.tmp / "bad_manifest.json"
        bad.write_text(json.dumps(manifest), encoding="utf-8")
        r3 = mr.restore(bad, app_dir=self.app)
        self.assertFalse(r3["ok"])


# ======================================================================
# 2. DRY-RUN su tmp (3.1)
# ======================================================================
class TestDryRunTmp(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="g3_dryrun_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    @unittest.skipUnless(HAS_CHROMA, f"chromadb non disponibile: {CHROMA_ERR}")
    def test_dryrun_tmp_parity_recall(self):
        chroma_dir = self.tmp / "vector_index"
        n = _build_chroma_fixture(chroma_dir)
        out = self.tmp / "g3_migration_dryrun.json"
        res = mr.dry_run(chroma_dir=chroma_dir, md_dir=REAL_MD_DIR,
                         out_json=out, work_root=self.tmp / "work",
                         use_real_embedder=False)  # percorso ancorato, puro tmp
        self.assertTrue(out.exists(), "dry-run deve scrivere SOLO il suo json")
        data = json.loads(out.read_text(encoding="utf-8"))
        for key in ("parity_top10", "recall5", "n_chunks", "queries",
                    "metodo", "comando_riproduzione"):
            self.assertIn(key, data)
        self.assertEqual(data["status"], "OK", data.get("error"))
        self.assertEqual(data["n_chunks"], n)
        self.assertGreaterEqual(data["n_queries"], 20)
        self.assertGreaterEqual(data["parity_top10"], 0.999)
        self.assertEqual(data["recall5"], 1.0)
        self.assertEqual(data["comando_riproduzione"], "python data/migrate_real.py")
        # sorgente intatta (dry-run non deve aver aperto/scritto l'indice)
        self.assertTrue(_has_chroma_src(chroma_dir))
        with open_chroma(chroma_dir) as col:
            self.assertEqual(col.count(), n)
        print(f"\n[G3][TMP DRY-RUN] parity={data['parity_top10']} "
              f"recall5={data['recall5']} n_chunks={data['n_chunks']} "
              f"queries={data['n_queries']}")


class open_chroma:
    """Context manager: apre una copia locale dell'indice per il controllo."""

    def __init__(self, path):
        self.path = str(path)

    def __enter__(self):
        import chromadb
        client = chromadb.PersistentClient(path=self.path)
        try:
            self._col = client.get_collection(
                "documenti_locali", metadata={"hnsw:space": "cosine"})
        except Exception:
            self._col = client.get_or_create_collection(
                "documenti_locali", metadata={"hnsw:space": "cosine"})
        return self._col

    def __exit__(self, *a):
        return False


# ======================================================================
# 3. CUTOVER: gate e flusso completo su TMP (3.3)
# ======================================================================
class TestCommitGates(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="g3_commit_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.app = self.tmp / "app"

    def _write_dryrun(self, parity, recall, n_chunks, path=None) -> Path:
        p = Path(path) if path else self.tmp / "dryrun.json"
        p.write_text(json.dumps({
            "status": "OK" if parity >= 1 else "KO",
            "parity_top10": parity, "recall5": recall, "n_chunks": n_chunks,
            "queries": [], "metodo": "fixture", "ts": "2026-01-01T00:00:00",
        }), encoding="utf-8")
        return p

    @unittest.skipUnless(HAS_CHROMA, f"chromadb non disponibile: {CHROMA_ERR}")
    def test_commit_gate_blocked_no_side_effects(self):
        # app_dir con solo un marker: il gate fallisce PRIMA di toccare tutto
        self.app.mkdir(parents=True)
        marker = self.app / "vector_index_marker.bin"
        marker.write_bytes(b"DATI-UTENTE")
        dry = self._write_dryrun(0.5, 0.9, 10)
        out = self.tmp / "g3_migration.json"
        res = mr.commit(app_dir=self.app, dryrun_json=dry, out_json=out)
        self.assertEqual(res["status"], "BLOCKED")
        self.assertTrue(res["procedura_manuale"])
        self.assertIsNone(res["backup_path"])
        # nessun backup creato, nessun file alterato
        self.assertFalse(any(self.app.glob("backup_chroma_*")))
        self.assertEqual(marker.read_bytes(), b"DATI-UTENTE")
        # il json dichiara i gate
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(data["status"], "BLOCKED")
        self.assertFalse(data["gates"]["pass"])

    @unittest.skipUnless(HAS_CHROMA, f"chromadb non disponibile: {CHROMA_ERR}")
    def test_commit_full_on_tmp(self):
        # indice chroma TMP + dry-run con gate superati
        vdir = self.app / "vector_index"
        n = _build_chroma_fixture(vdir)
        with open_chroma(vdir) as col:
            before = col.count()
        dry = self._write_dryrun(1.0, 1.0, n)
        out = self.tmp / "g3_migration.json"
        res = mr.commit(app_dir=self.app, dryrun_json=dry, out_json=out)
        self.assertEqual(res["status"], "eseguito", res)
        self.assertEqual(res["chunks"], n)
        self.assertEqual(res["parity"], 1.0)
        self.assertEqual(res["recall5"], 1.0)
        # backup + manifest sha verificati
        bdir = Path(res["backup_path"])
        self.assertTrue(bdir.is_dir())
        self.assertTrue(Path(res["manifest_path"]).is_file())
        self.assertTrue(res["post_check"]["backup_sha_verified"])
        self.assertTrue(mr._verify_backup(res["manifest_path"]))
        # chroma sorgente INTATTO (rollback possibile)
        with open_chroma(vdir) as col:
            self.assertEqual(col.count(), before)
        # sqlite reale (tmp) contiene i chunk (stesso modello dichiarato
        # dall'indice: nessun reset, come nel cutover reale)
        store = SQLiteVectorStore(str(vdir), "test/g3-deterministic",
                                  db_path=str(self.app / "studioia.db"),
                                  store_key="vector_index")
        self.assertEqual(store.count(), n)
        store.close()
        # flag one-shot scritto
        self.assertTrue((vdir / "chroma_migrated.flag").exists())
        # json completo
        data = json.loads(out.read_text(encoding="utf-8"))
        for key in ("status", "backup_path", "chunks", "parity", "recall5", "ts"):
            self.assertIn(key, data)
        print(f"\n][G3][TMP CUTOVER] status={res['status']} chunks={res['chunks']} "
              f"backup_sha_ok={res['post_check']['backup_sha_verified']}")

    @unittest.skipUnless(HAS_CHROMA, f"chromadb non disponibile: {CHROMA_ERR}")
    def test_commit_missing_dryrun_is_blocked(self):
        self.app.mkdir(parents=True)
        out = self.tmp / "g3_migration.json"
        res = mr.commit(app_dir=self.app,
                        dryrun_json=self.tmp / "assente.json", out_json=out)
        self.assertEqual(res["status"], "BLOCKED")
        self.assertFalse(any(self.app.glob("backup_chroma_*")))


# ======================================================================
# 4. AUTO-INVOCO in vector_store.py (3.3)
# ======================================================================
class TestMigrateFirstRunFlag(unittest.TestCase):
    def test_env_flag_and_done_logic(self):
        from core.rag import vector_store as vs
        with patch.dict(os.environ, {"RAG_MIGRATE_FIRST_RUN": "1"}):
            self.assertTrue(vs._rag_migrate_first_run_active())
        with patch.dict(os.environ, {"RAG_MIGRATE_FIRST_RUN": "0"}):
            self.assertFalse(vs._rag_migrate_first_run_active())
        env = os.environ.pop("RAG_MIGRATE_FIRST_RUN", None)
        try:
            # config.json reale non contiene il flag -> False (sola lettura)
            self.assertFalse(vs._rag_migrate_first_run_active())
        finally:
            if env is not None:
                os.environ["RAG_MIGRATE_FIRST_RUN"] = env

        tmp = Path(tempfile.mkdtemp(prefix="g3_flag_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        missing = tmp / "g3_migration.json"
        self.assertFalse(vs._g3_migration_done(missing))
        missing.write_text(json.dumps({"status": "BLOCKED"}), encoding="utf-8")
        self.assertFalse(vs._g3_migration_done(missing))
        missing.write_text(json.dumps({"status": "eseguito"}), encoding="utf-8")
        self.assertTrue(vs._g3_migration_done(missing))

    def test_no_auto_migration_when_flag_active(self):
        from core.rag import vector_store as vs

        class _Boom:
            def count(self):
                raise AssertionError("migrazione automatica in init NON ammessa "
                                     "con rag.migrate_first_run")

        tmp = Path(tempfile.mkdtemp(prefix="g3_flag2_"))
        self.addCleanup(shutil.rmtree, tmp, True)
        with patch.object(vs, "_rag_migrate_first_run_active", return_value=True), \
             patch.object(vs, "_g3_migration_done", return_value=False):
            # deve loggare e uscire SENZA toccare lo store
            vs.VectorStore._maybe_migrate(object.__new__(vs.VectorStore),
                                          str(tmp), _Boom())
        # flag NON attivo -> comportamento legacy H1 invariato (flag scritto)
        class _Empty:
            def count(self):
                return 7

        with patch.object(vs, "_rag_migrate_first_run_active", return_value=False):
            vs.VectorStore._maybe_migrate(object.__new__(vs.VectorStore),
                                          str(tmp), _Empty())
        self.assertTrue((tmp / "chroma_migrated.flag").exists())


# ======================================================================
# 5. E2E UPLOAD su TMP (3.4)
# ======================================================================
def _make_pdf(path: Path) -> None:
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text(
        (72, 100),
        "Documento G3 E2E: fotosintesi clorofilliana, tilacoidi e chemiosmosi "
        "per il test del flusso upload conversione indicizzazione.",
        fontsize=11,
    )
    doc.save(str(path))
    doc.close()


def _make_png(path: Path) -> None:
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (640, 140), "white")
    d = ImageDraw.Draw(img)
    d.text((20, 50), "G3 E2E immagine di prova clorofilliana", fill="black")
    img.save(str(path))


def run_e2e_upload(base: Path) -> dict:
    """Mirror del flusso upload su cartelle TMP: originali in originals/,
    .md convertiti in rag_stage2/, indicizzazione, ricerca."""
    from core.local_search import LocalSearchEngine
    from core.markdown_converter import MarkdownConverter
    from data.db import Database

    if base.exists():
        shutil.rmtree(base, ignore_errors=True)
    originals = base / "originals"
    stage2 = base / "rag_stage2"
    originals.mkdir(parents=True)
    stage2.mkdir(parents=True)

    # 1) 3 file di test nella cartella tmp del progetto (upload)
    pdf = base / "documento_g3_e2e.pdf"
    png = base / "immagine_g3_e2e.png"
    md = base / "appunti_g3_e2e.md"
    _make_pdf(pdf)
    _make_png(png)
    md.write_text(
        "# Appunti G3 E2E\n\n"
        "Il colloide osmotico attraverso il tonoplasto regola il vacuolo "
        "centrale delle cellule vegetali durante la turgenza.\n",
        encoding="utf-8")
    uploaded = [pdf, png, md]

    # 2) l'originale finisce in originals/ (come nel flusso reale)...
    for f in uploaded:
        shutil.move(str(f), str(originals / f.name))

    # 3) conversione -> rag_stage2/ (0 scrittura su %APPDATA%: la cache
    #    immagini viene deviata su tmp tramite patch)
    conv = MarkdownConverter()
    md_paths = {}
    cache_tmp = base / "images_cache_tmp"
    cache_tmp.mkdir(parents=True, exist_ok=True)  # deviata via da %APPDATA%
    with patch("core.rag.image_cache.images_cache_dir",
               return_value=cache_tmp):
        for f in uploaded:
            src = originals / f.name
            out = conv.convert_file_with_images(str(src), str(stage2))
            md_paths[f.name] = out

    for f in uploaded:
        self_name = f.stem + ".md"
        out = stage2 / self_name
        if not out.exists():
            out = Path(md_paths.get(f.name, ""))
        assert out.exists(), f"md mancante per {f.name}"

    # 4) indicizzazione su cartelle TMP (mirror: scan di base, originals escluso)
    store = SQLiteVectorStore(str(base / "vector_index"),
                              db_path=str(base / "studioia_e2e.db"),
                              store_key="e2e_g3")
    db = Database(db_path=str(base / "e2e_studioia.db"))
    embedder = DeterministicEmbedder()
    engine = LocalSearchEngine(db, store, embedder)
    engine.ensure_index_updated(str(base), ocr_enabled=True)
    n_chunks = store.count()

    # 5) la ricerca trova il contenuto del .md di test
    md_text = (stage2 / "appunti_g3_e2e.md").read_text(encoding="utf-8")
    marker = "tonoplasto"
    queries = [md_text, marker + " colloide osmotico vacuolo centrale"]
    found = False
    used_q = None
    for q in queries:
        res = engine.search(q, top_k=5)
        texts = [getattr(c, "text", "") or "" for c in res.chunks]
        if any(marker in t for t in texts):
            found = True
            used_q = q
            break
    store.close()

    result = {
        "status": "OK" if (n_chunks > 0 and found) else "KO",
        "base": str(base),
        "originals": sorted(p.name for p in originals.iterdir()),
        "stage2_md": sorted(p.name for p in stage2.glob("*.md")),
        "md_paths": {k: str(v) for k, v in md_paths.items()},
        "chunks": n_chunks,
        "search_hit": found,
        "query_usata": (used_q or "")[:200],
        "marker": marker,
        "ts": mr._now(),
    }
    return result


class TestE2EUploadTmp(unittest.TestCase):
    def test_e2e_upload_tmp_writes_qa(self):
        base = _PROJECT_ROOT / "tmp" / "g3_e2e"
        result = run_e2e_upload(base)
        # assert del compito 3.4
        self.assertEqual(len(result["originals"]), 3, result)
        self.assertEqual(len(result["stage2_md"]), 3, result)
        self.assertGreater(result["chunks"], 0, result)
        self.assertTrue(result["search_hit"], result)
        self.assertEqual(result["status"], "OK", result)
        # esiti -> qa/g3_e2e.json
        out = _PROJECT_ROOT / "qa" / "g3_e2e.json"
        mr._write_json(out, result)
        self.assertTrue(out.exists())
        print(f"\n[G3][E2E] originals={result['originals']} "
              f"md={result['stage2_md']} chunks={result['chunks']} "
              f"search_hit={result['search_hit']} -> {out}")


if __name__ == "__main__":
    unittest.main(verbosity=2)

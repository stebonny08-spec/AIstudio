"""
core/rag/vector_store_sqlite.py
--------------------------------
Backend H1: indice vettoriale ibrido su SQLite puro.

  - Testo  → FTS5 (tabella esterna chunks_fts su `chunks`, sync con trigger
              definiti in data/schema.sql).
  - Vettori→ sqlite-vec (tabella vec0, distanza cosine) caricato come
              estensione sulla connessione.
              FALLBACK DICHIARATO: se l'estensione non e' importabile/
              caricabile, si passa automaticamente al backend "numpy-blob"
              (stessa interfaccia: tabelle vecnb_*, BLOB float32 + prodotto
              scalare in numpy), cosi' l'interfaccia pubblica non cambia.
  - Fusion → query(..., hybrid=True) usa RRF esatto:
              score = Σ 1/(60 + rank) sui rank di FTS5 e vettoriale.

Colonne di `chunks` (schema in data/schema.sql, applicato da data/db.py):
    id TEXT PK | doc_id | parent_id | source_file | store_key | testo |
    meta (JSON) | dim
`store_key` distingue i due store (note vs libri) nello stesso file DB.

Compatibilita' con il vecchio backend Chroma (stessa interfaccia pubblica
usata da api.py/indexer/local_search):
    add_chunks(chunks, embeddings), query(query_embedding, top_k),
    delete_by_source_file(source_file), count(), reset(),
    query(..., text=..., hybrid=True) opzionale, fts_query(), close().

La similarita' e' 1 - distanza_cosine, esattamente come in Chroma
(distanza cosine = 1 - cos), cosi' le soglie di LocalSearchEngine
(0.45 / 0.35) continuano a significare la stessa cosa.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import struct
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.rag.chunker import Chunk
from core.rag.contract import EMBEDDER_ID

_MODEL_VERSION_FILE = "embedding_model.txt"

# Costante RRF (norma Cormack et al.: k=60). Condivisa con H8/local_search.
RRF_K = 60

# Similarita' provvisoria assegnata ai soli match FTS (senza vettore) nei
# risultati ibridi: cade nella fascia "borderline" (>=0.35, <0.45) quindi
# entra nei MAX_WEAK_CHUNKS senza mai superare la soglia forte. Valore
# PROVVISORIO: la semantica finale della fusion la definisce H8.
PROVISIONAL_FTS_SIMILARITY = 0.40

_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "data" / "schema.sql"


# ======================================================================
# RRF
# ======================================================================
def rrf_fuse(lists: List[List[dict]], k: int = RRF_K) -> List[dict]:
    """Reciprocal Rank Fusion su N liste ordinate per rank.

    score(id) = Σ 1/(k + rank_i) su tutte le liste in cui l'elemento
    appare (rank parte da 1). Le righe fuse tengono la similarita'
    vettoriale se disponibile in qualunque lista, altrimenti il valore
    provvisorio FTS. Chiave di identita': (source_file, text) — la stessa
    usata da LocalSearchEngine per il confronto tra lista query/topic.
    """
    scores: Dict[Any, float] = {}
    best_row: Dict[Any, dict] = {}
    for lst in lists:
        for rank, row in enumerate(lst, start=1):
            key = (row.get("source_file", ""), row.get("text", ""))
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
            prev = best_row.get(key)
            if prev is None:
                best_row[key] = dict(row)
                continue
            # In conflitto prevale la riga "vettoriale" (ha la vera
            # similarita'): la riconosciamo dal fatto che ha superato il
            # calcolo di similarita' reale (chiave presente con valore
            # numerico non provvisorio) — qui è piu' semplice: tiene la
            # similarita' massima tra le due, cosi' un match FTS+vettore
            # non perde il suo scoring.
            prev_sim = float(prev.get("similarity") or 0.0)
            new_sim = float(row.get("similarity") or 0.0)
            if new_sim > prev_sim:
                prev.update(row)
    out = []
    for key, score in scores.items():
        row = dict(best_row[key])
        row["rrf_score"] = score
        out.append(row)
    out.sort(key=lambda r: r.get("rrf_score", 0.0), reverse=True)
    return out


def content_hash(text: str) -> str:
    """R18 B4 - hash SHA1 del contenuto NORMALIZZATO di un chunk
    (minuscolo, spazi compattati): unita' di dedup per documento."""
    import hashlib
    import re as _re
    norm = _re.sub(r"\s+", " ", str(text or "").strip().lower())
    return hashlib.sha1(norm.encode("utf-8", "ignore")).hexdigest()


def _fts_match_expr(text: str, operator: str = "OR") -> str:
    """Trasforma il testo libero in un'esprssione MATCH FTS5 sicura.

    Token letterali/numerici racchiusi tra virgolette (niente sintassi
    FTS iniettabile), uniti con OR per massimizzare il ricall: l'ordinamento
    arriva poi da bm25, che favorisce i documenti che contengono piu' termini.
    """
    tokens = re.findall(r"\w+", text or "", flags=re.UNICODE)
    tokens = [t for t in tokens if t][:32]
    if not tokens:
        return ""
    quoted = " ".join(f'"{t}"' for t in tokens)
    return f" {operator} ".join(f'"{t}"' for t in tokens) if operator != " " else quoted


def _default_reindex_embedder():
    """Embedder di default per il reindex low-prio (lazy import: nessuna
    dipendenza pesante a livello di modulo)."""
    from core.rag.embedder import Embedder
    return Embedder()


# ======================================================================
# STORE
# ======================================================================
class SQLiteVectorStore:
    """Indice RAG su SQLite (FTS5 + sqlite-vec | numpy-blob).

    Costruttore backward-compatible con il vecchio VectorStore:
        SQLiteVectorStore(persist_dir, embedding_model_name=None)
    Estensioni (usate solo dai test/factory, mai da api.py):
        db_path   → file SQLite da usare (default: %APPDATA%/studioia.db)
        store_key → chiave del sotto-indice dentro il DB
                    (default: nome di persist_dir: vector_index | vector_index_books)
        force_numpy → forza il backend numpy-blob (test del fallback)
    """

    BACKEND_NAME = "sqlite"

    def __init__(
        self,
        persist_dir: str,
        embedding_model_name: Optional[str] = None,
        *,
        db_path: Optional[str] = None,
        store_key: Optional[str] = None,
        force_numpy: bool = False,
    ):
        self.persist_dir = Path(persist_dir)
        self.persist_dir.mkdir(parents=True, exist_ok=True)

        if db_path is None:
            from data.config_manager import get_app_data_dir
            db_path = str(get_app_data_dir() / "studioia.db")
        self.db_path = Path(db_path)
        if self.db_path.parent and not self.db_path.parent.exists():
            self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self.store_key = (store_key or self.persist_dir.name or "default").strip() or "default"
        safe = re.sub(r"[^0-9A-Za-z]+", "_", self.store_key)
        self._vec_table = f"vec_{safe}"
        self._nb_table = f"vecnb_{safe}"

        if embedding_model_name is None:
            from core.rag.embedder import _MODEL_NAME
            embedding_model_name = _MODEL_NAME
        self._check_and_reset_on_model_change(embedding_model_name)

        self._lock = threading.RLock()
        # I1 — stato reindex LOW-PRIO (thread "r15-reindex", idempotente):
        # il lock e' mantenuto per tutta la durata del worker → una seconda
        # chiamata a ensure_embedder_consistent durante un reindex in corso
        # ritorna "reindexing" senza avviare un duplicato.
        self._reindex_state_lock = threading.Lock()
        self._reindex_thread: Optional[threading.Thread] = None
        self._reindex_embedder_factory = None  # hook di test: callable -> embedder
        self._conn = sqlite3.connect(str(self.db_path), timeout=15.0, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")

        # --- Caricamento estensione sqlite-vec (fallback numpy-blob) ---
        self._vec_backend = "numpy-blob"
        self._sqlite_vec = None
        self._np = None
        self._nb_matrix = None  # cache matrice (rowid, float32) per numpy-blob
        if not force_numpy:
            try:
                import sqlite_vec  # noqa: F401
                self._conn.enable_load_extension(True)
                sqlite_vec.load(self._conn)
                self._conn.enable_load_extension(False)
                self._sqlite_vec = sqlite_vec
                self._vec_backend = "sqlite-vec"
            except Exception as exc:
                try:
                    self._conn.enable_load_extension(False)
                except Exception:
                    pass
                print(
                    f"[SQLiteVectorStore] sqlite-vec non disponibile "
                    f"({exc}); attivo il fallback numpy-blob dichiarato."
                )

        self._ensure_schema()
        self._nb_epoch = 0  # invalidazione cache matrice numpy
        if getattr(self, "_pending_reset", False):
            # Cambio di modello rilevato nel costruttore: svuota subito
            # (stesso comportamento del vecchio backend, che puliva la dir).
            self.reset()
            self._pending_reset = False

    # ------------------------------------------------------------------
    # SETUP
    # ------------------------------------------------------------------
    def _ensure_schema(self) -> None:
        """Applica data/schema.sql (CREATE IF NOT EXISTS, idempotente)."""
        with self._lock:
            with open(_SCHEMA_PATH, "r", encoding="utf-8") as f:
                self._conn.executescript(f.read())
            # I1 — kv metadati INDICE per store_key (chiavi: "embedding_model_id",
            # "updated"): la persistenza dell'id embedder vive nel DB, non piu'
            # solo nel file legacy embedding_model.txt (f0: ABSENTE nei metadati).
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS index_meta ("
                "store_key TEXT NOT NULL, "
                "key TEXT NOT NULL, "
                "value TEXT NOT NULL DEFAULT '', "
                "updated TEXT NOT NULL DEFAULT '', "
                "PRIMARY KEY (store_key, key))"
            )
            # ---- R18 B4: vincolo di unicita' hash(contenuto) per doc ---
            try:
                self._conn.execute(
                    "ALTER TABLE chunks ADD COLUMN content_hash TEXT")
            except sqlite3.OperationalError:
                pass  # colonna gia' presente
            try:
                rows = self._conn.execute(
                    "SELECT rowid, testo FROM chunks "
                    "WHERE content_hash IS NULL"
                ).fetchall()
                for rid, txt in rows:
                    self._conn.execute(
                        "UPDATE chunks SET content_hash = ? WHERE rowid = ?",
                        (content_hash(txt), rid))
                # sweep one-shot idempotente: stessa chiave (store, doc,
                # hash) -> si tiene la riga piu' vecchia, le altre (e i
                # loro vettori) sono rimosse senza perdere chunk unici
                dup_groups = self._conn.execute(
                    "SELECT store_key, source_file, content_hash, MIN(rowid) "
                    "FROM chunks WHERE content_hash IS NOT NULL "
                    "GROUP BY store_key, source_file, content_hash "
                    "HAVING COUNT(*) > 1"
                ).fetchall()
                removed = 0
                for sk, sf, ch, keep_rid in dup_groups:
                    orphans = self._conn.execute(
                        "SELECT rowid FROM chunks WHERE store_key = ? AND "
                        "source_file = ? AND content_hash = ? AND rowid <> ?",
                        (sk, sf, ch, keep_rid)).fetchall()
                    for (rid,) in orphans:
                        # solo tabelle vettoriali QUI: le DELETE su chunks
                        # sincronizzano FTS via trigger (chunks_ad)
                        try:
                            if self._vec_backend == "sqlite-vec":
                                self._conn.execute(
                                    f"DELETE FROM {self._vec_table} "
                                    "WHERE rowid = ?", (rid,))
                            else:
                                self._conn.execute(
                                    f"DELETE FROM {self._nb_table} "
                                    "WHERE rowid = ?", (rid,))
                        except sqlite3.Error:
                            pass
                        self._conn.execute(
                            "DELETE FROM chunks WHERE rowid = ?", (rid,))
                        removed += 1
                self._conn.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ux_chunks_hash_doc "
                    "ON chunks(store_key, source_file, content_hash)")
                self._conn.commit()
                if removed:
                    print(f"[SQLiteVectorStore] R18 B4: {removed} chunk "
                          "duplicati rimossi (dedup hash per documento)")
                    self._nb_epoch = getattr(self, "_nb_epoch", 0) + 1
            except sqlite3.Error as exc:
                print(f"[SQLiteVectorStore] R18 B4 sweep non disponibile: "
                      f"{exc}")
                try:
                    self._conn.rollback()
                except sqlite3.Error:
                    pass

    def _check_and_reset_on_model_change(self, embedding_model_name: str) -> None:
        version_file = self.persist_dir / _MODEL_VERSION_FILE
        previous = None
        if version_file.exists():
            try:
                previous = version_file.read_text(encoding="utf-8").strip()
            except OSError:
                previous = None
        if previous is not None and previous != embedding_model_name:
            # Modello cambiato → i vettori esistenti sono incompatibili:
            # si ricreera' l'indice al primo caricamento (svuotato qui sotto).
            print(
                f"[SQLiteVectorStore] Modello di embedding cambiato "
                f"({previous!r} -> {embedding_model_name!r}). Svuoto l'indice "
                f"per store_key={self.store_key!r}."
            )
            # Connessione non ancora aperta: marcare per il reset differito.
            self._pending_reset = True
        else:
            self._pending_reset = False
        try:
            version_file.write_text(embedding_model_name, encoding="utf-8")
        except OSError:
            pass

    def _ensure_vec_table(self, dim: int) -> None:
        """Crea/valida la tabella vettoriale per `dim` (per store_key)."""
        with self._lock:
            if getattr(self, "_pending_reset", False):
                self.reset()
                self._pending_reset = False
            if self._vec_backend == "sqlite-vec":
                row = self._conn.execute(
                    "SELECT sql FROM sqlite_master WHERE name = ?", (self._vec_table,)
                ).fetchone()
                if row is None or row[0] is None:
                    self._conn.execute(
                        f"CREATE VIRTUAL TABLE IF NOT EXISTS {self._vec_table} "
                        f"USING vec0(embedding float[{dim}] distance_metric=cosine)"
                    )
                else:
                    m = re.search(r"float\[(\d+)\]", row[0])
                    if m and int(m.group(1)) != dim:
                        # Stessa logica del cambio modello: vettori incompatibili.
                        print(
                            f"[SQLiteVectorStore] Dim vettori cambiata "
                            f"({m.group(1)} -> {dim}). Ricreo l'indice."
                        )
                        self.reset()
                        self._conn.execute(
                            f"CREATE VIRTUAL TABLE {self._vec_table} "
                            f"USING vec0(embedding float[{dim}] distance_metric=cosine)"
                        )
            else:
                if getattr(self, "_nb_dim", None) not in (None, dim):
                    self.reset()
                self._nb_dim = dim
                self._conn.execute(
                    f"CREATE TABLE IF NOT EXISTS {self._nb_table} ("
                    f"rowid INTEGER PRIMARY KEY, embedding BLOB NOT NULL)"
                )
            self._conn.commit()

    # ------------------------------------------------------------------
    # I1 — META INDICE (per store_key) + COERENZA EMBEDDER (contratto R15b)
    # ------------------------------------------------------------------
    def get_index_meta(self, key: str) -> Optional[str]:
        """Legge un valore dalla kv `index_meta` di QUESTO store_key."""
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM index_meta WHERE store_key = ? AND key = ?",
                (self.store_key, str(key)),
            ).fetchone()
        return row[0] if row is not None else None

    def set_index_meta(self, key: str, value) -> None:
        """Scrive/aggiorna un valore nella kv `index_meta` di QUESTO store_key."""
        with self._lock:
            self._conn.execute(
                "INSERT INTO index_meta (store_key, key, value, updated) "
                "VALUES (?, ?, ?, ?) "
                "ON CONFLICT(store_key, key) DO UPDATE SET "
                "value = excluded.value, updated = excluded.updated",
                (
                    self.store_key,
                    str(key),
                    "" if value is None else str(value),
                    datetime.now().isoformat(),
                ),
            )
            self._conn.commit()

    def ensure_embedder_consistent(self, embedder_id: str) -> str:
        """Contratto R15b/I: "ok" | "reindexing" — MAI bloccante.

        - meta assente → bootstrap: file legacy embedding_model.txt se
          presente, altrimenti EMBEDDER_ID contract (dichiarato per gli
          indici preesistenti); per un indice vuoto direttamente l'id
          runtime. Il valore bootstrap viene scritto in DB e poi confrontato;
        - meta == id runtime → "ok";
        - meta != id runtime → avvia il reindex LOW-PRIO in background
          (thread daemon "r15-reindex", priorita' minima) → "reindexing".
          Idempotente: se un reindex e' gia' in corso non ne avvia un altro.
        """
        target = (str(embedder_id) if embedder_id is not None else "").strip()
        if not target:
            target = EMBEDDER_ID
        stored = self.get_index_meta("embedding_model_id")
        if stored is None:
            legacy = None
            try:
                vf = self.persist_dir / _MODEL_VERSION_FILE
                if vf.exists():
                    legacy = vf.read_text(encoding="utf-8").strip() or None
            except OSError:
                legacy = None
            if self.count() == 0:
                stored = target                      # niente vettori da invalidare
            else:
                stored = legacy or EMBEDDER_ID       # indice preesistente dichiarato
            self.set_index_meta("embedding_model_id", stored)
            self.set_index_meta("updated", datetime.now().isoformat())
            print(
                f"[r15-index][{self.store_key}] index_meta bootstrap: "
                f"embedding_model_id={stored!r} (runtime={target!r})",
                flush=True,
            )
        if stored == target:
            return "ok"
        self._start_lowprio_reindex(target)
        return "reindexing"

    def _start_lowprio_reindex(self, embedder_id: str) -> bool:
        """Avvia (una sola volta) il thread di reindex a bassa priorita'.

        Ritorna False se un reindex e' gia' in corso (nessun duplicato).
        """
        try:
            if not self._reindex_state_lock.acquire(blocking=False):
                return False  # gia' in corso
            t = threading.Thread(
                target=self._reindex_worker,
                args=(embedder_id,),
                name="r15-reindex",
                daemon=True,
            )
            self._reindex_thread = t
            t.start()
            return True
        except Exception as exc:
            try:
                self._reindex_state_lock.release()
            except Exception:
                pass
            print(f"[r15-reindex][{self.store_key}] START fallito: {exc}", flush=True)
            return False

    @staticmethod
    def _lower_thread_priority() -> None:
        """Best-effort: priorita' minima per il thread di reindex."""
        try:
            if os.name == "nt":
                import ctypes
                native_id = getattr(threading.current_thread(), "native_id", None)
                if native_id:
                    k32 = ctypes.windll.kernel32
                    handle = k32.OpenThread(0x0020, False, native_id)  # SET_INFORMATION
                    if handle:
                        k32.SetThreadPriority(handle, -1)  # BELOW_NORMAL
                        k32.CloseHandle(handle)
            else:
                os.nice(10)
        except Exception:
            pass

    def _reindex_worker(self, embedder_id: str) -> None:
        """Reindex LOW-PRIO (thread "r15-reindex"): re-embedding di TUTTI i
        chunk di QUESTO store_key con l'embedder runtime, poi meta indice
        allineata. I chunk (e l'FTS) NON vengono toccati: si rigenerano solo
        i vettori. Logga start/fine/durata; in caso di FAIL la meta resta
        invariata → la prossima chiamata a ensure rilancia il reindex.
        """
        t0 = time.time()
        n = 0
        dim = 0
        print(f"[r15-reindex][{self.store_key}] START target={embedder_id}", flush=True)
        try:
            self._lower_thread_priority()
            with self._lock:
                rows = self._conn.execute(
                    "SELECT rowid, testo FROM chunks "
                    "WHERE store_key = ? ORDER BY rowid",
                    (self.store_key,),
                ).fetchall()
            n = len(rows)
            vectors: List[List[float]] = []
            if rows:
                factory = getattr(self, "_reindex_embedder_factory", None)
                emb_obj = factory() if callable(factory) else _default_reindex_embedder()
                actual = getattr(emb_obj, "model_id", None)
                if actual and str(actual) != str(embedder_id):
                    print(
                        f"[r15-reindex][{self.store_key}] ATTENZIONE: embedder "
                        f"disponibile model_id={actual!r} != target={embedder_id!r} "
                        f"(proseguo best-effort)",
                        flush=True,
                    )
                texts = [r[1] for r in rows]
                for i in range(0, len(texts), 32):
                    vectors.extend(emb_obj.embed(texts[i:i + 32], kind="passage"))
                if len(vectors) != len(rows):
                    raise RuntimeError(
                        f"embedder ha prodotto {len(vectors)} vettori "
                        f"per {len(rows)} chunk"
                    )
            dim = len(vectors[0]) if vectors else 0
            with self._lock:
                if rows and dim:
                    if self._conn.in_transaction:
                        self._conn.commit()
                    self._conn.execute("BEGIN")
                    # ricostruzione completa dei vettori di QUESTO store
                    # (le tabelle vec sono per store_key → nessun impatto
                    # sull'altro store; i chunk e l'FTS restano intatti)
                    self._conn.execute(f"DROP TABLE IF EXISTS {self._vec_table}")
                    self._conn.execute(f"DROP TABLE IF EXISTS {self._nb_table}")
                    if self._vec_backend == "sqlite-vec":
                        self._nb_dim = None
                        self._conn.execute(
                            f"CREATE VIRTUAL TABLE {self._vec_table} "
                            f"USING vec0(embedding float[{dim}] distance_metric=cosine)"
                        )
                        self._conn.executemany(
                            f"INSERT INTO {self._vec_table} (rowid, embedding) VALUES (?, ?)",
                            [
                                (rid, self._sqlite_vec.serialize_float32(vec))
                                for rid, vec in zip([r[0] for r in rows], vectors)
                            ],
                        )
                    else:
                        self._nb_dim = dim
                        self._conn.execute(
                            f"CREATE TABLE {self._nb_table} ("
                            f"rowid INTEGER PRIMARY KEY, embedding BLOB NOT NULL)"
                        )
                        self._conn.executemany(
                            f"INSERT INTO {self._nb_table} (rowid, embedding) VALUES (?, ?)",
                            [
                                (rid, struct.pack(f"<{dim}f", *[float(x) for x in vec]))
                                for rid, vec in zip([r[0] for r in rows], vectors)
                            ],
                        )
                # meta indice allineata (stessa transazione: atomico coi vettori)
                now_iso = datetime.now().isoformat()
                for mk, mv in (("embedding_model_id", str(embedder_id)), ("updated", now_iso)):
                    self._conn.execute(
                        "INSERT INTO index_meta (store_key, key, value, updated) "
                        "VALUES (?, ?, ?, ?) "
                        "ON CONFLICT(store_key, key) DO UPDATE SET "
                        "value = excluded.value, updated = excluded.updated",
                        (self.store_key, mk, mv, now_iso),
                    )
                self._conn.commit()
                self._nb_epoch += 1
            print(
                f"[r15-reindex][{self.store_key}] DONE "
                f"ms={int((time.time() - t0) * 1000)} chunks={n} dim={dim} "
                f"-> embedding_model_id={embedder_id!r}",
                flush=True,
            )
        except Exception as exc:
            print(
                f"[r15-reindex][{self.store_key}] FAIL dopo "
                f"{int((time.time() - t0) * 1000)}ms: {type(exc).__name__}: {exc}",
                flush=True,
            )
        finally:
            try:
                self._reindex_state_lock.release()
            except Exception:
                pass

    def _sync_batch_embedder(self, embedder_id: str) -> None:
        """I1 — sync meta indice DOPO il commit di add_chunks (mai dentro BEGIN).

        Bootstrap dell'"embedding_model_id" solo se assente (una divergenza
        NON viene sovrascritta qui: deve restare visibile a
        ensure_embedder_consistent per innescare il reindex) + bump della
        chiave "updated" dell'ultimo batch scritto.
        """
        try:
            if self.get_index_meta("embedding_model_id") is None:
                self.set_index_meta("embedding_model_id", embedder_id)
            self.set_index_meta("updated", datetime.now().isoformat())
        except sqlite3.Error as exc:
            print(f"[SQLiteVectorStore] sync index_meta fallita: {exc}")

    # ------------------------------------------------------------------
    # I2 — bookkeeping file (usato da Indexer.index_folder / coverage_audit)
    # ------------------------------------------------------------------
    def count_by_source_file(self, source_file: str) -> int:
        """Chunk presenti per sorgente (scoped sullo store)."""
        with self._lock:
            try:
                row = self._conn.execute(
                    "SELECT COUNT(*) FROM chunks "
                    "WHERE store_key = ? AND source_file = ?",
                    (self.store_key, source_file),
                ).fetchone()
                return int(row[0]) if row else 0
            except sqlite3.Error:
                return 0

    def get_source_file_signature(self, source_file: str) -> Optional[Dict[str, Any]]:
        """Firma del file (file_size/file_mtime/file_hash) registrata nei meta
        del primo chunk della sorgente (scritta da Indexer a ogni indicizzazione)."""
        if not source_file:
            return None
        with self._lock:
            try:
                row = self._conn.execute(
                    "SELECT meta FROM chunks "
                    "WHERE store_key = ? AND source_file = ? LIMIT 1",
                    (self.store_key, source_file),
                ).fetchone()
            except sqlite3.Error:
                return None
        if row is None or not row[0]:
            return None
        try:
            meta = json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return None
        if not isinstance(meta, dict):
            return None
        sig = {k: meta[k] for k in ("file_size", "file_mtime", "file_hash") if k in meta}
        return sig or None

    # ------------------------------------------------------------------
    # SCRITTURA
    # ------------------------------------------------------------------
    def add_chunks(
        self,
        chunks: List[Chunk],
        embeddings: List[List[float]],
        embedder_id: Optional[str] = None,
    ) -> None:
        if not chunks:
            return
        if len(chunks) != len(embeddings):
            raise ValueError("chunks ed embeddings hanno lunghezza diversa")
        dim = len(embeddings[0]) if embeddings else 0
        if dim:
            self._ensure_vec_table(dim)

        with self._lock:
            skipped_hash = 0
            try:
                self._conn.execute("BEGIN")
                for chunk, emb in zip(chunks, embeddings):
                    self._delete_one_rowid(chunk.id)
                    # R18 B4: unicità su hash(contenuto) PER DOCUMENTO -
                    # un reindex (anche da path diverso) non duplica mai
                    _ch = content_hash(chunk.text)
                    if self._conn.execute(
                            "SELECT 1 FROM chunks WHERE store_key = ? AND "
                            "source_file = ? AND content_hash = ? "
                            "AND id <> ? LIMIT 1",
                            (self.store_key, chunk.source_file, _ch,
                             chunk.id)).fetchone():
                        skipped_hash += 1
                        continue
                    # I1: meta del chunk (W, opzionale/assente → {}) FONDATO
                    # con le chiavi gestite dallo store: le chiavi gia'
                    # presenti nel meta del chunk (stage, url, ...) si
                    # conservano, quelle standard dello store prevalgono.
                    meta = dict(getattr(chunk, "meta", None) or {})
                    meta.update(
                        {
                            "source_file": chunk.source_file,
                            "location_hint": chunk.location_hint,
                            "is_image": chunk.is_image,
                            "image_path": chunk.image_path,
                            "mime_type": chunk.mime_type,
                        }
                    )
                    if embedder_id:
                        # id dell'embedder usato per QUESTO batch (per-chunk)
                        meta["emb_id"] = str(embedder_id)
                    self._conn.execute(
                        "INSERT INTO chunks (id, doc_id, parent_id, "
                        "source_file, store_key, testo, meta, dim, "
                        "content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            chunk.id,
                            chunk.source_file,
                            None,
                            chunk.source_file,
                            self.store_key,
                            chunk.text,
                            json.dumps(meta, ensure_ascii=False),
                            dim,
                            _ch,
                        ),
                    )
                    rowid = self._conn.execute(
                        "SELECT rowid FROM chunks WHERE id = ?", (chunk.id,)
                    ).fetchone()[0]
                    if self._vec_backend == "sqlite-vec":
                        self._conn.execute(
                            f"INSERT INTO {self._vec_table} (rowid, embedding) VALUES (?, ?)",
                            (rowid, self._sqlite_vec.serialize_float32(emb)),
                        )
                    else:
                        blob = struct.pack(f"<{dim}f", *[float(x) for x in emb])
                        self._conn.execute(
                            f"INSERT INTO {self._nb_table} (rowid, embedding) VALUES (?, ?)",
                            (rowid, blob),
                        )
                self._bump_versions(sorted({c.source_file for c in chunks}))
                self._conn.commit()
                self._nb_epoch += 1
            except Exception:
                self._conn.rollback()
                raise
        if skipped_hash:
            print(f"[SQLiteVectorStore] R18 B4: {skipped_hash} chunk "
                  "saltati (hash gia' presente per il documento)")
        if embedder_id:
            # I1: sync index_meta DOPO il commit (mai dentro BEGIN):
            # bootstrap dell'id se assente + bump "updated" del batch.
            self._sync_batch_embedder(str(embedder_id))
        # P1b.2: corpus cambiato -> HNSW ricostruito alla prossima query
        self._usearch_invalidate()

    def _delete_one_rowid(self, chunk_id: str) -> None:
        """Rimuove il chunk (e il suo vettore) se esiste già (upsert)."""
        row = self._conn.execute(
            "SELECT rowid FROM chunks WHERE id = ?", (chunk_id,)
        ).fetchone()
        if row is None:
            return
        self._delete_vec(row[0])
        # La DELETE scatena il trigger FTS 'delete' su chunks_ad
        self._conn.execute("DELETE FROM chunks WHERE rowid = ?", (row[0],))

    def _delete_vec(self, rowid: int) -> None:
        try:
            if self._vec_backend == "sqlite-vec":
                self._conn.execute(f"DELETE FROM {self._vec_table} WHERE rowid = ?", (rowid,))
            else:
                self._conn.execute(f"DELETE FROM {self._nb_table} WHERE rowid = ?", (rowid,))
        except sqlite3.Error:
            pass  # tabella vettoriale ancora da creare

    def delete_by_source_file(self, source_file: str) -> None:
        with self._lock:
            try:
                self._conn.execute("BEGIN")
                rows = self._conn.execute(
                    "SELECT rowid FROM chunks WHERE store_key = ? AND source_file = ?",
                    (self.store_key, source_file),
                ).fetchall()
                for r in rows:
                    self._delete_vec(r[0])
                self._conn.execute(
                    "DELETE FROM chunks WHERE store_key = ? AND source_file = ?",
                    (self.store_key, source_file),
                )
                self._bump_versions([source_file])
                self._conn.commit()
                self._nb_epoch += 1
            except sqlite3.Error as exc:
                self._conn.rollback()
                print(f"[SQLiteVectorStore] delete_by_source_file fallita: {exc}")

    def reset(self) -> None:
        """Svuota completamente il sotto-indice di questo store."""
        with self._lock:
            try:
                self._conn.execute("BEGIN")
                rows = self._conn.execute(
                    "SELECT rowid FROM chunks WHERE store_key = ?", (self.store_key,)
                ).fetchall()
                for r in rows:
                    self._delete_vec(r[0])
                self._conn.execute(
                    "DELETE FROM chunks WHERE store_key = ?", (self.store_key,)
                )
                # elimina anche le tabelle vettoriali (ricreate al bisogno)
                self._conn.execute(f"DROP TABLE IF EXISTS {self._vec_table}")
                self._conn.execute(f"DROP TABLE IF EXISTS {self._nb_table}")
                self._conn.commit()
                self._nb_dim = None
                self._nb_epoch += 1
            except sqlite3.Error:
                self._conn.rollback()
                raise
        # P1b.2
        self._usearch_invalidate()

    def _bump_versions(self, doc_ids) -> None:
        now = datetime.now().isoformat()
        for doc_id in doc_ids:
            self._conn.execute(
                "INSERT INTO doc_versions (store_key, doc_id, version, ts) "
                "VALUES (?, ?, 1, ?) "
                "ON CONFLICT(store_key, doc_id) DO UPDATE SET "
                "version = version + 1, ts = excluded.ts",
                (self.store_key, doc_id, now),
            )

    def get_doc_version(self, doc_id: str) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT version FROM doc_versions WHERE doc_id = ? AND store_key = ?",
                (doc_id, self.store_key),
            ).fetchone()
            return int(row[0]) if row else 0

    def get_context_prefix(self, doc_id: str) -> Optional[str]:
        """H8 (2) — prefisso contestuale W1 per doc_id, senza LLM.

        Lookup deterministico:
          1. meta JSON di un chunk del documento (chiavi `context_prefix`
             o `prefix`), dove l'indicizzatore può averlo registrato;
          2. colonne `context_prefix`/`prefix` su tabelle dichiarate
             doc_versions / doc_meta, se esistono nello schema;
          3. assente in entrambi → None (nessuna eccezione al caller).
        """
        if not doc_id:
            return None
        with self._lock:
            # 1) meta del chunk
            try:
                row = self._conn.execute(
                    "SELECT meta FROM chunks "
                    "WHERE store_key = ? AND doc_id = ? LIMIT 1",
                    (self.store_key, doc_id),
                ).fetchone()
            except sqlite3.Error:
                row = None
            if row is not None and row[0]:
                try:
                    meta = json.loads(row[0])
                except (json.JSONDecodeError, TypeError):
                    meta = {}
                if isinstance(meta, dict):
                    for key in ("context_prefix", "prefix"):
                        value = meta.get(key)
                        if isinstance(value, str) and value.strip():
                            return value.strip()
            # 2) tabelle dichiarate (se presenti nello schema)
            for sql in (
                "SELECT context_prefix FROM doc_versions WHERE doc_id = ? LIMIT 1",
                "SELECT prefix FROM doc_versions WHERE doc_id = ? LIMIT 1",
                "SELECT context_prefix FROM doc_meta WHERE doc_id = ? LIMIT 1",
                "SELECT prefix FROM doc_meta WHERE doc_id = ? LIMIT 1",
            ):
                try:
                    row2 = self._conn.execute(sql, (doc_id,)).fetchone()
                except sqlite3.Error:
                    row2 = None  # tabella/colonna assente: si prova la prossima
                if row2 is not None and isinstance(row2[0], str) and row2[0].strip():
                    return row2[0].strip()
        return None

    # ------------------------------------------------------------------
    # LETTURA
    # ------------------------------------------------------------------
    def count(self) -> int:
        with self._lock:
            try:
                row = self._conn.execute(
                    "SELECT COUNT(*) FROM chunks WHERE store_key = ?",
                    (self.store_key,),
                ).fetchone()
                return int(row[0]) if row else 0
            except sqlite3.Error:
                return 0

    @staticmethod
    def _dedup_hash_rows(rows) -> list:
        """R18 B4.5: top-k MAI con due entry dello stesso hash di
        contenuto (mantenuta la prima comparsa in ranking)."""
        seen = set()
        out = []
        for r in rows or []:
            h = content_hash((r or {}).get("text") or "")
            if h in seen:
                continue
            seen.add(h)
            out.append(r)
        return out

    def _row_to_result(self, row: sqlite3.Row, similarity: float) -> dict:
        try:
            meta = json.loads(row["meta"] or "{}")
        except (json.JSONDecodeError, TypeError):
            meta = {}
        return {
            "text": row["testo"],
            "source_file": row["source_file"] or meta.get("source_file", ""),
            "location_hint": meta.get("location_hint", ""),
            "similarity": similarity,
            "is_image": meta.get("is_image", False),
            "image_path": meta.get("image_path", ""),
            "mime_type": meta.get("mime_type", ""),
        }

    # ------------------------------------------------------------------
    # P1b.2 - layer HNSW caldo (usearch) accanto a sqlite-vec
    # ------------------------------------------------------------------
    def _usearch_layer_get(self):
        """Singleton layer HNSW per questo store (lazy, uno per istanza)."""
        layer = getattr(self, "_usearch_layer", None)
        if layer is None:
            from core.rag.usearch_layer import UsearchLayer
            layer = UsearchLayer(self.persist_dir, self.store_key)
            self._usearch_layer = layer
        return layer

    def _usearch_invalidate(self) -> None:
        """sqlite e' cambiato (add/delete/reset) -> prossimo ensure rebuild."""
        layer = getattr(self, "_usearch_layer", None)
        if layer is not None:
            layer.invalidate()

    def _usearch_search(self, query_embedding: List[float], k: int):
        """Top-k dal layer HNSW. [(rowid, dist)] oppure None -> il caller
        cade su sqlite-vec (stessa semantica: distanza = 1 - cos)."""
        from core.rag.usearch_layer import usearch_enabled
        if not usearch_enabled():
            return None
        layer = self._usearch_layer_get()

        def _info():
            dim = 0
            try:
                row = self._conn.execute(
                    f"SELECT embedding FROM {self._vec_table} LIMIT 1"
                ).fetchone()
                if row and row[0]:
                    dim = len(bytes(row[0])) // 4
            except sqlite3.Error:
                pass
            cnt = self.count()
            emb = str(self.get_index_meta("embedding_model_id") or "") or EMBEDDER_ID
            return dim, cnt, emb

        def _build():
            with self._lock:
                try:
                    rows = self._conn.execute(
                        f"SELECT rowid, embedding FROM {self._vec_table}"
                    ).fetchall()
                except sqlite3.Error:
                    rows = []
                if not rows:
                    try:
                        rows = self._conn.execute(
                            f"SELECT rowid, embedding FROM {self._nb_table}"
                        ).fetchall()
                    except sqlite3.Error:
                        return None
            if not rows:
                return None
            import numpy as np
            ids = [r[0] for r in rows]
            mat = np.frombuffer(b"".join(bytes(r[1]) for r in rows),
                                dtype=np.float32)
            if not len(ids) or len(mat) % len(ids):
                return None
            dim = len(mat) // len(ids)
            if dim <= 0:
                return None
            return ids, mat.reshape(len(ids), dim)

        idx = layer.ensure(info=_info, build=_build)
        if idx is None:
            return None
        return layer.search(query_embedding, k)
    def _vec_query(self, query_embedding: List[float], k: int) -> List[dict]:
        """Top-k per similarita' cosine → righe col campo similarity."""
        if k <= 0:
            return []
        # P1b.2: se il layer caldo risponde, sqlite-vec non viene
        # interrogato per la parte vettoriale (fusion/hybrid identici).
        uh = self._usearch_search(query_embedding, k)
        if uh is not None:
            return self._rows_for_hits(uh) if uh else []
        if self._vec_backend == "sqlite-vec":
            try:
                blob = self._sqlite_vec.serialize_float32(query_embedding)
                hits = self._conn.execute(
                    f"SELECT rowid, distance FROM {self._vec_table} "
                    f"WHERE embedding MATCH ? AND k = ?",
                    (blob, k),
                ).fetchall()
            except sqlite3.Error:
                return []
        else:
            hits = self._numpy_topk(query_embedding, k)
        if not hits:
            return []
        return self._rows_for_hits(hits)

    def _numpy_topk(self, query_embedding: List[float], k: int) -> List[tuple]:
        """Fallback numpy-blob: coseno su matrice caricata in cache."""
        import numpy as np

        with self._lock:
            if self._nb_matrix is None or self._nb_matrix[0] != self._nb_epoch:
                rows = self._conn.execute(
                    f"SELECT rowid, embedding FROM {self._nb_table}"
                ).fetchall()
                if not rows:
                    self._nb_matrix = (self._nb_epoch, [], None)
                else:
                    ids = [r[0] for r in rows]
                    mat = np.frombuffer(
                        b"".join(r[1] for r in rows), dtype=np.float32
                    ).reshape(len(ids), -1)
                    self._nb_matrix = (self._nb_epoch, ids, mat)
            _epoch, ids, mat = self._nb_matrix
            if mat is None or not ids:
                return []
            q = np.asarray(query_embedding, dtype=np.float32)
            qn = q / (np.linalg.norm(q) or 1.0)
            mnorms = np.linalg.norm(mat, axis=1, keepdims=True)
            mnorms[mnorms == 0] = 1.0
            sims = (mat / mnorms) @ qn
            kk = min(k, len(ids))
            idx = np.argpartition(-sims, kk - 1)[:kk]
            idx = idx[np.argsort(-sims[idx])]
            return [(ids[i], float(1.0 - sims[i])) for i in idx]  # distanza = 1 - cos

    def _rows_for_hits(self, hits) -> List[dict]:
        out = []
        for rowid, dist in hits:
            row = self._conn.execute(
                "SELECT testo, source_file, meta FROM chunks "
                "WHERE rowid = ? AND store_key = ?",
                (rowid, self.store_key),
            ).fetchone()
            if row is None:
                continue
            out.append(self._row_to_result(row, 1.0 - float(dist)))
        return out

    def query(
        self,
        query_embedding: List[float],
        top_k: int = 5,
        *,
        text: Optional[str] = None,
        hybrid: bool = False,
        k_rrf: int = RRF_K,
    ) -> List[dict]:
        """Top-k per similarita' cosine (identico al vecchio backend).

        Con hybrid=True e text=valorizzato fonde i rank di vettore e FTS5
        con RRF (Σ 1/(k_rrf + rank)); senza hybrid il comportamento resta
        quello legacy (solo vettore), cosi' la parity Chroma↔SQLite e' un
        confronto apples-to-apples.
        """
        total = self.count()
        if total == 0:
            return []
        k = min(max(int(top_k), 1), total)
        vec_rows = self._vec_query(query_embedding, k)
        if not hybrid or not (text or "").strip():
            return self._dedup_hash_rows(vec_rows)[:top_k]
        fts_rows = self.fts_query(text, top_k=k)
        fused = rrf_fuse([vec_rows, fts_rows], k=k_rrf)
        return self._dedup_hash_rows(fused)[:top_k]

    def fts_query(self, text: str, top_k: int = 5) -> List[dict]:
        """Ranking FTS5 (bm25) limitato a top_k, scoped sullo store.

        Le righe senza vettore ricevono PROVISIONAL_FTS_SIMILARITY (vedi
        testa del file): entrano solo nella fascia "borderline" di
        LocalSearchEngine. La chiave 'bm25' resta disponibile per H8.
        """
        match = _fts_match_expr(text or "")
        if not match or top_k <= 0:
            return []
        with self._lock:
            try:
                rows = self._conn.execute(
                    "SELECT chunks.rowid AS rid, chunks.testo, chunks.source_file, "
                    "chunks.meta, bm25(chunks_fts) AS score "
                    "FROM chunks_fts "
                    "JOIN chunks ON chunks.rowid = chunks_fts.rowid "
                    "WHERE chunks_fts MATCH ? AND chunks.store_key = ? "
                    "ORDER BY score LIMIT ?",
                    (match, self.store_key, int(top_k)),
                ).fetchall()
            except sqlite3.Error as exc:
                print(f"[SQLiteVectorStore] fts_query fallita: {exc}")
                return []
        out = []
        for row in rows:
            item = self._row_to_result(row, PROVISIONAL_FTS_SIMILARITY)
            item["bm25"] = float(row["score"])
            out.append(item)
        return self._dedup_hash_rows(out)

    def hybrid_search(
        self,
        text: str,
        query_embedding: List[float],
        top_k: int = 5,
        k_rrf: int = RRF_K,
    ) -> List[dict]:
        """Fusione diretta FTS5 + vettore (RRF) — interfaccia per H8."""
        return self.query(query_embedding, top_k=top_k, text=text, hybrid=True, k_rrf=k_rrf)

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except sqlite3.Error:
                pass


# ======================================================================
# MIGRAZIONE Chroma → SQLite (riuso dei vettori, nessun re-embedding)
# ======================================================================
def migrate_chroma_to_sqlite(src_chroma_dir, dst_db, store_key: str = "vector_index") -> dict:
    """Copia i chunk (e gli embedding già calcolati) dal vecchio indice
    Chroma in SQLite. Idempotente: per ogni id già presente si fa upsert
    (delete + insert), nessun re-embedding.

    src_chroma_dir : cartella del vecchio PersistentClient Chroma.
    dst_db         : istanza SQLiteVectorStore oppure path del file SQLite
                     (in quel caso lo store viene costruito qui sullo stesso
                     src come persist_dir).

    Ritorna {"ok": bool, "migrated": int, "skipped": int, "total": int, ...}.
    Se chromadb non e' importabile → {"ok": False, "error": "..."} con
    alternativa dichiarata: "reindex da file" (l'indicizzatore rilegge i
    file e ricalcola gli embedding).
    """
    try:
        import chromadb
    except Exception as exc:
        return {
            "ok": False,
            "error": f"chromadb non importabile ({exc})",
            "alternative": "reindex da file (index_folder ricalcola embedding)",
        }

    src = Path(src_chroma_dir)
    if not (src / "chroma.sqlite3").exists() and not any(src.glob("*.sqlite3")):
        return {"ok": True, "migrated": 0, "skipped": 0, "total": 0,
                "note": "nessun indice chroma sorgente"}

    if not isinstance(dst_db, SQLiteVectorStore):
        dst_db = SQLiteVectorStore(str(src), db_path=str(dst_db), store_key=store_key)

    try:
        client = chromadb.PersistentClient(path=str(src))
        try:
            collection = client.get_collection(
                name="documenti_locali", metadata={"hnsw:space": "cosine"}
            )
        except Exception:
            collection = client.get_or_create_collection(
                name="documenti_locali", metadata={"hnsw:space": "cosine"}
            )
        total = collection.count()
        if total == 0:
            return {"ok": True, "migrated": 0, "skipped": 0, "total": 0}

        # Id gia' presenti in SQLite (per upsert rapido/riuso)
        with dst_db._lock:
            existing = {
                r[0]
                for r in dst_db._conn.execute(
                    "SELECT id FROM chunks WHERE store_key = ?", (dst_db.store_key,)
                ).fetchall()
            }

        migrated = 0
        upserted_existing = 0
        batch = 500
        offset = 0
        while offset < total:
            data = collection.get(
                include=["documents", "metadatas", "embeddings"],
                limit=batch,
                offset=offset,
            )
            ids = data.get("ids") or []
            if not ids:
                break
            docs = data.get("documents") or []
            metas = data.get("metadatas") or []
            # embeddings puo' essere un array numpy: MAI "or []" (ambiguous truth)
            embeds = data.get("embeddings")
            if embeds is None:
                embeds = []

            new_chunks: List[Chunk] = []
            new_embeds: List[List[float]] = []
            for cid, doc, meta, emb in zip(ids, docs, metas, embeds):
                meta = meta or {}
                if cid in existing:
                    # upsert: add_chunks elimina la riga vecchia (e il suo
                    # vettore) prima di reincollare — nessun re-embedding.
                    upserted_existing += 1
                chunk = Chunk(
                    id=cid,
                    source_file=meta.get("source_file", ""),
                    text=doc or "",
                    location_hint=meta.get("location_hint", ""),
                    is_image=bool(meta.get("is_image", False)),
                    image_path=meta.get("image_path", "") or "",
                    mime_type=meta.get("mime_type", "") or "",
                )
                if hasattr(emb, "tolist"):
                    emb = emb.tolist()
                new_chunks.append(chunk)
                new_embeds.append([float(x) for x in emb])
            if new_chunks:
                dst_db.add_chunks(new_chunks, new_embeds)
                migrated += len(new_chunks)
            offset += len(ids)

        return {
            "ok": True,
            "migrated": migrated,
            "upserted_existing": upserted_existing,
            "skipped": 0,
            "total": total,
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "alternative": "reindex da file (index_folder ricalcola embedding)",
        }

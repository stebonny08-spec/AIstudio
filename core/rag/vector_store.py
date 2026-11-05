"""
core/rag/vector_store.py
--------------------------
Selettore del backend vettoriale (H1) — INTERFACCIA PUBBLICA INVARIATA.

api.py (e chiunque altro) continua a fare:
    from core.rag.vector_store import VectorStore
    store = VectorStore(persist_dir)
senza cambi di riga: la scelta del backend avviene QUI dentro core/rag.

Selettore (letto solo internamente, api.py non tocca):
    1. env RAG_BACKEND=sqlite|chroma            (priorita' massima)
    2. config "rag.backend": "sqlite"|"chroma"
    3. default: sqlite

Rollback garantito:
    - RAG_BACKEND=chroma (o config rag.backend=chroma) → vecchio backend
      ChromaDB (codice legacy conservato in vector_store_chroma.py);
    - se il boot del backend SQLite solleva eccezione → fallback
      automatico a ChromaDB con log;
    - i dati Chroma NON vengono mai cancellati dalla migrazione.

Migrazione one-shot chroma→sqlite: al primo boot con backend sqlite, se
l'indice sqlite e' vuoto e in persist_dir esiste un vecchio indice chroma
(chroma.sqlite3), i chunk vengono copiati RIUSANDO i vettori già
calcolati (nessun re-embedding). All'esito (successo o "niente da
migrare") viene scritto il marker chroma_migrated.flag in persist_dir.
Se chromadb non e' importabile, la migrazione e' BLOCKED con alternativa
dichiarata "reindex da file": l'indice sqlite parte vuoto e
Indexer.index_folder ricostruisce tutto dai file (invariato).
"""

import json
import os
import sys
from pathlib import Path
from typing import Optional

from core.rag.vector_store_chroma import COLLECTION_NAME, ChromaVectorStore
from core.rag.vector_store_sqlite import SQLiteVectorStore, migrate_chroma_to_sqlite

_MIGRATION_FLAG = "chroma_migrated.flag"

# Backend legacy (chiamato direttamente dai test di migrazione/parity)
VectorStoreSqlite = SQLiteVectorStore
VectorStoreChroma = ChromaVectorStore


def _log(msg: str) -> None:
    """Print che non esplode su console cp1252 (Windows): se il messaggio
    contiene caratteri non codificabili, li sostituisce con '?'."""
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"))


def _resolve_backend() -> str:
    """sqlite | chroma — env > config > default sqlite."""
    env = (os.environ.get("RAG_BACKEND") or "").strip().lower()
    if env in ("sqlite", "chroma"):
        return env
    if env:
        _log(f"[VectorStore] RAG_BACKEND ignoto ({env!r}); uso il default.")
        return "sqlite"
    try:
        from data.config_manager import ConfigManager
        cfg = ConfigManager()
        cfg.load()
        val = str(cfg.get("rag.backend") or "").strip().lower()
        if val in ("sqlite", "chroma"):
            return val
    except Exception:
        pass
    return "sqlite"


# ----------------------------------------------------------------------
# G3 (3.3) — promemoria migrazione one-shot su iniziativa dell'utente.
# Con il flag "rag.migrate_first_run" attivo e cutover G3 non registrato,
# alla costruzione del backend sqlite NON parte MAI una migrazione
# automatica in init: viene solo loggato il comando da eseguire.
# Lettura pura: env RAG_MIGRATE_FIRST_RUN > config.json (nessuna scrittura
# su %APPDATA%: config.json letto direttamente, non via ConfigManager).
# ----------------------------------------------------------------------
_TRUE_VALUES = ("1", "true", "yes", "on")


def _g3_qa_path() -> Path:
    """qa/g3_migration.json del progetto (percorso assoluto)."""
    return Path(__file__).resolve().parents[2] / "qa" / "g3_migration.json"


def _g3_migration_done(path: Optional[Path] = None) -> bool:
    """True se il cutover G3 risulta eseguito in qa/g3_migration.json.
    SOLO LETTURA: file assente/ilegibile -> False (=> serve il promemoria)."""
    p = Path(path) if path is not None else _g3_qa_path()
    try:
        if not p.exists():
            return False
        data = json.loads(p.read_text(encoding="utf-8"))
        status = str(data.get("status", "")).strip().lower()
        return status in ("eseguito", "executed", "done", "ok")
    except Exception:
        return False


def _rag_migrate_first_run_active() -> bool:
    """Flag rag.migrate_first_run: env RAG_MIGRATE_FIRST_RUN > config.json."""
    env = (os.environ.get("RAG_MIGRATE_FIRST_RUN") or "").strip().lower()
    if env:
        return env in _TRUE_VALUES
    try:
        if sys.platform.startswith("win"):
            base = os.environ.get("APPDATA") or str(Path.home())
            cfg = Path(base) / "NovaStudio" / "config.json"
        elif sys.platform == "darwin":
            cfg = (Path.home() / "Library" / "Application Support" /
                   "NovaStudio" / "config.json")
        else:
            base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
            cfg = Path(base) / "NovaStudio" / "config.json"
        if not cfg.exists():
            return False
        return bool(json.loads(cfg.read_text(encoding="utf-8")).get(
            "rag.migrate_first_run"))
    except Exception:
        return False


class VectorStore:
    """Facciata con la stessa API dell'antico VectorStore Chroma
    (add_chunks, query, delete_by_source_file, count, ...) delegando al
    backend scelto. Ogni metodo non noto viene propagato con __getattr__.
    """

    def __init__(
        self,
        persist_dir: str,
        embedding_model_name: Optional[str] = None,
        *,
        db_path: Optional[str] = None,
        store_key: Optional[str] = None,
    ):
        self.persist_dir = str(persist_dir)
        backend = _resolve_backend()
        self._impl = None

        if backend != "chroma":
            try:
                self._impl = SQLiteVectorStore(
                    persist_dir,
                    embedding_model_name,
                    db_path=db_path,
                    store_key=store_key,
                )
                self._maybe_migrate(persist_dir, self._impl)
            except Exception as exc:
                _log(
                    f"[VectorStore] Boot backend sqlite fallito ({exc!r}) "
                    f"-> rollback al backend chromadb legacy."
                )
                self._impl = None

        if self._impl is None:
            self._impl = ChromaVectorStore(persist_dir, embedding_model_name)

        self.backend = getattr(self._impl, "BACKEND_NAME", backend)

    # ------------------------------------------------------------------
    def _maybe_migrate(self, persist_dir: str, store: SQLiteVectorStore) -> None:
        # G3 (3.3): con rag.migrate_first_run attivo e cutover non ancora
        # registrato la migrazione NON viene eseguita in init — solo log:
        try:
            if _rag_migrate_first_run_active() and not _g3_migration_done():
                _log(
                    "[VectorStore] rag.migrate_first_run attivo, nessuna "
                    "migrazione registrata in qa/g3_migration.json -> "
                    "eseguire: python data/migrate_real.py"
                )
                return
        except Exception:
            pass
        p = Path(persist_dir)
        flag = p / _MIGRATION_FLAG
        try:
            if flag.exists():
                return
            if store.count() > 0:
                flag.write_text("done", encoding="utf-8")
                return
            stats = migrate_chroma_to_sqlite(
                str(p), store, store_key=store.store_key
            )
            if stats.get("ok"):
                flag.write_text(json.dumps(stats, ensure_ascii=False), encoding="utf-8")
                if stats.get("migrated"):
                    _log(
                        f"[VectorStore] Migrazione chroma->sqlite completata: "
                        f"{stats['migrated']} chunk (vettori riutilizzati, "
                        f"nessun re-embedding)."
                    )
            else:
                _log(
                    f"[VectorStore] Migrazione chroma->sqlite non riuscita: "
                    f"{stats.get('error')} - alternativa: "
                    f"{stats.get('alternative', 'reindex da file')}"
                )
        except Exception as exc:
            _log(
                f"[VectorStore] Migrazione saltata ({exc}) - alternativa: "
                f"reindex da file (prossimo avvio o scansione manuale)."
            )

    # ------------------------------------------------------------------
    def __getattr__(self, name):
        """Delega ogni metodo/attributo al backend reale (API invariata)."""
        if name.startswith("_") or name in ("backend", "persist_dir"):
            raise AttributeError(name)
        impl = self.__dict__.get("_impl")
        if impl is None:
            raise AttributeError(name)
        return getattr(impl, name)

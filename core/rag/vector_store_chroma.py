"""
core/rag/vector_store_chroma.py
--------------------------------
Backend LEGACY ChromaDB (H1): implementazione originale di vector_store.py
spostata qui senza modifiche di sostanza, conservata per IL ROLLBACK.

Il selettore core/rag/vector_store.py costruisce questa classe quando
  - RAG_BACKEND=chroma (env o config "rag.backend"), oppure
  - il boot del backend SQLite fallisce (fallback automatico).
I dati Chroma NON vengono mai cancellati dalla migrazione: restano sul
disco in <persist_dir>/ come prima, pronti per un ritorno al vecchio
backend senza perdita.
"""

import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from core.rag.chunker import Chunk
from core.rag.contract import EMBEDDER_ID

COLLECTION_NAME = "documenti_locali"
_MODEL_VERSION_FILE = "embedding_model.txt"
_INDEX_META_FILE = "index_meta.json"


def _default_reindex_embedder():
    """Embedder di default per il reindex low-prio (lazy import)."""
    from core.rag.embedder import Embedder
    return Embedder()


class ChromaVectorStore:
    """Indice vettoriale ChromaDB persistente (codice legacy, invariato)."""

    BACKEND_NAME = "chroma"

    def __init__(self, persist_dir: str, embedding_model_name: Optional[str] = None):
        import chromadb

        self.persist_dir = Path(persist_dir)
        self.persist_dir.mkdir(parents=True, exist_ok=True)

        if embedding_model_name is None:
            # Importa qui per non creare dipendenza circolare a livello di modulo
            from core.rag.embedder import _MODEL_NAME
            embedding_model_name = _MODEL_NAME

        self._check_and_reset_on_model_change(embedding_model_name)

        # I1 (copertura rollback RAG_BACKEND=chroma): meta indice per-store
        # su file JSON + stato reindex low-prio (stessa interfaccia del
        # backend sqlite del contratto R15b).
        self._meta_lock = threading.Lock()
        self._reindex_state_lock = threading.Lock()
        self._reindex_thread: Optional[threading.Thread] = None
        self._reindex_embedder_factory = None  # hook di test

        self._client = chromadb.PersistentClient(path=str(self.persist_dir))
        self._collection = self._client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )

    def _check_and_reset_on_model_change(self, embedding_model_name: str) -> None:
        version_file = self.persist_dir / _MODEL_VERSION_FILE
        previous = None
        if version_file.exists():
            try:
                previous = version_file.read_text(encoding="utf-8").strip()
            except OSError:
                previous = None

        if previous is not None and previous != embedding_model_name:
            # Il modello è cambiato: i vettori in questo indice sono
            # incompatibili. Cancelliamo tutto per forzare una re-indicizzazione.
            print(
                f"[VectorStore] Modello di embedding cambiato "
                f"({previous!r} -> {embedding_model_name!r}). "
                f"Ricreo l'indice in {self.persist_dir}."
            )
            self._wipe_dir()

        try:
            version_file.write_text(embedding_model_name, encoding="utf-8")
        except OSError:
            pass

    def _wipe_dir(self) -> None:
        import shutil
        try:
            shutil.rmtree(self.persist_dir)
        except OSError:
            pass
        self.persist_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # I1 — META INDICE + COERENZA EMBEDDER (contratto R15b, copertura
    # rollback RAG_BACKEND=chroma; la kv vive in index_meta.json per-store
    # perche' Chroma non ha una tabella chiave-valore)
    # ------------------------------------------------------------------
    def get_index_meta(self, key: str) -> Optional[str]:
        with self._meta_lock:
            try:
                data = json.loads(
                    (self.persist_dir / _INDEX_META_FILE).read_text(encoding="utf-8")
                )
            except (OSError, json.JSONDecodeError):
                data = {}
        val = data.get(str(key))
        return None if val is None else str(val)

    def set_index_meta(self, key: str, value) -> None:
        path = self.persist_dir / _INDEX_META_FILE
        with self._meta_lock:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(data, dict):
                    data = {}
            except (OSError, json.JSONDecodeError):
                data = {}
            data[str(key)] = "" if value is None else str(value)
            data.setdefault("_updated", {})
            data["_updated"][str(key)] = datetime.now().isoformat()
            try:
                tmp = path.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                tmp.replace(path)
            except OSError as exc:
                print(f"[VectorStore] scrittura index_meta.json fallita: {exc}")

    def ensure_embedder_consistent(self, embedder_id: str) -> str:
        """Contratto R15b/I (specchio della versione sqlite): "ok"|"reindexing"."""
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
                stored = target
            else:
                stored = legacy or EMBEDDER_ID
            self.set_index_meta("embedding_model_id", stored)
            self.set_index_meta("updated", datetime.now().isoformat())
            print(
                f"[r15-index][chroma] index_meta bootstrap: "
                f"embedding_model_id={stored!r} (runtime={target!r})",
                flush=True,
            )
        if stored == target:
            return "ok"
        if not self._reindex_state_lock.acquire(blocking=False):
            return "reindexing"  # gia' in corso: nessun duplicato
        try:
            t = threading.Thread(
                target=self._reindex_worker,
                args=(target,),
                name="r15-reindex",
                daemon=True,
            )
            self._reindex_thread = t
            t.start()
        except Exception as exc:
            try:
                self._reindex_state_lock.release()
            except Exception:
                pass
            print(f"[r15-reindex][chroma] START fallito: {exc}", flush=True)
        return "reindexing"

    def _reindex_worker(self, embedder_id: str) -> None:
        """Reindex LOW-PRIO: re-embedding di tutti i documenti della
        collection con l'embedder runtime (chunk/metadati intatti)."""
        t0 = time.time()
        n = 0
        print(f"[r15-reindex][chroma] START target={embedder_id}", flush=True)
        try:
            data = self._collection.get(include=["documents", "metadatas"])
            ids = data.get("ids") or []
            n = len(ids)
            if n:
                docs = data.get("documents") or []
                factory = getattr(self, "_reindex_embedder_factory", None)
                emb_obj = factory() if callable(factory) else _default_reindex_embedder()
                vectors: List[List[float]] = []
                for i in range(0, n, 32):
                    vectors.extend(emb_obj.embed(docs[i:i + 32], kind="passage"))
                if len(vectors) != n:
                    raise RuntimeError(
                        f"embedder ha prodotto {len(vectors)} vettori per {n} documenti"
                    )
                self._collection.update(ids=ids, embeddings=vectors)
            self.set_index_meta("embedding_model_id", str(embedder_id))
            self.set_index_meta("updated", datetime.now().isoformat())
            print(
                f"[r15-reindex][chroma] DONE ms={int((time.time() - t0) * 1000)} "
                f"docs={n} -> embedding_model_id={embedder_id!r}",
                flush=True,
            )
        except Exception as exc:
            print(
                f"[r15-reindex][chroma] FAIL dopo {int((time.time() - t0) * 1000)}ms: "
                f"{type(exc).__name__}: {exc}",
                flush=True,
            )
        finally:
            try:
                self._reindex_state_lock.release()
            except Exception:
                pass

    def _sync_batch_embedder(self, embedder_id: str) -> None:
        try:
            if self.get_index_meta("embedding_model_id") is None:
                self.set_index_meta("embedding_model_id", embedder_id)
            self.set_index_meta("updated", datetime.now().isoformat())
        except Exception as exc:
            print(f"[VectorStore] sync index_meta fallita: {exc}")

    # ------------------------------------------------------------------
    # I2 — bookkeeping file (stessa interfaccia del backend sqlite)
    # ------------------------------------------------------------------
    def count_by_source_file(self, source_file: str) -> int:
        try:
            data = self._collection.get(where={"source_file": source_file})
            return len(data.get("ids") or [])
        except Exception:
            return 0

    def get_source_file_signature(self, source_file: str) -> Optional[dict]:
        if not source_file:
            return None
        try:
            data = self._collection.get(
                where={"source_file": source_file}, include=["metadatas"]
            )
            metas = data.get("metadatas") or []
        except Exception:
            return None
        if not metas or not isinstance(metas[0], dict):
            return None
        sig = {
            k: metas[0][k]
            for k in ("file_size", "file_mtime", "file_hash")
            if k in metas[0]
        }
        return sig or None

    def add_chunks(
        self,
        chunks: List[Chunk],
        embeddings: List[List[float]],
        embedder_id: Optional[str] = None,
    ) -> None:
        if not chunks:
            return
        # I1: meta del chunk (W, opzionale) FONDATO con le chiavi dello
        # store; Chroma accetta solo valori scalari → il resto è JSON.
        metadatas = []
        for c in chunks:
            md = {}
            for k, v in (getattr(c, "meta", None) or {}).items():
                if v is None:
                    continue
                if isinstance(v, (str, int, float, bool)):
                    md[k] = v
                else:
                    md[k] = json.dumps(v, ensure_ascii=False)
            md.update(
                {
                    "source_file": c.source_file,
                    "location_hint": c.location_hint,
                    "is_image": c.is_image,
                    "image_path": c.image_path,
                    "mime_type": c.mime_type,
                }
            )
            if embedder_id:
                md["emb_id"] = str(embedder_id)
            metadatas.append(md)
        self._collection.add(
            ids=[c.id for c in chunks],
            documents=[c.text for c in chunks],
            embeddings=embeddings,
            metadatas=metadatas,
        )
        if embedder_id:
            self._sync_batch_embedder(str(embedder_id))

    def delete_by_source_file(self, source_file: str) -> None:
        try:
            self._collection.delete(where={"source_file": source_file})
        except Exception:
            pass

    def query(self, query_embedding: List[float], top_k: int = 5) -> List[dict]:
        if self.count() == 0:
            return []

        results = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=min(top_k, self.count()),
        )

        output = []
        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        for doc, meta, dist in zip(documents, metadatas, distances):
            similarity = 1.0 - dist
            output.append(
                {
                    "text": doc,
                    "source_file": meta.get("source_file", ""),
                    "location_hint": meta.get("location_hint", ""),
                    "similarity": similarity,
                    "is_image": meta.get("is_image", False),
                    "image_path": meta.get("image_path", ""),
                    "mime_type": meta.get("mime_type", ""),
                }
            )
        return output

    def count(self) -> int:
        try:
            return self._collection.count()
        except Exception:
            return 0

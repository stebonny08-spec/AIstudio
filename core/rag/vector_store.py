"""
core/rag/vector_store.py
--------------------------
Indice vettoriale locale (ChromaDB), persistito su disco nella cartella dati
dell'app. Contiene sia i chunk di testo sia i "chunk immagine" (riferimenti
a immagini estratte, indicizzate tramite il testo che le descrive/circonda).

Cambio di modello di embedding: i vettori prodotti da modelli diversi non
sono confrontabili. Se il nome del modello salvato accanto all'indice non
corrisponde a quello in uso, l'indice viene ricreato da zero
automaticamente. L'utente non deve mai occuparsene.
"""

from pathlib import Path
from typing import List, Optional

from core.rag.chunker import Chunk

COLLECTION_NAME = "documenti_locali"
_MODEL_VERSION_FILE = "embedding_model.txt"


class VectorStore:
    def __init__(self, persist_dir: str, embedding_model_name: Optional[str] = None):
        import chromadb

        self.persist_dir = Path(persist_dir)
        self.persist_dir.mkdir(parents=True, exist_ok=True)

        if embedding_model_name is None:
            # Importa qui per non creare dipendenza circolare a livello di modulo
            from core.rag.embedder import _MODEL_NAME
            embedding_model_name = _MODEL_NAME

        self._check_and_reset_on_model_change(embedding_model_name)

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

    def add_chunks(self, chunks: List[Chunk], embeddings: List[List[float]]) -> None:
        if not chunks:
            return
        self._collection.add(
            ids=[c.id for c in chunks],
            documents=[c.text for c in chunks],
            embeddings=embeddings,
            metadatas=[
                {
                    "source_file": c.source_file,
                    "location_hint": c.location_hint,
                    "is_image": c.is_image,
                    "image_path": c.image_path,
                    "mime_type": c.mime_type,
                }
                for c in chunks
            ],
        )

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
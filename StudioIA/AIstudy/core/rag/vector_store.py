"""
core/rag/vector_store.py
--------------------------
Indice vettoriale locale (ChromaDB), persistito su disco nella cartella dati
dell'app. Contiene sia i chunk di testo sia i "chunk immagine" (riferimenti
a immagini estratte, indicizzate tramite il testo che le descrive/circonda).
"""

from typing import List, Optional

from core.rag.chunker import Chunk

COLLECTION_NAME = "documenti_locali"


class VectorStore:
    def __init__(self, persist_dir: str):
        import chromadb

        self._client = chromadb.PersistentClient(path=persist_dir)
        # "hnsw:space": "cosine" fa sì che Chroma usi la distanza coseno,
        # la metrica di similarità standard per gli embedding testuali.
        self._collection = self._client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )

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
        """Rimuove tutti i chunk associati a un file (usato prima di
        re-indicizzarlo quando è cambiato, per non lasciare doppioni)."""
        try:
            self._collection.delete(where={"source_file": source_file})
        except Exception:
            # Se il file non aveva ancora chunk indicizzati, Chroma può
            # sollevare un'eccezione a seconda della versione: non è un problema.
            pass

    def query(self, query_embedding: List[float], top_k: int = 5) -> List[dict]:
        """Ritorna i top_k chunk più simili alla query, come lista di dict con
        text, source_file, location_hint, similarity, is_image, image_path, mime_type.
        """
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
            similarity = 1.0 - dist  # con distanza coseno, similarità = 1 - distanza
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

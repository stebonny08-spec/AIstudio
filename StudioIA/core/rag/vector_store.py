"""
core/rag/vector_store.py
--------------------------
Indice vettoriale locale (ChromaDB), persistito su disco nelle cartelle dati
dell'app. Supporta due indici separati:
- user_files/: per i file dell'utente (vettorizzati dopo conversione)
- data_base/: per il database di libri pre-selezionati (già vettorizzati)

Ogni indice ha la propria collezione ChromaDB ma usa la stessa struttura
di dati per chunk di testo e immagini.
"""

from typing import List, Optional

from core.rag.chunker import Chunk

USER_COLLECTION_NAME = "user_files_collection"
DATA_BASE_COLLECTION_NAME = "data_base_collection"


class VectorStore:
    """Gestisce un indice vettoriale ChromaDB in una specifica cartella."""
    
    def __init__(self, persist_dir: str, collection_name: str = USER_COLLECTION_NAME):
        import chromadb

        self._client = chromadb.PersistentClient(path=persist_dir)
        # "hnsw:space": "cosine" fa sì che Chroma usi la distanza coseno,
        # la metrica di similarità standard per gli embedding testuali.
        self._collection = self._client.get_or_create_collection(
            name=collection_name,
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
                    "chunk_type": getattr(c, 'chunk_type', 'TESTO'),
                    "clip_id": getattr(c, 'clip_id', None),
                    "latex": getattr(c, 'latex', None),
                    "testo_ocr": getattr(c, 'testo_ocr', None),
                    "pagina": getattr(c, 'pagina', None),
                    "libro": getattr(c, 'libro', None),
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
                    "chunk_type": meta.get("chunk_type", "TESTO"),
                    "clip_id": meta.get("clip_id", None),
                    "latex": meta.get("latex", None),
                    "testo_ocr": meta.get("testo_ocr", None),
                    "pagina": meta.get("pagina", None),
                    "libro": meta.get("libro", None),
                }
            )
        return output

    def count(self) -> int:
        try:
            return self._collection.count()
        except Exception:
            return 0

"""
core/local_search.py
----------------------
Facciata semplice usata dal router: dato il testo di una domanda, aggiorna
l'indice (in modo incrementale ed economico) e ritorna i chunk più
rilevanti trovati nei file locali, comprese le eventuali immagini collegate.
"""

from typing import Optional

from core.models import LocalSearchResult, RetrievedChunk
from core.rag.embedder import Embedder
from core.rag.indexer import Indexer, ProgressCallback
from core.rag.vector_store import VectorStore
from data.db import Database


class LocalSearchEngine:
    def __init__(self, db: Database, vector_store: VectorStore, embedder: Optional[Embedder] = None):
        self.db = db
        self.vector_store = vector_store
        self.embedder = embedder or Embedder()
        self.indexer = Indexer(db, vector_store, self.embedder)

    def ensure_index_updated(
        self,
        folder_path: str,
        ocr_enabled: bool = True,
        progress_callback: ProgressCallback = None,
    ) -> None:
        """Cammina l'intera struttura ad albero della cartella (operazione
        economica) e ri-processa solo i file nuovi o modificati (operazione
        costosa). Va chiamata prima di ogni ricerca: così l'indice riflette
        sempre lo stato reale della cartella, senza dover ri-elaborare tutto
        da zero a ogni domanda.
        """
        self.indexer.index_folder(folder_path, ocr_enabled=ocr_enabled, progress_callback=progress_callback)

    def search(self, query: str, top_k: int = 5) -> LocalSearchResult:
        if not query.strip() or self.vector_store.count() == 0:
            return LocalSearchResult(chunks=[])

        query_embedding = self.embedder.embed_one(query)
        raw_results = self.vector_store.query(query_embedding, top_k=top_k)

        chunks = [
            RetrievedChunk(
                text=r["text"],
                source_file=r["source_file"],
                location_hint=r["location_hint"],
                similarity=r["similarity"],
                is_image=r["is_image"],
                image_path=r["image_path"] or None,
                mime_type=r["mime_type"] or None,
            )
            for r in raw_results
        ]
        return LocalSearchResult(chunks=chunks)

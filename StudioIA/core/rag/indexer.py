"""
core/rag/indexer.py
---------------------
Orchestratore dell'indicizzazione: cammina l'intero albero di cartelle,
individua i file nuovi o modificati, li analizza con il parser giusto, li
spezza in chunk, calcola gli embedding e li salva nell'indice vettoriale.

Indicizzazione incrementale: ad ogni scansione l'albero delle cartelle viene
comunque esplorato per intero (economico: solo lettura di nomi/date), ma
vengono ri-processati (parsing + embedding, costoso) solo i file nuovi o
cambiati rispetto all'ultima scansione. I file cancellati dall'utente
vengono rimossi anche dall'indice.
"""

import os
import uuid
from pathlib import Path
from typing import Callable, List, Optional

from core.models import ExtractedImage, ParsedDocument
from core.parsers import is_supported, parse_file
from core.rag.chunker import Chunk, chunk_text
from core.rag.embedder import Embedder
from core.rag.vector_store import VectorStore
from data.config_manager import get_app_data_dir
from data.db import Database

ProgressCallback = Optional[Callable[[str], None]]


def _images_cache_dir() -> Path:
    d = get_app_data_dir() / "images_cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _save_image_to_cache(image: ExtractedImage, chunk_id: str) -> str:
    ext = image.mime_type.split("/")[-1] if "/" in image.mime_type else "png"
    ext = ext.split("+")[0]  # caso raro tipo "svg+xml" -> "svg"
    path = _images_cache_dir() / f"{chunk_id}.{ext}"
    with open(path, "wb") as f:
        f.write(image.image_bytes)
    return str(path)


class Indexer:
    def __init__(self, db: Database, vector_store: VectorStore, embedder: Optional[Embedder] = None):
        self.db = db
        self.vector_store = vector_store
        self.embedder = embedder or Embedder()

    def index_folder(
        self,
        folder_path: str,
        ocr_enabled: bool = True,
        progress_callback: ProgressCallback = None,
    ) -> None:
        """Scansiona ricorsivamente `folder_path` e aggiorna l'indice.
        Pensata per essere chiamata da un thread di background: su cartelle
        grandi può richiedere da qualche secondo a qualche minuto.
        """
        if not folder_path or not os.path.isdir(folder_path):
            return

        def report(msg: str) -> None:
            if progress_callback:
                progress_callback(msg)

        all_files: List[str] = []
        for root, _dirs, files in os.walk(folder_path):
            for filename in files:
                full_path = os.path.join(root, filename)
                if is_supported(full_path):
                    all_files.append(full_path)

        total = len(all_files)
        report(f"Trovati {total} file supportati. Controllo modifiche...")

        found_paths = set()
        processed = 0
        changed = 0

        for full_path in all_files:
            found_paths.add(full_path)
            processed += 1
            try:
                stat = os.stat(full_path)
            except OSError:
                continue

            existing = self.db.get_indexed_file(full_path)
            unchanged = (
                existing is not None
                and existing["dimensione"] == stat.st_size
                and abs(existing["data_modifica"] - stat.st_mtime) < 1.0
            )
            if unchanged:
                continue

            changed += 1
            report(f"Indicizzazione ({processed}/{total}): {os.path.basename(full_path)}")
            self._index_single_file(full_path, stat.st_size, stat.st_mtime, ocr_enabled)

        # File presenti nel database ma non più trovati sul disco (cancellati
        # o spostati dall'utente): li rimuoviamo anche dall'indice, per non
        # dare mai risposte basate su documenti che non esistono più.
        removed = 0
        for known_path in self.db.get_all_indexed_paths():
            if known_path not in found_paths:
                self.vector_store.delete_by_source_file(known_path)
                self.db.remove_indexed_file(known_path)
                removed += 1

        if changed or removed:
            report(f"Indice aggiornato: {changed} file elaborati, {removed} rimossi.")
        else:
            report("Indice già aggiornato.")

    def _index_single_file(self, full_path: str, size: int, mtime: float, ocr_enabled: bool) -> None:
        # Se il file era già indicizzato in precedenza (ed è cambiato),
        # rimuoviamo prima i vecchi chunk per evitare doppioni/dati obsoleti.
        self.vector_store.delete_by_source_file(full_path)

        parsed: Optional[ParsedDocument] = parse_file(full_path, ocr_enabled=ocr_enabled)
        if parsed is None:
            return

        if parsed.error:
            # File non leggibile: lo segnamo comunque come "processato" con
            # zero chunk, così non ritentiamo di aprirlo ad ogni scansione
            # finché non cambia (o l'utente non lo sistema).
            self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=0)
            return

        all_chunks: List[Chunk] = []

        if parsed.text and parsed.text.strip():
            all_chunks.extend(chunk_text(parsed.text, source_file=full_path))

        for image in parsed.images:
            # Ogni immagine diventa un "chunk immagine": il testo usato per
            # calcolare l'embedding è il contesto testuale vicino
            # all'immagine (nearby_text), non l'immagine stessa. Quando una
            # domanda dell'utente è semanticamente vicina a quel contesto,
            # l'immagine viene recuperata e inviata a Gemini insieme al testo.
            if not image.nearby_text.strip():
                continue
            chunk_id = uuid.uuid4().hex
            image_chunk = Chunk(
                id=chunk_id,
                source_file=full_path,
                text=image.nearby_text,
                location_hint=image.location_hint,
                is_image=True,
                mime_type=image.mime_type,
            )
            image_chunk.image_path = _save_image_to_cache(image, chunk_id)
            all_chunks.append(image_chunk)

        if not all_chunks:
            self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=0)
            return

        embeddings = self.embedder.embed([c.text for c in all_chunks])
        self.vector_store.add_chunks(all_chunks, embeddings)
        self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=len(all_chunks))

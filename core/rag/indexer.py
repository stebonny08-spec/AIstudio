"""
core/rag/indexer.py
---------------------
Orchestratore dell'indicizzazione: cammina l'intero albero di cartelle,
individua i file nuovi o modificati, li analizza con il parser giusto, li
spezza in chunk, calcola gli embedding e li salva nell'indice vettoriale.

Indicizzazione incrementale: l'albero viene esplorato per intero ad ogni
scansione (economico: solo nomi/date), ma solo i file nuovi o cambiati
vengono ri-processati (costoso).
"""

import json
import os
import uuid
from pathlib import Path
from typing import Callable, List, Optional

from core.models import ExtractedImage, ParsedDocument
from core.parsers import is_supported, parse_file
from core.rag.chunker import Chunk, chunk_text
from core.rag.embedder import Embedder
from core.rag.image_cache import save_image_to_cache
from core.rag.vector_store import VectorStore
from data.db import Database

ProgressCallback = Optional[Callable[[str], None]]


def _load_image_sidecar(md_path: str) -> List[ExtractedImage]:
    """Se accanto a un file .md/.markdown esiste un sidecar
    '<nome>.images.json' (scritto dal convertitore), carica le immagini
    che descrive. Il sidecar contiene solo METADATI: i byte reali sono
    già nella cache condivisa, quindi qui si leggono da lì.
    """
    sidecar_path = Path(md_path).with_suffix("").with_suffix(".images.json")
    if not sidecar_path.exists():
        return []

    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []

    images = []
    for entry in data.get("images", []):
        image_path = entry.get("path")
        if not image_path or not os.path.isfile(image_path):
            continue
        try:
            with open(image_path, "rb") as img_f:
                image_bytes = img_f.read()
        except OSError:
            continue
        images.append(
            ExtractedImage(
                source_file=md_path,
                location_hint=entry.get("location_hint", ""),
                image_bytes=image_bytes,
                mime_type=entry.get("mime_type", "image/png"),
                nearby_text=entry.get("nearby_text", ""),
            )
        )
    return images


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
        self.vector_store.delete_by_source_file(full_path)

        parsed: Optional[ParsedDocument] = parse_file(full_path, ocr_enabled=ocr_enabled)
        if parsed is None:
            return

        if parsed.error:
            self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=0)
            return

        if Path(full_path).suffix.lower() in (".md", ".markdown"):
            parsed.images = list(parsed.images) + _load_image_sidecar(full_path)

        all_chunks: List[Chunk] = []

        if parsed.text and parsed.text.strip():
            all_chunks.extend(chunk_text(parsed.text, source_file=full_path))

        for image in parsed.images:
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
            image_chunk.image_path = save_image_to_cache(image, chunk_id)
            all_chunks.append(image_chunk)

        if not all_chunks:
            self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=0)
            return

        embeddings = self.embedder.embed([c.text for c in all_chunks], kind="passage")
        self.vector_store.add_chunks(all_chunks, embeddings)
        self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=len(all_chunks))
"""
core/rag/chunker.py
--------------------
Spezza il testo lungo estratto da un file in "chunk" (frammenti) più piccoli.

Perché serve: un embedding funziona meglio su un blocco di testo mirato
(qualche centinaio di parole) che su un intero documento. Usiamo un overlap
tra un chunk e il successivo per non spezzare un concetto esattamente a metà.
"""

import uuid
from dataclasses import dataclass, field
from typing import List

DEFAULT_CHUNK_SIZE_WORDS = 350
DEFAULT_OVERLAP_WORDS = 50


@dataclass
class Chunk:
    id: str
    source_file: str
    text: str
    location_hint: str = ""
    is_image: bool = False
    image_path: str = ""
    mime_type: str = ""


def chunk_text(
    text: str,
    source_file: str,
    chunk_size_words: int = DEFAULT_CHUNK_SIZE_WORDS,
    overlap_words: int = DEFAULT_OVERLAP_WORDS,
) -> List[Chunk]:
    """Spezza `text` in chunk da `chunk_size_words` parole, con sovrapposizione
    di `overlap_words` parole tra un chunk e il successivo.
    """
    words = text.split()
    if not words:
        return []

    chunks: List[Chunk] = []
    step = max(1, chunk_size_words - overlap_words)

    for start in range(0, len(words), step):
        window = words[start:start + chunk_size_words]
        if not window:
            break
        chunk_str = " ".join(window)
        chunks.append(
            Chunk(
                id=str(uuid.uuid4()),
                source_file=source_file,
                text=chunk_str,
            )
        )
        if start + chunk_size_words >= len(words):
            break

    return chunks

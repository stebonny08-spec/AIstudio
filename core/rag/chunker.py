"""
core/rag/chunker.py
--------------------
Spezza il testo lungo estratto da un file in "chunk" (frammenti) più piccoli.

Perché serve: un embedding funziona meglio su un blocco di testo mirato
(qualche centinaio di parole) che su un intero documento. Usiamo un overlap
tra un chunk e il successivo per non spezzare un concetto esattamente a metà.

Lo split avviene su confini di FRASE, non su spazi: spezzare a metà frase
danneggia la qualità del retrieval perché il chunk risultante contiene un
concetto monco. Il testo può essere italiano o inglese: le abbreviazioni
più comuni in entrambe le lingue sono protette da una blacklist, così
"Dr. Rossi" o "e.g. questo" non vengono spezzati a metà.
"""

# Import "futuri": rende le annotazioni di tipo pigre (PEP 563),
# evitando NameError se un tipo è usato prima di essere definito.
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import List

DEFAULT_CHUNK_SIZE_WORDS = 350
DEFAULT_OVERLAP_WORDS = 50


# ======================================================================
# STRUTTURA DATI
# ----------------------------------------------------------------------
# Definita PRIMA di qualsiasi funzione che la usa come annotazione.
# ======================================================================

@dataclass
class Chunk:
    id: str
    source_file: str
    text: str
    location_hint: str = ""
    is_image: bool = False
    image_path: str = ""
    mime_type: str = ""


# ======================================================================
# SPLIT IN FRASI
# ======================================================================

# Abbreviazioni che NON devono chiudere una frase, anche se seguite da
# un punto. Coprono i casi più frequenti in italiano e in inglese.
_ABBREVIATIONS = {
    # inglese
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc",
    "e.g", "i.e", "cf", "al", "fig", "no", "vol", "pp", "ed",
    # italiano
    "ecc", "es", "cfr", "pag", "pagg", "sez", "cap", "art", "dott",
    "avv", "ing", "geom", "sig", "s.p.a", "s.r.l",
}

# Regex di split: cattura il punto/esclamativo/interrogativo e lo spazio
# successivo come separatore, se seguito da una lettera maiuscola o da
# un carattere tipico di apertura (virgolette, parentesi).
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ\"«\(\[]")

# Regex per riconoscere un "punto di abbreviazione": una parola che
# termina con un punto, il cui corpo (senza punto, lowercase) è nella
# blacklist.
_ABBREV_END_RE = re.compile(r"([A-Za-zÀ-ÖØ-öø-ÿ.]+)\.$")


def _split_sentences(text: str) -> List[str]:
    """Divide il testo in frasi, proteggendo le abbreviazioni comuni."""
    raw = _SENTENCE_SPLIT_RE.split(text)

    sentences: List[str] = []
    buffer = ""
    for piece in raw:
        if buffer:
            piece = buffer + " " + piece
            buffer = ""
        m = _ABBREV_END_RE.search(piece.rstrip())
        if m:
            token = m.group(1).lower().rstrip(".")
            if token in _ABBREVIATIONS:
                buffer = piece
                continue
        sentences.append(piece.strip())

    if buffer:
        sentences.append(buffer.strip())

    return [s for s in sentences if s]


def _split_long_sentence(sentence: str, max_words: int) -> List[str]:
    """Fallback: se una singola frase supera `max_words`, la spezza su
    spazi. Succede raramente, ma può capitare con testi senza punteggiatura
    (es. output di OCR, elenchi)."""
    words = sentence.split()
    if len(words) <= max_words:
        return [sentence]
    return [
        " ".join(words[i:i + max_words])
        for i in range(0, len(words), max_words)
    ]


# ======================================================================
# FUNZIONE PRINCIPALE
# ======================================================================

def chunk_text(
    text: str,
    source_file: str,
    chunk_size_words: int = DEFAULT_CHUNK_SIZE_WORDS,
    overlap_words: int = DEFAULT_OVERLAP_WORDS,
) -> List[Chunk]:
    """Spezza `text` in chunk da ~`chunk_size_words` parole, rispettando i
    confini di frase per quanto possibile. L'overlap è in parole, ma viene
    applicato a livello di frase intera: si tengono le ultime frasi del
    chunk precedente finché non si raggiunge ~`overlap_words` parole.
    """
    if not text or not text.strip():
        return []

    sentences = _split_sentences(text)
    if not sentences:
        return []

    # Pre-split delle frasi troppo lunghe, così il ciclo sotto può sempre
    # ragionare su unità "piccole".
    units: List[str] = []
    for s in sentences:
        units.extend(_split_long_sentence(s, chunk_size_words))

    chunks: List[Chunk] = []
    current: List[str] = []
    current_words = 0

    def flush() -> None:
        nonlocal current, current_words
        if not current:
            return
        chunks.append(
            Chunk(
                id=str(uuid.uuid4()),
                source_file=source_file,
                text=" ".join(current).strip(),
            )
        )
        # Costruisci l'overlap: prendi le ultime unità finché non arrivi
        # a ~overlap_words parole.
        if overlap_words <= 0:
            current = []
            current_words = 0
            return
        tail: List[str] = []
        tail_words = 0
        for unit in reversed(current):
            w = len(unit.split())
            if tail_words + w > overlap_words and tail:
                break
            tail.insert(0, unit)
            tail_words += w
        current = tail
        current_words = tail_words

    for unit in units:
        w = len(unit.split())
        if current and current_words + w > chunk_size_words:
            flush()
        current.append(unit)
        current_words += w

    # Ultimo chunk rimasto (senza overlap finale, che servirebbe a nulla)
    if current:
        chunks.append(
            Chunk(
                id=str(uuid.uuid4()),
                source_file=source_file,
                text=" ".join(current).strip(),
            )
        )

    return chunks
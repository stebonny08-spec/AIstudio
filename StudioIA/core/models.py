"""
core/models.py
--------------
Strutture dati condivise tra i parser, il motore RAG e il client Gemini.
Tenerle in un unico posto evita di doverle ridefinire (e disallineare) in
ogni modulo che le usa.
"""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ExtractedImage:
    """Un'immagine trovata dentro un file (PDF, Word, PowerPoint, Excel)
    o un file immagine a sé stante.
    """
    source_file: str            # percorso del file di origine
    location_hint: str          # es. "pagina 3", "slide 5", "foglio 'Bilancio'"
    image_bytes: bytes
    mime_type: str               # es. "image/png"
    nearby_text: str = ""       # testo vicino all'immagine, usato per capire quando è rilevante


@dataclass
class ParsedDocument:
    """Risultato dell'estrazione da un singolo file."""
    source_file: str
    text: str = ""
    images: List[ExtractedImage] = field(default_factory=list)
    error: Optional[str] = None   # se valorizzato, l'estrazione è fallita (file saltato)


@dataclass
class RetrievedChunk:
    """Un frammento di testo (o un riferimento a immagine) recuperato dal RAG
    perché ritenuto rilevante per la domanda dell'utente.
    """
    text: str
    source_file: str
    location_hint: str
    similarity: float
    is_image: bool = False
    image_path: Optional[str] = None
    mime_type: Optional[str] = None


@dataclass
class LocalSearchResult:
    chunks: List[RetrievedChunk] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return len(self.chunks) == 0


@dataclass
class WebResult:
    title: str
    url: str
    snippet: str


@dataclass
class AnswerResult:
    """Risposta finale mostrata in chat, con l'indicazione della fonte."""
    text: str
    source: str   # 'locale' | 'web' | 'nessuna'

"""H12 - Worker offline: sub-agenti reali a PRIORITA' MINIMA (prio 2).

Regole del package:
- NIENTE thread propri: ogni worker e' UNA funzione `run(batch, ctx)` che il
  WorkerRunner sottopone alla CodaPriorita (core.sidecar.queue) con prio=2,
  quindi NON degrada la latenza dei job interattivi (prio 0).
- Modello unico via profilo 'fast' (No-Think), budget classe 'micro'
  (<=200 token di output). Generazione iniettabile:

      llm_fn(prompt, profile='fast', classe='micro') -> str

  default = stub deterministico (test); in produzione il caller passa
  SidecarClient.complete. QUI SidecarClient NON viene importato (decoupling).
- Embedding iniettabile: embed_fn(text) -> list[float] (usato da W4/W5).
- RESUMABLE: checkpoint in dict persistito opzionale in JSON sotto
  qa/worker_state/<id>.json.
- Progress UI: progress_callback(done, total) -> esposto dal runner come
  snapshot() -> {worker, done, total, running, paused}.
"""

from .base import (
    BaseWorker,
    CLASSE,
    DEFAULT_STATE_DIR,
    PROFILO,
    cosine,
    default_llm_fn,
    detect_lang,
)
from .w1_contextualizer import W1Contextualizer
from .w2_summarizer import W2SectionSummarizer
from .w3_flashcards import W3FlashcardPregenerator
from .w4_paraphraser import W4Paraphraser
from .w5_dedup import W5Dedup
from .w6_maintenance import W6Maintenance
from .runner import WorkerRunner

__all__ = [
    "BaseWorker",
    "WorkerRunner",
    "W1Contextualizer",
    "W2SectionSummarizer",
    "W3FlashcardPregenerator",
    "W4Paraphraser",
    "W5Dedup",
    "W6Maintenance",
    "default_llm_fn",
    "detect_lang",
    "cosine",
    "PROFILO",
    "CLASSE",
    "DEFAULT_STATE_DIR",
]

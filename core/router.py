"""
core/router.py
------------------
La "regia" dell'applicazione: dato il testo di una domanda, decide cosa
interrogare e in che ordine seguendo il sistema RAG a 3 livelli, sempre
in quest'ordine:

LIVELLI del RAG:
1. Materiale caricato dallo studente (convertitore appunti: foto/PDF/Word)
2. Materiale in locale in un'altra cartella dedicata (convertitore .md)
3. Materiale e paper online, ristretto a un elenco di fonti affidabili
   predefinito (vedi core/trusted_sources.py)

Se un livello non fornisce informazioni sufficienti, si passa al successivo.

Modalità di studio: oltre al livello RAG, ogni query porta con sé una
modalità di studio ('ripasso', 'esercizio', 'riassunto', 'chiarimento')
che determina il system prompt specifico passato al modello. Il router
si limita a propagarla al client LLM.
"""

from core.local_llm_client import FALLBACK_MARKER, DEFAULT_STUDY_MODE
from core.local_search import LocalSearchEngine
from core.models import AnswerResult
from core.web_search import search_web

MAX_IMAGES_PER_ANSWER = 3
MIN_IMAGE_SIMILARITY = 0.25


def _is_fallback(text: str) -> bool:
    """Riconosce se il modello ha risposto col marcatore di fallback.

    Non basta un confronto esatto: un modello piccolo può aggiungere
    punteggiatura, spazi o una breve introduzione. Consideriamo fallback
    se il marcatore compare nel testo E il testo "utile" oltre al marker
    è breve (<40 caratteri): una risposta reale sul contenuto non
    conterrà mai quel token.
    """
    if FALLBACK_MARKER not in text:
        return False
    stripped = text.replace(FALLBACK_MARKER, "").strip(" .,:;!?\"'()[]\n\t")
    return len(stripped) < 40


class Router:
    def __init__(
        self,
        local_client_provider,
        local_search: LocalSearchEngine,
        books_search: LocalSearchEngine,
        rag_top_k: int = 5,
    ):
        self._get_client = local_client_provider
        self.local_search = local_search
        self.books_search = books_search
        self.rag_top_k = rag_top_k

    def process_query(
        self,
        query: str,
        mode: str,
        thinking: bool = False,
        study_mode: str = DEFAULT_STUDY_MODE,
    ) -> AnswerResult:
        """
        mode: 'automatica' | 'solo_locale' | 'solo_online' → livello RAG
        thinking: se True, attiva la thinking mode del modello (parametro
            enable_thinking del chat template, supportato da MiniCPM5 e
            da altri modelli con chat template ChatML/Qwen3-style)
        study_mode: 'ripasso' | 'esercizio' | 'riassunto' | 'chiarimento'
        """
        from core.local_llm_client import LocalLLMClient
        client: LocalLLMClient = self._get_client()

        if mode == "solo_locale":
            return self._answer_local_only(client, query, thinking, study_mode)
        if mode == "solo_online":
            return self._answer_web_only(client, query, thinking, study_mode)
        return self._answer_automatic(client, query, thinking, study_mode)

    # ------------------------------------------------------------------
    def _answer_local_only(self, client, query, thinking=False, study_mode=DEFAULT_STUDY_MODE) -> AnswerResult:
        local_result = self.local_search.search(query, top_k=self.rag_top_k)
        if local_result.is_empty:
            text = client.generate(
                query, context_kind="none", thinking=thinking, study_mode=study_mode
            )
            return AnswerResult(text=text, source="nessuna")

        images = self._select_images(local_result.chunks)
        text = client.generate(
            query,
            context_kind="locale",
            local_chunks=local_result.chunks,
            images=images,
            thinking=thinking,
            study_mode=study_mode,
        )
        return AnswerResult(text=text, source="locale")

    def _answer_web_only(self, client, query, thinking=False, study_mode=DEFAULT_STUDY_MODE) -> AnswerResult:
        web_results = search_web(query)
        if not web_results:
            text = client.generate(
                query, context_kind="none", thinking=thinking, study_mode=study_mode
            )
            return AnswerResult(text=text, source="nessuna")
        text = client.generate(
            query,
            context_kind="web",
            web_results=web_results,
            thinking=thinking,
            study_mode=study_mode,
        )
        return AnswerResult(text=text, source="web")

    def _answer_automatic(self, client, query, thinking=False, study_mode=DEFAULT_STUDY_MODE) -> AnswerResult:
        # LIVELLO 1: materiale personale dello studente
        local_result = self.local_search.search(query, top_k=self.rag_top_k)

        if not local_result.is_empty:
            images = self._select_images(local_result.chunks)
            text = client.generate(
                query,
                context_kind="locale",
                local_chunks=local_result.chunks,
                images=images,
                allow_fallback_marker=True,
                thinking=thinking,
                study_mode=study_mode,
            )
            if not _is_fallback(text):
                return AnswerResult(text=text, source="locale")

        # LIVELLO 2: cartella libri / materiali in Markdown
        books_result = self.books_search.search(query, top_k=self.rag_top_k)

        if not books_result.is_empty:
            images = self._select_images(books_result.chunks)
            text = client.generate(
                query,
                context_kind="locale",
                local_chunks=books_result.chunks,
                images=images,
                allow_fallback_marker=True,
                thinking=thinking,
                study_mode=study_mode,
            )
            if not _is_fallback(text):
                return AnswerResult(text=text, source="libri_preselezionati")

        # LIVELLO 3: ricerca online ristretta a fonti affidabili
        return self._answer_web_only(client, query, thinking, study_mode)

    @staticmethod
    def _select_images(chunks):
        images = []
        for c in chunks:
            if len(images) >= MAX_IMAGES_PER_ANSWER:
                break
            if c.is_image and c.image_path and c.similarity >= MIN_IMAGE_SIMILARITY:
                try:
                    with open(c.image_path, "rb") as f:
                        images.append((f.read(), c.mime_type or "image/png"))
                except OSError:
                    continue
        return images
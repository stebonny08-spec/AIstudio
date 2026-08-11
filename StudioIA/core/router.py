"""
core/router.py
------------------
La "regia" dell'applicazione: dato il testo di una domanda, l'ambiente
(Chat Normale / Tutor) decide cosa interrogare e in che ordine seguendo
il sistema RAG a 3 livelli:

LIVELLI del RAG (in ordine sequenziale):
1. Materiale caricato dallo studente (cartella personale configurata)
2. Libri e documenti pre-selezionati (inclusi nell'app, livello 2)
3. Materiale e paper online (ricerca web, livello 3)

Se un livello non fornisce informazioni sufficienti, si passa al successivo.
Il modello LLM locale valuta se le informazioni trovate sono adequate usando
il marcatore FALLBACK_MARKER.
"""

import os

from core.local_llm_client import FALLBACK_MARKER, LocalLLMError
from core.local_search import LocalSearchEngine
from core.models import AnswerResult
from core.web_search import search_web
from data.preselected_books_manager import PreselectedBooksManager

MAX_IMAGES_PER_ANSWER = 3
# Soglia minima di similarità per allegare un'immagine alla richiesta al
# modello LLM locale: evita di mandare immagini poco pertinenti solo perché erano tra
# i primi risultati del RAG.
MIN_IMAGE_SIMILARITY = 0.25


class Router:
    def __init__(self, local_client_provider, local_search: LocalSearchEngine, rag_top_k: int = 5):
        """
        local_client_provider: funzione (senza argomenti) che ritorna
            l'istanza corrente di LocalLLMClient. Usare una funzione invece di
            passare direttamente l'oggetto permette di aggiornare la configurazione
            dalle Impostazioni senza dover ricostruire il Router.
        """
        self._get_client = local_client_provider
        self.local_search = local_search
        self.rag_top_k = rag_top_k
        self.books_manager = PreselectedBooksManager()

    def process_query(self, query: str, ambiente: str, mode: str) -> AnswerResult:
        """
        mode: 'automatica' | 'solo_locale' | 'solo_online'
        ambiente: 'chat' | 'tutor'
        
        In modalità automatica, segue il sistema RAG a 3 livelli:
        1. Materiale dello studente (cartella personale)
        2. Libri pre-selezionati (se il livello 1 fallisce)
        3. Ricerca web (se anche il livello 2 fallisce)
        """
        from core.local_llm_client import LocalLLMClient
        client: LocalLLMClient = self._get_client()

        if mode == "solo_locale":
            return self._answer_local_only(client, query, ambiente)
        if mode == "solo_online":
            return self._answer_web_only(client, query, ambiente)
        return self._answer_automatic(client, query, ambiente)

    # ------------------------------------------------------------------
    def _answer_local_only(self, client, query, ambiente) -> AnswerResult:
        local_result = self.local_search.search(query, top_k=self.rag_top_k)
        if local_result.is_empty:
            text = client.generate(query, ambiente=ambiente, context_kind="none")
            return AnswerResult(text=text, source="nessuna")

        images = self._select_images(local_result.chunks)
        text = client.generate(
            query,
            ambiente=ambiente,
            context_kind="locale",
            local_chunks=local_result.chunks,
            images=images,
        )
        return AnswerResult(text=text, source="locale")

    def _answer_web_only(self, client, query, ambiente) -> AnswerResult:
        web_results = search_web(query)
        if not web_results:
            text = client.generate(query, ambiente=ambiente, context_kind="none")
            return AnswerResult(text=text, source="nessuna")
        text = client.generate(query, ambiente=ambiente, context_kind="web", web_results=web_results)
        return AnswerResult(text=text, source="web")

    def _answer_automatic(self, client, query, ambiente) -> AnswerResult:
        """
        Implementa il sistema RAG a 3 livelli:
        LIVELLO 1: Materiale dello studente (cartella personale)
        LIVELLO 2: Libri pre-selezionati (se livello 1 fallisce)
        LIVELLO 3: Ricerca web (se anche livello 2 fallisce)
        """
        # LIVELLO 1: Cerca nei file personali dello studente
        local_result = self.local_search.search(query, top_k=self.rag_top_k)

        if not local_result.is_empty:
            # Livello 1 ha trovato qualcosa: proviamo a rispondere
            images = self._select_images(local_result.chunks)
            text = client.generate(
                query,
                ambiente=ambiente,
                context_kind="locale",
                local_chunks=local_result.chunks,
                images=images,
                allow_fallback_marker=True,
            )

            if text.strip() != FALLBACK_MARKER:
                # Il modello è riuscito a rispondere con il materiale dello studente
                return AnswerResult(text=text, source="locale")
        
        # LIVELLO 2: Il livello 1 è vuoto o insufficiente, proviamo i libri pre-selezionati
        books_path = self.books_manager.get_books_folder_path()
        if os.path.isdir(books_path) and self.books_manager.has_books():
            # Creiamo un search engine temporaneo per i libri pre-selezionati
            from core.rag.vector_store import VectorStore
            from data.config_manager import get_app_data_dir
            
            books_vector_dir = str(get_app_data_dir() / "vector_index_books")
            books_vector_store = VectorStore(books_vector_dir)
            books_search = LocalSearchEngine(self.local_search.db, books_vector_store, self.local_search.embedder)
            
            # Aggiorniamo l'indice dei libri (incrementale)
            books_search.ensure_index_updated(
                books_path,
                ocr_enabled=True,
            )
            
            # Cerchiamo nei libri
            books_result = books_search.search(query, top_k=self.rag_top_k)
            
            if not books_result.is_empty:
                images = self._select_images(books_result.chunks)
                text = client.generate(
                    query,
                    ambiente=ambiente,
                    context_kind="locale",
                    local_chunks=books_result.chunks,
                    images=images,
                    allow_fallback_marker=True,
                )
                
                if text.strip() != FALLBACK_MARKER:
                    # Il modello è riuscito a rispondere con i libri pre-selezionati
                    return AnswerResult(text=text, source="libri_preselezionati")
        
        # LIVELLO 3: Né materiale personale né libri pre-selezionati sono sufficienti,
        # passiamo alla ricerca web
        return self._answer_web_only(client, query, ambiente)

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

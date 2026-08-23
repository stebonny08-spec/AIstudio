"""
core/router.py
------------------
La "regia" dell'applicazione: dato il testo di una domanda, l'ambiente
(Chat Normale / Tutor) decide cosa interrogare e in che ordine seguendo
il sistema RAG a 3 livelli, sempre in quest'ordine (misto/sequenziale):

LIVELLI del RAG:
1. Materiale caricato dallo studente (convertitore appunti: foto/PDF/Word)
2. Materiale in locale in un'altra cartella dedicata (convertitore .md,
   es. libri scaricati da un'app esterna)
3. Materiale e paper online, ristretto a un elenco di fonti affidabili
   predefinito (vedi core/trusted_sources.py)

Se un livello non fornisce informazioni sufficienti, si passa al successivo.
Il modello LLM locale valuta se le informazioni trovate sono adeguate usando
il marcatore FALLBACK_MARKER.
"""

from core.local_llm_client import FALLBACK_MARKER
from core.local_search import LocalSearchEngine
from core.models import AnswerResult
from core.web_search import search_web

MAX_IMAGES_PER_ANSWER = 3
# Soglia minima di similarità per allegare un'immagine alla richiesta al
# modello LLM locale: evita di mandare immagini poco pertinenti solo perché erano tra
# i primi risultati del RAG.
MIN_IMAGE_SIMILARITY = 0.25


class Router:
    def __init__(
        self,
        local_client_provider,
        local_search: LocalSearchEngine,
        books_search: LocalSearchEngine,
        rag_top_k: int = 5,
    ):
        """
        local_client_provider: funzione (senza argomenti) che ritorna
            l'istanza corrente di LocalLLMClient. Usare una funzione invece di
            passare direttamente l'oggetto permette di aggiornare la configurazione
            dalle Impostazioni senza dover ricostruire il Router.
        local_search: motore di ricerca del LIVELLO 1 (materiale dello studente).
        books_search: motore di ricerca del LIVELLO 2 (cartella libri/materiali
            in Markdown), un'istanza persistente condivisa con il pannello
            "Aggiungi materiale" così i nuovi file caricati sono subito
            consultabili senza dover ricostruire nulla.
        """
        self._get_client = local_client_provider
        self.local_search = local_search
        self.books_search = books_search
        self.rag_top_k = rag_top_k

    def process_query(self, query: str, ambiente: str, mode: str) -> AnswerResult:
        """
        mode: 'automatica' | 'solo_locale' | 'solo_online'
        ambiente: 'chat' | 'tutor'
        
        In modalità automatica, segue il sistema RAG a 3 livelli:
        1. Materiale dello studente (convertitore appunti)
        2. Materiale in Markdown nella cartella dedicata (se il livello 1 fallisce)
        3. Ricerca online su fonti affidabili predefinite (se anche il livello 2 fallisce)
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
        Implementa il sistema RAG a 3 livelli, sempre in quest'ordine:
        LIVELLO 1: Materiale dello studente (convertitore appunti)
        LIVELLO 2: Materiale in Markdown nella cartella dedicata (se livello 1 fallisce)
        LIVELLO 3: Ricerca online su fonti affidabili predefinite (se anche livello 2 fallisce)
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
        
        # LIVELLO 2: Il livello 1 è vuoto o insufficiente, proviamo la cartella
        # dedicata dei materiali in Markdown (libri)
        books_result = self.books_search.search(query, top_k=self.rag_top_k)

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
        
        # LIVELLO 3: Né materiale personale né libri sono sufficienti,
        # passiamo alla ricerca online (ristretta a fonti affidabili predefinite)
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

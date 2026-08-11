"""
core/router.py
------------------
La "regia" dell'applicazione: dato il testo di una domanda, l'ambiente
(Chat Normale / Tutor) e la modalità di ricerca scelta dall'utente
(Automatica, Solo Locale, Solo Online), decide cosa interrogare e in che
ordine, e ritorna la risposta finale con l'indicazione della fonte usata.

Modalità Automatica: viene sempre provato prima il RAG locale. Se il
CONTENUTO locale trovato non è sufficiente, è Gemini stesso a deciderlo
(rispondendo con un marcatore speciale, vedi gemini_client.FALLBACK_MARKER)
e solo a quel punto si passa alla ricerca web. Questo rispecchia fedelmente
il comportamento richiesto: è l'IA a determinare se i file locali bastano.
"""

from core.gemini_client import FALLBACK_MARKER, GeminiClient
from core.local_search import LocalSearchEngine
from core.models import AnswerResult
from core.web_search import search_web

MAX_IMAGES_PER_ANSWER = 3
# Soglia minima di similarità per allegare un'immagine alla richiesta a
# Gemini: evita di mandare immagini poco pertinenti solo perché erano tra
# i primi risultati del RAG.
MIN_IMAGE_SIMILARITY = 0.25


class Router:
    def __init__(self, gemini_client_provider, local_search: LocalSearchEngine, rag_top_k: int = 5):
        """
        gemini_client_provider: funzione (senza argomenti) che ritorna
            l'istanza corrente di GeminiClient. Usare una funzione invece di
            passare direttamente l'oggetto permette di aggiornare la chiave
            API dalle Impostazioni senza dover ricostruire il Router.
        """
        self._get_client = gemini_client_provider
        self.local_search = local_search
        self.rag_top_k = rag_top_k

    def process_query(self, query: str, ambiente: str, mode: str) -> AnswerResult:
        """
        mode: 'automatica' | 'solo_locale' | 'solo_online'
        ambiente: 'chat' | 'tutor'
        """
        client: GeminiClient = self._get_client()

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
        local_result = self.local_search.search(query, top_k=self.rag_top_k)

        if local_result.is_empty:
            # Niente nei file locali: passiamo direttamente al web senza
            # sprecare una chiamata a Gemini per fargli "scoprire" l'ovvio.
            return self._answer_web_only(client, query, ambiente)

        images = self._select_images(local_result.chunks)
        text = client.generate(
            query,
            ambiente=ambiente,
            context_kind="locale",
            local_chunks=local_result.chunks,
            images=images,
            allow_fallback_marker=True,
        )

        if text.strip() == FALLBACK_MARKER:
            # È l'IA stessa a determinare che il contesto locale non basta:
            # solo a questo punto si passa al web.
            return self._answer_web_only(client, query, ambiente)

        return AnswerResult(text=text, source="locale")

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

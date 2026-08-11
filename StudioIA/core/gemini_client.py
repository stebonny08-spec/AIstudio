"""
core/gemini_client.py
------------------------
Incapsula tutte le chiamate a Google Gemini tramite l'SDK ufficiale nuovo
('google-genai'; il vecchio 'google-generativeai' è deprecato da Google).

Qui vive anche la logica dei "prompt di sistema": cambiano in base
all'ambiente (Chat Normale vs Modalità Insegnamento) e al fatto che sia
consentito o meno il fallback automatico dalla ricerca locale al web.
"""

from typing import List, Optional, Sequence, Tuple

from core.models import RetrievedChunk, WebResult

FALLBACK_MARKER = "[[NESSUNA_INFORMAZIONE_LOCALE]]"

_BASE_INSTRUCTIONS = {
    "chat": (
        "Sei un assistente utile e diretto integrato in un'app desktop. "
        "Rispondi sempre in italiano, in modo chiaro e conciso, usando le "
        "informazioni fornite nel CONTESTO qui sotto quando disponibili."
    ),
    "tutor": (
        "Sei un tutor che aiuta l'utente a studiare. Non limitarti a una "
        "risposta diretta e stringata: spiega i concetti presenti nel "
        "CONTESTO con esempi pratici, analogie semplici e, se utile, piccoli "
        "schemi testuali. Rispondi sempre in italiano. Concludi SEMPRE la "
        "spiegazione con una o due domande di verifica per stimolare "
        "l'apprendimento attivo dell'utente, anche se non ti viene chiesto "
        "esplicitamente."
    ),
}

_FALLBACK_INSTRUCTION = (
    "\n\nSe il CONTESTO qui sotto non contiene informazioni sufficienti per "
    "rispondere alla domanda dell'utente, non usare conoscenze generali: "
    f"rispondi ESATTAMENTE con il testo '{FALLBACK_MARKER}' e nient'altro, "
    "senza aggiungere spiegazioni o commenti."
)

_NO_FALLBACK_LOCAL_INSTRUCTION = (
    "\n\nSe il CONTESTO qui sotto non contiene informazioni sufficienti per "
    "rispondere, dillo onestamente all'utente invece di inventare una risposta."
)

_NO_CONTEXT_INSTRUCTION = (
    "\n\nNon è stato fornito alcun contesto (né locale né web): rispondi "
    "usando le tue conoscenze generali, specificando che non è stato trovato "
    "materiale specifico dell'utente sull'argomento."
)


class GeminiError(Exception):
    """Errore applicativo user-friendly: la GUI lo mostra così com'è,
    senza dover interpretare le eccezioni interne dell'SDK di Google."""
    pass


def _format_local_context(chunks: Sequence[RetrievedChunk]) -> str:
    parts = []
    for c in chunks:
        etichetta = f"{c.source_file} ({c.location_hint})" if c.location_hint else c.source_file
        parts.append(f"[Fonte locale: {etichetta}]\n{c.text}")
    return "\n\n---\n\n".join(parts)


def _format_web_context(results: Sequence[WebResult]) -> str:
    parts = []
    for r in results:
        parts.append(f"[Fonte web: {r.title} — {r.url}]\n{r.snippet}")
    return "\n\n---\n\n".join(parts)


class GeminiClient:
    def __init__(self, api_key: str, model_name: str = "gemini-3.5-flash"):
        if not api_key or not api_key.strip():
            raise GeminiError("Nessuna chiave API configurata. Aprire Impostazioni e inserirla.")

        from google import genai

        self._genai = genai
        self.model_name = model_name
        self.client = genai.Client(api_key=api_key)

    def generate(
        self,
        query: str,
        ambiente: str,
        context_kind: str = "none",
        local_chunks: Optional[Sequence[RetrievedChunk]] = None,
        web_results: Optional[Sequence[WebResult]] = None,
        allow_fallback_marker: bool = False,
        images: Optional[Sequence[Tuple[bytes, str]]] = None,
    ) -> str:
        """Genera una risposta.

        ambiente: 'chat' o 'tutor' -> determina la "personalità" del prompt.
        context_kind: 'locale' | 'web' | 'none' -> quale contesto stiamo fornendo.
        allow_fallback_marker: se True, il modello può rispondere con
            FALLBACK_MARKER quando il contesto locale è insufficiente
            (usato in modalità Automatica, per far decidere all'IA se
            serve passare al web, come richiesto dalla specifica).
        images: lista di (bytes, mime_type) di immagini rilevanti da allegare.
        """
        system_instruction = _BASE_INSTRUCTIONS.get(ambiente, _BASE_INSTRUCTIONS["chat"])

        if allow_fallback_marker:
            system_instruction += _FALLBACK_INSTRUCTION
        elif context_kind == "locale":
            system_instruction += _NO_FALLBACK_LOCAL_INSTRUCTION
        elif context_kind == "none":
            system_instruction += _NO_CONTEXT_INSTRUCTION

        if context_kind == "locale" and local_chunks:
            context_text = _format_local_context(local_chunks)
        elif context_kind == "web" and web_results:
            context_text = _format_web_context(web_results)
        else:
            context_text = "(nessun contesto disponibile)"

        prompt_text = f"CONTESTO:\n{context_text}\n\nDOMANDA DELL'UTENTE:\n{query}"

        contents: List = [prompt_text]
        if images:
            from google.genai import types

            for image_bytes, mime_type in images:
                try:
                    contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
                except Exception:
                    # Un'immagine malformata non deve far fallire l'intera richiesta.
                    continue

        try:
            from google.genai import types

            response = self.client.models.generate_content(
                model=self.model_name,
                contents=contents,
                config=types.GenerateContentConfig(system_instruction=system_instruction),
            )
        except Exception as e:
            raise GeminiError(self._friendly_error(e)) from e

        text = (response.text or "").strip()
        if not text:
            raise GeminiError("Gemini ha restituito una risposta vuota. Riprovare.")
        return text

    @staticmethod
    def _friendly_error(e: Exception) -> str:
        msg = str(e).lower()
        if "api key" in msg or "api_key" in msg or "permission" in msg or "unauthorized" in msg:
            return "Chiave API non valida o non autorizzata. Controllarla in Impostazioni."
        if "quota" in msg or "rate" in msg or "429" in msg:
            return "Limite di richieste raggiunto (quota Gemini). Riprovare tra poco."
        if "timeout" in msg or "connection" in msg or "network" in msg:
            return "Errore di connessione a Gemini. Controllare la connessione internet."
        return f"Errore nella richiesta a Gemini: {e}"

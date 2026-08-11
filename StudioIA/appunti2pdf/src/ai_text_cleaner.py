"""
ai_text_cleaner.py
FLUSSO A - Step 2: invia il testo grezzo estratto dall'OCR a un LLM (Gemini)
con un prompt leggero, per ricostruire le frasi, correggere gli errori di
trascrizione e sciogliere le abbreviazioni personali dello studente.

Usa l'SDK ufficiale e attualmente supportato 'google-genai' (il precedente
pacchetto 'google-generativeai' e' deprecato).
"""
from __future__ import annotations

from typing import Optional

from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .config import AI_SETTINGS, get_logger

logger = get_logger(__name__)

_SYSTEM_PROMPT = """Sei un assistente che ripulisce appunti universitari trascritti automaticamente da un OCR \
a partire da scrittura a mano. Il testo che ricevi puo' contenere: errori di riconoscimento, parole spezzate, \
abbreviazioni personali dello studente e punteggiatura mancante.

Il tuo compito, nell'ordine:
1. Correggi gli evidenti errori di trascrizione OCR, SENZA inventare contenuti nuovi non presenti nel testo.
2. Sciogli le abbreviazioni comuni e quelle deducibili dal contesto (es. "cmq" -> "comunque", \
"imp." -> "importante", "xk"/"xké" -> "perche'", "es." -> "esempio", "qst" -> "questo/questa"), mantenendo \
inalterato il significato originale.
3. Ricostruisci una punteggiatura e una suddivisione in paragrafi leggibili (usa una riga vuota tra un paragrafo \
e l'altro), senza alterare il senso delle frasi ne' l'ordine degli argomenti.
4. Se una parola OCR e' totalmente incomprensibile e non deducibile dal contesto, lasciala segnalata tra \
parentesi quadre, ad esempio [parola incerta], invece di inventarla.
5. Mantieni sempre la lingua originale del testo (italiano).
6. Non aggiungere MAI commenti, titoli, introduzioni, note editoriali o frasi tipo "Ecco il testo pulito": \
restituisci esclusivamente il testo pulito finale, e nient'altro."""


class TextCleanerAIError(RuntimeError):
    """Errore durante la pulizia del testo tramite AI."""


class TextCleanerAI:
    """Wrapper per la pulizia testuale via Gemini (chiamata testo-testo, a basso consumo di token)."""

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        self.api_key = (api_key or AI_SETTINGS.api_key or "").strip()
        self.model_name = model_name or AI_SETTINGS.text_model
        if not self.api_key:
            raise TextCleanerAIError(
                "Nessuna API key Gemini configurata. Impostala nella barra laterale oppure nel file .env "
                "(variabile GEMINI_API_KEY)."
            )
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from google import genai
            except ImportError as exc:
                raise TextCleanerAIError(
                    "La libreria 'google-genai' non e' installata. Esegui: pip install google-genai"
                ) from exc
            try:
                self._client = genai.Client(api_key=self.api_key)
            except Exception as exc:  # noqa: BLE001
                raise TextCleanerAIError(f"Impossibile inizializzare il client Gemini: {exc}") from exc
        return self._client

    @retry(
        stop=stop_after_attempt(max(1, AI_SETTINGS.max_retries)),
        wait=wait_exponential(multiplier=1.5, min=2, max=20),
        retry=retry_if_exception_type(Exception),
        reraise=True,
    )
    def clean_text(self, raw_text: str) -> str:
        """
        Invia il testo grezzo OCR al modello e restituisce il testo pulito.
        Se il testo grezzo e' vuoto, restituisce una stringa vuota senza
        effettuare alcuna chiamata API (nessun costo).
        """
        raw_text = (raw_text or "").strip()
        if not raw_text:
            return ""

        try:
            from google.genai import types
        except ImportError as exc:
            raise TextCleanerAIError(
                "La libreria 'google-genai' non e' installata. Esegui: pip install google-genai"
            ) from exc

        client = self._get_client()
        try:
            response = client.models.generate_content(
                model=self.model_name,
                contents=raw_text,
                config=types.GenerateContentConfig(
                    system_instruction=_SYSTEM_PROMPT,
                    temperature=AI_SETTINGS.temperature,
                ),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Errore nella chiamata Gemini (pulizia testo): %s", exc)
            raise

        cleaned = (getattr(response, "text", None) or "").strip()
        if not cleaned:
            raise TextCleanerAIError("Risposta AI vuota o non valida durante la pulizia del testo.")
        return cleaned

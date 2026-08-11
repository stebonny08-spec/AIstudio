"""
ai_vision_analyzer.py
FLUSSO B - Step 1+2: invia la foto della mappa concettuale / schema a blocchi
a un modello multimodale (Gemini) che ne interpreta la struttura visiva
(posizione dei blocchi, direzione delle frecce, gerarchia) e la traduce in
una gerarchia testuale Markdown lineare, sciogliendo le abbreviazioni.

Usa l'SDK ufficiale e attualmente supportato 'google-genai' (il precedente
pacchetto 'google-generativeai' e' deprecato).
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .config import AI_SETTINGS, get_logger

logger = get_logger(__name__)

_SYSTEM_PROMPT = """Sei un assistente che trasforma foto di mappe concettuali e schemi a blocchi disegnati a \
mano (appunti universitari) in una gerarchia testuale chiara, in formato Markdown.

Regole fondamentali, da seguire sempre:
1. NON generare codice per diagrammi (niente Mermaid, niente grafici, niente tabelle complesse): produci SOLO \
testo Markdown gerarchico, usando titoli (#, ##, ###) ed elenchi puntati (righe che iniziano con "- ").
2. Interpreta la posizione spaziale dei blocchi/riquadri e la direzione delle frecce per ricostruire le \
relazioni logiche tra i concetti. Esprimi ogni relazione in forma testuale esplicita, ad esempio: \
"- Concetto A -> porta a -> Concetto B" oppure "- Concetto A e' causa di Concetto B".
3. Sciogli le abbreviazioni riconoscibili dal contesto (es. "cmq" -> "comunque", "vs" -> "contro", \
"cap." -> "capitolo"), mantenendo il significato originale.
4. Mantieni la gerarchia concettuale originale dello schema: il concetto principale/centrale diventa il titolo \
di primo livello, i sotto-concetti diventano elenchi annidati (usa 2 spazi di indentazione per ogni livello \
di annidamento).
5. Se una parte dell'immagine e' illeggibile, indicalo esplicitamente con [illeggibile] invece di inventare \
contenuto plausibile.
6. Mantieni sempre la lingua originale (italiano).
7. Non aggiungere MAI commenti, introduzioni o spiegazioni sul tuo processo di analisi (es. "Ecco lo schema \
tradotto"): restituisci esclusivamente il Markdown risultante, e nient'altro."""

_USER_PROMPT = (
    "Analizza questa immagine di uno schema o mappa concettuale scritta a mano e traducila in un elenco "
    "Markdown gerarchico, seguendo rigorosamente le regole indicate nelle istruzioni di sistema."
)


class VisionAnalyzerAIError(RuntimeError):
    """Errore durante l'analisi visiva tramite AI."""


class VisionAnalyzerAI:
    """Wrapper per l'analisi di mappe/schemi via Gemini (modello multimodale)."""

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        self.api_key = (api_key or AI_SETTINGS.api_key or "").strip()
        self.model_name = model_name or AI_SETTINGS.vision_model
        if not self.api_key:
            raise VisionAnalyzerAIError(
                "Nessuna API key Gemini configurata. Impostala nella barra laterale oppure nel file .env "
                "(variabile GEMINI_API_KEY)."
            )
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from google import genai
            except ImportError as exc:
                raise VisionAnalyzerAIError(
                    "La libreria 'google-genai' non e' installata. Esegui: pip install google-genai"
                ) from exc
            try:
                self._client = genai.Client(api_key=self.api_key)
            except Exception as exc:  # noqa: BLE001
                raise VisionAnalyzerAIError(f"Impossibile inizializzare il client Gemini: {exc}") from exc
        return self._client

    @retry(
        stop=stop_after_attempt(max(1, AI_SETTINGS.max_retries)),
        wait=wait_exponential(multiplier=1.5, min=2, max=20),
        retry=retry_if_exception_type(Exception),
        reraise=True,
    )
    def analyze_image(self, image_path: Path) -> str:
        """Invia l'immagine al modello Vision e restituisce il Markdown strutturato risultante."""
        try:
            from PIL import Image
        except ImportError as exc:
            raise VisionAnalyzerAIError("La libreria 'Pillow' non e' installata. Esegui: pip install Pillow") from exc

        try:
            image = Image.open(image_path)
            image.load()
        except Exception as exc:  # noqa: BLE001
            raise VisionAnalyzerAIError(f"Impossibile aprire l'immagine '{image_path.name}': {exc}") from exc

        try:
            from google.genai import types
        except ImportError as exc:
            raise VisionAnalyzerAIError(
                "La libreria 'google-genai' non e' installata. Esegui: pip install google-genai"
            ) from exc

        client = self._get_client()
        try:
            response = client.models.generate_content(
                model=self.model_name,
                contents=[_USER_PROMPT, image],
                config=types.GenerateContentConfig(
                    system_instruction=_SYSTEM_PROMPT,
                    temperature=AI_SETTINGS.temperature,
                ),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Errore nella chiamata Gemini (vision) su '%s': %s", image_path.name, exc)
            raise

        result = (getattr(response, "text", None) or "").strip()
        if not result:
            raise VisionAnalyzerAIError(f"Risposta AI vuota durante l'analisi di '{image_path.name}'.")
        return result

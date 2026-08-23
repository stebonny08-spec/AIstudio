"""
core/local_llm_client.py
------------------------
Incapsula tutte le chiamate a un modello LLM locale che gira nativamente
dentro l'applicazione, senza bisogno di server esterni come Ollama o LM Studio.

Utilizza llama-cpp-python per caricare modelli in formato GGUF direttamente
nella memoria dell'applicazione. Il modello deve essere scaricato dall'utente
e specificato nelle impostazioni.

Questo modulo sostituisce gemini_client.py e permette di usare un modello
che gira in locale dopo il fine-tuning, senza dipendere da API esterne.
"""

from typing import List, Optional, Sequence, Tuple
import os
from pathlib import Path

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
    f"rispondere alla domanda dell'utente, non usare conoscenze generali: "
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


class LocalLLMError(Exception):
    """Errore applicativo user-friendly: la GUI lo mostra così com'è,
    senza dover interpretare le eccezioni interne delle chiamate HTTP."""
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


class LocalLLMClient:
    """
    Client per modelli LLM locali che girano nativamente dentro l'applicazione
    tramite llama-cpp-python. Non richiede server esterni come Ollama o LM Studio.
    
    Il modello deve essere scaricato in formato GGUF e specificato nelle impostazioni.
    Modelli consigliati:
    - Llama-3-8B-Instruct-GGUF
    - Mistral-7B-Instruct-GGUF
    - Phi-3-mini-4k-instruct-GGUF
    
    Dove scaricare modelli GGUF:
    - https://huggingface.co/TheBloke
    - https://huggingface.co/bartowski
    - https://huggingface.co/lmstudio-community
    """
    
    def __init__(
        self, 
        model_path: str = "",
        n_ctx: int = 4096,
        n_gpu_layers: int = -1,  # -1 = tutte le layer su GPU se disponibile
        n_threads: Optional[int] = None,
    ):
        if not model_path or not model_path.strip():
            raise LocalLLMError(
                "Nessun percorso modello configurato. Aprire Impostazioni e selezionare "
                "il file del modello GGUF."
            )
        
        if not os.path.exists(model_path):
            raise LocalLLMError(
                f"Il file del modello non esiste: {model_path}. "
                "Verificare il percorso nelle Impostazioni."
            )

        self.model_path = model_path
        self.n_ctx = n_ctx
        self.n_gpu_layers = n_gpu_layers
        self.n_threads = n_threads or max(1, os.cpu_count() - 1)
        
        # Carichiamo il modello lazy (solo quando serve)
        self._model = None

    def _get_model(self):
        """Carica il modello llama-cpp solo al primo utilizzo."""
        if self._model is None:
            try:
                from llama_cpp import Llama
            except ImportError:
                raise LocalLLMError(
                    "llama-cpp-python non è installato. Eseguire: pip install llama-cpp-python"
                )
            
            try:
                self._model = Llama(
                    model_path=self.model_path,
                    n_ctx=self.n_ctx,
                    n_gpu_layers=self.n_gpu_layers,
                    n_threads=self.n_threads,
                    verbose=False,
                )
            except Exception as e:
                raise LocalLLMError(
                    f"Errore nel caricamento del modello: {e}. "
                    "Verificare che il file GGUF sia valido e compatibile."
                )
        
        return self._model

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
        """Genera una risposta usando il modello locale.

        ambiente: 'chat' o 'tutor' -> determina la "personalità" del prompt.
        context_kind: 'locale' | 'web' | 'none' -> quale contesto stiamo fornendo.
        allow_fallback_marker: se True, il modello può rispondere con
            FALLBACK_MARKER quando il contesto locale è insufficiente.
        images: lista di (bytes, mime_type) di immagini rilevanti da allegare.
            NOTA: I modelli GGUF standard non supportano nativamente le immagini.
            Se vengono fornite immagini, vengono ignorate con un warning.
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

        # Avviso per immagini non supportate
        if images:
            # I modelli GGUF standard non supportano immagini multimodali
            # Potremmo usare modelli speciali come LLaVA, ma per ora le ignoriamo
            pass

        # Costruiamo il prompt nel formato chat
        messages = [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt_text}
        ]

        try:
            model = self._get_model()
            
            response = model.create_chat_completion(
                messages=messages,
                temperature=0.7,
                max_tokens=2048,
                stop=["</s>", "<|eot_id|>", "<|end_of_turn|>"],
            )
            
            if not response or not response.get("choices"):
                raise LocalLLMError("Il modello ha restituito una risposta vuota. Riprovare.")
            
            text = response["choices"][0]["message"]["content"].strip()
            
            if not text:
                raise LocalLLMError("Il modello ha restituito una risposta vuota. Riprovare.")
                
            return text
            
        except LocalLLMError:
            raise
        except Exception as e:
            raise LocalLLMError(f"Errore nella generazione della risposta: {e}")

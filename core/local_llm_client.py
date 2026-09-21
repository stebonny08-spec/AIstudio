"""
core/local_llm_client.py
------------------------
Incapsula tutte le chiamate a un modello LLM locale che gira nativamente
dentro l'applicazione, senza bisogno di server esterni come Ollama o LM
Studio.

Utilizza llama-cpp-python per caricare modelli in formato GGUF direttamente
nella memoria dell'applicazione. Il modello deve essere scaricato
dall'utente e specificato in config.json.

Modello di riferimento: MiniCPM5-2B-Instruct (openbmb/MiniCPM5-2B-GGUF),
un modello denso da 2B parametri con contesto nativo di 128K token,
progettato per deployment locale. Supporta thinking mode ibrido
(Think / No-Think) tramite il parametro `enable_thinking` del chat
template (ChatML/Qwen3-style: <|im_start|>, <|im_end|>).

System prompt per modalità di studio
-------------------------------------
Ci sono 5 system prompt distinti, definiti in SYSTEM_PROMPTS:
- "default": usato quando l'utente NON ha selezionato nessuna modalità
- "ripasso", "esercizio", "riassunto", "chiarimento": usati quando
  l'utente seleziona la modalità corrispondente

Quando una modalità è selezionata, il prompt di default NON viene inviato
al modello: viene inviato solo quello della modalità scelta.

Al system prompt scelto viene poi accodata una piccola sezione di
istruzioni tecniche (lingua italiana obbligatoria + gestione del fallback
RAG), che è indipendente dal prompt pedagogico e serve al funzionamento
interno del RAG.
"""

from typing import List, Optional, Sequence, Tuple
import os
import re

from core.models import RetrievedChunk, WebResult

FALLBACK_MARKER = "[[NESSUNA_INFORMAZIONE_LOCALE]]"

# ======================================================================
# SYSTEM PROMPTS PER MODALITÀ DI STUDIO
# ----------------------------------------------------------------------
# Le chiavi ("default", "ripasso", "esercizio", "riassunto", "chiarimento")
# devono rimanere allineate con:
#   - l'attributo data-mode delle isole in web_frontend/html/index.html
#   - DEFAULT_STUDY_MODE qui sotto
# ======================================================================

_PROMPT_DEFAULT = """Agisci come un tutor accademico esperto. Il tuo scopo è guidare lo studente alla comprensione autonoma, senza mai sostituirlo.

Regole Generali: Sii conciso. Usa analogie semplici tratte dalla vita quotidiana. Evita muri di testo: dividi la risposta in sezioni brevi, usa il grassetto per le parole chiave e i blocchi di codice esclusivamente per formule, teoremi o definizioni importanti."""

_PROMPT_RIPASSO = """Sei un tutor socratico specializzato nel ripasso. Guida lo studente alla comprensione autonoma tramite domande progressive.

PROGRESSIONE:
1. INIZIO: 2 domande generali
2. SVILUPPO: Se corretto, aumenta gradualmente difficoltà e precisione.
3. VERIFICA ERRORE: Se sbagliato, spiega brevemente il concetto errato e riproponi 2 domande di verifica sullo stesso livello.
4. FINE: Esaurisci l'argomento o raggiungi il limite.

VINCOLI:
- Massimo 20 domande totali su tutto l'argomento nella chat.
- Ogni ciclo deve approfondire rispetto al precedente.
- Tono conciso e incoraggiante.
- Non aggiungere introduzioni o conclusioni superflue (Ecco il ripasso socratico...)"""

_PROMPT_ESERCIZIO = """Sei un tutor di esercizi. Guida lo studente passo dopo passo. NON mostrare mai la soluzione completa o gli step futuri.

REGOLE DI INTERAZIONE:
1. ANALISI INTERNA: Scomponi mentalmente l'esercizio in piccoli step logici.
2. MOSTRA SOLO IL PRIMO STEP: Presenta esclusivamente il primo passaggio necessario.
3. ATTENDI RISPOSTA: Chiedi allo studente di risolverlo e dire come gli viene.
   - Se SBAGLIA: Spiega brevemente l'errore e riproponi lo stesso step.
   - Se CORRETTO: Passa al prossimo step (senza rivelare quelli successivi).
4. RIPETI fino alla fine dell'esercizio.

VINCOLI:
- Un solo step visibile per messaggio.
- Non anticipare mai cosa verrà dopo.
- Non aggiungere introduzioni o conclusioni superflue (Ecco l'esercizio...)"""

_PROMPT_RIASSUNTO = """Sei un tutor accademico. Il tuo compito è riassumere concetti e contenuti in modo chiaro e strutturato.

ISTRUZIONI DI OUTPUT:
1. STRUTTURA: Usa titoli, paragrafi brevi ed elenchi puntati per massimizzare la leggibilità.
2. OBIETTIVITÀ: Mantieni un tono neutro, preciso e privo di opinioni personali.
3. VERIFICA FINALE: Concludi SEMPRE con 1-5 domande di verifica calibrate sulla complessità del testo.

VINCOLI:
- Sii conciso ma completo.
- Non aggiungere introduzioni o conclusioni superflue ("Ecco il riassunto...")"""

_PROMPT_CHIARIMENTO = """Sei un tutor accademico esperto in chiarimenti. Spiega concetti complessi usando analogie pratiche della vita quotidiana.

PROCEDURA:
1. SPIEGAZIONE: Usa un linguaggio semplice e diretto.
2. ANALOGIA: Collega il concetto a una situazione reale e tangibile (es. cucina, traffico, sport).
3. ADATTAMENTO: Se lo studente non capisce, cambia RADICALMENTE l'analogia o l'approccio.
4. VERIFICA: Concludi SEMPRE con 1-5 domande mirate per testare la comprensione.

VINCOLI:
- Usa le analogie solo per i concetti più importanti e complessi
- Sii conciso: evita giri di parole.
- Le analogie devono essere intuitive per chiunque.
- Non sostituire lo studente: guida, non risolvere al posto suo."""


DEFAULT_STUDY_MODE = "default"

SYSTEM_PROMPTS = {
    "default": _PROMPT_DEFAULT,
    "ripasso": _PROMPT_RIPASSO,
    "esercizio": _PROMPT_ESERCIZIO,
    "riassunto": _PROMPT_RIASSUNTO,
    "chiarimento": _PROMPT_CHIARIMENTO,
}


# ======================================================================
# ISTRUZIONI TECNICHE (accodate SEMPRE al system prompt, indipendenti
# dalla modalità scelta). Servono a far funzionare correttamente il RAG.
# ======================================================================

_LANGUAGE_INSTRUCTION = (
    "Rispondi SEMPRE in italiano, anche quando il CONTESTO fornito è in "
    "un'altra lingua (es. inglese): traduci mentalmente le informazioni e "
    "formula la risposta in italiano."
)

_FALLBACK_INSTRUCTION = (
    "Se il CONTESTO qui sotto non contiene informazioni sufficienti per "
    f"rispondere alla domanda dell'utente, non usare conoscenze generali: "
    f"rispondi ESATTAMENTE con il testo '{FALLBACK_MARKER}' e nient'altro, "
    "senza aggiungere spiegazioni, punteggiatura o commenti."
)

_NO_FALLBACK_LOCAL_INSTRUCTION = (
    "Se il CONTESTO qui sotto non contiene informazioni sufficienti per "
    "rispondere, dillo onestamente all'utente invece di inventare una risposta."
)

_NO_CONTEXT_INSTRUCTION = (
    "Non è stato fornito alcun contesto (né locale né web): rispondi "
    "usando le tue conoscenze generali, specificando che non è stato trovato "
    "materiale specifico dell'utente sull'argomento."
)


# ======================================================================
# Thinking mode (MiniCPM5 / Qwen3)
# ======================================================================

# I modelli della famiglia MiniCPM5 e Qwen3 possono racchiudere il
# ragionamento interno tra tag di "thinking". Il formato esatto cambia
# tra le famiglie:
#   - MiniCPM5 usa <think>...</think>
#   - Qwen3 usa  thinking... response
# La regex gestisce entrambi i casi. Il ragionamento non deve MAI
# arrivare all'utente: viene rimosso dal testo finale.
_THINK_TAG_RE = re.compile(
    r"<(?:think|thinking)>.*?</(?:think|thinking)>",
    re.DOTALL | re.IGNORECASE,
)
# Fallback per tag di apertura senza chiusura (capita se il modello
# esaurisce i token durante il ragionamento).
_THINK_UNCLOSED_RE = re.compile(
    r"<(?:think|thinking)>.*$",
    re.DOTALL | re.IGNORECASE,
)


class LocalLLMError(Exception):
    """Errore applicativo user-friendly: la GUI lo mostra così com'è,
    senza dover interpretare le eccezioni interne."""
    pass


# ======================================================================
# Composizione del system prompt finale
# ======================================================================

def _build_system_prompt(
    study_mode: str,
    context_kind: str,
    allow_fallback_marker: bool,
) -> str:
    """Compone il system prompt finale:
        1. il testo della modalità selezionata (o quello 'default')
        2. le istruzioni tecniche (lingua + gestione fallback/contesto)

    Il prompt di default NON viene mai concatenato a quello di una modalità:
    se `study_mode` è una delle 4 modalità, viene usato solo quel prompt.
    """
    mode_prompt = SYSTEM_PROMPTS.get(study_mode)
    if not mode_prompt:
        mode_prompt = SYSTEM_PROMPTS[DEFAULT_STUDY_MODE]

    technical_parts = [_LANGUAGE_INSTRUCTION]

    if allow_fallback_marker:
        technical_parts.append(_FALLBACK_INSTRUCTION)
    elif context_kind == "locale":
        technical_parts.append(_NO_FALLBACK_LOCAL_INSTRUCTION)
    elif context_kind == "none":
        technical_parts.append(_NO_CONTEXT_INSTRUCTION)

    return mode_prompt + "\n\n" + "\n\n".join(technical_parts)


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


def _strip_thinking(text: str) -> str:
    """Rimuove il ragionamento interno (tag <think> o  thinking) dal testo."""
    text = _THINK_TAG_RE.sub("", text)
    text = _THINK_UNCLOSED_RE.sub("", text)
    return text.strip()


# ======================================================================
# Client
# ======================================================================

class LocalLLMClient:
    """
    Client per modelli LLM locali che girano nativamente dentro
    l'applicazione tramite llama-cpp-python.

    Modello di riferimento: MiniCPM5-2B (formato GGUF, quantizzazione
    Q4_K_M, ~1.56 GB). Altri modelli compatibili (stesso chat template
    ChatML/Qwen3-style) possono essere usati impostando local_model_path
    in config.json.

    Dove scaricare modelli GGUF:
    - https://huggingface.co/openbmb/MiniCPM5-2B-GGUF
    - https://huggingface.co/unsloth
    - https://huggingface.co/bartowski
    """

    def __init__(
        self,
        model_path: str = "",
        n_ctx: int = 8192,
        n_gpu_layers: int = -1,
        n_threads: Optional[int] = None,
    ):
        if not model_path or not model_path.strip():
            raise LocalLLMError(
                "Nessun percorso modello configurato. Specificare 'local_model_path' "
                "in config.json."
            )

        if not os.path.exists(model_path):
            raise LocalLLMError(
                f"Il file del modello non esiste: {model_path}. "
                "Verificare il percorso in config.json."
            )

        self.model_path = model_path
        self.n_ctx = n_ctx
        self.n_gpu_layers = n_gpu_layers
        self.n_threads = n_threads or max(1, os.cpu_count() - 1)

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
        context_kind: str = "none",
        local_chunks: Optional[Sequence[RetrievedChunk]] = None,
        web_results: Optional[Sequence[WebResult]] = None,
        allow_fallback_marker: bool = False,
        images: Optional[Sequence[Tuple[bytes, str]]] = None,
        thinking: bool = False,
        study_mode: str = DEFAULT_STUDY_MODE,
    ) -> str:
        """Genera una risposta usando il modello locale.

        study_mode: chiave tra quelle in SYSTEM_PROMPTS. Determina il
            system prompt inviato al modello. Se la chiave non è
            riconosciuta, viene usato il prompt 'default'.

        thinking: se True, attiva la thinking mode del modello tramite il
            chat template (enable_thinking=True). Se la versione di
            llama-cpp-python in uso non supporta il passaggio di
            chat_template_kwargs, la richiesta viene inviata senza il
            controllo esplicito: il modello decide autonomamente.
        """
        system_prompt = _build_system_prompt(
            study_mode=study_mode,
            context_kind=context_kind,
            allow_fallback_marker=allow_fallback_marker,
        )

        if context_kind == "locale" and local_chunks:
            context_text = _format_local_context(local_chunks)
        elif context_kind == "web" and web_results:
            context_text = _format_web_context(web_results)
        else:
            context_text = "(nessun contesto disponibile)"

        prompt_text = (
            f"CONTESTO:\n{context_text}\n\nDOMANDA DELL'UTENTE:\n{query}"
        )

        # Il system prompt è il VERO role: "system" del messaggio, non un
        # prefisso del messaggio utente.
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt_text},
        ]

        # Parametri di campionamento consigliati per MiniCPM5-2B: diversi
        # tra modalità Think e No-Think.
        if thinking:
            sampling = dict(temperature=0.9, top_p=0.95)
            max_tokens = min(3072, max(1024, self.n_ctx - 1024))
        else:
            sampling = dict(temperature=1.0, top_p=0.95)
            max_tokens = min(2048, max(512, self.n_ctx - 512))

        try:
            model = self._get_model()

            # Prova a passare enable_thinking al chat template. Se la
            # versione di llama-cpp-python non supporta il parametro,
            # TypeError viene catturato e la chiamata viene ripetuta
            # senza (fallback silenzioso).
            try:
                response = model.create_chat_completion(
                    messages=messages,
                    max_tokens=max_tokens,
                    stop=["</s>", "<|eot_id|>", "<|end_of_turn|>", "<|im_end|>"],
                    chat_template_kwargs={"enable_thinking": thinking},
                    **sampling,
                )
            except TypeError:
                response = model.create_chat_completion(
                    messages=messages,
                    max_tokens=max_tokens,
                    stop=["</s>", "<|eot_id|>", "<|end_of_turn|>", "<|im_end|>"],
                    **sampling,
                )

            if not response or not response.get("choices"):
                raise LocalLLMError("Il modello ha restituito una risposta vuota. Riprovare.")

            raw_text = response["choices"][0]["message"]["content"].strip()
            text = _strip_thinking(raw_text)

            if not text:
                raise LocalLLMError("Il modello ha restituito una risposta vuota. Riprovare.")

            return text

        except LocalLLMError:
            raise
        except Exception as e:
            raise LocalLLMError(f"Errore nella generazione della risposta: {e}")
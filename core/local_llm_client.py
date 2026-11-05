"""
core/local_llm_client.py
------------------------
Client per modelli LLM locali (formato GGUF) tramite llama-cpp-python.

Ottimizzazioni ADATTIVE:
  - Se il modello gira su GPU (n_gpu_layers != 0): flash_attn + KV cache Q8_0
  - Se il modello gira su CPU (n_gpu_layers == 0): flash_attn + KV cache F16
    La KV cache Q8_0 su CPU è più LENTA di F16 (dequantizzazione ad ogni
    operazione di attention), quindi NON va usata.

Log all'avvio:
  - Backend rilevato (CUDA / Metal / Vulkan / CPU-only)
  - n_gpu_layers richiesti ed effettivi
  - n_threads CPU
  - Tipo di KV cache

Prompt del riassunto e del chiarimento: riscritti in chiave "testo coeso"
(60-70% del testo principale discorsivo, massimo 2-3 concetti chiave finali).
"""

from __future__ import annotations

import os
import re
import threading
import time
from typing import Generator, List, Optional, Sequence

from core.models import RetrievedChunk, WebResult

# R16 2.3/2.4: budget del PROMPT per il SLO (pp ~100 tok/s misurato,
# qa/tmp/_r16_diag_chat*.py): max 3 chunk x 340 char (~360 tok) per
# blocco contesto. Gate, fusione RRF e fonti usano i top-k COMPLETI:
# solo la stringa del prompt viene troncata.
PROMPT_MAX_CHUNKS = 3
# R18 (GT B2.3): i chunk sono MEDIAMENTE ~2300 char; il cap 220 tagliava
# i fatti obbligatori (es. "anidride carbonica" a pos 852 del chunk 1,
# date wiki nei primi ~300 char dello snippet). Tradeoff pp dichiarato.
PROMPT_CHUNK_CHARS = 950
PROMPT_WEB_MAX = 6   # R18 fix9: slot per fonti con DATE GT
                     # (wiki extract SENZA anni; britannica/sapere li
                     # hanno ma erano fuori dai primi 4)
PROMPT_WEB_CHARS = 400
CHAT_MAX_TOKENS = 2000   # R18: cap di sicurezza anti-loop per la chat (le risposte si completano)

FALLBACK_MARKER = "[[NESSUNA_INFORMAZIONE_LOCALE]]"

# ======================================================================
# SYSTEM PROMPTS
# ======================================================================

_PROMPT_DEFAULT = """Agisci come un tutor accademico esperto. Il tuo scopo è guidare lo studente alla comprensione autonoma, senza mai sostituirlo.

Regole Generali: Usa analogie semplici tratte dalla vita quotidiana. Evita muri di testo: dividi la risposta in sezioni brevi, usa il grassetto per le parole chiave e i blocchi di codice esclusivamente per formule, teoremi o definizioni importanti."""

_PROMPT_RIPASSO = """# RUOLO
Sei un tutor socratico specializzato nel ripasso attivo. Consolidi le conoscenze pregresse dello studente attraverso una progressione calibrata di domande, dal generale allo specifico.

# PROGRESSIONE

## Fase INIZIO
- Saluta con: "Ciao! Iniziamo con il ripasso!"
- Poni 2 domande generali per verificare la cornice teorica di base e valutare il livello di preparazione.

## Fase SVILUPPO
Se le risposte sono corrette, aumenta gradualmente:
- La specificità dei dettagli richiesti
- La complessità delle relazioni tra concetti
- La necessità di applicare il concetto a scenari nuovi

## Fase VERIFICA ERRORE
Se lo studente sbaglia:
1. Spiega brevemente il concetto errato senza colpevolizzare
2. Riproponi 2 domande allo stesso livello di difficoltà
3. Solo dopo 2 risposte corrette consecutive, riprendi la progressione

## Fase FINE
La sessione termina quando esaurisci i sotto-argomenti, raggiungi 20 domande, o lo studente dimostra padronanza avanzata.

# VINCOLI
- Massimo 20 domande totali nell'intera sessione
- Domande sempre chiare e univoche, mai a trabocchetto
- Mai saltare livelli di difficoltà senza consolidamento
- Feedback specifico e costruttivo (es. "Ottimo, hai colto il punto X; ora approfondiamo Y")
- Tono conciso e incoraggiante
- Usa **grassetto** per concetti chiave, elenchi puntati per le opzioni
- Non aggiungere introduzioni o conclusioni superflue"""

_PROMPT_ESERCIZIO = """# RUOLO
Sei un tutor specializzato nella risoluzione guidata di esercizi. Accompagni lo studente attraverso ogni passaggio logico, senza mai rivelare la soluzione finale né anticipare gli step futuri.

# PROCEDURA

## Fase 0 — Attivazione
Inizia ESCLUSIVAMENTE con: "Certo! Risolviamo e capiamo questo esercizio!"

## Fase 1 — Analisi Interna (non mostrata)
Prima di rispondere, scomponi mentalmente l'esercizio in step logici elementari. Identifica i prerequisiti teorici e prevedi gli errori tipici.

## Fase 2 — Primo Step
Mostra SOLO il primo passaggio necessario. Fornisci una breve giustificazione del perché si inizia da lì e chiarisci cosa lo studente deve produrre.

## Fase 3 — Ciclo di Interazione
Attendi la risposta prima di procedere.

Se lo studente SBAGLIA:
1. Identifica il tipo di errore (calcolo, concettuale, interpretazione)
2. Dai una guida più specifica, senza dire "è sbagliato" genericamente
3. Riproponi lo stesso step
4. Solo dopo 3 tentativi falliti: fornisci la soluzione parziale e passa avanti

Se lo studente CORREGGE:
1. Conferma con precisione (es. "Esatto, perché...")
2. Presenta ESCLUSIVAMENTE il prossimo step

## Fase 4 — Chiusura
Raggiunta la soluzione, proponi una variante semplice come verifica finale.

# VINCOLI
- Un solo step visibile per messaggio, mai più passaggi insieme
- Mai anticipare "ora faremo X, poi Y"
- Mai risolvere al posto dello studente senza che ci abbia provato
- Mai saltare gli step fondamentali
- **Grassetto** per parole chiave, elenchi per sotto-passaggi, formule in `blocchi di codice`
- Non aggiungere introduzioni o conclusioni superflue"""

_PROMPT_RIASSUNTO = """# RUOLO
Sei un tutor accademico. Il tuo compito è produrre un riassunto COESO e DISCORSIVO dei contenuti, scritto come un breve saggio o un paragrafo di manuale, non come un elenco di appunti.

# PROCEDURA

## Fase 0 — Attivazione
Inizia ESCLUSIVAMENTE con: "Ecco il riassunto!"

## Fase 1 — Testo principale (60-70% dell'output)
Scrivi un testo COESO e discorsivo che spieghi l'argomento dall'inizio alla fine. Il testo deve scorrere come una spiegazione continua:

- Apri con una frase che inquadra l'argomento e ne indica l'importanza
- Sviluppa i concetti in paragrafi brevi (3-5 righe) collegati tra loro con connettivi logici ("di conseguenza", "d'altra parte", "inoltre", "per questo motivo", "in parallelo", "successivamente")
- Ogni paragrafo introduce un aspetto e prepara il successivo
- Usa frasi complete e periodi ben costruiti
- NON fare elenchi puntati nel testo principale
- NON usare formule spezzate tipo "Definizione: ...", "Caratteristiche: ...", "Funzione: ..."
- Il grassetto va usato con parsimonia, solo per termini tecnici la prima volta che appaiono

## Fase 2 — Concetti chiave (max 2-3 voci)
Dopo il testo, aggiungi una sezione finale con il titolo esatto "**Concetti chiave**" contenente MASSIMO 2-3 voci in elenco puntato. Queste sono le cose da ricordare assolutamente, non un riassunto del riassunto.

## Fase 3 — Verifica finale
Concludi con 1-5 domande di verifica calibrate su: base (riconoscimento), intermedio (applicazione), avanzato (analisi critica). Le domande vanno numerate.

# VINCOLI
- Il testo principale coeso deve occupare il 60-70% dell'output totale
- Massimo 2-3 concetti chiave finali, non di più
- Tono neutro, preciso, privo di opinioni personali
- Massimo 4-5 righe per paragrafo, mai muri di testo
- Usa `blocchi di codice` SOLO per formule, teoremi, definizioni formali
- Mai saltare la verifica finale
- Mai aggiungere introduzioni oltre alla frase di attivazione, né conclusioni superflue"""

_PROMPT_CHIARIMENTO = """# RUOLO
Sei un tutor accademico specializzato nel rendere accessibili concetti complessi attraverso una spiegazione COESA e DISCORSIVA, integrata con analogie concrete della vita quotidiana.

# PROCEDURA

## Fase 0 — Attivazione
Inizia ESCLUSIVAMENTE con: "Ecco il chiarimento dell'argomento!"

## Fase 1 — Spiegazione coesa (60-70% dell'output)
Produci una spiegazione fluida e discorsiva del concetto, che scorra come una lezione ben raccontata:

- Apri con una definizione chiara e accessibile del concetto
- Sviluppa il ragionamento collegando gli aspetti con connettivi logici ("in sostanza", "questo significa che", "di conseguenza", "a differenza di", "per capirci meglio")
- Usa frasi complete, evita elenchi puntati nel corpo del testo
- Non usare formule spezzate tipo "Definizione: ...", "Funzione: ..."

## Fase 2 — Analogia integrata nel discorso
L'analogia NON deve essere una sezione separata con titolo "Analogia". Va INTEGRATA nel flusso della spiegazione:
- Introducila con formule tipo "Immagina che...", "È un po' come quando...", "Pensa a..."
- Esplicita brevemente la corrispondenza tra gli elementi dell'analogia e il concetto reale
- Segnala in una frase dove l'analogia si rompe o non è più valida
- NON presentare l'analogia come elenco puntato di elementi

Gerarchia delle analogie preferite (dalla più semplice):
- Domestiche (cucina, casa, famiglia)
- Quotidiane (traffico, supermercato, sport)
- Tecniche semplici (orologi, motori)
- Sistemiche (ecosistemi, economie)

## Fase 3 — Concetti chiave (max 2-3 voci)
Dopo il testo, aggiungi una sezione finale con il titolo esatto "**Concetti chiave**" contenente MASSIMO 2-3 voci in elenco puntato. Sono le cose da tenere a mente, non un riassunto del testo.

## Fase 4 — Adattamento
Se lo studente non capisce (turni successivi):
1. Cambia radicalmente il dominio dell'analogia (es. da cucina a traffico)
2. Abbassa il livello di astrazione
3. Se ancora non basta, usa esempi concreti invece di analogie

## Fase 5 — Verifica finale
Concludi SEMPRE con 1-5 domande numerate che verifichino la comprensione del concetto originale (non dell'analogia). Le domande devono testare il concetto, non la metafora usata.

# VINCOLI
- Il testo principale coeso deve occupare il 60-70% dell'output totale
- Massimo 2-3 concetti chiave finali, non di più
- Le analogie devono essere riconoscibili in 2-3 secondi, mai specialistiche
- Segnala sempre i limiti dell'analogia (è un modello, non la realtà)
- Non ripetere più di 2 volte lo stesso approccio senza cambiarlo radicalmente
- Non sostituire lo studente: guida, non risolvere al posto suo
- Usa `blocchi di codice` SOLO per formule, teoremi, definizioni formali
- Mai muri di testo, ma nemmeno elenchi puntati eccessivi
- Mai saltare la verifica finale
- Mai aggiungere introduzioni o conclusioni superflue"""

DEFAULT_STUDY_MODE = "default"

SYSTEM_PROMPTS = {
    "default": _PROMPT_DEFAULT,
    "ripasso": _PROMPT_RIPASSO,
    "esercizio": _PROMPT_ESERCIZIO,
    "riassunto": _PROMPT_RIASSUNTO,
    "chiarimento": _PROMPT_CHIARIMENTO,
}

# ======================================================================
# SEZIONI RIMOVIBILI
# ======================================================================

_SALUTATION_SECTIONS = {
    "ripasso": '## Fase INIZIO\n- Saluta con: "Ciao! Iniziamo con il ripasso!"\n- Poni 2 domande generali per verificare la cornice teorica di base e valutare il livello di preparazione.\n\n',
    "esercizio": '## Fase 0 — Attivazione\nInizia ESCLUSIVAMENTE con: "Certo! Risolviamo e capiamo questo esercizio!"\n\n',
    "riassunto": '## Fase 0 — Attivazione\nInizia ESCLUSIVAMENTE con: "Ecco il riassunto!"\n\n',
    "chiarimento": '## Fase 0 — Attivazione\nInizia ESCLUSIVAMENTE con: "Ecco il chiarimento dell\'argomento!"\n\n',
    "default": None,
}

_FINAL_QUESTIONS_SECTIONS = {
    "esercizio": '## Fase 4 — Chiusura\nRaggiunta la soluzione, proponi una variante semplice come verifica finale.\n\n',
    "riassunto": '## Fase 3 — Verifica finale\nConcludi con 1-5 domande di verifica calibrate su: base (riconoscimento), intermedio (applicazione), avanzato (analisi critica). Le domande vanno numerate.\n\n',
    "chiarimento": '## Fase 5 — Verifica finale\nConcludi SEMPRE con 1-5 domande numerate che verifichino la comprensione del concetto originale (non dell\'analogia). Le domande devono testare il concetto, non la metafora usata.\n\n',
    "ripasso": None,
    "default": None,
}

_CONTINUATION_SUFFIX_PART1 = (
    "\n\n# NOTA TECNICA — TESTO MULTIPARTE\n"
    "Il testo fornito dall'utente è molto lungo ed è stato diviso in più parti. "
    "Questa è la PARTE 1. Ne seguiranno altre. "
    "NON concludere con domande finali, riassunti complessivi o saluti conclusivi: "
    "la risposta continua nella parte successiva."
)

_CONTINUATION_SUFFIX_MIDDLE = (
    "\n\n# NOTA TECNICA — CONTINUAZIONE\n"
    "Stai continuando una risposta precedente sullo stesso argomento. "
    "Nel messaggio utente trovi un riassunto delle parti già trattate. "
    "Riprendi da dove ti eri interrotto, senza ripetere il saluto iniziale, "
    "senza ricominciare da capo, senza riformulare l'introduzione. "
    "NON concludere con domande finali: la risposta continua nella parte successiva."
)

_CONTINUATION_SUFFIX_LAST = (
    "\n\n# NOTA TECNICA — ULTIMA PARTE\n"
    "Stai continuando una risposta precedente sullo stesso argomento. "
    "Nel messaggio utente trovi un riassunto delle parti già trattate. "
    "Riprendi da dove ti eri interrotto, senza ripetere il saluto iniziale e senza "
    "ricominciare da capo. Questa è l'ULTIMA parte del testo: concludi la risposta "
    "in modo coerente, applicando le eventuali richieste finali previste dal tuo ruolo."
)

# ======================================================================
# CONTESTO APPLICAZIONE (solo chitchat)
# ======================================================================

_APP_CONTEXT = """Sei l'assistente AI di NovaStudio, un'applicazione desktop di studio che gira interamente sul PC dell'utente, senza servizi cloud.

Cosa fai in NovaStudio:
- Consulti i materiali di studio dell'utente: appunti, PDF, Word, PowerPoint, file di testo e Markdown.
- Se i materiali non bastano, cerchi nella libreria di libri dell'utente.
- Se neanche la libreria basta, cerchi sul web su fonti affidabili.
- L'utente può scegliere una modalità di studio (Ripasso, Esercizio, Riassunto, Chiarimento).
- L'utente può attivare "Pensiero profondo" per farti riflettere più a lungo.

Cosa NON fai:
- Non vedi le immagini: usi solo il testo estratto via OCR.
- Non ricordi conversazioni precedenti: ogni chat è isolata.

Per domande fuori dallo studio (saluti, chiacchiere) rispondi breve e cordiale, poi proponi di aiutare con lo studio."""

_LANGUAGE_INSTRUCTION = (
    "Rispondi nella LINGUA della domanda dell'utente (domanda in italiano "
    "-> risposta in italiano; domanda in un'altra lingua -> rispondi in "
    "quella lingua). Le fonti possono essere in un'altra lingua: traduci "
    "e rielabora il contenuto con parole tue, NON copiare brani."
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

# R15b G2b - istruzione SOLO per esito "parziale" del gate precoce
# (core/rag/gate.py decide_gate). Backward-compat: senza il flag
# outcome="parziale" il prompt di sistema resta IDENTICO a prima.
_PARTIAL_OUTCOME_INSTRUCTION = (
    "RECUPERO PARZIALE NEI MATERIALI LOCALI: le fonti fornite contengono "
    "solo PARTE di cio' che serve a rispondere. La pipeline APRE GIA' la "
    "risposta con la formula ('Dai tuoi materiali emerge solo questo'): "
    "NON ripeterla e NON usare la formula di esempio "
    "'Ho trovato solo questo nei materiali' all'inizio - continua "
    "direttamente con il contenuto, SENZA codici di citazione [F1]/[W1] e "
    "SENZA blocchi 'Fonti:' (la provenienza la mostra l'interfaccia). "
    "Rispondi usando ESCLUSIVAMENTE le fonti indicate. "
    "NON inventare, NON completare con conoscenze generali e NON fingere "
    "completezza: se un dettaglio non e' nelle fonti, dillo esplicitamente."
)

_THINK_OPEN_RE = re.compile(r"<(?:think|thinking)>", re.IGNORECASE)
_THINK_CLOSE_RE = re.compile(r"</(?:think|thinking)>", re.IGNORECASE)


class LocalLLMError(Exception):
    pass


def _strip_section(prompt: str, section: Optional[str]) -> str:
    if not section:
        return prompt
    return prompt.replace(section, "")


def _build_system_prompt(
    study_mode: str,
    context_kind: str,
    allow_fallback_marker: bool,
    chitchat: bool,
    part_index: int = 0,
    is_last_part: bool = True,
    outcome: Optional[str] = None,
) -> str:
    if chitchat:
        return _APP_CONTEXT + "\n\n" + _LANGUAGE_INSTRUCTION

    mode_prompt = SYSTEM_PROMPTS.get(study_mode, SYSTEM_PROMPTS[DEFAULT_STUDY_MODE])

    if part_index > 0:
        if part_index > 1:
            mode_prompt = _strip_section(mode_prompt, _SALUTATION_SECTIONS.get(study_mode))
        if not is_last_part:
            mode_prompt = _strip_section(mode_prompt, _FINAL_QUESTIONS_SECTIONS.get(study_mode))

    technical = [
        _LANGUAGE_INSTRUCTION,
        "Se nei blocchi di contesto compaiono date, anni, numeri o "
        "equazioni pertinenti alla domanda, RIPORTALI FEDELMENTE nel "
        "testo della risposta (non inventarne di nuovi e non "
        "sostituirli con formulazioni vaghe).",
    ]
    if allow_fallback_marker:
        technical.append(_FALLBACK_INSTRUCTION)
    elif context_kind == "locale":
        technical.append(_NO_FALLBACK_LOCAL_INSTRUCTION)
    elif context_kind == "none":
        technical.append(_NO_CONTEXT_INSTRUCTION)
    # R15b G2b: SOLO con il flag esplicito il prompt cambia
    if outcome == "parziale":
        technical.append(_PARTIAL_OUTCOME_INSTRUCTION)

    result = mode_prompt + "\n\n" + "\n\n".join(technical)

    if part_index == 1:
        result += _CONTINUATION_SUFFIX_PART1
    elif part_index > 1 and not is_last_part:
        result += _CONTINUATION_SUFFIX_MIDDLE
    elif part_index > 1 and is_last_part:
        result += _CONTINUATION_SUFFIX_LAST

    return result


def _format_local_context(chunks: Sequence[RetrievedChunk]) -> str:
    """R16 1.1: blocchi delimitati <contesto> (nessuna riga grezza
    "[Fonte locale:" nel prompt; le citazioni usano gli id [F1], [W2]...)."""
    parts = []
    for i, c in enumerate(chunks[:PROMPT_MAX_CHUNKS], 1):
        etichetta = f"{c.source_file} ({c.location_hint})" if c.location_hint else c.source_file
        etichetta = str(etichetta).replace('"', "'").replace("\n", " ")
        txt = str(c.text or "")
        if len(txt) > PROMPT_CHUNK_CHARS:
            txt = txt[:PROMPT_CHUNK_CHARS] + " ..."
        parts.append(
            f'<contesto id="F{i}" tipo="appunti" fonte="{etichetta}">\n'
            f"{txt}\n</contesto>")
    return "\n\n".join(parts)


def _format_web_context(results: Sequence[WebResult]) -> str:
    """R16 1.1: blocchi <contesto> per il web con url (citazioni [W1]...)."""
    parts = []
    for i, r in enumerate(results[:PROMPT_WEB_MAX], 1):  # R16 budget
        title = str(r.title or "").replace('"', "'").replace("\n", " ")
        url = str(r.url or "").replace('"', "'")
        snip = str(r.snippet or "")
        if len(snip) > PROMPT_WEB_CHARS:
            snip = snip[:PROMPT_WEB_CHARS] + " ..."
        parts.append(
            f'<contesto id="W{i}" tipo="web" fonte="{title}" url="{url}">\n'
            f"{snip}\n</contesto>")
    return "\n\n".join(parts)


def _collect_source_texts(local_chunks, web_results) -> List[str]:
    """Testi di riferimento per la guardia ANTI-COPIA (verbatim)."""
    out: List[str] = []
    for c in (local_chunks or [])[:6]:
        t = str(getattr(c, "text", "") or "")
        if t.strip():
            out.append(t[:800])
    for r in (web_results or [])[:4]:
        s = str(getattr(r, "snippet", "") or "")
        if s.strip():
            out.append(s[:800])
    return out


def _estimate_max_tokens(n_ctx: int, prompt_chars: int, thinking: bool) -> int:
    estimated_prompt_tokens = (prompt_chars // 3) + 30
    safety_buffer = 128
    available = n_ctx - estimated_prompt_tokens - safety_buffer
    if available < 256:
        return 256
    if thinking:
        return min(4096, available)
    return min(3072, available)


def _detect_backend_info() -> dict:
    """Rileva quali backend accelerati sono disponibili in llama-cpp-python."""
    info = {
        "supports_gpu": False,
        "backend_string": "unknown",
    }
    try:
        from llama_cpp import llama_cpp as _llama
        if hasattr(_llama, "llama_supports_gpu_offload"):
            info["supports_gpu"] = bool(_llama.llama_supports_gpu_offload())
        if hasattr(_llama, "llama_print_system_info"):
            raw = _llama.llama_print_system_info()
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="ignore")
            info["backend_string"] = str(raw).strip().split("\n")[0][:120]
    except Exception:
        pass
    return info


class LocalLLMClient:
    def __init__(self, model_path="", n_ctx=8192, n_gpu_layers=-1, n_threads=None):
        if not model_path or not model_path.strip():
            raise LocalLLMError(
                "Nessun percorso modello configurato. Apri 'Seleziona modelli' "
                "e scarica un modello."
            )
        if not os.path.exists(model_path):
            raise LocalLLMError(f"Il file del modello non esiste: {model_path}")
        self.model_path = model_path
        self.n_ctx = n_ctx
        self.n_gpu_layers = n_gpu_layers
        self.n_threads = n_threads or max(1, os.cpu_count() - 1)
        self._model = None
        self._optimizations = []
        self._backend_info = _detect_backend_info()

    def is_loaded(self) -> bool:
        return self._model is not None

    def load_model_blocking(self):
        return self._get_model()

    def _get_model(self):
        if self._model is not None:
            return self._model

        try:
            from llama_cpp import Llama
        except ImportError:
            raise LocalLLMError("llama-cpp-python non installato.")

        # ------------------------------------------------------------------
        # Strategia di caricamento ADATTIVA
        # - GPU  → KV cache Q8_0 (risparmia VRAM)
        # - CPU  → KV cache F16 (default, più veloce in CPU)
        # ------------------------------------------------------------------
        use_gpu = (self.n_gpu_layers != 0)

        base_kwargs = dict(
            model_path=self.model_path,
            n_ctx=self.n_ctx,
            n_gpu_layers=self.n_gpu_layers,
            n_threads=self.n_threads,
            n_batch=512,
            n_ubatch=512,
            verbose=False,
        )

        if use_gpu:
            attempts = [
                (dict(flash_attn=True, type_k=1, type_v=1), "GPU + flash_attn + KV cache Q8_0"),
                (dict(flash_attn=True), "GPU + flash_attn (KV F16)"),
                ({}, "GPU base"),
                (dict(flash_attn=True), "CPU fallback + flash_attn (KV F16)"),
                ({}, "CPU fallback base"),
            ]
        else:
            attempts = [
                (dict(flash_attn=True), "CPU + flash_attn (KV F16)"),
                ({}, "CPU base (KV F16)"),
            ]

        last_err = None
        for extra, label in attempts:
            try:
                self._model = Llama(**base_kwargs, **extra)
                self._optimizations.append(label)

                print(f"[LocalLLMClient] === Modello caricato ===")
                print(f"[LocalLLMClient]   Strategia: {label}")
                print(f"[LocalLLMClient]   n_ctx: {self.n_ctx}")
                print(f"[LocalLLMClient]   n_gpu_layers richiesti: {self.n_gpu_layers}")
                print(f"[LocalLLMClient]   n_threads CPU: {self.n_threads}")
                print(f"[LocalLLMClient]   Backend GPU disponibile: {self._backend_info['supports_gpu']}")
                if self._backend_info["backend_string"] != "unknown":
                    print(f"[LocalLLMClient]   System info: {self._backend_info['backend_string']}")
                print(f"[LocalLLMClient] =======================")
                return self._model
            except Exception as e:
                last_err = e
                continue

        raise LocalLLMError(f"Errore nel caricamento del modello: {last_err}")

    def _prepare_messages(
        self,
        query,
        context_kind,
        local_chunks,
        web_results,
        allow_fallback_marker,
        study_mode,
        chitchat,
        part_index,
        is_last_part,
        parts_summaries,
        history_turns=None,
        outcome=None,
        answer_draft=None,
        repair_note: Optional[str] = None,
    ) -> list:
        system_prompt = _build_system_prompt(
            study_mode=study_mode,
            context_kind=context_kind,
            allow_fallback_marker=allow_fallback_marker,
            chitchat=chitchat,
            part_index=part_index,
            is_last_part=is_last_part,
            outcome=outcome,
        )

        if context_kind == "locale" and local_chunks:
            context_text = _format_local_context(local_chunks)
        elif context_kind == "web" and web_results:
            context_text = _format_web_context(web_results)
        else:
            context_text = "(nessun contesto disponibile)"

        # G2/H3 - ordine di produzione STABILE: system (+header RAG) ->
        # storia -> query. L'header RAG vive nel SYSTEM (prefisso) PRIMA
        # della storia: stesso set di fonti => stesso hash di prefisso.
        has_ctx = bool(
            (context_kind == "locale" and local_chunks)
            or (context_kind == "web" and web_results)
        )
        system_content = system_prompt
        if has_ctx:
            system_content = (
                f"{system_prompt}\n\n---\n"
                f"CONTESTO/RIFERIMENTI (fonti):\n"
                f"NON usare codici di citazione come [F1]/[W1], NON "
                f"elencare URL, NON creare blocchi 'Fonti:' nel testo: la "
                f"provenienza la mostra l'interfaccia; NON riprodurre i "
                f"marcatori <contesto> o </contesto> nella risposta.\n"
                f"SE I MATERIALI LOCALI E LE FONTI WEB RIPORTANO DATI "
                f"DIVERSI SU UNO STESSO FATTO, SEGUI LE FONTI WEB E "
                f"AGGIUNGI UNA FRASE CHE SEGNALE CHE I MATERIALI LOCALI "
                f"RIPORTANO UN DATO DIVERSO.\n\n"
                f"{context_text}"
            )

        if part_index > 1 and parts_summaries:
            summaries_block = "\n".join(
                f"  Parte {i+1}: {s}" for i, s in enumerate(parts_summaries) if s
            )
            total_label = "(parte finale)" if is_last_part else "(parte successiva)"
            prompt_text = (
                f"(contesto e riferimenti nel messaggio di sistema - {total_label})\n\n"
                f"---\n\n"
                f"RIEPILOGO DELLE PARTI GIÀ TRATTATE:\n{summaries_block}\n\n"
                f"---\n\n"
                f"DOMANDA ORIGINALE DELL'UTENTE:\n{query}\n\n"
                f"Continua la risposta da dove ti eri interrotto."
            )
        else:
            prompt_text = f"DOMANDA DELL'UTENTE:\n{query}"
        if answer_draft:
            # R16 follow-up: HIT di cache -> rielaborazione della bozza
            # (mai testo identico: la guardia not_identical lo verifica)
            prompt_text += (
                "\n\n---\nBOZZA GIA' DATA (RIFORMULALA con le tue "
                "parole, cambiando almeno qualche termine: NON copiarla, "
                "NON elencare i chunk, mantieni lingua della domanda e "
                "citazioni):\n" + str(answer_draft))
            system_content += (
                "\n\nRIELABORAZIONE: la bozza fornita e' solo un "
                "riferimento; rispondi con prosa tua.")
        if repair_note:
            # R18 B2.1: rigenerazione vincolata al contesto dopo le
            # violations del self-check di grounding (una sola)
            prompt_text += (
                "\n\n---\nCORREZIONE OBBLIGATORIA (rispondi SOLO col "
                "testo corretto, rimanendo esclusivamente sul CONTESTO):\n"
                + str(repair_note))
        messages = [{"role": "system", "content": system_content}]
        # G2/H3 - storia conversazionale reale (turni interi, ruoli stabili)
        for t in (history_turns or []):
            role = str(t.get("role", "")).lower()
            content = str(t.get("content", "") or "").strip()
            if not content:
                continue
            messages.append({
                "role": "assistant" if role in ("ai", "assistant", "model") else "user",
                "content": content,
            })
        messages.append({"role": "user", "content": prompt_text})
        return messages

    # ------------------------------------------------------------------
    # R16 B1 GUARD: generate_stream (pubblico) valida/ritenta/fallback;
    # _stream_plain e' la generazione grezza (invariata + budget tempo).
    # ------------------------------------------------------------------
    def generate_stream(
        self,
        query: str,
        context_kind: str = "none",
        local_chunks=None,
        web_results=None,
        allow_fallback_marker: bool = False,
        images=None,
        thinking: bool = False,
        study_mode: str = DEFAULT_STUDY_MODE,
        stop_event: Optional[threading.Event] = None,
        chitchat: bool = False,
        part_index: int = 0,
        is_last_part: bool = True,
        parts_summaries: Optional[List[str]] = None,
        history_turns: Optional[List[dict]] = None,
        outcome: Optional[str] = None,
        time_budget_s: Optional[float] = None,
        answer_draft: Optional[str] = None,
        repair_note: Optional[str] = None,
    ) -> Generator[str, None, None]:
        """R16 1.2: stream VALIDATO (guardia output -> retry -> fallback)."""
        from core.rag.output_guard import (REPAIR_INSTRUCTION,
                                           compose_fallback,
                                           guarded_stream)

        if parts_summaries is None:
            parts_summaries = []
        system_text = ""
        try:
            _msgs = self._prepare_messages(
                query, context_kind, local_chunks, web_results,
                allow_fallback_marker, study_mode, chitchat,
                part_index, is_last_part, parts_summaries,
                history_turns=history_turns, outcome=outcome,
                repair_note=repair_note)
            if _msgs:
                system_text = str(_msgs[0].get("content") or "")
        except Exception:
            system_text = ""
        has_ctx = bool(local_chunks or web_results)
        deadline = (time.perf_counter() + float(time_budget_s)
                    if time_budget_s else None)
        fallback = compose_fallback(local_chunks, web_results, query)
        src_texts = _collect_source_texts(local_chunks, web_results)

        def _first():
            return self._stream_plain(
                query, context_kind, local_chunks, web_results,
                allow_fallback_marker, images, thinking, study_mode,
                stop_event, chitchat, part_index, is_last_part,
                parts_summaries, history_turns, outcome,
                time_budget_s=time_budget_s, answer_draft=answer_draft,
                repair_note=repair_note)

        def _repair():
            return self._stream_plain(
                query, context_kind, local_chunks, web_results,
                allow_fallback_marker, images, thinking, study_mode,
                stop_event, chitchat, part_index, is_last_part,
                parts_summaries, history_turns, outcome,
                time_budget_s=time_budget_s, _repair=True,
                _repair_instruction=REPAIR_INSTRUCTION,
                answer_draft=answer_draft)

        def _on_final(d):
            try:
                self.last_marker_check = d
            except Exception:
                pass

        for item in guarded_stream(
                _first, system_text=system_text, fallback_text=fallback,
                repair_factory=_repair, deadline=deadline,
                check_min_len=has_ctx, on_final=_on_final,
                source_texts=src_texts,
                not_identical_to=(answer_draft if answer_draft
                                  else None)):
            yield item

    def _stream_plain(
        self,
        query: str,
        context_kind: str = "none",
        local_chunks=None,
        web_results=None,
        allow_fallback_marker: bool = False,
        images=None,
        thinking: bool = False,
        study_mode: str = DEFAULT_STUDY_MODE,
        stop_event: Optional[threading.Event] = None,
        chitchat: bool = False,
        part_index: int = 0,
        is_last_part: bool = True,
        parts_summaries: Optional[List[str]] = None,
        history_turns: Optional[List[dict]] = None,
        outcome: Optional[str] = None,
        time_budget_s: Optional[float] = None,
        _repair: bool = False,
        _repair_instruction: str = "",
        answer_draft: Optional[str] = None,
        repair_note: Optional[str] = None,
    ) -> Generator[str, None, None]:
        if parts_summaries is None:
            parts_summaries = []

        messages = self._prepare_messages(
            query, context_kind, local_chunks, web_results,
            allow_fallback_marker, study_mode, chitchat,
            part_index, is_last_part, parts_summaries,
            history_turns=history_turns,
            outcome=outcome,
            answer_draft=answer_draft,
            repair_note=repair_note,
        )
        if _repair and _repair_instruction:
            messages = [dict(m) for m in messages]
            messages[-1] = dict(messages[-1])
            messages[-1]["content"] = (
                str(messages[-1].get("content") or "")
                + _repair_instruction)
        deadline = (time.perf_counter() + float(time_budget_s)
                    if time_budget_s else None)

        prompt_chars = sum(len(m.get("content", "")) for m in messages)
        max_tokens = _estimate_max_tokens(self.n_ctx, prompt_chars, thinking)
        # R18: NESSUN cap dal budget tempo (la risposta si completa);
        # time_budget_s resta solo informativo per la degradazione stadi

        sampling_primary = dict(
            temperature=1.0,
            top_p=0.95,
            min_p=0.0,
            repeat_penalty=1.1,
        )
        sampling_fallback = dict(
            temperature=1.0,
            top_p=0.95,
            repeat_penalty=1.1,
        )

        try:
            model = self._get_model()

            def _make_stream(kwargs_sampling):
                try:
                    return model.create_chat_completion(
                        messages=messages,
                        max_tokens=max_tokens,
                        stop=["</s>", "<|eot_id|>", "<|end_of_turn|>", "<|im_end|>"],
                        chat_template_kwargs={"enable_thinking": thinking},
                        stream=True,
                        **kwargs_sampling,
                    )
                except TypeError:
                    return model.create_chat_completion(
                        messages=messages,
                        max_tokens=max_tokens,
                        stop=["</s>", "<|eot_id|>", "<|end_of_turn|>", "<|im_end|>"],
                        stream=True,
                        **kwargs_sampling,
                    )

            try:
                stream = _make_stream(sampling_primary)
            except TypeError:
                stream = _make_stream(sampling_fallback)

            pending = ""
            in_thinking = False
            decided = False

            for chunk in stream:
                if stop_event is not None and stop_event.is_set():
                    break

                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta", {}) or {}
                token = delta.get("content") or ""
                if not token:
                    continue

                pending += token

                if not decided:
                    if len(pending) < 15 and not _THINK_OPEN_RE.search(pending):
                        continue
                    if _THINK_OPEN_RE.search(pending):
                        in_thinking = True
                    decided = True

                if in_thinking:
                    close = _THINK_CLOSE_RE.search(pending)
                    if close:
                        pending = pending[close.end():]
                        in_thinking = False
                    else:
                        continue

                if pending:
                    yield pending
                    pending = ""

            if pending and not in_thinking:
                yield pending

        except LocalLLMError:
            raise
        except Exception as e:
            raise LocalLLMError(f"Errore nella generazione della risposta: {e}")

    def generate(self, query, **kwargs) -> str:
        return "".join(t for t in self.generate_stream(query, **kwargs)
                       if isinstance(t, str))

    # ==================================================================
    # T1 - Adattore sidecar (llama-server esterno, POST /completion).
    # Funzioni NUOVE: il codice preesistente non viene modificato.
    #
    #   llm.backend = 'sidecar' -> prova prima il sidecar
    #     - sidecar KO -> fallback sulla strada in-process ESISTENTE
    #     - fallback KO -> raise AiUnavailable('AI non disponibile')
    #   llm.backend = 'inprocess' -> rollback: solo la strada esistente,
    #     con identico comportamento (incluse le eccezioni originali).
    # ==================================================================

    @staticmethod
    def _sidecar_backend_enabled() -> bool:
        try:
            from data.config_manager import ConfigManager
            backend = str(ConfigManager().get("llm.backend", "sidecar") or "sidecar")
        except Exception:
            backend = "sidecar"
        return backend.strip().lower() == "sidecar"

    @staticmethod
    def _make_sidecar_client():
        # Import puro: se fallisce il sidecar e' "non disponibile"
        from core.sidecar.client import SidecarClient
        return SidecarClient()

    def stream_via_sidecar(
        self,
        query: str,
        profile: Optional[str] = None,
        classe: Optional[str] = None,
        context_kind: str = "none",
        local_chunks=None,
        web_results=None,
        allow_fallback_marker: bool = False,
        images=None,
        thinking: bool = False,
        study_mode: str = DEFAULT_STUDY_MODE,
        stop_event: Optional[threading.Event] = None,
        chitchat: bool = False,
        part_index: int = 0,
        is_last_part: bool = True,
        parts_summaries: Optional[List[str]] = None,
        history_turns: Optional[List[dict]] = None,
        outcome: Optional[str] = None,
        time_budget_s: Optional[float] = None,
        answer_draft: Optional[str] = None,
        repair_note: Optional[str] = None,
    ) -> Generator[str, None, None]:
        """Stream via sidecar con fallback in-process (mai eccezione cruda)."""
        if parts_summaries is None:
            parts_summaries = []

        # --- 1) sidecar (solo se backend='sidecar' E client importabile)
        sidecar_ok = False
        client = None
        if self._sidecar_backend_enabled():
            try:
                client = self._make_sidecar_client()
                sidecar_ok = True
            except Exception:
                client = None
                sidecar_ok = False

        if sidecar_ok and client is not None:
            emitted_any = False
            try:
                try:
                    messages = self._prepare_messages(
                        query, context_kind, local_chunks, web_results,
                        allow_fallback_marker, study_mode, chitchat,
                        part_index, is_last_part, parts_summaries,
                        history_turns=history_turns,
                        outcome=outcome,
                        answer_draft=answer_draft,
                        repair_note=repair_note,
                    )
                except Exception:
                    messages = query  # prompt grezzo: meglio di niente
                system_text = ""
                if isinstance(messages, list) and messages:
                    try:
                        system_text = str(messages[0].get("content") or "")
                    except Exception:
                        system_text = ""
                prof = profile or ("think" if thinking else "fast")
                cls = classe or ("think" if thinking else "standard")
                from core.rag.output_guard import (REPAIR_INSTRUCTION,
                                                   compose_fallback,
                                                   guarded_stream)
                from core.rag.contract import RESET_TOKEN

                def _side_first():
                    for piece in client.complete(
                        messages, profile=prof, classe=cls, stream=True,
                        max_tokens=CHAT_MAX_TOKENS
                    ):
                        if stop_event is not None and stop_event.is_set():
                            return
                        yield piece

                def _side_repair():
                    msgs = messages
                    if isinstance(messages, list) and messages:
                        msgs = [dict(m) for m in messages]
                        msgs[-1] = dict(msgs[-1])
                        msgs[-1]["content"] = (
                            str(msgs[-1].get("content") or "")
                            + REPAIR_INSTRUCTION)
                    for piece in client.complete(
                        msgs, profile=prof, classe=cls, stream=True,
                        max_tokens=CHAT_MAX_TOKENS
                    ):
                        if stop_event is not None and stop_event.is_set():
                            return
                        yield piece

                deadline = (time.perf_counter() + float(time_budget_s)
                            if time_budget_s else None)
                fallback = compose_fallback(local_chunks, web_results, query)
                guarded = guarded_stream(
                    _side_first, system_text=system_text,
                    fallback_text=fallback, repair_factory=_side_repair,
                    deadline=deadline,
                    check_min_len=bool(local_chunks or web_results),
                    on_final=lambda d: setattr(self, "last_marker_check", d),
                    source_texts=_collect_source_texts(local_chunks,
                                                       web_results),
                    not_identical_to=(answer_draft if answer_draft
                                      else None),
                )
                for item in guarded:
                    if isinstance(item, dict):
                        emitted_any = True
                        yield item  # RESET_TOKEN -> router -> evento reset
                        continue
                    if stop_event is not None and stop_event.is_set():
                        break
                    emitted_any = True
                    yield item
                return
            except Exception as exc:
                print(f"[LocalLLMClient] Sidecar KO ({exc}): fallback in-process")
                if emitted_any:
                    from core.rag.contract import RESET_TOKEN
                    yield RESET_TOKEN  # rigenerazione pulita in-process

        # --- 2) strada ESISTENTE in-process (codice identico all'originale)
        try:
            yield from self.generate_stream(
                query,
                context_kind=context_kind,
                local_chunks=local_chunks,
                web_results=web_results,
                allow_fallback_marker=allow_fallback_marker,
                images=images,
                thinking=thinking,
                study_mode=study_mode,
                stop_event=stop_event,
                chitchat=chitchat,
                part_index=part_index,
                is_last_part=is_last_part,
                parts_summaries=parts_summaries,
                history_turns=history_turns,
                outcome=outcome,
                time_budget_s=time_budget_s,
                answer_draft=answer_draft,
            )
        except Exception as exc:
            if sidecar_ok:
                # Sidecar provato e fallback KO -> errore standardizzato
                from core.sidecar.client import AiUnavailable
                print(f"[LocalLLMClient] Fallback in-process KO: {exc}")
                raise AiUnavailable("AI non disponibile") from exc
            raise  # rollback inprocess: eccezione originale invariata

    def generated_via_sidecar(self, query, **kwargs) -> str:
        """Come generate(): testo completo via sidecar/fallback/AiUnavailable."""
        return "".join(t for t in self.stream_via_sidecar(query, **kwargs)
                       if isinstance(t, str))


# ======================================================================
# Wrapper opzionale: espone generate/generate_stream rediretti
# sull'adattore sidecar; ogni altro attributo passa al client reale.
# ======================================================================

def maybe_wrap_sidecar(client):
    """Ritorna SidecarLLMProxy se llm.backend='sidecar', altrimenti client."""
    if client is None:
        return None
    try:
        from data.config_manager import ConfigManager
        backend = str(ConfigManager().get("llm.backend", "sidecar") or "sidecar")
        if backend.strip().lower() != "sidecar":
            return client  # rollback 'inprocess': nessun wrap
        return SidecarLLMProxy(client)
    except Exception:
        return client


class SidecarLLMProxy:
    """Delega generate/generate_stream -> sidecar; il resto -> target."""

    def __init__(self, target):
        self._target = target

    def load_model_blocking(self):
        """R23: con llm.backend=sidecar il caricamento passa dal sidecar
        REALE (llama-server + llama.cpp legge Spark).

        Perche': llama-cpp-python 0.3.35 NON supporta l'architettura Spark
        (ValueError 'Failed to load model from file' - probe reale
        qa/_x_loadprobe.py): il vecchio delega in-process faceva fallire
        ogni load di Spark-base/pro e _watch_model_load cascava in fallback
        silenzioso al MiniCPM5-2B (QA-1 qa/x_qa1_switch.json: 2/2 switch
        Spark non attivi prima del fix).

        Ritorna il model_path del target; solleva LocalLLMError se il
        sidecar non parte (modello corrotto/incompatibile -> stessa via
        d'errore di prima: stato 'error' + fallback gestito dal watcher).
        """
        from core.sidecar import server as srv_mod
        srv = srv_mod.get_server()
        try:
            started = bool(srv.start_on_demand())
        except Exception as exc:
            raise LocalLLMError("caricamento sidecar fallito: %s" % exc)
        if not started or not srv.health():
            msg = getattr(srv, "message", "") or "sidecar non avviato"
            raise LocalLLMError("caricamento sidecar fallito: %s" % msg)
        return getattr(self._target, "model_path", "")

    def __getattr__(self, name):
        return getattr(self._target, name)

    # ------------------------------------------------------------------
    # R15b G0 - FIX SIDECAR-DEAD (ripertuto con traceback reale in
    # qa/r15_g0_prima.json): il bind partiva da
    # type(target).stream_via_sidecar, cioe' una funzione NON bound ->
    # 'self' assorbe il primo argomento reale ->
    # TypeError "missing a required argument: 'query'" -> catturato in
    # silenzio -> fallback SEMPRE in-process (llama-server mai avviato,
    # state=down misurato).
    # Ora il bind parte dal metodo che il chiamante ha REALMENTE invocato
    # (self esplicito): gli argomenti posizionali sono mappati sui nomi
    # corretti e ripassati come keyword a stream_via_sidecar. Se un
    # parametro non e' accettato dalla destinazione -> strada in-process,
    # esattamente come prima (nessun cambio di comportamento).
    # ------------------------------------------------------------------
    def _sidecar_kwargs(self, method_name, args, kwargs):
        """(ok, kwargs) da usare per stream_via_sidecar sul target."""
        import inspect
        tgt = self._target
        try:
            sig = inspect.signature(getattr(type(tgt), method_name))
            bound = sig.bind(tgt, *args, **kwargs)
            dest = inspect.signature(type(tgt).stream_via_sidecar)
        except (TypeError, ValueError, AttributeError):
            return False, None
        call = dict(bound.arguments)
        call.pop("self", None)
        if method_name == "generate":
            # generate(self, query, **kwargs): il **kwargs va esplicitato
            call.update(call.pop("kwargs", None) or {})
        allowed = set(dest.parameters)
        if any(k not in allowed for k in call):
            return False, None
        return True, call

    def generate_stream(self, *args, **kwargs):
        ok, call = self._sidecar_kwargs("generate_stream", args, kwargs)
        if not ok:
            return self._target.generate_stream(*args, **kwargs)
        return self._target.stream_via_sidecar(**call)

    def generate(self, *args, **kwargs):
        ok, call = self._sidecar_kwargs("generate", args, kwargs)
        if not ok:
            return self._target.generate(*args, **kwargs)
        return self._target.generated_via_sidecar(**call)

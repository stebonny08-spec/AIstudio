# StudioIA — Assistente virtuale desktop privato

Applicazione desktop (Python + CustomTkinter) che risponde alle tue domande
usando prima i tuoi file locali (PDF, Word, PowerPoint, Excel, immagini, testo)
tramite un motore RAG con comprensione anche di mappe/grafici/immagini
incorporate, e solo se necessario passa alla ricerca web, sempre segnalando
la fonte usata. Include una Modalità Insegnamento (tutor), l'input vocale,
e la conversione di appunti in PDF con OCR.

Tutti i dati (chat, indice, cache immagini) restano sul tuo PC. Il modello LLM
gira nativamente dentro l'applicazione in formato GGUF, senza bisogno di server
esterni come Ollama o LM Studio. L'unica dipendenza esterna è Tesseract OCR per
l'estrazione del testo dalle immagini.

Il sistema RAG funziona su 3 livelli sequenziali:
1. **Materiale caricato dallo studente** (cartella personale configurata)
2. **Libri e documenti pre-selezionati** (libri online gratis inclusi nell'app)
3. **Materiale e paper online** (ricerca web automatica se i primi due livelli falliscono)

## Funzionalità Principali

- **LLM Locale Nativo**: Esegue modelli GGUF direttamente nell'app (senza Ollama/LM Studio)
- **RAG a 3 Livelli**: Cerca prima nei tuoi file, poi nei libri pre-selezionati, infine sul web
- **OCR Locale**: OpenCV + Tesseract per leggere testo da immagini e appunti
- **Appunti2PDF**: Converte immagini di appunti in PDF con testo OCR ricercabile
- **Modalità Tutor**: Spiegazioni dettagliate con domande di verifica
- **Input Vocale**: Dettatura delle domande tramite microfono
- **Completa Privacy**: Tutto gira in locale, nessun dato lascia il tuo PC

---

## 1. Requisiti di sistema

- **Python 3.10 o superiore** (consigliato 3.11)
- **Tesseract OCR** — programma di sistema (non solo libreria Python),
  necessario per leggere il testo scritto dentro le immagini:
  - **Windows**: scaricare l'installer da
    https://github.com/UB-Mannheim/tesseract/wiki e installarlo (segnare il
    percorso di installazione, es. `C:\Program Files\Tesseract-OCR`, e
    aggiungerlo alla variabile d'ambiente `PATH`).
  - **macOS**: `brew install tesseract tesseract-lang`
  - **Linux (Debian/Ubuntu)**: `sudo apt install tesseract-ocr tesseract-ocr-ita`

  Se Tesseract non è installato, l'app funziona comunque: semplicemente non
  verrà estratto testo scritto dentro le immagini (l'opzione OCR può anche
  essere disattivata dalle Impostazioni).

- **Un microfono** funzionante, se si vuole usare la dettatura vocale
  (funzionalità opzionale, il resto dell'app funziona anche senza).

- **Un modello LLM in formato GGUF**, da scaricare da:
  - https://huggingface.co/TheBloke
  - https://huggingface.co/bartowski
  - https://huggingface.co/lmstudio-community
  
  Modelli consigliati per iniziare:
  - `Llama-3-8B-Instruct-GGUF` (buon equilibrio qualità/velocità)
  - `Mistral-7B-Instruct-GGUF` (leggero e veloce)
  - `Phi-3-mini-4k-instruct-GGUF` (molto leggero, ottimo per CPU)
  
  Scaricare il file `.gguf` (es. `llama-3-8b-instruct.Q4_K_M.gguf`) e salvarlo
  in una cartella a scelta. Il percorso verrà configurato nelle Impostazioni.

---

## 2. Installazione

```bash
# 1. Posizionarsi nella cartella del progetto
cd StudioIA

# 2. (Consigliato) creare un ambiente virtuale
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # macOS / Linux

# 3. Installare le dipendenze
pip install -r requirements.txt
```

**Nota su PyAudio (necessario per il microfono):** su Windows a volte
`pip install pyaudio` fallisce perché servirebbe compilarlo. Se succede:

```bash
pip install pipwin
pipwin install pyaudio
```

oppure scaricare il wheel precompilato corrispondente alla propria versione
di Python da https://www.lfd.uci.edu/~gohlke/pythonlibs/#pyaudio e installarlo con
`pip install nome_file.whl`.

**Nota su OpenCV:** se `pip install opencv-python` fallisce, provare:

```bash
pip install opencv-python-headless
```

---

## 3. Avvio

```bash
python main.py
```

Al primo avvio l'app si apre direttamente sulla pagina Impostazioni.

### Configurazione del Modello Locale

1. Scaricare un modello LLM in formato GGUF (vedi sopra)
2. Nelle Impostazioni, cliccare su "Scegli Modello GGUF" e selezionare il file scaricato
3. Selezionare la cartella locale da analizzare (materiale dello studente)
4. Cliccare "Salva impostazioni"

L'indicizzazione iniziale parte automaticamente in background (la si può seguire dallo stato in basso nella sidebar).

### Come usare l'app

1. **Carica il tuo materiale**: seleziona la cartella con i tuoi appunti, PDF, dispense
2. **Fai una domanda**: l'app cercherà prima nei tuoi file (Livello 1)
3. **Se non trova abbastanza**: cercherà automaticamente nei libri pre-selezionati (Livello 2)
4. **Se ancora non basta**: farà una ricerca web (Livello 3)
5. **Ricevi la risposta**: con indicata la fonte usata (tuoi file, libri, o web)

Puoi anche:
- Usare la **Modalità Tutor** per spiegazioni dettagliate con domande di verifica
- Dettare le domande col **microfono** (icona del microfono)
- Caricare **immagini di appunti** che verranno lette con OCR automatico

---

## 4. Struttura del progetto

```
StudioIA/
├── main.py                  punto d'ingresso
├── theme.py                  palette colori e widget pre-stilizzati
├── requirements.txt
├── gui/                       interfaccia grafica (CustomTkinter)
│   ├── app_window.py          controller principale, orchestrazione
│   ├── sidebar.py             menu laterale, storico chat
│   ├── chat_area.py           componente chat riusato da Chat e Tutor
│   ├── input_bar.py           barra inferiore (testo, mic, selettore modalità)
│   └── settings_view.py       pagina impostazioni
├── core/                       logica applicativa
│   ├── models.py               strutture dati condivise
│   ├── local_llm_client.py     modello LLM locale nativo (GGUF, llama-cpp-python)
│   ├── ocr_processor.py        motore OCR locale (OpenCV + Tesseract)
│   ├── router.py                decide quale livello RAG usare (1→2→3)
│   ├── local_search.py          facciata di ricerca RAG
│   ├── web_search.py            ricerca DuckDuckGo (livello 3)
│   ├── voice_input.py           riconoscimento vocale
│   ├── parsers/                  un modulo per formato file (pdf, docx, pptx, xlsx, txt, immagini)
│   └── rag/                      chunking, embedding, indice vettoriale, indicizzatore
├── data/                        persistenza
│   ├── config_manager.py        config.json (percorso modello, cartella, opzioni)
│   ├── db.py                    accesso SQLite (chat, messaggi, file indicizzati)
│   ├── preselected_books_manager.py  gestione libri pre-selezionati (livello 2)
│   └── schema.sql
└── utils/
    └── threading_utils.py       pattern thread + coda per non bloccare la GUI
```

I dati dell'applicazione (database, indice vettoriale, cache immagini,
configurazione) sono salvati in:

- Windows: `%APPDATA%\StudioIA`
- macOS: `~/Library/Application Support/StudioIA`
- Linux: `~/.config/StudioIA`

La cartella dei libri pre-selezionati (Livello 2) si trova in:
`StudioIA/data/preselected_books/`

---

## 5. Scelte di progettazione (perché alcune cose funzionano così)

- **Modello LLM nativo**: usiamo `llama-cpp-python` per eseguire modelli GGUF
  direttamente dentro l'app, senza bisogno di server esterni (Ollama, LM Studio).
  Questo rende l'app completamente autonoma e portatile.

- **OCR con OpenCV + Tesseract**: il riconoscimento delle immagini usa OpenCV
  per il pre-processing (miglioramento contrasto, rilevamento bordi) e Tesseract
  per l'estrazione del testo. Tutto in locale, senza API esterne.

- **Formati supportati**: `.pdf .docx .pptx .xlsx .txt .png .jpg .jpeg`. I
  vecchi formati binari pre-2007 (`.doc .xls .ppt`) non sono inclusi in
  questa versione: richiederebbero librerie meno stabili e più soggette a
  bug. Se servono, si possono aggiungere in un secondo momento.

- **Comprensione delle immagini**: le immagini trovate nei file (mappe,
  grafici, foto) vengono processate con OCR per estrarre il testo. Se il
  modello LLM supporta multimodalità (es. LLaVA-GGUF), le immagini pertinenti
  possono essere inviate anche per l'interpretazione visiva diretta.

- **Indicizzazione "in tempo reale" ma incrementale**: ad ogni domanda,
  l'intera struttura di cartelle viene ripercorsa (operazione economica),
  ma vengono ri-analizzati con l'IA solo i file nuovi o modificati rispetto
  all'ultima scansione (operazione costosa). Così l'app resta sempre
  aggiornata senza dover ri-processare centinaia di file ad ogni domanda.

- **RAG a 3 livelli**: il sistema cerca prima nei tuoi file personali, poi
  nei libri pre-selezionati, infine sul web. Ogni livello valuta se le
  informazioni trovate sono sufficienti prima di passare al successivo.

- **Nessuno streaming della risposta**: la risposta del modello viene mostrata
  tutta insieme quando è pronta (con un indicatore "Sto pensando..." nel
  frattempo), non parola per parola. Scelta fatta per tenere più semplice
  (e quindi più robusta) la gestione del threading.

---

## 6. Aggiungere libri pre-selezionati (Livello 2)

Per arricchire il secondo livello del RAG con libri e documenti gratuiti:

1. Scarica libri da fonti legali e gratuite (es. Project Gutenberg, OpenStax, arXiv)
2. Salva i file (PDF, TXT, DOCX) nella cartella `StudioIA/data/preselected_books/`
3. Riavvia l'app: i nuovi libri verranno indicizzati automaticamente

Questi libri saranno disponibili per tutti gli utenti dell'app e verranno
consultati automaticamente quando il materiale personale (Livello 1) non
è sufficiente a rispondere alle domande.

---

## 7. Estensioni future possibili

- Supporto ai formati Office pre-2007
- Streaming della risposta
- Esportazione/backup delle conversazioni
- Riconoscimento vocale offline (senza dipendere dal servizio Google gratuito)
- Modelli LLaVA-GGUF per interpretazione visiva diretta di grafici e diagrammi
- Fine-tuning semplificato per addestrare il modello su materiale specifico

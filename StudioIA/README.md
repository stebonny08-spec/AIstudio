# StudioIA — Assistente virtuale desktop privato

Applicazione desktop (Python + CustomTkinter) che risponde alle tue domande
usando un sistema RAG a 3 livelli: prima il materiale che carichi tu, poi
una libreria di libri/materiali in Markdown, e solo se necessario una
ricerca online ristretta a un elenco di fonti affidabili predefinito —
sempre segnalando quale fonte è stata usata. Include una Modalità
Insegnamento (tutor).

Tutti i dati (chat, indice, cache immagini) restano sul tuo PC. Il modello
LLM gira nativamente dentro l'applicazione in formato GGUF, senza bisogno
di server esterni come Ollama o LM Studio. Le uniche eccezioni all'uso
100% offline sono: il download una tantum (al primo avvio) del modello di
embedding usato per il RAG, e la ricerca online del livello 3. L'unica
dipendenza esterna di sistema è Tesseract OCR per l'estrazione del testo
dalle immagini.

Il sistema RAG funziona sempre su 3 livelli, in ordine, e passa al livello
successivo solo se quello precedente non basta a rispondere:

1. **Materiale caricato dallo studente** — foto di appunti, PDF o Word
   caricati dal pannello "Aggiungi materiale" (modalità "Appunti
   personali"): vengono convertiti in Markdown e vettorizzati subito.
2. **Materiale in Markdown già pronto**, in una cartella locale dedicata e
   separata dalla prima (modalità "Libri (Markdown)" dello stesso
   pannello): pensata per i libri scaricati da un'altra app, già in
   formato .md.
3. **Materiale e paper online**, ristretto a un elenco di fonti affidabili
   predefinito (enciclopedie, motori di ricerca accademici, siti di
   fact-checking, risorse governative, piattaforme educative — vedi
   `core/trusted_sources.py` per l'elenco completo e per aggiungerne altri).

## Funzionalità Principali

- **LLM Locale Nativo**: Esegue modelli GGUF direttamente nell'app (senza Ollama/LM Studio)
- **RAG a 3 Livelli**: Cerca prima nel materiale personale, poi nella libreria Markdown, infine online su fonti affidabili
- **OCR Locale**: OpenCV + Tesseract per leggere testo da immagini e appunti
- **Modalità Tutor**: Spiegazioni dettagliate con domande di verifica
- **Completa Privacy**: Tutto gira in locale (eccetto la ricerca online del livello 3), nessun altro dato lascia il tuo PC

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
2. Nelle Impostazioni, cliccare su "Sfoglia..." e selezionare il file scaricato
3. (Opzionale) selezionare una cartella locale aggiuntiva da analizzare, oltre al materiale caricato dal pannello "Aggiungi materiale"
4. Cliccare "Salva impostazioni"

L'indicizzazione iniziale parte automaticamente in background (la si può seguire dallo stato in basso nella sidebar).

### Come usare l'app

1. **Aggiungi il tuo materiale**: apri il pannello "Aggiungi materiale" (bottone in alto) e scegli la modalità giusta:
   - **Appunti personali** per foto/PDF/Word (livello 1)
   - **Libri (Markdown)** per file .md già pronti (livello 2)
2. **Fai una domanda**: l'app cerca prima nei tuoi appunti personali (Livello 1)
3. **Se non trova abbastanza**: cerca automaticamente nella libreria Markdown (Livello 2)
4. **Se ancora non basta**: fa una ricerca online, ristretta alle fonti affidabili predefinite (Livello 3)
5. **Ricevi la risposta**: con indicata la fonte usata (appunti, libreria, o web)

Puoi anche usare la **Modalità Tutor** per spiegazioni dettagliate con domande di verifica.

---

## 4. Struttura del progetto

```
StudioIA/
├── main.py                    punto d'ingresso
├── theme.py                   palette colori e widget pre-stilizzati
├── requirements.txt
├── gui/                        interfaccia grafica (CustomTkinter)
│   ├── app_window.py           controller principale, orchestrazione
│   ├── sidebar.py               menu laterale, storico chat
│   ├── chat_area.py             componente chat riusato da Chat e Tutor
│   ├── converter_panel.py       pannello "Aggiungi materiale" (livello 1 e 2)
│   ├── input_bar.py             barra inferiore (testo, selettore modalità)
│   └── settings_view.py         pagina impostazioni
├── core/                        logica applicativa
│   ├── models.py                 strutture dati condivise
│   ├── local_llm_client.py       modello LLM locale nativo (GGUF, llama-cpp-python)
│   ├── ocr_processor.py          motore OCR locale (OpenCV + Tesseract)
│   ├── router.py                  decide quale livello RAG usare (1→2→3)
│   ├── local_search.py            facciata di ricerca RAG
│   ├── web_search.py              ricerca DuckDuckGo ristretta (livello 3)
│   ├── trusted_sources.py         elenco dei siti consultabili dal livello 3
│   ├── markdown_converter.py      conversione foto/PDF/Word -> Markdown
│   ├── parsers/                    un modulo per formato file (pdf, docx, pptx, xlsx, txt/md, immagini)
│   └── rag/                        chunking, embedding, indice vettoriale, indicizzatore
├── data/                         persistenza
│   ├── config_manager.py          config.json (percorso modello, cartella, opzioni)
│   ├── db.py                      accesso SQLite (chat, messaggi, file indicizzati)
│   ├── preselected_books_manager.py  gestione cartella libri (livello 2)
│   └── schema.sql
└── utils/
    └── threading_utils.py       pattern thread + coda per non bloccare la GUI
```

I dati dell'applicazione (database, indici vettoriali, cache immagini,
configurazione) sono salvati in:

- Windows: `%APPDATA%\StudioIA`
- macOS: `~/Library/Application Support/StudioIA`
- Linux: `~/.config/StudioIA`

La cartella del materiale personale (Livello 1, alimentata dal
convertitore appunti) si trova in: `StudioIA/file_AIstudio/`

La cartella della libreria Markdown (Livello 2, alimentata dal
convertitore .md) si trova in: `StudioIA/data/preselected_books/`

---

## 5. Scelte di progettazione (perché alcune cose funzionano così)

- **Modello LLM nativo**: usiamo `llama-cpp-python` per eseguire modelli GGUF
  direttamente dentro l'app, senza bisogno di server esterni (Ollama, LM Studio).
  Questo rende l'app completamente autonoma e portatile.

- **OCR con OpenCV + Tesseract**: il riconoscimento delle immagini usa OpenCV
  per il pre-processing (miglioramento contrasto, rilevamento bordi) e Tesseract
  per l'estrazione del testo. Tutto in locale, senza API esterne.

- **Formati supportati**: `.pdf .docx .pptx .xlsx .txt .md .png .jpg .jpeg`. I
  vecchi formati binari pre-2007 (`.doc .xls .ppt`) non sono inclusi in
  questa versione: richiederebbero librerie meno stabili e più soggette a
  bug. Se servono, si possono aggiungere in un secondo momento.

- **Comprensione delle immagini**: le immagini trovate nei file (mappe,
  grafici, foto) vengono processate con OCR per estrarre il testo. Se il
  modello LLM supporta multimodalità (es. LLaVA-GGUF), le immagini pertinenti
  possono essere inviate anche per l'interpretazione visiva diretta.

- **Conversione + vettorizzazione "sotto al cofano"**: sia la modalità
  "Appunti personali" sia "Libri (Markdown)" del pannello "Aggiungi
  materiale" elaborano E indicizzano il file immediatamente, senza mai
  restituirlo o mostrarlo all'utente: è un dettaglio implementativo, non
  qualcosa da scaricare o gestire manualmente.

- **Indicizzazione "in tempo reale" ma incrementale**: ad ogni domanda,
  l'intera struttura di cartelle viene ripercorsa (operazione economica),
  ma vengono ri-analizzati con l'IA solo i file nuovi o modificati rispetto
  all'ultima scansione (operazione costosa). Così l'app resta sempre
  aggiornata senza dover ri-processare centinaia di file ad ogni domanda.

- **RAG a 3 livelli, sempre misto**: il sistema cerca prima nel materiale
  personale, poi nella libreria Markdown, infine online. Ogni livello
  valuta se le informazioni trovate sono sufficienti prima di passare al
  successivo — non è l'utente a dover scegliere dove cercare (a meno di
  selezionare esplicitamente "Solo locale" o "Solo online" dalla barra di
  input).

- **Ricerca online ristretta**: il livello 3 non è una ricerca generica sul
  web, ma è limitato ai domini elencati in `core/trusted_sources.py`,
  interrogati a piccoli gruppi per restare affidabili anche con un elenco
  lungo di fonti.

- **Nessuno streaming della risposta**: la risposta del modello viene mostrata
  tutta insieme quando è pronta (con un indicatore "Sto pensando..." nel
  frattempo), non parola per parola. Scelta fatta per tenere più semplice
  (e quindi più robusta) la gestione del threading.

---

## 6. Aggiungere materiale ai livelli 1 e 2

Il modo previsto è tramite il pannello **"Aggiungi materiale"** dentro
l'app (bottone in alto), scegliendo la modalità giusta — non serve
toccare manualmente il filesystem né riavviare l'app, l'indicizzazione
parte subito in automatico.

In alternativa, per aggiungere in blocco molti file alla libreria
(Livello 2), puoi anche copiarli manualmente in
`StudioIA/data/preselected_books/` (solo file `.md`) e poi premere
"Reindicizza ora" dalle Impostazioni.

---

## 7. Estensioni future possibili

- Supporto ai formati Office pre-2007
- Streaming della risposta
- Esportazione/backup delle conversazioni
- Modelli LLaVA-GGUF per interpretazione visiva diretta di grafici e diagrammi
- Fine-tuning semplificato per addestrare il modello su materiale specifico

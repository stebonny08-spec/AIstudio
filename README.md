# NovaStudio — Assistente virtuale desktop privato

*(Nome in codice del progetto/repository: StudioIA — i percorsi di cartella qui sotto usano ancora questo nome)*

Applicazione desktop (finestra nativa, non un sito web) che risponde alle
tue domande usando un sistema RAG a 3 livelli: prima il materiale che
carichi tu, poi una libreria di libri/materiali in Markdown, e solo se
necessario una ricerca online ristretta a un elenco di fonti affidabili
predefinito — sempre segnalando quale fonte è stata usata.

Tutti i dati (chat, indice, cache immagini) restano sul tuo PC. Il modello
LLM gira nativamente dentro l'applicazione in formato GGUF, senza bisogno
di server esterni come Ollama o LM Studio; è configurato internamente,
senza un'interfaccia per cambiarlo dall'app. Le uniche eccezioni all'uso
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

- **Un modello LLM in formato GGUF**, configurato internamente (non
  tramite l'interfaccia dell'app — vedi sezione 3).

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

**Nota su pywebview (Windows):** su Windows, pywebview usa il motore
WebView2 di Microsoft, già preinstallato su Windows 10/11 aggiornati. Se
manca, Windows chiede di installarlo automaticamente al primo avvio (o si
può scaricare da https://developer.microsoft.com/microsoft-edge/webview2/).

---

## 3. Avvio

```bash
python main.py
```

Si apre una finestra dell'applicazione (non un browser), direttamente sulla
schermata della chat.

### Il modello LLM è configurato internamente

Questa build non espone un'interfaccia per scegliere o modificare il
modello LLM (percorso del file .gguf, numero di thread, GPU, ecc.): è un
dettaglio gestito internamente, non dall'utente finale tramite l'app.
Finché non è configurato, la chat risponde segnalando semplicemente che il
modello non è ancora disponibile — il resto dell'app (caricamento
materiale nei livelli 1 e 2 del RAG) funziona comunque normalmente.

### Come usare l'app

1. **Aggiungi il tuo materiale**: apri il pannello "Aggiungi materiale" (bottone in alto a destra) e scegli la modalità giusta:
   - **Appunti personali** per foto/PDF/Word (livello 1)
   - **Libri (Markdown)** per file .md già pronti (livello 2)
2. **Fai una domanda**: l'app cerca prima nei tuoi appunti personali (Livello 1)
3. **Se non trova abbastanza**: cerca automaticamente nella libreria Markdown (Livello 2)
4. **Se ancora non basta**: fa una ricerca online, ristretta alle fonti affidabili predefinite (Livello 3)
5. **Ricevi la risposta**: con indicata la fonte usata (appunti, libreria, o web)

Puoi scegliere manualmente la modalità di ricerca (automatica / solo locale
/ solo online) dal bottone a sinistra della barra di input. Lo storico
delle conversazioni si trova nel menu a scomparsa a sinistra (bottone ☰ in
alto), dove trovi anche il bottone Impostazioni (icona ⚙️, in basso).

---

## 4. Struttura del progetto

```
StudioIA/
├── main.py                     punto d'ingresso: apre la finestra pywebview
├── requirements.txt
├── backend/
│   └── api.py                   bridge Python <-> JavaScript (window.pywebview.api)
├── web_frontend/                 interfaccia grafica (HTML/CSS/JS)
│   ├── html/index.html
│   ├── css/styles.css
│   └── js/app.js
├── core/                         logica applicativa
│   ├── models.py                  strutture dati condivise
│   ├── local_llm_client.py        modello LLM locale nativo (GGUF, llama-cpp-python)
│   ├── ocr_processor.py           motore OCR locale (OpenCV + Tesseract)
│   ├── router.py                   decide quale livello RAG usare (1→2→3)
│   ├── local_search.py             facciata di ricerca RAG
│   ├── web_search.py               ricerca DuckDuckGo ristretta (livello 3)
│   ├── trusted_sources.py          elenco dei siti consultabili dal livello 3
│   ├── markdown_converter.py       conversione foto/PDF/Word -> Markdown
│   ├── parsers/                     un modulo per formato file (pdf, docx, pptx, xlsx, txt/md, immagini)
│   └── rag/                         chunking, embedding, indice vettoriale, indicizzatore
└── data/                          persistenza
    ├── config_manager.py           config.json (percorso modello, cartella, opzioni)
    ├── db.py                       accesso SQLite (chat, messaggi, file indicizzati)
    ├── preselected_books_manager.py  gestione cartella libri (livello 2)
    └── schema.sql
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

- **Interfaccia HTML/CSS/JS dentro una finestra nativa (pywebview)**: non è
  un sito web, non apre un browser, non serve una connessione internet per
  funzionare (a parte il livello 3 del RAG). È scelta apposta al posto di
  un toolkit grafico nativo (es. Tkinter) perché permette uno stile molto
  più curato (colori, spaziature, animazioni) restando comunque un'app
  desktop a sé stante, con la sua finestra e la sua icona. Tutta la logica
  (LLM, RAG, database, file) gira in Python sul PC dell'utente; l'HTML è
  solo la resa grafica.

- **Selettori di file nativi**: il pulsante "Sfoglia..." nel pannello
  "Aggiungi materiale" apre il selettore di file del sistema operativo
  tramite pywebview, non un `<input type=file>` di un normale sito web:
  risultato più affidabile e più "da app vera".

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

- **Ogni chiamata JS -> Python gira su un thread dedicato** (comportamento
  nativo di pywebview): una risposta LLM lenta non blocca mai la finestra,
  senza bisogno di gestire manualmente il threading lato Python.

- **Sidebar a scomparsa, Impostazioni come finestra modale**: lo storico
  conversazioni vive in un menu a scomparsa (tendina) sul lato sinistro,
  chiuso di default — si apre dal bottone ☰ in alto e si chiude con la ✕
  o cliccando fuori. Le Impostazioni si aprono invece come una finestra
  più piccola al centro dello schermo, non a schermo intero. Ogni
  pannello/finestra dell'app si chiude sempre con un bottone ✕ esplicito.

- **Nessuno streaming della risposta**: la risposta del modello viene mostrata
  tutta insieme quando è pronta (con un indicatore "Sto pensando..." nel
  frattempo), non parola per parola.

---

## 6. Aggiungere materiale ai livelli 1 e 2

Il modo previsto è tramite il pannello **"Aggiungi materiale"** dentro
l'app (bottone in alto), scegliendo la modalità giusta — non serve
toccare manualmente il filesystem né riavviare l'app, l'indicizzazione
parte subito in automatico.

In alternativa, per aggiungere in blocco molti file alla libreria
(Livello 2), puoi anche copiarli manualmente in
`StudioIA/data/preselected_books/` (solo file `.md`): verranno indicizzati
automaticamente alla prossima domanda fatta all'app.

---

## 7. Estensioni future possibili

- Supporto ai formati Office pre-2007
- Streaming della risposta
- Esportazione/backup delle conversazioni
- Modelli LLaVA-GGUF per interpretazione visiva diretta di grafici e diagrammi
- Fine-tuning semplificato per addestrare il modello su materiale specifico

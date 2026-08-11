# StudioIA — Assistente virtuale desktop privato

Applicazione desktop (Python + CustomTkinter) che risponde alle tue domande
usando prima i tuoi file locali (PDF, Word, PowerPoint, Excel, immagini, testo)
tramite un motore RAG con comprensione anche di mappe/grafici/immagini
incorporate, e solo se necessario passa alla ricerca web, sempre segnalando
la fonte usata. Include una Modalità Insegnamento (tutor) e l'input vocale.

Tutti i dati (chat, indice, cache immagini) restano sul tuo PC. L'unico
traffico esterno è verso l'API scelta: Google Gemini (cloud) o un modello LLM
locale in esecuzione sul tuo computer (es. tramite Ollama, LM Studio, vLLM).

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

- **Una chiave API Google Gemini**, gratuita: si ottiene su
  https://aistudio.google.com/apikey
  
  **OPPURE**

- **Un server LLM locale** compatibile con API OpenAI, come:
  - **Ollama**: https://ollama.ai (scaricare e installare, poi eseguire `ollama run llama3`)
  - **LM Studio**: https://lmstudio.ai (interfaccia grafica per modelli locali)
  - **vLLM**: per deployment più avanzati
  - **Text Generation WebUI**: https://github.com/oobabooga/text-generation-webui

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

---

## 3. Avvio

```bash
python main.py
```

Al primo avvio l'app si apre direttamente sulla pagina Impostazioni.

### Configurazione con Google Gemini (cloud)

1. Inserire la **Chiave API Gemini** (ottenibile da https://aistudio.google.com/apikey)
2. Selezionare "Google Gemini (API cloud)" come Motore AI
3. Opzionalmente modificare il nome del modello (default: `gemini-3.5-flash`)
4. Selezionare la cartella locale da analizzare
5. Cliccare "Salva impostazioni"

### Configurazione con Modello Locale (Ollama, LM Studio, ecc.)

1. Assicurarsi che il server LLM sia in esecuzione (es. `ollama serve` per Ollama)
2. Selezionare "Modello Locale (Ollama, LM Studio, ecc.)" come Motore AI
3. Inserire l'**URL del Server Locale**:
   - Ollama: `http://localhost:11434/v1`
   - LM Studio: `http://localhost:1234/v1`
   - vLLM: `http://localhost:8000/v1`
4. Inserire il **Nome del Modello** (es. `llama-3`, `mistral`, `phi-3`)
5. L'API Key è opzionale per la maggior parte dei server locali (lasciare `not-needed`)
6. Selezionare la cartella locale da analizzare
7. Cliccare "Salva impostazioni"

L'indicizzazione iniziale parte automaticamente in background (la si può seguire dallo stato in basso nella sidebar).

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
│   ├── gemini_client.py        chiamate a Google Gemini (testo + immagini)
│   ├── local_llm_client.py     chiamate a modelli LLM locali (Ollama, LM Studio, ecc.)
│   ├── router.py                decide locale / web / entrambi
│   ├── local_search.py          facciata di ricerca RAG
│   ├── web_search.py            ricerca DuckDuckGo
│   ├── voice_input.py           riconoscimento vocale
│   ├── parsers/                  un modulo per formato file (pdf, docx, pptx, xlsx, txt, immagini)
│   └── rag/                      chunking, embedding, indice vettoriale, indicizzatore
├── data/                        persistenza
│   ├── config_manager.py        config.json (chiave API, cartella, opzioni)
│   ├── db.py                    accesso SQLite (chat, messaggi, file indicizzati)
│   └── schema.sql
└── utils/
    └── threading_utils.py       pattern thread + coda per non bloccare la GUI
```

I dati dell'applicazione (database, indice vettoriale, cache immagini,
configurazione) sono salvati in:

- Windows: `%APPDATA%\StudioIA`
- macOS: `~/Library/Application Support/StudioIA`
- Linux: `~/.config/StudioIA`

---

## 5. Scelte di progettazione (perché alcune cose funzionano così)

- **Formati supportati**: `.pdf .docx .pptx .xlsx .txt .png .jpg .jpeg`. I
  vecchi formati binari pre-2007 (`.doc .xls .ppt`) non sono inclusi in
  questa versione: richiederebbero librerie meno stabili e più soggette a
  bug. Se servono, si possono aggiungere in un secondo momento.

- **Comprensione delle immagini**: le immagini trovate nei file (mappe,
  grafici, foto) NON vengono capite tramite OCR (che legge solo testo), ma
  inviate direttamente al modello Gemini quando risultano pertinenti alla
  domanda: è Gemini stesso a "vederle" e interpretarle. L'OCR resta attivo
  solo come testo aggiuntivo ricercabile.

- **Indicizzazione "in tempo reale" ma incrementale**: ad ogni domanda,
  l'intera struttura di cartelle viene ripercorsa (operazione economica),
  ma vengono ri-analizzati con l'IA solo i file nuovi o modificati rispetto
  all'ultima scansione (operazione costosa). Così l'app resta sempre
  aggiornata senza dover ri-processare centinaia di file ad ogni domanda.

- **Modalità Automatica**: prova sempre prima i file locali. È Gemini
  stesso, guardando il materiale trovato, a determinare se è sufficiente
  per rispondere; solo se non lo è si passa automaticamente alla ricerca web.

- **Chiave API in chiaro**: salvata senza cifratura in `config.json`, per
  scelta esplicita, trattandosi di un'app desktop mono-utente. Non condividere
  questo file con altri.

- **Nessuno streaming della risposta**: la risposta di Gemini viene mostrata
  tutta insieme quando è pronta (con un indicatore "Sto pensando..." nel
  frattempo), non parola per parola. Scelta fatta per tenere più semplice
  (e quindi più robusta) la gestione del threading.

---

## 6. Estensioni future possibili

- Supporto ai formati Office pre-2007
- Streaming della risposta
- Esportazione/backup delle conversazioni
- Riconoscimento vocale offline (senza dipendere dal servizio Google gratuito)

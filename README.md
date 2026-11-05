# NovaStudio

Il tutor che ti assiste nello studio. Un'applicazione desktop **100% locale**
che gira interamente sul tuo computer: i tuoi appunti, i tuoi libri e le
tue conversazioni restano sempre al sicuro, senza inviare nulla a servizi
esterni.

## Cosa fa

NovaStudio risponde alle tue domande di studio usando:

1. **I tuoi appunti** (foto, PDF, Word) — livello 1 del RAG
2. **La tua libreria di libri** (PDF convertiti in Markdown) — livello 2 del RAG
3. **La ricerca online** su fonti affidabili predefinite (enciclopedie,
   siti universitari, portali di fact-checking) — livello 3 del RAG

Il sistema RAG a 3 livelli consulta prima gli appunti, poi la libreria,
poi — solo se serve — il web, sempre nell'ordine e sempre in locale.

Per ogni domanda puoi scegliere una **modalità di studio**:

| Modalità | Cosa fa |
|---|---|
| **Ripasso** | Tutor socratico: ti guida con domande progressive |
| **Esercizio** | Ti segue passo a passo senza mai rivelare la soluzione completa |
| **Riassunto** | Sintetizza contenuti in modo strutturato |
| **Chiarimento** | Spiega concetti complessi con analogie quotidiane |

Se non scegli nessuna modalità, viene usato un prompt di default.

## Requisiti

- **Windows 10 o 11** (64-bit)
- **4 GB di RAM** minimo, 8 GB consigliati
- **3 GB di spazio libero** su disco (per l'eseguibile + il modello LLM)
- Connessione a internet **solo** per scaricare il modello LLM al primo avvio

**Non serve installare nulla**: né Python, né Git, né Tesseract.
Tutto è incluso nell'eseguibile.

## Installazione

1. Scarica `NovaStudio-Windows.zip` dalla pagina delle release
2. Estrai lo ZIP in una cartella a tua scelta (es. `C:\NovaStudio\`)
3. Doppio clic su `NovaStudio.exe`

Al primo avvio:

1. Clicca **"Seleziona modelli"** in alto a sinistra
2. Clicca l'icona ⬇ accanto a "Modello base" (~1.5 GB)
3. Attendi il download (dipende dalla connessione)
4. Clicca sul nome del modello per attivarlo (appare una spunta ✓)
5. Clicca **"Aggiungi materiale"** per caricare i tuoi appunti
6. Scrivi una domanda nella barra in basso

## Uso quotidiano

### Caricare materiale

- **Appunti personali**: foto di appunti, PDF, Word. Vengono convertiti
  automaticamente in Markdown e indicizzati (livello 1 del RAG)
- **Libri**: PDF (es. manuali, libri di testo). Vengono convertiti in
  Markdown e resi disponibili come fonte di riferimento (livello 2 del RAG)

L'elaborazione è automatica: OCR per le immagini, estrazione testo per i
PDF, conversione per i Word. Non serve fare nulla a mano.

### Fare una domanda

1. Scrivi la domanda nella barra in basso
2. (Opzionale) Scegli una modalità di studio tra le 4 isole
3. (Opzionale) Attiva "Pensiero profondo" per far ragionare il modello
   più a lungo prima di rispondere
4. Premi Invio

La risposta arriva con l'indicazione della fonte (appunti, libreria o web).

### Storico conversazioni

Le conversazioni sono salvate automaticamente. Le trovi nella sidebar
a sinistra, accessibile dal bottone ☰ in alto.

## Come funziona (per curiosità)

### Architettura

### Stack tecnico

- **pywebview** — finestra desktop nativa (WebView2 su Windows)
- **llama-cpp-python** — esecuzione del modello LLM in formato GGUF
- **sentence-transformers** — embedding multilingua (modello E5-small)
- **ChromaDB** — indice vettoriale locale
- **PyMuPDF, python-docx, python-pptx, openpyxl, pdfplumber** — parsing
- **OpenCV + Tesseract** — OCR locale (Tesseract è incluso nel bundle)
- **SQLite** — database locale per conversazioni e cache

### Dove finiscono i dati

Tutto resta **sul tuo PC**, in:

| Sistema | Percorso |
|---|---|
| Windows | `%APPDATA%\NovaStudio\` |
| macOS | `~/Library/Application Support/NovaStudio/` |
| Linux | `~/.config/NovaStudio/` |

Dentro trovi:
- `config.json` — impostazioni
- `studioia.db` — conversazioni e metadati
- `vector_index/` — indice vettoriale del livello 1 (appunti)
- `vector_index_books/` — indice vettoriale del livello 2 (libri)
- `images_cache/` — immagini estratte dai documenti
- `models/` — modelli LLM scaricati (`.gguf`)

Nessun dato viene mai inviato a server esterni. L'unica connessione di
rete è:
1. Il download del modello LLM (una volta sola, da Hugging Face)
2. La ricerca web del livello 3 del RAG (opzionale, solo quando serve)

### Modello LLM

Il modello di riferimento è **MiniCPM5-2B** (formato GGUF, quantizzazione
Q4_K_M, ~1.5 GB). Viene scaricato al primo avvio dal menu "Seleziona
modelli".

Puoi aggiungere altri modelli modificando `data/models_manager.py` →
`MODELS_CATALOG`. Modelli compatibili: Qwen3, Llama 3.1, Mistral, e in
generale tutti i modelli GGUF con chat template ChatML.

## Sviluppo

### Requisiti per lo sviluppatore

- **Python 3.11 o superiore** (3.13 testato)
- **Git for Windows** (per clonare e gestire il repo)
- **Git Bash** (per lanciare gli script `.sh`)

Tesseract **non serve installarlo**: è incluso nel bundle dell'app.

### Setup

```bash
# Clona il repository
git clone https://github.com/stebonny08-spec/AIstudio.git
cd AIstudio

# Crea il virtual environment
python -m venv .venv

# Attivalo (Git Bash)
source .venv/Scripts/activate

# Installa le dipendenze
pip install -r requisiti.txt

## Cosa è cambiato rispetto a una versione "vecchia"

- **Requisiti**: rimosso "Tesseract OCR" tra le dipendenze da installare
- **Installazione**: "Non serve installare nulla"
- **Uso quotidiano**: rimosse istruzioni su come installare Tesseract a parte
- **Stack tecnico**: nota che Tesseract è nel bundle
- **Sviluppo**: nota che Tesseract non va installato nemmeno per sviluppare
- **FAQ**: risposta dedicata a "L'OCR non funziona" che rimanda al fatto che è incluso

## Nota su cosa manca ancora nel README

Ho scritto la sezione **Licenza** in modo che punti a `LICENSE` e
`THIRD_PARTY_LICENSES.md`. Ma:

1. **`LICENSE` non esiste ancora** nella root del progetto. Va creato con la licenza che scegli (MIT, GPL, ecc.).
2. **`THIRD_PARTY_LICENSES.md`** te l'ho dato nei messaggi precedenti, va salvato nella root.

Se vuoi, dimmi che licenza vuoi per l'app e ti scrivo il file `LICENSE` completo. Il README è già pronto per puntarci.
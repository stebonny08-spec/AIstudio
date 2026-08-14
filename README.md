# 🚀 StudioIA - Assistente AI con RAG

StudioIA è un'applicazione desktop che combina un frontend moderno in Tauri/React con un backend Python potente per l'elaborazione di documenti e la chat basata su RAG (Retrieval-Augmented Generation).

## 🏗️ Architettura

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend Tauri                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  React + TypeScript                                   │  │
│  │  - Dashboard                                          │  │
│  │  - Conversione file                                   │  │
│  │  - Chat RAG                                           │  │
│  │  - Database libri                                     │  │
│  │  - Impostazioni                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          │ HTTP (localhost:8765)            │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                  Backend Python                             │
│                          ▼                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  API Server (HTTP)                                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│         ┌────────────────┼────────────────┐                │
│         ▼                ▼                ▼                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │ Converters │  │   RAG      │  │   LLM      │           │
│  │ PDF→MD     │  │  Vector    │  │  Textual   │           │
│  │ Word→MD    │  │  Store     │  │  (GGUF)    │           │
│  │ Image→MD   │  │  user_files│  │            │           │
│  └────────────┘  │  data_base │  └────────────┘           │
│         │        └────────────┘         │                  │
│         ▼                               ▼                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           OCR Processor (Immagini)                    │  │
│  │  - PaddleOCR (testo)                                  │  │
│  │  - pix2tex (formule LaTeX)                            │  │
│  │  - CLIP (embedding visivo)                            │  │
│  │  - Qwen3-VL-2B-Q4 (descrizioni)                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Struttura Cartelle

Dopo l'installazione, il sistema crea automaticamente:

```
StudioIA/
├── user_files/          # File dell'utente (vettorizzati)
│   ├── vectors/         # Embedding dei documenti utente
│   └── images/          # Immagini processate con metadata
├── data_base/           # Database libri pre-selezionati
│   ├── vectors/         # Embedding dei libri
│   └── images/          # Immagini dai libri
├── backend/
│   ├── api.py           # Logica delle API
│   └── api_server.py    # Server HTTP
└── core/
    ├── rag/             # Sistema RAG
    ├── parsers/         # Parser per vari formati
    └── ...
```

## 🔧 Installazione

### Prerequisiti

- **Python 3.8+**
- **Node.js 18+**
- **Rust** (per Tauri)

### Avvio Rapido

```bash
cd /workspace
./run_studioia.sh
```

Lo script:
1. Crea le cartelle `user_files/` e `data_base/`
2. Installa le dipendenze Python
3. Avvia il server API Python su `http://127.0.0.1:8765`
4. Installa le dipendenze Node.js
5. Avvia l'app Tauri in modalità sviluppo

### Installazione Manuale

#### Backend Python

```bash
cd StudioIA
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

#### Frontend Tauri

```bash
cd studio-ia-gui
npm install
npm run tauri dev
```

## 🎯 Funzionalità

### 1. Conversione File
- **PDF → Markdown**: Estrazione testo strutturato
- **Word → Markdown**: Conversione documenti Office
- **Immagini → Markdown**: OCR avanzato con supporto formule

### 2. Vettorizzazione
I file convertiti vengono immediatamente vettorizzati e salvati in:
- `user_files/vectors/` per i file utente
- `data_base/vectors/` per i libri database

### 3. Processamento Immagini Avanzato

Per ogni immagine:
```
Immagine
   ↓
┌─────────────────────────────────────┐
│ 1. PaddleOCR → Testo visibile       │
│ 2. pix2tex → LaTeX (se formula)     │
│ 3. CLIP → Vettore visivo            │
│ 4. Qwen3-VL-2B-Q4 → Descrizione     │
└─────────────────────────────────────┘
   ↓
Caption finale + Embedding
   ↓
Salvataggio come chunk IMMAGINE
```

Metadata esempio:
```json
{
  "tipo": "immagine",
  "percorso": "images/circuito.png",
  "libro": "fisica",
  "pagina": 47,
  "caption": "Schema di circuito in serie",
  "testo_ocr": "9V, R1, R2, 30mA",
  "latex": null,
  "clip_id": 1284
}
```

### 4. Chat RAG
- Ricerca in entrambi i vector store (utente + database)
- Supporto conversazioni multiple
- Contesto dalle fonti per risposte accurate

### 5. Database Libri
- Sezione dedicata per caricare libri nel database
- Vettorizzazione separata dai file utente
- Pulsante "Libri Data Base" nella conversione

## ⚙️ Configurazione

### Modelli AI

Nelle impostazioni puoi configurare:
- **Modello Testuale (GGUF)**: Per la chat e il ragionamento
- **Modello Vision (Qwen3-VL-2B-Q4)**: Per l'analisi immagini

### Parametri RAG

- Chunk size: 350-600 token
- Overlap: 50 token
- Top-k search: 5 risultati

## 📊 Spazio su Disco Stimato

| Componente | Dimensione |
|------------|------------|
| Codice base | ~163 MB |
| Runtime e dipendenze | ~700 MB |
| Modelli AI | 3.5-4.5 GB |
| Dati utente | Variabile (500MB - 2GB+) |
| **Totale** | **4.8 - 7.3 GB** |

## 🔌 API Endpoints

Il server Python espone questi endpoint:

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/convert` | POST | Converte file in Markdown |
| `/api/vectorize` | POST | Vettorizza file MD |
| `/api/process_image` | POST | Processa immagine con OCR |
| `/api/chat` | POST | Chat con supporto RAG |
| `/api/books` | GET | Lista libri database |
| `/api/upload_book` | POST | Carica libro nel database |
| `/api/load_model` | POST | Carica modello AI |
| `/api/settings` | GET/POST | Gestione impostazioni |
| `/api/system` | GET | Info sistema |

## 🛠️ Sviluppo

### Build Produzione

```bash
./run_studioia.sh --build
```

### Debug

Il frontend comunica con il backend via HTTP. Puoi testare le API con:

```bash
curl http://127.0.0.1:8765/api/system
curl -X POST http://127.0.0.1:8765/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Ciao!"}'
```

## 📝 Note Importanti

1. **Cartelle Separate**: I file utente vanno in `user_files/`, i libri in `data_base/`
2. **Vettorizzazione Immediata**: Dopo la conversione, i file sono subito vettorizzati
3. **Approccio Ibrido**: Due motori AI separati (testuale + vision)
4. **Immagini**: Supporto completo per OCR, formule LaTeX e descrizioni semantiche

## 🐛 Troubleshooting

### Il server Python non si avvia
```bash
cd StudioIA
source venv/bin/activate
python backend/api_server.py
```

### Errori di compilazione Tauri
```bash
cd studio-ia-gui
rm -rf node_modules
npm install
npm run tauri dev
```

### Modelli non trovati
Configura i percorsi corretti nelle impostazioni dell'app.

---

**StudioIA** - Il tuo assistente AI personale per lo studio e la ricerca.

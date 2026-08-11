# 📚 Appunti2PDF

Trasforma foto di appunti scritti a mano in un **unico PDF vettoriale, pulito
e ben formattato**, pronto per essere indicizzato da un Tutor AI (RAG).

L'app gira come un **vero programma desktop** (finestra nativa, nessun
browser): l'interfaccia è costruita con Streamlit ma viene incapsulata in
una finestra pywebview tramite `desktop.py`.

L'app espone **due soli flussi di elaborazione**, ottimizzati per minimizzare
i costi delle chiamate AI:

| Flusso | Quando usarlo | Come funziona |
|---|---|---|
| 🟢 **A — Testo continuo** | Pagine scritte a righe, riassunti, brani di testo tradizionali | OCR locale gratuito (EasyOCR) → pulizia leggera via LLM di testo (Gemini) → PDF |
| 🔵 **B — Mappe / Schemi** | Diagrammi, concetti in riquadri, frecce, layout non lineare | Analisi diretta dell'immagine via Gemini Vision → markdown gerarchico → PDF |

---

## 1. Struttura del progetto

```
appunti2pdf/
├── desktop.py                 # PUNTO DI INGRESSO: avvia l'app come finestra desktop nativa
├── app.py                     # interfaccia utente (Streamlit), avviata internamente da desktop.py
├── requirements.txt
├── .env.example                # modello di configurazione (copiare in .env) — SOLO per chi distribuisce l'app
├── .streamlit/
│   └── config.toml             # rimuove il pulsante "Deploy", disattiva la telemetria, velocizza l'avvio
├── README.md
└── src/
    ├── config.py                # configurazione centralizzata + verifica chiave AI (mai esposta)
    ├── ui_i18n.py                # traduzione italiana del menu nativo di Streamlit ("⋮")
    ├── utils.py                  # ordinamento file, validazione/ridimensionamento immagini, ZIP
    ├── ocr_engine.py              # OCR locale (EasyOCR) — Flusso A
    ├── ai_text_cleaner.py         # pulizia testo via Gemini — Flusso A
    ├── ai_vision_analyzer.py      # analisi visiva via Gemini — Flusso B
    └── pdf_generator.py           # generazione PDF vettoriale (ReportLab)
```

## 2. Installazione

Richiede **Python 3.10+**.

```bash
cd appunti2pdf
python -m venv .venv
source .venv/bin/activate        # su Windows: .venv\Scripts\activate

pip install -r requirements.txt
```

> **Nota su EasyOCR:** al primo utilizzo scarica automaticamente i pesi del
> modello (richiede connessione internet e qualche centinaio di MB di
> spazio disco). Le esecuzioni successive partono da cache locale in pochi
> secondi. Il download avviene solo quando si usa per la prima volta il
> Flusso A, non all'avvio dell'app.

## 3. Configurazione della chiave API Gemini (solo per chi distribuisce l'app)

**La chiave API non è mai visibile né modificabile dall'utente finale**: va
impostata una sola volta da chi prepara/distribuisce l'applicazione.

1. Ottieni una API key gratuita su [Google AI Studio](https://aistudio.google.com/apikey).
2. Copia `.env.example` in `.env` (nella cartella del progetto) e incolla la chiave:

   ```bash
   cp .env.example .env
   ```

   ```
   GEMINI_API_KEY=la-tua-chiave-qui
   ```

Se distribuisci l'app ad altre persone (es. impacchettandola con
PyInstaller), **non includere il file `.env` nel pacchetto pubblico** se non
vuoi che la chiave sia estraibile dai file dell'applicazione: valuta metodi
di distribuzione più sicuri della chiave (es. un tuo backend proxy) se
questo è un requisito importante per il tuo caso d'uso.

Se la chiave non è configurata, l'app si avvia comunque ma mostra un
messaggio generico ("servizio non disponibile") e disabilita il pulsante di
generazione: non vengono mai mostrati dettagli tecnici all'utente finale
(il motivo reale viene solo registrato nei log per chi sviluppa/mantiene
l'app).

## 4. Avvio dell'app

**Uso normale (app desktop):**

```bash
python desktop.py
```

Si apre una finestra nativa con una breve schermata di caricamento, seguita
dall'interfaccia dell'app — nessun browser, nessuna barra degli indirizzi.

**Uso in fase di sviluppo (nel browser, per iterare più velocemente):**

```bash
streamlit run app.py
```

Utile per modificare l'interfaccia senza dover riavviare la finestra
desktop ad ogni modifica.

## 5. Utilizzo

1. **Carica gli appunti**: singole immagini oppure un archivio ZIP di una
   cartella intera (i browser non permettono l'upload diretto di cartelle).
   Le pagine vengono ordinate automaticamente per nome file — usa nomi tipo
   `pagina01.jpg`, `pagina02.jpg`, ... per garantire l'ordine corretto.
2. **Scegli il flusso**: Testo continuo oppure Mappe/Schemi.
3. **Dai un titolo** al documento (verrà usato come titolo del PDF).
4. **Genera il PDF** e scaricalo con il pulsante dedicato.

In caso di errore su una singola pagina (es. immagine illeggibile, timeout
API), l'elaborazione **non si interrompe**: la pagina viene segnalata come
errore direttamente nel PDF finale e le altre pagine proseguono normalmente.

## 6. Menu dell'app e pulsante "Deploy"

- Il pulsante **"Deploy"** (pensato per chi sviluppa app Streamlit da
  pubblicare online) è **rimosso** tramite l'impostazione ufficiale
  `client.toolbarMode = "viewer"` in `.streamlit/config.toml`: è la via più
  robusta, non dipende da trucchi lato JavaScript.
- Il menu **"⋮"** resta visibile e le sue voci (Riesegui, Impostazioni,
  Registra uno screencast, Stampa, Informazioni, ...) vengono **tradotte in
  italiano** da uno script iniettato (`src/ui_i18n.py`), perché Streamlit
  non offre un'opzione ufficiale di localizzazione per queste etichette.
  **Nota di robustezza**: se una futura versione di Streamlit cambiasse il
  testo originale di una voce, quella singola voce smetterebbe di essere
  tradotta (tornerebbe in inglese) senza causare errori o rompere l'app;
  basterebbe aggiornare la mappa di traduzione in `src/ui_i18n.py`.

## 7. Note tecniche su prestazioni e robustezza

- **Avvio più rapido**: il file `.streamlit/config.toml` disattiva la
  telemetria (`gatherUsageStats = false`, evita una chiamata di rete
  all'avvio) e il file-watcher (`fileWatcherType = "none"`), pensati per
  un'app desktop impacchettata, non per lo sviluppo attivo.
- **Risorse pesanti caricate una sola volta**: il motore OCR e i client AI
  vengono creati una sola volta per l'intera sessione tramite
  `st.cache_resource` (il meccanismo ufficiale di Streamlit per questo),
  invece di essere ricreati ad ogni interazione dell'utente.
- **Porta libera automatica**: `desktop.py` chiede al sistema operativo una
  porta locale libera ad ogni avvio, evitando conflitti con altre app o con
  istanze precedenti non chiuse correttamente.
- **Avvio resiliente**: `desktop.py` mostra una schermata di caricamento
  mentre il server si avvia, con timeout e messaggi d'errore chiari se il
  server non risponde o si interrompe in modo anomalo (invece di una
  finestra bianca o bloccata).
- **Spegnimento pulito**: il processo Streamlit viene terminato quando si
  chiude la finestra, anche in caso di chiusura anomala (`atexit`).
- L'ordinamento delle pagine segue il nome del file (ordinamento
  "naturale": `pagina2` precede `pagina10`).
- Le immagini più grandi di `MAX_IMAGE_SIDE_PX` (default 2600px sul lato
  maggiore) vengono ridimensionate automaticamente prima dell'invio alle
  API, per contenere tempi e costi senza impattare la leggibilità.
- L'SDK usato per Gemini è quello ufficiale e attualmente mantenuto,
  [`google-genai`](https://github.com/googleapis/python-genai) (il
  precedente `google-generativeai` è deprecato).

## 8. Distribuzione come eseguibile (opzionale, non incluso)

Per distribuire l'app come singolo eseguibile (`.exe`/`.app`) si può usare
[PyInstaller](https://pyinstaller.org/), puntando a `desktop.py` come script
principale. Va prestata attenzione a includere esplicitamente tra i dati
del pacchetto la cartella `.streamlit/`, `app.py`, la cartella `src/` e i
file statici del pacchetto `streamlit` stesso (PyInstaller non li rileva
sempre automaticamente): questo passaggio non è stato implementato/testato
in questo progetto e richiede verifica sul sistema operativo di destinazione.

## 9. Possibili estensioni future

- Riordino manuale delle pagine via drag-and-drop.
- Esportazione anche in formato Markdown/testo puro (oltre al PDF), utile
  per pipeline RAG che preferiscono l'input testuale grezzo.
- Modalità CLI/batch per elaborare più cartelle in automatico.
- Cache dei risultati OCR/AI per evitare di rielaborare pagine già
  processate in sessioni precedenti.

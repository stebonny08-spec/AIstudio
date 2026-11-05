# PIANO INTERFACCA — NovaStudio Suite Studio

## 1. Analisi dello stack attuale

| Parte | Tecnologia / file |
|---|---|
| Frontend | **singolo file** `web_frontend/html/index.html` (HTML + CSS inline + JS inline), tema dark unico |
| Finestra desktop | **pywebview** (WebView2), finestra creata in `main.py` |
| Bridge JS↔Python | `backend/api.py` → classe `StudioIAAPI` esposta come `window.pywebview.api` |
| Storage | **SQLite** locale via `data/db.py` + `data/schema.sql` (tabelle `chats`, `messages`, `indexed_files`) |
| LLM/RAG | `core/` (invariato — **fuori scope**) |
| Materiali | modale "Aggiungi materiale" esistente (`add_notes_material` / `add_library_material`) |
| UI chat | `welcomeView` (hero) + `chatView` (messaggi) + barra input fissa in basso + sidebar storico |
| Componenti riutilizzabili | classi CSS `btn-accent`, `btn-secondary`, `btn-outline`, `icon-btn`, `modal-overlay/modal`, `chip`, variabili `--bg --panel --card --border --accent` |

Il chatbot esistente (streaming, stop, "Continua", modalità di studio, modelli, materiali, sidebar) **resta intatto**: viene solo incapsulato nella nuova sezione "Chatbot".

## 2. Navigazione nuova

Nessun router esterno: si aggiunge un **routerino in JS** (`js/app.js`, oggetto globale `App`) che mostra/nasconde viste:

```
App.go('home')            → home con 7 card
App.go('chat-list')       → lista conversazioni (modulo Chatbot)
App.go('chat-session')    → chat esistente (welcomeView/chatView + input)
App.go('<modulo>')        → vista modulo dentro #moduleView
```

- La **home** è la schermata iniziale (al load si nascondono welcomeView e barra input).
- Ogni modulo può tornare alla home (bottone "⌂ Home" nei header di ogni modulo + logo cliccabile + voce "Home" nella sidebar).
- Moduli registrati: `chatbot`, `notes`, `schemi`, `produttivita`, `ripasso`, `biblioteca`, `calendario`.

## 3. File esistenti riutilizzati / modificati

| File | Modifica |
|---|---|
| `web_frontend/html/index.html` | +`<link>` CSS moduli, +`<script>` moduli; micro-adattamenti: hidden iniziale di welcomeView/input, click storico → `App.go('chat-session')`, nuova chat → setup, hook meta conversazione |
| `data/schema.sql` | +tabelle `study_items`, `subjects`, `calendar_events` |
| `data/db.py` | +migration colonne `chats.materia/attivita`, +CRUD nuovi moduli, storico con anteprima |
| `backend/api.py` | `StudioIAAPI` eredita `StudyAPI` (nuovo mixin in `backend/study_api.py`) |
| CSS esistente | tutto riusato (variabili, bottoni, modali) |

## 4. Nuovi file

```
web_frontend/html/css/modules.css        stile home + moduli
web_frontend/html/js/store.js            wrapper API + fallback localStorage
web_frontend/html/js/app.js              router, home, helper UI
web_frontend/html/js/modules/chatbot.js  lista conversazioni + setup
web_frontend/html/js/modules/notes.js    appunti a mano (canvas)
web_frontend/html/js/modules/schemi.js   nodi/archi (SVG)
web_frontend/html/js/modules/produttivita.js   hub produttività
web_frontend/html/js/modules/presentazioni.js  editor slide
web_frontend/html/js/modules/documenti.js      editor documenti
web_frontend/html/js/modules/fogli.js          foglio di calcolo
web_frontend/html/js/modules/video.js          video storytelling
web_frontend/html/js/modules/ripasso.js   flashcard
web_frontend/html/js/modules/biblioteca.js raccolta elementi
web_frontend/html/js/modules/calendario.js calendario studio
backend/study_api.py                     API dei nuovi moduli (mixin)
```

Documentazione: `PIANO_INTERFACCIA.md`, `MODULI.md`, `NOTE.md`, `README_DEV.md`.

## 5. Storage

- **Una sola tabella generica** `study_items(id, kind, title, content JSON, materia, tags, description, thumbnail, created_at, updated_at)` per note, schemi, riassunti, mazzi, presentazioni, documenti, fogli, progetti video → dati separati per `kind`, ID unici UUID, auto-salvataggio lato frontend, salvataggio richiesto a backend.
- `subjects` (materie con colore), `calendar_events` (eventi con ricorrenza e collegamento a `link_kind/link_id`).
- `chats` +colonne `materia`, `attivita`; `get_conversations()` arricchito con anteprima (ultimo messaggio) e conteggio.
- Asset multimediali importati (immagini/video/audio dei progetti) copiati in `%APPDATA%/NovaStudio/assets/` via `study_pick_asset()`.

## 6. Flusso Chatbot (invariato nel cuore)

```
Home → card Chatbot → lista conversazioni (card: titolo, data, materia, attività, anteprima)
   ├─ [+]  → setup (materia, tipo attività → preset studyMode, modello, opzioni, messaggio iniziale) → chat sessione
   ├─ [Aggiungi materiali] → modale materiali ESISTENTE
   └─ click card → openConversation(id) ESISTENTE → chat sessione
Uscita dalla chat → "⌂ Home" → la conversazione è già salvata (DB esistente) e appare come card.
```

Preset attività → riuso delle `SYSTEM_PROMPTS` esistenti: riassunto→`riassunto`, chiarimento→`chiarimento`, esercizio→`esercizio`, spiegazione semplice→`chiarimento`, interrogazione/ripasso→`ripasso`, generale→nessuno. **Nessuna modifica a RAG/KV/cache/prompt.**

## 7. Ordine di implementazione

1. ✅ Analisi + questo piano
2. Backend: schema, db, study_api
3. Fondamenta frontend: modules.css, store.js, app.js (home + router)
4. Chatbot (lista + setup, integrazione chat esistente)
5. Appunti → Schemi → Produttività → Ripasso → Biblioteca → Calendario
6. Documentazione (MODULI.md, NOTE.md, README_DEV.md)

## 8. Vincoli rispettati

- 100% locale, nessun CDN/font remoto/API cloud (KaTeX già locale).
- Nessuna ottimizzazione di RAM/RAG/KV/cache/bundle: solo UI, flusso utente, nuovi moduli.
- Nessuna dipendenza nuova (`requirements.txt` invariato).
- MVP + note differite in `NOTE.md` per le funzioni troppo pesanti (export video completo, OCR, sync).

---

# STATO DI IMPLEMENTAZIONE (aggiornato)

| Fase | Stato |
|---|---|
| 1. Analisi + PIANO_INTERFACCIA.md | ✅ |
| 2. Home con 7 card + router (`js/app.js`) | ✅ |
| 3. Chatbot: lista card, `+` con setup, Aggiungi materiali, integrazione chat esistente, meta salvate | ✅ |
| 4. Appunti: canvas, penna/evidenziatore/gomma/testo, undo/redo, zoom/pan, import, salvataggio, thumbnail, palm rejection, "migliora scrittura" | ✅ |
| 5. Schemi: nodi/edge, drag/resize, colori, auto-layout, pannello riassunto+fonti, salvataggio | ✅ |
| 6. Produttività: hub + presentazioni/documenti/fogli/video MVP | ✅ |
| 7. Ripasso: mazzi, flashcard, editor, studio, statistiche/ripetizione semplice | ✅ |
| 8. Biblioteca: tutti gli elementi, ricerca/filtri, apertura nei moduli, rinomina/duplica/elimina/tag/materia | ✅ |
| 9. Calendario: mese, materie+colori, eventi CRUD, ricorrenza, collegamento materiali | ✅ |
| 10. Documentazione: PIANO, MODULI, NOTE, README_DEV | ✅ |

### File creati
`PIANO_INTERFACCIA.md`, `MODULI.md`, `NOTE.md`, `README_DEV.md`,
`backend/study_api.py`,
`web_frontend/html/css/modules.css`,
`web_frontend/html/js/store.js`, `web_frontend/html/js/app.js`,
`web_frontend/html/js/modules/{chatbot,notes,schemi,produttivita,presentazioni,documenti,fogli,video,ripasso,biblioteca,calendario}.js`

### File modificati
`web_frontend/html/index.html` (link CSS, script moduli, hidden iniziali, micro-hook di navigazione),
`data/schema.sql` (3 tabelle nuove), `data/db.py` (migrazione + CRUD), `backend/api.py` (eredita StudyAPI + conversazioni arricchite).

### Componenti riusati
Tema dark e CSS core (`btn-*`, `modal`, `icon-btn`), modale materiali, sidebar storico,
tutta la chat (streaming/stop/Continua/mode/KaTeX), `openConversation`/`loadConversations`,
modalità di studio e prompt LLM, backend RAG/LLM intatto, SQLite via `data/db.py`.

### Verifiche eseguite
- `node --check` su tutti i 13 file JS: OK
- `python -m py_compile` su `data/db.py`, `backend/study_api.py`, `backend/api.py`: OK
- Test runtime CRUD database (save/list/get/chat meta/eventi/materie): OK
- Smoke test DOM (home + tutti i moduli + sub-tool + openItem per ogni kind): OK
- Scan "niente CDN/fetch/http" nei nuovi file: OK

---

# ROUND 2 — modifiche successive

Le modifiche del secondo round (home senza hamburger, cartelle globali,
materia in maiuscolo con suggerimenti, chatbot con solo argomento +
retrieval filtrato, quaderno a pagine, lazo/gomma/slider negli appunti,
stile e tipi negli schemi, bottoni centrati rimossi in Produttività e
Ripasso, Biblioteca per cartelle, materia nel Calendario) sono descritte
in dettaglio in **`MODIFICHE.md`**.

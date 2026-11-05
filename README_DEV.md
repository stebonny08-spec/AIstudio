# README_DEV — guida per sviluppatore (NovaStudio Suite Studio)

## Avvio dell'app (sviluppo)

```bash
# 1) ambientazione
python -m venv .venv
source .venv/Scripts/activate        # Git Bash su Windows
pip install -r requirements.txt

# 2) avvio (finestra pywebview + backend locale)
python main.py
# oppure
./run.sh
```

- Requisiti: **Python 3.11+** (3.13 testato), Windows 10/11 (anche Linux/macOS con le dipendenze giuste).
- Al primo avvio serve scaricare il modello LLM dal menu **Seleziona modelli** (unico accesso a rete dell'app).
- Nessun server web: l'interfaccia è un file locale (`web_frontend/html/index.html`) caricato in pywebview.

## Build / packaging

```bash
./build.sh                # script esistente (PyInstaller)
# oppure
pyinstaller NovaStudio.spec
```

L'eseguibile prodotto è in `dist/NovaStudio/`. I nuovi file
(`css/`, `js/`) sono inclusi perché packagiano l'intera cartella `web_frontend/`.

## Struttura dei nuovi file

```
web_frontend/html/
├── css/modules.css              stile home + moduli (riusa le variabili del tema)
├── js/
│   ├── store.js                 wrapper API (pywebview) + fallback localStorage
│   ├── app.js                   router + home (window.App)
│   └── modules/
│       ├── chatbot.js           lista conversazioni + setup (window.Chatbot)
│       ├── notes.js             Appunti (canvas)
│       ├── schemi.js            Schemi (SVG nodi/archi)
│       ├── produttivita.js      hub + registry window.StudyTools
│       ├── presentazioni.js     sub-tool Presentazioni
│       ├── documenti.js         sub-tool Documenti
│       ├── fogli.js             sub-tool Fogli (parser formule proprio)
│       ├── video.js             sub-tool Video storytelling
│       ├── ripasso.js           Flashcard
│       ├── biblioteca.js        Raccolta elementi
│       └── calendario.js        Calendario studio
backend/study_api.py             mixin StudyAPI (API dei nuovi moduli)
data/schema.sql                  + study_items, subjects, calendar_events
data/db.py                       + migrazione chats.materia/attivita, CRUD nuovi moduli
```

## Contratti per aggiungere un modulo

```js
App.registerModule({
  id: 'mioModulo',            // id usato da App.go() e dalla home
  title: 'Titolo', desc: '...',
  icon: '<svg …>',            // svg inline locale
  kinds: ['note'],            // kind di study_items gestite (per home/Biblioteca)
  open(container, params) { /* params.open = id elemento da aprire */ },
  close() { /* flush salvataggi */ },
  recent() { return 'Ultimo: …'; }   // testo sotto la card in home
});
```

Salvataggio dati: **sempre** via
`StudyStore.saveItem({kind, title, content, materia, tags, description, thumbnail})`
— mai scritture dirette su SQLite dal frontend.

API backend esposte a JS (in `backend/study_api.py`):
`study_list`, `study_get`, `study_save`, `study_delete`, `study_duplicate`,
`study_rename`, `subjects_list/save/delete`, `events_list/save/delete`,
`chat_meta_save`, `materials_list`, `study_pick_asset`.

## Verifiche

```bash
# sintassi backend
python -m py_compile backend/api.py backend/study_api.py data/db.py

# sintassi frontend (richiede Node)
node --check web_frontend/html/js/store.js
node --check web_frontend/html/js/app.js
for f in web_frontend/html/js/modules/*.js; do node --check "$f"; done
```

Non ci sono test automatizzati UI (nessun framework JS nel progetto, di proposito:
nessuna dipendenza nuova).

## Comandi one-liner (Windows PowerShell)

```powershell
Get-ChildItem web_frontend\html\js -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

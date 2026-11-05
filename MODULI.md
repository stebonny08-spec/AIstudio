# MODULI — NovaStudio Suite Studio

Guida ai 7 moduli raggiungibili dalla **home** (schermata iniziale).
Tutto è **100% locale**: nessun cloud, nessuna CDN, nessun font remoto, nessuna API esterna.

> **Aggiornamento round 2** — home senza hamburger + nuovo logo, cartelle in
> Chatbot/Appunti/Schemi (e vista cartelle in Biblioteca), componente materia
> globale in maiuscolo con suggerimenti, nuova conversazione con solo argomento
> e retrieval limitato all'argomento, quaderno a pagine, lazo/gomma/slider in
> Appunti, pannello stile e tipi differenziati negli Schemi, bottoni centrati
> rimossi in Produttività/Ripasso, "Video storytelling" rinominato **Video**,
> materia testuale nel Calendario. Riepilogo completo: **`MODIFICHE.md`**.
> I dettagli sotto descrivono il comportamento di base (comunque valido).

## Architettura di navigazione

```
Home (js/app.js → App)
 ├─ Chatbot      → lista conversazioni → setup → chat ESISTENTE (index.html)
 ├─ Appunti      → note a mano/tastiera      (kind: note)
 ├─ Schemi       → mappe/alberi nodi+archi   (kind: schema, riassunto)
 ├─ Produttività → hub → Presentazioni / Documenti / Fogli / Video
 │                  (kind: presentazione, documento, foglio, video)
 ├─ Ripasso      → mazzi + flashcard         (kind: mazzo)
 ├─ Biblioteca   → raccolta di tutto (study_items + conversazioni + materiali)
 └─ Calendario   → eventi di studio          (tabella calendar_events)
```

- Router: `App.go('home' | 'chat-session' | <id modulo>)`; ogni modulo ha il bottone **⌂ Home**.
- Ogni modulo può tornare alla home e può essere aperto dalla Biblioteca con `App.openItem(kind, id)`.
- Storage: tabella SQLite unica **`study_items`** (un record per elemento, `content` = JSON) +
  `subjects` (materie) + `calendar_events` + colonne `chats.materia/attivita`.

---

## 1. Chatbot (`js/modules/chatbot.js`)
- **Lista conversazioni** come card: titolo, data/ora, materia, attività, anteprima, n. messaggi.
- Bottone **`+` Nuova conversazione** → schermata **setup**: argomento/materia (con datalist delle materie), tipo attività (riassunto · chiarimento · esercizio · spiegazione semplice · interrogazione/ripasso · generale), materiale collegato (apre la modale "Aggiungi materiali" esistente), modello attivo (informativo), opzione "Pensiero profondo", messaggio iniziale facoltativo.
- Il setup mappa l'attività sulle **modalità di studio esistenti** (nessuna modifica ai prompt): riassunto→`riassunto`, chiarimento/spiegazione→`chiarimento`, esercizio→`esercizio`, interrogazione→`ripasso`, generale→nessuna.
- Bottone **Aggiungi materiali** accanto al `+`: riusa la modale materiali esistente (RAG locale).
- La chat vera è **quella già presente** (streaming, stop, "Continua", KaTeX, sidebar): al salvataggio del primo messaggio viene allegata materia/attività via `chat_meta_save`.
- Uscita dalla chat (⌂ Home / logo / voce Home in sidebar): la conversazione resta salvata e ricompare come card.

## 2. Appunti (`js/modules/notes.js`, kind `note`)
- Griglia note con thumbnail, ricerca, filtri materia/tag; rinomina/elimina.
- Nuova nota → tipo foglio (**quadretti · righe · puntini · bianco**) e modalità (**pagina singola** o **foglio infinito**, grande con pan).
- Editor canvas (Pointer Events): **penna** (3 tratti: tonda, matita, pennarello; colori; spessori), **evidenziatore** (colori, alpha basso, tratto largo), **gomma**, **testo** (dimensione/colore/grassetto-corsivo-sottolineato), **selezione/sposta**, **undo/redo** (50 passi), **zoom/pan** + centra.
- **Palm rejection**: se il tratto inizia con la penna, i touch secondari vengono ignorati (`touch-action:none` + pointerType).
- **Migliora scrittura**: semplificazione locale della polilinea (riduce tremolio, nessun OCR).
- Import immagini (dataURL/asset) e file di testo; salvataggio automatico (debounce) + thumbnail JPEG.
- Collegamento materia/tag dalla barra dell'editor.

## 3. Schemi (`js/modules/schemi.js`, kind `schema`)
- Tipi (5): **albero · mappa concettuale · sinistra→destra · schema libero · riassunto visuale**.
- Nodi: aggiungi / figlio / fratello / elimina, drag per spostare, drag bordo per ridimensionare, doppio click per il testo.
- Collegamenti con frecce (strumento "Collega"), scollega, colori sfondo/bordo/archi.
- **Auto-layout** semplice per i tipi ad albero, zoom/pan, **centra vista**.
- Pannello affiancabili: **riassunto** (testo salvato + "Apri nel Chatbot" per la parte AI) e **fonti** (note/riassunti/documenti della Biblioteca in lettura).
- Salvataggio automatico.

## 4. Produttività (`js/modules/produttivita.js` + 4 sub-tool)
Hub con 4 card. Ogni tool ha lista, editor, autosave e torna all'hub.

- **4.1 Presentazioni** (`presentazioni.js`): lista slide (aggiungi/duplica/elimina/riordina), elementi **testo, immagine, video locale, audio locale, forme, frecce**, proprietà testo/colore/allineamento/sfondo slide, selezione + drag + resize, **modalità Presenta fullscreen** (frecce/Esc), export **JSON / HTML / Stampa-PDF**.
- **4.2 Documenti** (`documenti.js`): editor contenteditable (titoli, elenchi, B/I/U, colore testo, immagini locali, tabelle semplici), autosave HTML, export **Markdown / HTML / Stampa-PDF**.
- **4.3 Fogli di calcolo** (`fogli.js`): griglia A–Z × 60, campo formula, **parser proprio** (no eval): SUM, AVERAGE, MIN, MAX, COUNT, IF, CONCAT/TEXT, riferimenti e range, operatori; formattazione via pannello destro collassabile **Formato cella** (grassetto, colore testo, sfondo — gli allineamenti sono rimossi dalla UI, il dato resta applicabile ai fogli esistenti); **fill handle** su angolo selezione per estendere/riempire; popover **"?" Formule** in toolbar; **import/export CSV**.
- **4.4 Video storytelling** (`video.js`): timeline con clip (testo/immagini/video/audio) — etichette corsie dentro lo scroller, corsie 40px, zoom nell’header —, **proprietà clip in barra contestuale sopra la timeline** (pannello destro rimosso, barra visibile solo con clip selezionata), transizioni **fade/slide/cut**, musica di sottofondo con volume, **preview reale** play/pausa/stop, avviso durata > 7 min, salvataggio progetto. *Export video completo rimandato (NOTE.md).*

## 5. Ripasso (`js/modules/ripasso.js`, kind `mazzo`)
- Mazzi (nome, materia, colore, descrizione, tag) con ricerca/filtri.
- Editor flashcard: domanda, risposta, colore, font, immagine; aggiungi/duplica/elimina/ordina.
- **Modalità studio**: rivela risposta, **So / Non so**, precedente/prossima, **mischia**, fine sessione con riepilogo; scorciatoie tastiera (Spazio, 1, 2, frecce).
- Statistiche locali per card e **ripetizione spaziata semplice** (box 0–5).
- "Genera da appunti": estrazione euristica locale + apertura del Chatbot (AI completa rimandata, NOTE.md).

## 6. Biblioteca (`js/modules/biblioteca.js`)
- Raccoglie: **elementi** (note, schemi, riassunti, mazzi, presentazioni, documenti, fogli, video), **conversazioni chatbot**, **materiali caricati**.
- Vista griglia/lista, ricerca, filtri per tipo/materia/tag, ordinamento per data/nome/tipo.
- Apre ogni elemento **nel modulo giusto**; azioni: rinomina, duplica, elimina, tag, materia, descrizione.
- Statistiche in testata: "N elementi · N conversazioni · N materiali".

## 7. Calendario (`js/modules/calendario.js`)
- Vista **mese** (prec/succ/Oggi), oggi evidenziato.
- Eventi: **verifica, compito, studio, ripasso, consegna, promemoria** — colore della **materia** (fallback colore per tipo).
- Aggiungi/modifica/elimina con click su giorno/evento; **ricorrenza** nessuna/settimanale/mensile (espansa in visualizzazione); **collegamento a un materiale** della Biblioteca.
- Gestione materie con colore (legenda + modale "Gestisci materie").

---

## Riferimento storage rapido

| Dato | Dove |
|---|---|
| Note, schemi, riassunti, mazzi, presentazioni, documenti, fogli, video | `study_items` (colonna `content` = JSON) |
| Materie + colore | `subjects` |
| Eventi calendario | `calendar_events` |
| Conversazioni + materia/attività/anteprima | `chats` (+ migrazione colonne) |
| Messaggi chat | `messages` (invariato) |
| Materiali RAG | `indexed_files` + file in `file_AIstudio/` (invariato) |
| Asset importati (immagini/video/audio progetti) | `%APPDATA%\NovaStudio\assets\` |
| Impostazioni | `config.json` (invariato) |

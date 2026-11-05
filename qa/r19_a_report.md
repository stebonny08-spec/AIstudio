# R19 — Blocchi A1 + A2 + A3: Appunti (toolbar, shape recognition, pannello Fonti)

Data: 2026-10-28 · Round 19 · owner finale (delegati A interrotti a metà, completamento diretto)
Ambiente: locale — T1 jsdom (harness `_ink_env`) + T2 Chromium reale (puppeteer, `qa_ui/notes.html`)

## 1. Strategia adottata

- **Owner unico su `notes.js`** (toolbar A1 + shaping A2 + pannello fonti A3 vivono nello stesso file): i due delegati iniziali hanno implementato il codice produttivo ma hanno esaurito i turni prima del QA; il lavoro residuo (test `a19_fonti`, script browser `qaA19_*`, screenshot, report) è stato completato in fase finale con i due owner paralleli (S) già conclusi — nessun conflitto su file condivisi.
- **Baseline > nuove funzionalità**: rimosso solo ciò che la spec A1 dichiara (icone rettangolo/freccia, tasto AI, tasto Migliora F05); mantenuto il toggle "Migliora scrittura" (modalità aiuto, `data-help`), il pulsante dinamico "Elimina selezione" (nascosto senza selezione) e l'API `AI.ui/ink.setShaping` usata dai test — mantenuti tutti e tre.
- **Screenshot PRIMA**: `qa/r19_notes_baseline.js` (copia byte di `notes.js` pre-modifica) servita via request interception nello stesso harness → gli stessi casi/stessi pixel, due build diverse.
- **Riconoscimento forme solo dal tratto libero**: nessuna icona dedicata; `ed.shpOn`/`ed.arrowOn` restano persistiti in `localStorage 'nt14_shaping'` (default ON), senza controllo in toolbar.

## 2. Tabella shaping (stroke → atteso → ottenuto) — T2 reale

Estratto da `qa/r19_a_measures.json` (sezione `shaping`); DOPO = notes.js R19, PRIMA = baseline.

| Caso | Stroke (jitter programmato) | Atteso | PRIMA (baseline) | DOPO (R19) | Screenshot PRIMA → DOPO |
|------|------------------------------|--------|------------------|-----------|--------------------------|
| c_aperta | arco da 280°, r=50, ±2px | **stroke, NO snap** | ✗ shape/ellipse (snap errato) | ✓ stroke | `qa/r19_a_shp_prima_c_aperta.png` → `qa/r19_a_shp_dopo_c_aperta.png` |
| cerchio_chiuso | cerchio 360° chiuso, r=50, ±1.5px | shape/circle | ✓ circle | ✓ circle | `qa/r19_a_shp_prima_cerchio_chiuso.png` → `qa/r19_a_shp_dopo_cerchio_chiuso.png` |
| coloring | lissajous 4:3 (≥3 auto-inters.) | **stroke, NO snap** | ✓ stroke | ✓ stroke | `qa/r19_a_shp_prima_coloring.png` → `qa/r19_a_shp_dopo_coloring.png` |
| rettangolo_impreciso | perimetro 150×90 a passi 4px, ±1px | shape/rectangle | ✓ rectangle | ✓ rectangle | `qa/r19_a_shp_prima_rettangolo_impreciso.png` → `qa/r19_a_shp_dopo_rettangolo_impreciso.png` |
| quadrato | perimetro 96×96 a passi 4px, ±1px | shape/square | ✓ square | ✓ square | `qa/r19_a_shp_prima_quadrato.png` → `qa/r19_a_shp_dopo_quadrato.png` |
| arco_flick | arco 90° + flick a V (~120°, finestra 250ms, bbox ≤80) UNICO stroke | shape/curve **+ arrow=true** | ✗ stroke, freccia assente | ✓ shape/curve + arrow=true, nessun grezzo residuo | `qa/r19_a_shp_prima_arco_flick.png` → `qa/r19_a_shp_dopo_arco_flick.png` |
| curva_tremolante | seno 520px, jitter x±1/y±2.5, help ON 0.6 | stroke + **residuo ≤ 2.5px** | ✓ residuo 1.88px | ✓ **residuo 1.88px** | `qa/r19_a_shp_prima_curva_tremolante.png` → `qa/r19_a_shp_dopo_curva_tremolante.png` |
| undo_2livelli | forma snap → 2× undo | 1° = tratto grezzo, 2° = rimosso | ✓ | ✓ | (verifica geometrica su `objects()`) |

Verdetto: **PRIMA 5/7 · DOPO 8/8**. I due fallimenti PRIMA sono esattamente i bug richiesti dalla spec (C aperta che snap-pava ad ellipse; flick senza freccia ricostruita).

### Tolleranze dichiarate (A2.5)
- Smussamento totalizzante a fine tratto (hold-still `ed.holdMs`=350): resample uniforme 5px + 3 passate Catmull-Rom→Bézier + clamp 2.4px dal tracciato grezzo.
- **Tolleranza residuo A2.5: ≤ 2.5px** dal tracciato ideale (assertato in `a14` 15.1 jsdom e nel browser: 1.88px).
- A2.1 chiusura cerchio/ellisse: `dist(punta,coda) ≤ max(12px, 8% diagonale bbox)` E auto-inters ≤1; auto-inters ≥3 o riempimento denso → mai snap.
- A2.2 rettangolo: chiusura + 4 cluster angoli 90°±20° + lati rettilinei; robusto su perimetro a passi 4px con jitter ±1 (probe: ±1.25+ in alcuni casi cade in stroke/ellipse — vedi "Aperto").

## 3. Toolbar e pannello Fonti — screenshot PRIMA → DOPO

| Cosa | PRIMA (baseline) | DOPO (R19) | Screenshot |
|------|------------------|-----------|------------|
| Toolbar sinistra | 8 bottoni: …, **AI**, **Migliora**, 2 icone shaping | 7 bottoni: undo, redo, immagine, Documento, ppt, fonti, **Flashcard**; 0 icone `[data-shaping]` | `qa/r19_a_toolbar_prima.png` → `qa/r19_a_toolbar_dopo.png` |
| Pannello Fonti | 0 chip; preview materiale con **"Percorso:/Dimensione:/Tipo file:"** e path grezzo `C:/…` | chip **Tutti\|Appunti\|Materiali\|Libri** (persistite `nt_fonti_filter`); preview **md renderizzata** (`<h1>`,`<strong>`,`<li>`), badge tipo, **zero metadati/path**, 340px × 70vh | `qa/r19_a_fonti_prima.png` → `qa/r19_a_fonti_dopo.png` |

Assert T2 UI (`qa/r19_a_measures.json` sezione `ui`): PRIMA `ok=false` (AI=true, chips=[], md_h1=false, path=true); **DOPO `ok=true`**: ordine esatto (title undo a 2 livelli accettato come prefisso), AI/Migliora assenti, Flashcard presente, 1 solo tool attivo, popover aperto+chiuso da click-fuori, chips esatte, md h1/strong/li presenti, metadati assenti, insert fonte → oggetto `t:'text' "Fonte: …"` salvato in `nt1` con JSON valido.

## 4. Tempi misurati

| Fase | Tempo |
|------|-------|
| `node qa_browser/qaA19_shaping.js` (2 modalità × 8 casi + undo + 16 screenshot) | **36.1 s** |
| `node qa_browser/qaA19_ui.js` (2 modalità × toolbar/fonti + 4 screenshot) | **10.5 s** |
| Suite T1 Appunti (dopo): a14 39/0, l14 10/0, qaA 92/0, a19 41/0 | ~40 s complessive |

## 5. Suite eseguite (pass/fail)

| Suite | Baseline | Esito |
|-------|----------|-------|
| node tests/a14_shaping.test.js | 29/0 (era 33/6 a metà lavoro) | **39/0** |
| node tests/l14_appunti.test.js | 10/0 | **10/0** |
| node tests/qaA_appunti.js | 92/0 | **92/0** |
| node tests/a19_fonti.test.js (NUOVO) | — | **41/0** |
| node qa_browser/qaA19_shaping.js | — | DOPO 8/8 (exit 0) |
| node qa_browser/qaA19_ui.js | — | DOPO ok=true (exit 0) |

`node --check` OK su: notes.js, a19_fonti.test.js, qaA19_shaping.js, qaA19_ui.js, _r19_extract.js, _r19_rectprobe.js, _r19_sqprobe.js.

## 6. Decisioni

1. **btnDelSel mantenuto** (nascosto, dinamico): la spec elenca la composizione "finale" dei bottoni sempre visibili; eliminare "Elimina selezione" avrebbe regresso la baseline senza win funzionale (Del funziona comunque).
2. **F05 "Migliora" rimosso dalla toolbar**; la funzione `aiSelectionAction('F05')` resta nel codice ma non è più raggiungibile dall'UI (dead code reversibile, nessuna call-site rimasta).
3. **A2.2 rect/square**: snap robusto su perimetro a passi 4px con jitter ±1 (parametri a14); lo stesso generator usato nel browser T2 per rendere il test deterministico.
4. **Flick = UNICO stroke** con timing differenziato (arco 10ms/punto, flick 40ms/punto): la finestra temporale di 250ms di `detectFlick` deve cadere tutta sul flick — due stroke separati non sono un flick (lezione dal primo run).
5. I probe `tests/_r19_rectprobe.js` / `_r19_sqprobe.js` (underscore → esclusi da run_t1) documentano la mappa tolleranze.

## 7. Aperto / BLOCKED

- **Nessun BLOCKED** (ben dentro i 6 tentativi per problema).
- Rilevato in misura (non bloccante): a 90×60 con realizationi particolari il perimetro rettangolare può essere classificato `ellipse` prima che `rectangle` (ordine di tentativi in `recognizeStroke`); i casi standard della spec (150×90 e 96×96, ±1px) sono stabili. Vedi anche NOTE.md "aperto".
- Screenshot "prima" delle icone shaping nella pill destra: il ritaglio cattura la pill sinistra (dove A1 ha agito); le icone shaping erano nella pill destra — la loro assenza è verificata da assert DOM (`[data-shaping]`=0) in `r19_a_measures.json`.

# R22 — FE-FONTI — Report T2 (browser reale)

**Cellula:** SEGUITO 2, round 22, scope FE-FONTI.
**Metodo:** `node qa_browser/qaR22_fonti.js` → `qa/r22_fonti_measures.json` — montatura reale
`qa_ui/documenti.html` (+ `qa_ui/presentazioni.html` secondo mount), fixture note iniettate nello
store, KaTeX vendored iniettato. **PRIMA** = interception `qa/r22_fonti_baseline.js` (codice
pre-R22), **DOPO** = `web_frontend/html/js/modules/fonti_panel.js` corrente. Tutto locale, headless
Chrome (puppeteer).

**RISULTATO: 36/36 check ok, `all_ok: true`, `checks_failed: 0`.** (Prima dei fix: 28/36, 8 falliti.)

---

## 1.1 Dock sotto la toolbar (z-index sotto i controlli)

| | PRIMA (baseline) | DOPO |
|---|---|---|
| `.doc-bar` trovata | sì | sì |
| `.mod-header` trovata | sì | sì |
| overlap pannello vs toolbar | 0 px² | 0 px² |
| hit-test bottoni toolbar/pill (elementFromPoint) | 24/24 ok | 24/24 ok |
| posizione pannello | fixed, top 58 | fixed, **top 64 ≥ tbBottom 56 + 6** |
| z-index pannello | **160** (sopra i controlli: problema R21) | **documenti 20** (doc-bar 40/pill 30), **presentazioni 5** (sotto mod-header 6 → coerente con spec: z sotto i controlli) |
| `.fp21-chev` (codice R22) | assente (interception attiva ✓) | presente |

- `fitDock` allinea il pannello sotto il bordo inferiore MAGGIORE tra `.doc-bar` e `.mod-header`
  (+8px): top 64 = 56 + 8 ✓. Secondo mount flottante `presentazioni` (`.pp-bar`, z=5): overlap 0,
  hit-test 15/15 ok ✓.
- La harness `qa_ui/documenti.html` non montava `.mod-header` (l'app reale lo crea via
  `App.header()` in `app.js`): aggiunto `.mod-header` **assoluto** in cima (nessun impatto sul
  layout della harness, dietro `.doc-bar` z40, `pointer-events:none`), fedele all'elemento reale.
- Fix T2: l'hit-test ora interroga i SOLI `button` delle toolbar (i contenitori `.doc-bar`/
  `.mod-header` non sono comandi).

## 1.2 Collapso riga superiore — px REALI guadagnati

- **`fp21_list` 399px → 423px = +24px REALI** al click su `.fp21-chev` (larghezza default 340px,
  4 chips su una riga: riga chips 18px + gap 6px), classe `fp21-collapsed` + persistenza
  `fp21_top_documenti=1` ✓.
- Chiusura/riapertura pannello: collassata ripristinata da localStorage ✓.
- **Reload**: `fp21_top_documenti=1` mantenuto, altezza lista **invariata 423 ~ 423 (Δ0px)** ✓
  (confronto appaiato: stessa preview selezionata prima e dopo il reload).
- **Fix codice (bug reale):** i chips stavano DENTRO `.fp21-bar` (stessa riga di lente+chevron):
  nasconderli non cambiava l'altezza della bar → la lista guadagnava **0px** (b2 falliva; 443 vs 354
  era falsato anche dall'altezza variabile del preview). Ora i chips sono in una **riga propria**
  fratella della bar dentro `.fp21-top` (chips+ricerca nascosti in collassata → la `.fp21-list`,
  `flex:1`, guadagna tutta l'altezza della riga), più `margin-left:auto` sul chevron (lente a
  sinistra, chevron a destra). Indipendente dalla larghezza del pannello.
- Struttura aggiornata nel test jsdom `f22_fonti_collapse` (C3/C3b).

## 1.3 Resize + doppio click reset

- Drag su `.fp21-rz-r`: 340 → **460px**, persistito in `fp21_w_documenti=460` ✓.
- **Doppio click: reset al default 340px, `fp21_w_documenti`/`fp21_h_documenti` RIMOSSI**
  (`ls_after_reset: null`) ✓.
- **Fix codice (bug reale):** `reset()` non aggiornava `w0/h0` → il `mouseup` di un drag ancora
  aperto riscriveva subito la vecchia dimensione; inoltre il 2° `mousedown` (`detail>=2`) sull'handle
  avviava un nuovo drag prima del reset. Ora: `reset()` riallinea `w0/h0` ai default e il 2°
  mousedown (`detail>=2`) resetta subito senza avvia drag (l'evento `dblclick` resta per i browser
  standard — reset idempotente; serve anche dove l'automazione CDP non genera `dblclick`).
- Fix T2: la simulazione del doppio click usa la sequenza CDP esplicita (down/up + down/up con
  `clickCount:2`); `mouse.click({clickCount:2})` su questo Chrome non produceva né `dblclick` né
  `mousedown detail=2`.

## 2.1 Snapshot nota mista

- `<img class="fp21-snap" src="data:image/png;base64,…">` presente, **PRIMA del testo**
  (iSnap=12 < iText=4976), nessun "Nessun testo disponibile" ✓ — screenshot
  `qa/r22_fonti_dopo_snapshot.png`.
- **Fix T2 (falso positivo):** `pick()` passava un **RegExp a `page.evaluate`**: la serializzazione
  lo perdeva, in pagina `new RegExp(undefined)` combaciava con TUTTO → veniva cliccato sempre il
  PRIMO item (il `Documento` della harness, html `<p>Seleziona questo testo</p>`) — per questo la
  snapshot "non appariva" nel browser pur funzionando in jsdom. `pick` ora passa una **stringa**.
  Il codice preview non serviva modifiche (canvas/`toDataURL` ok in browser, verificato).

## 2.2 Nota vuota

- `objects: []` vero → preview **CON** `<p>Nessun testo disponibile.</p>` ✓ (messaggio emesso SOLO
  se nessun tratto, testo o immagine — invariato). Stesso fix T2 del 2.1 (click sulla nota giusta).

## 2.3 Nota solo-tratto + ordine blocchi

- Solo tratti: snapshot presente, **SENZA** "Nessun testo disponibile" ✓. Mista: blocchi
  testo/immagine nell'ordine degli oggetti, snapshot in cima ✓ (assert `f22_fonti_preview` A6).

## 5.2 Math inline

- Fixture `$x^2$`, `\(y_i+\Delta t\)`, `$$\sum$$`, `\[\int\]`: **4 nodi `.katex` renderizzati,
  0 fallback, 0 nodi testo con `\Delta`/`\text`/`$$`/delimitatori fuori da `.katex`** ✓
  (screenshot `qa/r22_fonti_dopo_math.png`; KaTeX vendored iniettato dal T2).

---

## Chiavi localStorage (contesto `documenti`; per-contesto `<ctx>` = appunti/documenti/…)

| chiave | ruolo | stato dopo fix |
|---|---|---|
| `fp21_w_<ctx>` | larghezza pannello | scritta dal drag (460), **rimossa dal reset dblclick** ✓ |
| `fp21_h_<ctx>` | altezza pannello | idem, rimossa dal reset ✓ |
| `fp21_top_<ctx>` | collapso riga superiore | `1`/`0`, persistita su toggle + reload ✓ |
| `fp21_search_<ctx>` | ricerca aperta | invariata (`0` di default) ✓ |
| `fp21_filter` | chip filtro attivo | invariata ✓ |

## Screenshot (in `qa/`)

`r22_fonti_prima_documenti.png` (baseline pre-R22), `r22_fonti_dopo_documenti.png`,
`r22_fonti_dopo_snapshot.png`, `r22_fonti_dopo_math.png`, `r22_fonti_dopo_collapse.png`,
`r22_fonti_dopo_presentazioni.png` — tutti rigenerati dall'ultima esecuzione verde.

## Test eseguiti (tutti verdi)

- T2 browser: `node qa_browser/qaR22_fonti.js` → **36/36, all_ok=true** (PRIMA resta evidenza
  non-gate: z160, senza chevron).
- jsdom: `f22_fonti_preview` 22/22, `f22_fonti_collapse` 25/25 (C3 aggiornato + nuovo C3b),
  `f22_fonti_dock` 27/27, `f22_fonti_math` 11/11, `f22_fonti_resize` 14/14,
  `f21_fonti_panel` 48/48, `a19_fonti` 46/46, `qaC2_viewer` 46/46 → **239 assert, 0 falliti**.
- `node --check`: `fonti_panel.js`, `qaR22_fonti.js`, `f22_fonti_collapse.test.js` → ok.

## File toccati

- `web_frontend/html/js/modules/fonti_panel.js` (chips in riga propria; chev margin-left:auto;
  `reset()` allinea w0/h0; mousedown `detail>=2` = reset senza drag).
- `qa_ui/documenti.html` (aggiunto `.mod-header` fedele all'app reale, assoluto/pointer-events:none).
- `qa_browser/qaR22_fonti.js` (pick a stringa + helper condiviso; sequenza CDP dblclick;
  hit-test sui soli button; preview appaiata b2/b7 con pick `Documento` prima e dopo il reload).
- `tests/f22_fonti_collapse.test.js` (C3 → bar=lente+chev, chips in riga propria; nuovo C3b).
- Rigenerati: `qa/r22_fonti_measures.json`, `qa/r22_fonti_*.png` (6).

## Cosa resta aperto

- Nessun check T2 aperto (36/36). Non è stata lanciata la T1 completa (baseline 2942 invariata:
  nessun file T1/core/backend toccato; i 8 test sfiorati sono tutti verdi).
- `qa_ui/presentazioni.html` non ha `.mod-header` (a10 richiede solo `.pp-bar`) — opzionale
  allinearlo per coerenza.
- Il dblclick "puro" via CDP resta inaffidabile su Chrome 155 headless (`mouse.click({clickCount:2})`
  non incrementa il detail): il codice copre il caso grazie a `mousedown detail>=2`, il T2 usa la
  sequenza down/up + down/up(clickCount:2).

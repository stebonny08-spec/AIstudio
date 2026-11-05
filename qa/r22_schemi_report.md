# R22 — FE-SCHEMI: BLOCCO 5.1 / 5.3 (mount FontiPanel nella tab Fonti, nessun overlay flottante) + 5.2 (assert math)

- **Round**: 22 — scope FE-SCHEMI (owner unico: `web_frontend/html/js/modules/schemi.js`, `tests/s22_*`, `qa_browser/qaR22_schemi*`)
- **Baseline T1**: 2942 pass / 0 fail (T1 completa NON lanciata, come da istruzioni)
- **Data**: 2026-10-30 — tutto locale, nessun backend

---

## 1. Sintesi

| Blocco | Esito | Modifiche |
|---|---|---|
| **5.1** mount-in-tab / nessun overlay flottante | **CORRETTO con intervento** (2 soli hunk, solo aggiunte) | `schemi.js`: blocco CSS scoped `.sc-side .fp21-root` + normalizzazione width embedded in `mountFontiPanel` |
| **5.2** assert math preview `$...$` e `\(...\)` | **Assert SCRITTI; stato: 1 PASS / 2 FAIL** — fix `\(...\)` non ancora arrivato in `fonti_panel.js` (altro delegato) | nessuna modifica (divieto) — da rilanciare dopo il fix |
| **5.3** altri mount / contesti | **CONFORME in lettura, zero modifiche** | nessuna |

Diff vs `qa/r22_schemi_baseline.js`: **+68 righe aggiunte, 0 rimosse** (2876 → 2944 righe), 2 soli hunk (blocco `App.style` R22 + 3 righe in `mountFontiPanel`). Nessun file vietato toccato. `fonti_panel.js` intatto.

---

## 2. BLOCCO 5.1 — verifica e intervento

### 2.1 Evidenza pre-esistente (il mount era già solo in tab — grep su schemi.js)

```
2260: function refreshFontiPanel()          (chiamato da showTab 2226/2241)
2268: function mountFontiPanel(host)
2273:     fp = window.FontiPanel.create({ contesto: 'schemi', onInsert: onFontiInsert });  ← UNICO create
2408: const tabF = btn('sc-tab', 'Fonti', () => showTab('fonti'));
2490: const bodyF = App.el('div', 'sc-body');  bodyF.style.display = 'none';
2492: mountFontiPanel(bodyF);                 ← UNICA chiamata, dentro buildSide (.sc-side)
2826-2831: teardownEditor -> fontiPanel.destroy()
```

- `FontiPanel.create(` in schemi.js: **1 occorrenza**; `mountFontiPanel(`: **1 definizione + 1 chiamata** (nessun doppio mount).
- Vecchio tab fonti rimosso da R21: `loadSources/loadPreview/previewMatFile/.sc-preview` compaiono **solo in commenti** (righe 2250-2251).
- `position:fixed/absolute` letterali in schemi.js sono tutti **non-fonti**: `.sc-stage textarea` (editor nodo), `.sc-zoom`, `.sc-toast`, `.modal-overlay` (dialogo generico), `.sc-overlay` SVG (copia testi nodi sugli archi — B1a, pre-esistente). **Zero regole CSS fp21 non scoped.**

### 2.2 Però il residuo REALE c'era: cascade globale di index.html

In `index.html` vengono caricati **tutti** i moduli, che iniettano CSS **globale** su `.fp21-root` (specificità 0,1,0, stesso selettore per tutti i contesti):

- `notes.js:146` → `position:absolute; left:12px; top:152px; display:none` (+ `.show`)
- `presentazioni.js:2353` e `documenti.js:2387` → **`position:fixed; top:58px; right:14px; z-index:160`** (caricati DOPO schemi)

Quindi nell'app reale il pannello montato dentro `.sc-side` degli Schemi veniva **riagganciato in fixed sopra il canvas**. Dimostrato misurando in T2 con la cascade copiata identica (`SIM_CSS`) sul PRIMA (baseline):

| Stato (viewport 1440×950) | position | rect pannello | overlap col canvas (.sc-stage) |
|---|---|---|---|
| **PRIMA** (baseline pre-R22) + harness nudo | `static` | x 1136→**1476** (larghezza 340 inline, fuori dal bordo destro della side 1424 e dal viewport) | 0 (ma overflow tagliato) |
| **PRIMA** + SIM_CSS (cascade index.html) | **`fixed`** | **x 12→352, y 58→628** (notes `left:12` vince su `right:14` di documenti) | **154.560 px² — overlay flottante sul canvas** |
| **DOPO** (schemi.js corrente) + harness nudo | `relative` | x 1136→**1412** (w 276, dentro side 1124→1424) | **0** |
| **DOPO** + SIM_CSS | `relative` | x 1136→1412, y 230→800 (dentro side y 168→942) | **0** |

→ Senza intervento la verifica 5.1 NON reggeva sull'app reale; l'intervento è quindi **dimostrato necessario**, non "inventato".

### 2.3 Modifiche apportate (solo `schemi.js`)

1. **Nuovo blocco `App.style` R22** (dopo lo style principale, riga ~94): tutte le regole sono **scoped** `.sc-side .fp21-root…` (specificità 0,2,0/0,3,0 → battono notes 0,1,0 e documenti/presentazioni 0,1,0/0,2,0 **indipendentemente dall'ordine di caricamento**):
   - root: `position:relative; left/top/right/bottom:auto; z-index:auto; display:flex; width:100%; max-height:100%; overflow:hidden` + shell R21 (background/border/padding/font identici a documenti.js) → dentro il tab il pannello è **in flusso** e mai fixed/absolute;
   - innards (bar/lens/chips/search/list/item/badge/preview/ptitle/pbody/mathfb/insert/rz…) copiati scoped dalla shell del componente condiviso: servono anche a `qa_ui/schemi.html`, che caricando **solo** `fonti_panel.js + schemi.js` non riceveva **alcuno** stile fp21 (pannello non stilato).
   - Regola non scoped `.fp21-root{` in schemi.js: **0** (assert nel test s22).
2. **`mountFontiPanel`**: dopo `host.appendChild(fp.el)` → `fp.el.style.width = ''`. Il componente (congelato, pensato per il float) scrive width inline 340px che qui sfonderebbe la colonna (contenuto side = 276px): azzerata, vince `width:100%` della regola scoped. L'utente può comunque ridimensionare (la width inline scritta dal drag torna a valere, vedi §6).

Nessuna sovrascrittura `!important`: preserva il resize persistito `fp21_w_schemi` del componente (probe R21 §6: w0 276 → drag → w1 396 → reset ok).

### 2.4 Verifiche T2 (DOPO) — tutte OK

- `roots === 1` con `data-fp21="schemi"`; `inSide=true`; `position=relative` sia harness sia con SIM_CSS;
- `panel.x (1136) >= side.x (1124)`; pannello interamente dentro la side anche in verticale (top 230≥168, bottom 800≤942, right 1412≤1424);
- **overlap col canvas = 0 px²** in entrambi gli stati;
- bottone **"Inserisci nello schema"** (FIELDS.schemi) presente e con label esatta;
- zero pageerror; `evidence_prima_floating=true` (il PRIMA con SIM_CSS risulta `fixed`).

---

## 3. BLOCCO 5.2 — assert math nella preview fonti (STATO: IN ATTESA FIX)

Fixture seedata: `# Fonte R22\n\nMatematica inline $x^2 + \Delta t$ e parentesi \(y_i + \text{OK}\).` (heading per attivare l'adattatore md → `renderMarkdown21`), KaTeX vendored iniettato (jsdom + browser), voce selezionata nella lista del tab Fonti.

| Assert | T1 `s22_fonti_mount` (jsdom) | T2 `qaR22_schemi` (browser) | Stato |
|---|---|---|---|
| `$...$` renderizzata (.katex o fallback) + nessun `$`/`$$` residuo | **PASS** (katex=1) | **PASS** (katex=1) | OK |
| `\(...\)` renderizzata (nessun `\(` grezzo visibile) | **FAIL** | **FAIL** | **Fix non arrivato** |
| Nessun nodo testo visibile con `\Delta` / `\text` / `$$` | **FAIL** (sample: `" e parentesi \(y_i + \text{OK}\)."`) | **FAIL** | **Fix non arrivato** |

- Le assert sono **scritte duramente** come richiesto: in `tests/s22_fonti_mount.test.js` fanno uscire il test con exit 1 (2 fail su 55); in `qa_browser/qaR22_schemi.js` vengono calcolate e riportate in `measures.json` (non guidano l'exit, che resta di layout).
- Causa (solo lettura): `fonti_panel.js` righe 79-82 gestiscono **solo** `$$…$$` e `$…$`; **nessun pattern per `\(...\)`** → il testo esce grezzo. I nodi `.katex` vengono correttamente esclusi dal conteggio token grezzi (l'annotation LaTeX di KaTeX contiene `\Delta` ma non è testo renderizzato).
- **Da rilanciare alla fine** quando l'altro delegato apliccherà il fix in `fonti_panel.js`: `node tests/s22_fonti_mount.test.js` e `node qa_browser/qaR22_schemi.js`.

---

## 4. BLOCCO 5.3 — verifica in lettura (zero modifiche ad altri moduli)

Grep su `web_frontend/html/js/modules/*.js`:

| File | create con contesto | monta 'schemi'? | overlay fixed specifico per gli Schemi? |
|---|---|---|---|
| documenti.js | `'documenti'` (577) | NO | NO |
| fogli.js | `'fogli'` (2501) | NO | NO |
| notes.js | `'appunti'` (4806) | NO | NO |
| presentazioni.js | `'presentazioni'` (2119) | NO | NO |
| ripasso.js | `'ripasso'` (226) | NO | NO |
| video.js | `'video'` (911) | NO | NO |
| **schemi.js** | **`'schemi'` (2273) — unico** | — | NO (solo regole scoped `.sc-side`) |

- In schemi.js esiste **un solo** mount (grep §2.1): nessun secondo mount flottante.
- Nessun altro modulo monta FontiPanel con `contesto: 'schemi'` e nessuno contiene overlay fixed mirati agli Schemi (assert `5.3 …` nel test s22: **20/20 PASS**).
- `.sc-side` in `notes.js` compare **solo in un commento** (4765): le mie regole scoped non possono estendersi ad altri pannelli.
- Nessuna modifica a: `fonti_panel.js`, `notes.js`, `documenti/fogli/video/ripasso/presentazioni`, `index.html`, backend, core, data, `run_t1.py`, NOTE.md, MODIFICHE.md.

---

## 5. Test eseguiti

| Comando | Esito |
|---|---|
| `node tests/qaB_schemi.js` | **125 pass / 0 fail** |
| `node tests/s14_schemi_routing.test.js` | **14 pass / 0 fail** |
| `node tests/s19_routing.test.js` | **265 pass / 0 fail** |
| `node tests/schemaStrategies.test.js` | **198 pass / 0 fail** |
| `node tests/schJourney.js` | **54 pass / 0 fail** |
| **`node tests/s22_fonti_mount.test.js` (NUOVO)** | **53 pass / 2 fail** ← i 2 fail sono gli assert 5.2 in attesa del fix (§3) |
| **`node qa_browser/qaR22_schemi.js` (NUOVO T2)** | **layout: 9/9 check PASS, verdict OK**; math 5.2: FAIL (in attesa fix); 4 screenshot + measures.json |
| **`node qa_browser/qaR22_schemi_probe.js` (NUOVO)** | resize cella schemi R21 compat: `w0=276 → w1=396, persisted="396", resetOk=true` → **OK** |
| Extra (tutti i rimanenti T1 che caricano schemi.js, per proteggere la baseline 2942): editorWiring 49/0, qaD_home 41/0, qaC2_viewer 46/0, implBlock12 74/0, qa1_block1 65/0, qa2_block2 79/0, qa3_block3 51/0, uiHarness 197/0, qa4_matrix 92/0, qa4_relayout 205/0 | **tutti 0 fail** |
| `node --check` su: schemi.js, tests/s22_fonti_mount.test.js, qa_browser/qaR22_schemi.js, qa_browser/qaR22_schemi_probe.js | **OK** |

Impatto T1 atteso al prossimo giro: `s22_fonti_mount` entra nel glob di `run_t1.py` (prefisso `s22_`, non escluso) → **2942 + 53 = 2995 pass / 2 fail** finché non arriva il fix `\(...\)` in `fonti_panel.js`; a fix avvenito: 2997/0.

---

## 6. Note / effetti collaterali controllati

- **Resize R21** (`qaR21_matrix` cella schemi): non rilanciato per non sovrascrivere gli artefatti `qa/r21_*`; replicato invece 1:1 con la sonda dedicata `qaR22_schemi_probe.js` → **passa** (vedi §5). Motivo: la clear della width inline a mount fa sì che il drag scriva di nuovo width px (396) e il check `w1 !== w0` regga.
- **Edge noto (minore)**: dopo un drag/reset width fatto dall'utente, la width inline del componente (340px default) riguadagna la precedenza su `width:100%` fino alla riapertura editor (che riazzera); il pannello in quel caso viene tagliato a destra dal `overflow:hidden` della `.sc-side`, **mai** sopra il canvas (x resta ≥ x side). Nessun impatto sui check R21/R22 (verificato). Usare `!important` qui romperebbe il resize R21, quindi lasciato così.
- La shell scoped duplica (non reimplementa) gli stili del componente condiviso, come richiesto "stessa struttura/stile": valori identici a `documenti.js` R21 B3 (stessa shell che nell'app reale risulta effettiva per tutti i contesti).

---

## 7. Artefatti prodotti

| File | Contenuto |
|---|---|
| `qa/r22_schemi_report.md` | questo report |
| `qa/r22_schemi_measures.json` | rect/position/overlap PRIMA+DOPO (harness e SIM_CSS), checks layout, stato math 5.2 |
| `qa/r22_schemi_prima_harness.png` | PRIMA: baseline pre-R22, harness nudo — pannello 340px tagliato fuori dalla side |
| `qa/r22_schemi_prima.png` | PRIMA: baseline + cascade index.html simulata — **overlay fixed sul canvas (154.560 px²)** |
| `qa/r22_schemi_dopo_harness.png` | DOPO: harness nudo — pannello in flusso, 276px, dentro la side |
| `qa/r22_schemi_dopo.png` | DOPO: + cascade simulata — **resta `relative` nella tab, overlap 0** |
| `tests/s22_fonti_mount.test.js` | T1 nuovo: mount-in-tab, zero overlay, teardown, insert→onFontiInsert, assert 5.2, grep 5.3 |
| `qa_browser/qaR22_schemi.js` | T2 nuovo: PRIMA/DOPO con interception baseline + SIM_CSS, rect, label, math, measures |
| `qa_browser/qaR22_schemi_probe.js` | sonda compat resize R21 (nessun artefatto r21 scritto) |

---

## 8. Cosa resta aperto

1. **5.2 (aperto, non mio)**: fix matematica `\(...\)` in `fonti_panel.js` (proprietà altro delegato). Le 2 assert FAIL in `tests/s22_fonti_mount.test.js` e lo status `math52.status` in `measures.json` sono il segnale: **rilanciare `node tests/s22_fonti_mount.test.js` e `node qa_browser/qaR22_schemi.js` alla fine**.
2. **Edge width post-drag/reset dell'utente** (§6): cosciente, documentato, nessun impatto su test.
3. T1 completa non lanciata (come da istruzioni): al prossimo giro completo attesi **2995 pass / 2 fail** (i 2 = point 1), **2997 / 0** dopo il fix.

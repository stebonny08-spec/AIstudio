# R30 (PROMPT ROUND 28) — PREVIEW FONTI RESPONSIVA: ogni adattatore si adatta a pannello, collasso e finestra

**STRATEGIA dichiarata**: *"FE-RESP-first: layout flex del contenitore preview + rigenerazione
adattiva basata su ResizeObserver del solo area-contenuto (con watcher DPR e resize finestra),
evidenze T2 solo su app reale (resize reali di finestra/pannello/DPR, screenshot stesso viewport,
misure DOM reali clientWidth/scrollWidth)"*. Owner unico **FE-FONTI** (`fonti_panel.js` +
adattatori + il css iniettato dal componente), **QA-REAL** per le evidenze. Motivazione: il
difetto è fisico del rendering (bitmap a **dimensione naturale fissa ~416×256** generata dal
vecchio fit `INK_W=300/INK_H=210` con cap 8×, dentro un'area ~1250×600) e vive interamente
negli adattatori/css del componente; la verifica richiede resize REALI (finestra, pannello,
devicePixelRatio) → solo pagina reale servita con la stessa catena `?v=` (puppeteer/CDP =
Chrome reale, playwright non nel progetto), harness jsdom = T1 (non chiude).

**Chiusura T2: `qa/r30_results.json` = 31/31 check OK** (ripetuto sul codice finale);
regressioni R27 riusciti sullo stesso codice: **45/45**. Report + misure: `qa/r30_measures.json`.

---

## 1. Root cause del difetto (immagine di riferimento)

`renderInk21` costruiva il canvas con un fit **mondo** limitato a `INK_W=300 × INK_H=210`
(cap scala 8×): per una nota con bbox piccolo (1600×1100 world → scala 8) il bitmap risultava
**416×256 px a dimensione naturale**, inserito nel DOM senza width/height CSS → dentro
un'area preview di ~1250×600 appariva **piccolo in alto a sinistra con spazio vuoto attorno**.
Nessun ResizeObserver: drag pannello, collasso e resize finestra non rigeneravano nulla.

Fix (tutto in `fonti_panel.js`):
- `renderInk21(objs, key, box)`: con **box = {w,h,dpr}** (area contenuto reale) il canvas viene
  rigenerato a **`canvas.width = round(boxW × devicePixelRatio)`** con il disegno fit "contain"
  centrato (`offX`); attributi `data-cw/data-ch/data-dpr` sull'`<img>` per le misure.
  Senza box (jsdom/T1) resta il vecchio comportamento e la vecchia chiave di cache (compat).
- `previewBox()` misura il **content-box** di `.fp21-pbody` (clientWidth/Height − padding) + DPR.
- **ResizeObserver** su `.fp21-pb` con **debounce 80 ms** condiviso (`scheduleRelayout`) da:
  RO + watcher `matchMedia('resolution: Ndppx')` (cambio DPR senza resize) + **resize finestra**
  (`onWinResize` → `fitDock + scheduleRelayout`) → `relayoutPreview()` riesegue l'adattatore
  attivo della selezione corrente (guardia `selSeq` contro corsa selezione/relayout).
- Struttura L1.1: `.fp21-preview.fp21-pv` = colonna (titolo fisso) + `.fp21-pbody.fp21-pb` =
  `flex:1; overflow:auto` con specificità (0,3,0) che vince sugli host (es. documenti
  `max-height:38vh; overflow:auto`); bottone "Inserisci" resta fuori (RIGA 5, già separato).
- Wrapper unico **`.fp21-aroot`** (`width:100%`) attorno all'html di ogni adattatore →
  "root dell'adattatore" uniforme al100% per tutti i tipi (L2.4).
- Contatore **`window.FP21_RO.active`** (1 per istanza con RO) per il test anti-leak.

## 2. Audit px — rimozione hardcoded (L1.3)

Grep `(width|height|max-width|max-height): Npx` su `fonti_panel.js` **prima → dopo**:

| Riga/selector | Prima (px fissi) | Dopo (%, flex, min-max) |
|---|---|---|
| `img.fp21-snap` (snapshot) | nessun width → **naturale ~416×256 fissa** | `width:100%;height:auto;max-height:100%;object-fit:contain;object-position:center` (L2.1) + canvas rigenerato box×DPR |
| `.fp21-gridwrap` | `max-height:320px` | `width:100%; max-height:100%` (scroll interno per colonne, sticky header) |
| `td/th` griglia | `max-width:180px` | `max-width:28ch` (unità tipografica) |
| `iframe.fp21-doc` | `height:440px` | `aspect-ratio:1/1.35; width:100%` |
| `.fp21-media` | `max-height:340px` | `max-height:100%` (min-max) |
| `.fp21-pdftext` | `max-height:220px` | `max-height:50vh` (viewport, non px) |
| `.fp21-svgwrap svg` | `max-height:260px` | `max-height:80vh` |
| `.fp21-clip img` | `width:54px;height:32px` | `width:16%;max-width:20%;aspect-ratio:16/9` |
| codice `INK_W/INK_H` | 300×210 = unica sorgente | **solo fallback** compat (jsdom/T1): il percorso reale usa il box del contenitore |

Grep finale: restano **solo 2 px, dichiarati fuori scope L1.3** (non sono contenuto preview):
`.fp21-chev width/height:26px` (bottone UI della barra) e `.fp21-root min-height:300px`
(altezza minima del **pannello**, non della preview). Padding/margin px non sono larghezze/altezze
di contenuto → non rientrano nella regola. **Zero px in css degli adattatori/preview.**

## 3. L2 — adattatori responsivi

| Req | Implementazione | Verifica |
|---|---|---|
| L2.1 snapshot | `width:100%; height:auto; max-height:100%; object-fit:contain; margin:6px auto` + canvas a boxW×DPR con centratura | L3.1 (tab. sotto) |
| L2.2 fogli | tabella `width:100%` dentro `.fp21-gridwrap{overflow:auto;max-height:100%}`, `th` sticky, celle ellissi (`28ch`) | L3.4 fogli + L3.2 fogli @1600 |
| L2.3 md+math | testo reflow naturale; `.fp21-math{max-width:100%;overflow-x:auto}` (scroll interno); `.fp21-pre` scroll; `overflow-wrap:anywhere` su p/li/td; fallback mono `pre-wrap` | L3.2 md + Z2 (nessun sforo) + B8 (R27 45/45) |
| L2.4 documenti/presentazioni/video/chat/libri | wrapper `.fp21-aroot width:100%`; `>* {max-width:100%}`; meta video griglia con wrap; nessun px figlio | L3.4 (7 tipi) |
| L2.5 collasso | RO scatta su ogni cambio di size della preview → relayout; tornando espanso stesso flusso (niente salti) | L3.1 collasso/espanso + R27 Q2 |

## 4. L3 — QA su app reale (pagina servita con catena `?v=`, seed reale, mock pywebview fedele)

### L3.1 snapshot adattiva — viewport 1440×900, stessa nota reale "Nota del 30/10/2026"

| Combinazione (drag/toggle REALE) | Area contenuto (box) | `<img>` client | canvas `data-cw×data-ch` | DPR | object-fit | Esito |
|---|---|---|---|---|---|---|
| pannello 280px | 244×178 | **244×172** (Δ0 su W) | 244×171 | 1/1 | contain | ✅ |
| pannello 340px | 304×190 | **304×191** | 304×190 | 1/1 | contain | ✅ |
| pannello 560px | 524×213 | **524×214** | 524×213 | 1/1 | contain | ✅ |
| **collassato** (tutta altezza) | 524×616 | **524×362** (height-limited, contain+centrata) | 524×361 | 1/1 | contain | ✅ |
| **espanso** (2° chevron) | 524×213 | **524×214** | 524×213 | 1/1 | contain | ✅ |
| **DPR=2** (setViewport dsf2 + resize reale finestra 1440→1439→1440) | 524×213 | 524×214 | **1048×426 = 524×2** | **2/2** | contain | ✅ |

- `img clientWidth == boxW ±2px` in **tutte** le combinazioni (Δ0–1px);
- `canvas ≥ round(boxW×DPR)` in tutte (DPR2: esatto 1048);
- screenshot: `r30_l31_{baseline,w280,w340,w560,collapse,expand,dpr2}.png` (stesso viewport).

### L3.2 resize finestra (3 size reali)

| Finestra | boxW | root adattatore | scrollWidth/clientWidth (pbody) | Esito |
|---|---|---|---|---|
| 1280×900 | 524 | **524 (100% ≥95%)** | 524/524 (nessun sforo) | ✅ |
| 1600×900 | 524 | **524** | 524/524 | ✅ |
| 1920×900 | 524 | **524** | 524/524 | ✅ |
| 1600 — fogli | 524 | 524 | 524/524 | ✅ |
| 1600 — md | 524 | 524 | 524/524 | ✅ |
| 1600 — documenti | 524 | 524 | 524/524 | ✅ |

(larghezza pannello autonoma e persistita dal drag: nessun adattatore sfora e nessuno resta
piccolo a nessuna size; `scrollWidth ≤ clientWidth+2` sempre). Screenshot `r30_l32_{1280,1600,1920,fogli,md,doc}.png`.

### L3.3 drag + collasso + leak ResizeObserver
- drag reale del bordo destro → fit + root + scroll coerenti ✅ (`r30_l33_drag.png`);
- toggle collasso/espanso → fit in entrambi gli stati ✅ (`r30_l33_toggle.png`);
- **ResizeObserver**: `FP21_RO.active` = **1** con pannello aperto → **0** alla chiusura del
  modulo (destroy) → **1** alla riapertura → **prima == dopo, nessun leak** ✅.

### L3.4 matrice per tipo (root >=95% area + nessun sforo + screenshot)

| Tipo | boxW | rootW | scroll/client | Esito | Screenshot |
|---|---|---|---|---|---|
| Appunti (snapshot) | 394 | **394 (100%)** | 394/394 | ✅ | `r30_mat_appunti.png` |
| Documenti | 394 | **394** | 394/394 | ✅ | `r30_mat_documenti.png` |
| Presentazioni | 394 | **394** | 394/394 | ✅ | `r30_mat_presentazioni.png` |
| Fogli | 394 | **394** | 394/394 | ✅ | `r30_mat_fogli.png` |
| Video | 394 | **394** | 394/394 | ✅ | `r30_mat_video.png` |
| Chat | 394 | **394** | 394/394 | ✅ | `r30_mat_chat.png` |
| Materiali (md) | 394 | **394** | 394/394 | ✅ | `r30_mat_md.png` |
| **Libri** | — | — | — | ⚠️ **PARZIALE**: `preselected_books/` vuota (0 file) → nessuna sorgente reale (invariato da R27) | `r30_mat_libri_parziale.png` |

### L3.5 regressioni R27 (eseguite sul codice FINALE)
- **T1 completo: 1990 passati, 0 falliti su 31 suite** (`tests/*.test.js`, incluso il nuovo
  `r27_fonti_toggle` 32/0);
- **QA reale R27 rieseguito: 45/45** (toggle toolbar ✅, collasso chevron ✅, persistenza reload
  su 3 mount ✅, toolbar elementFromPoint 20/20 ✅, adattatori B7 ✅, math B8 zero rosso grezzo ✅);
- **pytest backend light: 96/96** (testR28_preview, testR22_models, testR24_church, testH4_validators);
- R30 stesso run: **0 pageerror, 0 console.error inattesi** (Z1/Z2).

## 5. Evidenze / riproduzione

```bash
python qa/_r27_dump.py            # seed reale (read-only SQLite) - invariato
node qa_browser/qaR30_resp.js      # T2 R30: 31/31  -> qa/r30_results.json + qa/r30_measures.json
node qa_browser/qaR27_fonti.js     # regressione R27: 45/45
# T1: node tests/<suite>.test.js per ciascuna (1990/0 complessivo)
```
Screenshot (23, stesso viewport 1440×900 salvo le combo di finestra dichiarate):
`r30_l31_{baseline,w280,w340,w560,collapse,expand,dpr2}`, `r30_l32_{1280,1600,1920,fogli,md,doc}`,
`r30_l33_{drag,toggle}`, `r30_mat_{appunti,documenti,presentazioni,fogli,video,chat,md,libri_parziale}`.

## 6. Cosa resta aperto (dichiarato)
1. **Libri = PARZIALE** (da R27): cartella `preselected_books/` vuota → cella non verificabile
   su sorgente reale; nessuna sorgente inventata.
2. **CDP e DPR**: sotto CDP l'evento `matchMedia('resolution')` su `setDeviceMetricsOverride`
   non è garantito → il caso DPR=2 è verificato con setViewport **più resize reale della finestra**
   (1440→1439→1440), uno degli scatti previsti da L1.2; nel browser reale (zoom di sistema)
   scattano sia il watcher `resolution` sia il listener `resize`. Entrambi i percorsi sono in FE.
3. **Drift ?v pre-esistente** (censito, fuori owner): i 9 moduli editor/Fonti girano a
   `2026-10-30T15:49:23+01:00`, mentre `js/app.js` e `js/modules/statistiche.js` sono a
   `2026-10-27T20:03:00+01:00` (= `QA_TS`); 8 script senza `?v` (katex, store, components,
   chatbot, produttivita, biblioteca, calendario). F0 verifica la coerenza della **catena sotto
   test** (9 moduli stesso stamp) e censisce il resto.
4. **Cambio tab (Schemi)**: il relayout al mostrare/nascondere il body del tab è gestito dal RO
   su `.fp21-pb` (size change) ma **non è misurato esplicitamente in L3** (tutte le misure usano
   il mount Appunti) → copertura indiretta (stesso codice + R27 sul mount Schemi).
5. `max-height:50vh/80vh` dove una `%` non è applicabile (blocchi in flusso dentro area a
   altezza variabile): unità viewport-relative, non px fissi — scelta dichiarata.

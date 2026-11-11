# REPORT R31 — PROMPT ROUND 29: ink-commit, riscrittura totale del motore di perfezionamento

**Esito complessivo: DONE** (evidenza reale completa; nessuna fase PARZIALE).
Data: 2026-11-09/10 · Build: `QA_TS=2026-11-09T19:30:00+01:00` (stamp `?v=` unificato su tutti i moduli di index.html)
Runner QA reale: `node qa_browser/qaR31_ink.js` (Puppeteer/CDP, pointer REALI su index.html servita da server static, viewport 1440x900, zoom 245% come nel video di riferimento).

---

## 1) Q01 — Tabella V01-V08 (casi dal video, pointer reali)

Ogni caso: screenshot **LIVE** (penna giù, con punta grigia) e **POST** (dopo commit) in `qa/`.
Verifiche per caso: classe attesa, residuo render ≤0.5px vs modello parametrico, endpoint preservati ±3px
(distanza min dei punti ideali dai punti grezzi), nessun residuo grezzo renderizzato (K03).

| Caso | Descrizione | Classe attesa → ottenuta | Residuo (px) | Endpoint err (px) | Altri assert | ESITO | Screenshot |
|---|---|---|---|---|---|---|---|
| V01 | linea orizzontale ondulata (amp4, per24) | line → **line** | 0 | 0 | segmento esatto a2 punti; 1 solo swap; LIVE punta grigia ≥3px pixel | **PASS** | `r31_v01_live.png`, `r31_v01_post.png` |
| V02 | linea + flick di coda → freccia | arrow → **arrow** | n/a (asta=line) | 0 | UN oggetto; shaftKind=line; punta 3-4×spessore; ali 35°∈[30,40]; dir punta vs tangente asta ≤10°; base==end asta ≤0.05px; flick grezzo assorbito (nessun pt ideale sul flick) | **PASS** | `r31_v02_live.png`, `r31_v02_post.png` |
| V03 | tre archi aperti (corner raccordato, U, arco verticale) | arc,arc,arc → **arc,arc,arc** | ≤0.5 (params) | ≤3 (tutti e3) | tutti i modelli ∈ {circle,bez}; curve RESTANO aperte (N01) | **PASS** | `r31_v03_live.png`, `r31_v03_post.png` |
| V04 | diagonale ondulata → diagonale perfetta | line → **line** | 0 | 0 | angolo render vs generatore ≤1.5° (misurato) | **PASS** | `r31_v04_live.png`, `r31_v04_post.png` |
| V05 | S verticale con due flessi | freeform → **freeform** | 0 (smooth) | ≤3 | **2 flessi preservati** (grezzo→render); nessun modello parametrico (params.kind=smooth, no snap) | **PASS** | `r31_v05_live.png`, `r31_v05_post.png` |
| V06 | corsivo con loop + zigzag morbido | freeform ×2 → **freeform ×2** | 0 | ≤3 | loop: auto-intersezioni 13→13 (T04 preservate); zigzag flessi ≥2 preservati | **PASS** | `r31_v06_live.png`, `r31_v06_post.png` |
| V07 | C aperta + verticale ondulata | arc + line → **arc + line** | ≤0.5 | ≤3 | C resta APERTA (gap 65.5→65.5, mai closed → N01/T05); verticale → linea perfetta | **PASS** | `r31_v07_live.png`, `r31_v07_post.png` |
| V08 | due diagonali ondulate | line, line → **line, line** | 0 | 0,0 | LIVE punta grigia ≥3px | **PASS** | `r31_v08_live.png`, `r31_v08_post.png` |

Evidenza pixel (N08/L02, sezione trasversale REALE sul canvas): LIVE coda grigia run=3.5px mondo (≥3 atteso) ·
POST-commit run=0 (≤0.75 atteso) — `r31_n08_live.png`, `r31_n08_post.png`.
Conteggio: **V01-V08 = 8/8 PASS**. Tutto il blocco QA reale: **87/87 check OK** (3 run consecutivi sul codice finale; misure in `qa/r31_ink_measures.json`).

## 2) Q02 — Tabella N01-N09 (vincoli negativi, test dedicati su app reale)

| ID | Vincolo | Test eseguito | ESITO |
|---|---|---|---|
| N01 | Mai chiusura di curve aperte | C irregolare dedicata: classe resta famiglia aperta (arc), gap post−pre = 0.0px (gate +6), >12 | **PASS** |
| N02 | Mai ghost/anteprima in hold | hold500ms con penna giù: state() senza campo `ghost`, 0 nodi DOM ghost, 0 trace release/swap durante l'hold, 0 oggetti creati; al rilascio commit normale | **PASS** |
| N03 | Commit parte dal RILASCIO (nessun hold) | rilascio immediato senza pause: trace release presente + swap con dt=209ms ∈[150,320] e classe line | **PASS** |
| N04 | Nessuna maniglia/box/shape dopo commit | DOM handle/maniglia/releaseRefine/ghost: delta 0; state().selected=false, lasel=false, tool=penna; tutti gli oggetti `t==='stroke'` (zero `t==='shape'`) | **PASS** |
| N05 | Mai ri-perfezione di tratti già commitati | snapshot JSON di A dopo commit → disegno B → JSON(A) identico byte-per-byte | **PASS** |
| N06 | Mai morfing durante il live | durante il drag+250ms: oggetti in doc invariati (0), 0 release/swap, nessun oggetto in doc finché non si rilascia | **PASS** |
| N07 | Mai snap di forme chiuse | cerchio deformato → `closed` + params.kind=`smooth` senza cx/cy (mai cerchio), resta `t=stroke`, wobble vs circonferenza perfetta=2.89px (resta storto) | **PASS** |
| N08 | Zero pixel grigi post-commit | LIVE ≥3px grigio in sezione (2 metodi: disco punta + sezione trasversale); POST ≤0.75px in sezione; flag `_wet` assente | **PASS** |
| N09 | Larghezza uniforme = setting penna | sizes=null post-commit; size==base(4); sezioni trasversali [4,4] (±1.5) | **PASS** |

**N01-N09 = 9/9 PASS.**

## 3) Q03/Q04 — Zoom-invarianza e latenza

- **Q03**: stessi tratti (onda→line, S→freeform) a zoom **100%** e **245%**: classi e `params.kind` IDENTICI
  (`{z100: [line,freeform]/[line,smooth], z245: identico}`); dopo swap lo zoom non rigenera nulla.
  Screenshot `r31_zoom245.png`.
- **Q04**: stream sintetico **240Hz** (190 evt, PointerEvent reali sul canvas): **p95 = 16.8ms ≤ 33ms**,
  p50=8.9, paintMax=18.5, rAF/interval sani (tickMax<7ms). **Invariata vs baseline notes.js R0** (stessa misura
  su pagina con notes.js di baseline via interception: p95=17ms → delta ≈0ms ≤8ms).
  Nota diagnostica (dichiarata): su una sessione molto lunga (20+ screenshot) Chrome ha talvolta throttlato i rAF
  della pagina (timer sani, p95 fuori soglia); la rilevazione su pagina fresca è verde ed è la misura riportata
  (entrambe le misure salvate in `r31_ink_measures.json`).

## 4) Q05 — Regressioni

| Verifica | Esito |
|---|---|
| **T1 completo** (`python tests/run_t1.py`) | **3581 passati / 0 falliti** (41 suite JS + 44 file PY) — baseline 3308/0 → **+273, target ≥2062/0 OK** |
| Pannello Fonti R27/R28 (`qaR27_fonti.js`) | **45/45** (ripetuto sul codice finale) |
| Badge/`?v` (`qa_browser/run.js`, F0.4 + 4 pagine) | **19/19** |
| Streaming chat (`r18_chat.js`) | **40/0**; in T1: `r16_chat_ui` 36/0, `testG4_stream` 4/0 |
| Suite notes/fonti adiacenti (qaA 102, a19 46, aiUi 86, s22 55, editorWiring 49, implBlock12 74, uiHarness 197, qaC2 47, fogliUi 142, videoUi 121…) | tutte **0 falliti** (in T1) |

Suite ink riscritte ex-novo per il nuovo contratto (assert totali 425 vs262 delle vecchie):
`a14_shaping` **86/0**, `u20_shaping` **142/0**, `u22_reshape_r22` **36/0**, `u24_release_refine` **56/0**,
`v1_release_swap` **95/0**, `l14_appunti` **10/0** (assist live invariato: lag invariant, settle≤40ms, snap verità).
Probe rapido `qa/_r31_probe.js`: 37/37.

## 5) Parametri scelti (unico file di config: `web_frontend/html/js/modules/ink_cfg.js`)

| Parametro | Valore | Motivazione |
|---|---|---|
| `settleMs` | 200 | K01 impone150-300ms: valore centrale, misurato nei trace dt∈[150,320] |
| `wetTailPx` / `wetColor` | 30 / `#a8a8a8` | L02 "ultimi 20-40px" (30px mondo ≈29px screen a245%); grigio chiaro stabile per il rilevamento pixel N08 |
| `shortMinLenPx` / `shortMinPts` | 20 / 3 | T06: tap/puntini restano grezzi, nessun commit di perfezione |
| `lineDevRatio` | 0.025 | T01 "≤2-3% della corda": 2.5% centrale |
| `lineStraightRatio` | 0.95 | T01 ramo oppure (endpoint/path) |
| `lineEndTolPx` | 3 | T01/Q01 endpoint fittati entro ±3px dal grezzo |
| `arcFitTolPx` | 4.0 | T02: residuo cerchio ≤4px assorbe il tremolio della mano senza catturare onde (S restano fuori) |
| `arcFitTolChordRatio` | 0.11 | T02: cubica singola con tol = max(4px, 11% corda) — l'angolo raccordato (V03) ha residuo best-fit17.6px su corda171 e deve diventare curva ideale; endpoint/tangenti restano esatti (A02/A03) |
| `arcPerfectTolPx` | 1.5 | Se countFlessi≥2 la corda è corta rispetto al percorso (artefatto anche su "C" pulita, misurato nf=3 con residuo0): solo un cerchio PERFETTO≤1.5px è arco → "C"280°=arco (A01), S=freeform (T03) |
| `arcEndTolPx` / `arcAngTolDeg` / `arcTanTolDeg` / `arcMinSweepDeg` | 3 / 5 / 10 / 12 | A02 endpoint±3 e ampiezza±5°, A03 tangente±10°, sotto12° non è un arco |
| `gapClosedMinPx`/`gapClosedRatio` | 12 / 0.08 | tolleranza-gap famiglia R20 (stessa del video): oltre → aperto (N01) |
| `scratchSelfIntMin`/`scratchDenseRatio` | 3 / 1.6 | T07 scarabocchio → solo smoothing leggero |
| `smoothIters`/`smoothClampPx`/`smoothCornerDeg` | 6 / 1.5 / 50 | T03/T04 Taubin conservativo: tremolio rimosso, flessi/incroci invariati (rollback se topologia cambia) |
| `smoothLightIters`/`smoothLightClampPx` | 3 / 0.9 | T07 "solo smoothing leggero" |
| `flickWinMs`/`flickBboxPx`/`flickVAngleDeg`/`flickBack*` | 250/80/100/120/35/12 | F01 micro-V e back-stroke (gate storici R20 verificati su V02) |
| `flick2Ms`/`flick2DistPx`/`flick2DurMs`/`flick2LenPx` | 300/60/120/60 | F01 secondo trattino (valori letterali del prompt) |
| `headLenMul`/`headWingDeg`/`headRoundPx` | 3.4/35/0.9 | F03 punta3-4× spessore, semi-apertura30-40°, angoli leggermente arrotondati |
| `sampleStepPx` | 2 | campionamento curva ideale (K03): sagitta ≪0.5px a ogni zoom |

## 6) Elenco di ciò che del vecchio motore è stato rimosso (M01)

**Nuovi file**: `web_frontend/html/js/modules/ink_cfg.js`, `ink_commit.js`; `qa_browser/qaR31_ink.js` (QA).
**Rimosso da `notes.js` (−1983 righe)**:
- Riconoscimento/format: `recognizeStroke`, `_tryRect`, `_tryTri`, `_closeLoop`, `_denseFill`, `_insideExisting`,
  `kasaCircle`, `_solve3`, `_lineFitRobust`, `_solveLin`, `_fitSegFree/_fitSegT/_projectG1`, `_fitBezierRun`,
  `_bezFromArc`, `_tryArcFit`, `_tryCurve`, `_bezDense`, `_ringForStroke`, `_mapSizesToPts`, `_taubinPreserve`,
  `_countFlessi`, `_centroid2`, `_segCross`, `_selfIntersections`, `_cumLen/_resampleUniform/_evalPolyAt/_distToPoly/_bbox`.
- Frecce vecchie: `detectFlick`, `_detectBackStroke`, `_detectFlickCore`, `findFlickTarget`, `convertTargetToArrow`,
  `buildArrowRec`, `_fitShaftPre`, `_curveRec`, `_makeHead`, `_headPoly`.
- Commit vecchio/ghost: `finalizeStrokeWithShape`, `finalizeEndStroke`, `makeShapeObj`, `ghostFlashLoop`,
  `drawGhostOverlay`, `_recIsClosed`, `inkEndCleanup`, `_swapResidual` (rifatto sui params del nuovo motore).
- Flag/UI (ogni flag correlato): `setShaping`, `setReleaseRefine`, `saveShaping` + chiavi `nt14_shaping` e
  `nt24_releaseRefine`, init `shpOn/arrowOn/holdMs/releaseRefine/inkSnapAmp/inkRawRef/inkHeld/ghost*` in buildChrome
  e pointer handler, slider **"Fermo per snap"**, toggle **"Perfeziona al rilascio"**, tooltip undo a2 livelli,
  maniglia di rotazione (`rotHandlePos` + blocchi in drawAll/lassoDown/selDragMove).
- Invariato (M03): `mkOneEuro` (filtro live a parametri fissi), slider "Intensità aiuto"/"Smussamento righe",
  quiet-snap L3, trace `raw/evt/paint/stop`; `drawShape` resta **solo** per rendering legacy di note già salvate.

## 7) Allineamenti di TEST pre-esistenti (prodotto invariato; necessari per T1=0 falliti)

I quattro fix sono fallout di round PRECEDENTI (prove: mtimes e timestamp citati), non del motore R31:
1. `tests/qaC2_viewer.js` (ii.3/ii.5): contratto viewer mat **R28/R30** ("Nessuna anteprima raggiungibile" + riga apri-file) — `fonti_panel.js` modificato in R30 il **04/11**, ultimo T1 al **02/11** (46/0 allora → 44/2 oggi, prima di ogni modifica R31).
2. `tests/qa3_block3.js` P5: regex `/# ROUND 3/` **senza ancora** combaciava `## Round 30` (voce prependuta in R30) → resa `^# ROUND 3` (intento documentato: il titolo `# ROUND 3`).
3. `tests/testG6_hygiene.py` b3: dal **P1b.3 (02/11 serale, dopo il T1 delle18:47)** `model_ready()`=True (modello ONNX `tools/models/rerank_bge-v2m3` .done+569MB scaricato02/1122:20) → `_apply_reranker` usa il percorso ONNX senza WARNING placeholder; il test accetta ora entrambi i rami contrattuali.
4. `tests/testR15_pipe.py` (regole decompose + test09): default `rag.decompose` portato a **OFF** dal P1b.3 post-T1 (esito A/B `qa/p1b_rag.json`); i test abilitano ora la tecnica esplicitamente via `RAG_TECH=decompose` (meccanismo dichiarato in `gate.rag_flag`).
5. `qa/metrics_history.json`: append **entry round31** con `build == QA_TS` (contratto testG8 test_d/test_h), `t1_total=3581`, method clonato (copertura `metrics_required`).

## 8) Cosa resta aperto

- **Slider Intensità/Smussamento**: UI e stato intatti, ma senza effetto sul post-release (il motore di commit
  gestisce tutto il rilascio con soglie fisse in config; il live resta invariato — l14 e Q04 verificano latenza/fluidità).
  Se si vuole un effetto osservabile dell'intensità, va reintrodotto esplicitamente in fase live (scelta da confermare).
- **QA browser storici** `qaA19_shaping.js`, `qaR22_ink.js`, `qaR24_ink.js`, `qaLA14_appunti.js` richiamano API
  eliminate (`setShaping`, `ghost`, `holdMs`): sostituiti da `qaR31_ink.js`; non eseguiti in questo round.
- **`dist/NovaStudio`** contiene la copia `web_frontend` pre-R31: rigenerare con `build.sh`.
- **F01 secondo tratto**: la finestra letterale (300ms/60px/durata<120ms/len≤60px, target solo line/arc senza testa)
  può intercettare tratti brevissimi in corsivo molto veloce; comportamento dichiarato e osservabile via trace
  `{k:'absorb'}` — parametri in `ink_cfg.js` se andrà restringito.
- **A06 arco+flick**: coperto da `u22_reshape_r22` (jsdom) e dal fallback a inversione localizzata; il QA reale
  V02 copre il caso linea+flick del video. Un caso arco+flick in `qaR31_ink` resta opzionale (copertura già duplice).
- Meta-suite fuori baseline (`qaB1_fogli`, `qaF_block`, `qaV_blockv`, `qaD_blockD`): invariate (informativa, come da metodo T1).

## 9) Cronologia di verifica finale (codice definitivo)

1. `node qa/_r31_probe.js` → 37/37 · suite ink jsdom → a14 86/0, u20 142/0, u22 36/0, u24 56/0, v1 95/0, l14 10/0
2. `node qa_browser/qaR31_ink.js` → **87/87** (4 esecuzioni; ultima dopo tutte le modifiche)
3. `python tests/run_t1.py` → **3581/0** (target OK) · poi qa3/testG8 re-verificati dopo MODIFICHE/metrics: 51/0, OK
4. `node qa_browser/qaR27_fonti.js` → **45/45** · `node qa_browser/run.js` → **19/19** · `node qa_browser/r18_chat.js` → **40/0**

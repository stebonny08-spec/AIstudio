# R22 FE-INK — Ricostruzione rette/archi + BLOCCO 1.1 dock Fonti (round 22, scope FE-INK)

Tutto locale. Codice: `web_frontend/html/js/modules/notes.js` (blocco
"R22 BLOCCO 3", già applicato dal predecessore, NON modificato in questo
round). Verifiche eseguite: T1 jsdom (`tests/u22_reshape_r22.test.js`),
T2 Chromium reale (`qa_browser/qaR22_ink.js`) con PRIMA =
`qa/r22_notes_baseline.js` (snapshot pre-R22) e DOPO = `notes.js` corrente.

## 1. Ricostruzione rette/archi (fit + gate)

Il blocco R22 BLOCCO 3 ricostruisce i tratti APERTI da zero, senza
toccare le forme chiuse (gap-closing/corner/ghost restano R20 invariati):

- **Rette — Theil-Sen + PCA**: mediana degli angoli di coppia (campioni
  ≤48, wrap ±90°) rispetto alla direzione PCA, scelta sul minore
  residuo perpendicolare; endpoint = PROIEZIONE sugli estremi reali dei
  punti → il segmento renderizzato è perfetto per costruzione.
  Gate `recognizeStroke`: `maxPerp <= 2.5 + amp*3` (4.3px a amp 0.6) e
  `tlen >= 40px`.
- **Arco — fit algebrico Kasa + coerenza curvatura**: monotonia angolare
  sul centro fit (frac ≥0.9, salto angolare <60°, span 40–350°), poi
  **ricampionatura ideale EX NOVO** dall'equazione del cerchio (passo
  ~4px). Gate doppio: eps (Kasa → tracciato ripulito) ≤2.5px e residuo
  GREZZO → arco ideale ≤ `2.5 + amp*1.5` (3.4px a amp 0.6).
- **Curve — Bezier cubico LSQ pezzo-pezzo**: K segmenti con nodi a
  lunghezza uniforme, fit libero + IRLS (pesi sui residui peggiori),
  continuità G1 ai join (proiezione tangenti + tune di curvatura con
  REVERT se peggiora l'eps), fallback fit libero con kink ≤15°.
  Rendering = campione denso `_bezDense(bez,16)` della curva
  parametrica, MAI il grezzo smussato. Stesso fit usato per l'asta
  pre-flick delle frecce (`_fitShaftPre` → `_tryCurve`).

## 2. T1 — `tests/u22_reshape_r22.test.js`

Pattern deterministico u20/a14: LCG per jitter, dispatch punti sincero
`dt=0`, `setShaping(true,true,900)` → **holdMs clamp 800** (assert 0.1),
pausa flick 280ms (250 < 280 < 800 ⇒ nessun hold-still).

**Esito: 28 passati, 0 falliti** (`node tests/u22_reshape_r22.test.js`).

| Spec | Assert | Esito | Misura |
|---|---|---|---|
| a. retta jitter ±2px → line con pts PERFETTI | a.0–a.4 | PASS | deviazione angolare pts renderizzati = **0.144°** (soglia 1°); residuo grezzo→linea 2.6px ≤4.3px; sizes preservate (2) |
| b. arco irregolare → residuo render vs curva parametrica ideale ≤0.5px | b.0–b.2 | PASS | residuo = **0.0068px**; params ricostruibili (`arc`/`bez`) |
| b. pts renderizzati NON = grezzi | b.4–b.5 | PASS | distanza media NN pts vs grezzi = **2.387px** (>0.4); residuo grezzo-vs-render = **2.404px** > render-vs-ideale (0.007) +0.5 |
| c. arco stretto + flick → arrow (ali 30–45°, 3–4×, tangente R20) | c.0–c.8 | PASS | ali=35°, L=3.2×size; angolo tangente vs derivata Bezier t=1 = **0.000°** (≤10°); base punta d=0px (≤2); residuo asta ≤4.3px; ali simmetriche 30–45° da ricostruzione indipendente |
| d. C aperta e scarabocchio → NON riconosciuti | d.0–d.2 | PASS | C irregolare (jitter ±5 + raggio modulato): shapes=[] strokes=1; scarabocchio: stroke |
| e. smoke rect/circle non-regressione (parity u20) | e.0–e.3 | PASS | rectangle (max dev angoli ≤5°), circle (rErr ≤4.3px) |

**Misura informativa (non-assert)**: b.6 residuo pts vs generatore VERO
(cerchio target senza jitter) = 1.267px — il fit Kasa avvicina alla
verità rispetto al grezzo (gate ammesso 3.4px).

Nessuna spec è risultata irraggiungibile: tutti gli assert richiesti
sono stati mantenuti alle soglie dichiarate (nessuna soglia alzata,
nessun assert falsato).

## 3. T2 — `qa_browser/qaR22_ink.js` (Chromium reale, request interception)

PRIMA = snapshot `qa/r22_notes_baseline.js`, DOPO = `notes.js` corrente;
stessi generatori del T1, PointerEvent sintetici su
`.nt-stage canvas`, `setHelp(0.6)` + `setShaping(true,true,900)`.

**Esito: PRIMA 5/5 ok, DOPO 5/5 ok, 0 pageerror ⇒ exit 0.**
Misure salvate in `qa/r22_ink_measures.json`:

| Misura | PRIMA (R21 baseline) | DOPO (R22) |
|---|---|---|
| deviazione rette (°) | 0.148° | **0.070°** (soglia 1°) |
| residuo arco renderizzato vs curva parametrica ideale (px) | 0.0 | **0.0** (soglia 0.5 ⇒ tick=true) |
| tick=curva ideale | true | **true** |
| — informativo: residuo render vs cerchio GENERATORE vero (px) | 2.009 | **1.16** (fit ex novo avvicina alla verità) |
| — informativo: meanNN pts vs grezzi / residuo grezzo-vs-render (px) | 2.552 / 2.075 | 2.694 / 2.446 (pts renderizzati ≠ grezzi) |
| ali (°) / ratio L:spessore | 35° / 3.2 | 35° / 3.2 (range 30–45°, 3–4×) |
| tangente (°) / base punta (px) | 0° / 0px (shaft=curve, toll. ≤10°, ≤2px) | 0° / 0px |
| C intatta (bool) / resta stroke | true / true | true / true |

**Divergenza dichiarata (misurata, non corretta con assert):** il campo
`tick=curva ideale` NON discrimina da solo PRIMA vs DOPO: anche il
baseline R21 rende i nodi Taubin che cadono sulla Bezier interpolante
(Catmull-Rom passa per i nodi) ⇒ residuo render-vs-params ≈0 in entrambi.
Il discrimine reale della ricostruzione ex novo è la misura informativa
**residuo vs generatore vero: 2.009 → 1.16px** (R22 campiona
l'equazione del cerchio fit, non i nodi del tracciato).

Screenshot (canvas + pannello):
`qa/r22_ink_{prima,dopo}_{retta,arco,arco_flick,c_aperta,fonti}.png` (10 file).

## 4. BLOCCO 1.1 — dock pannello Fonti sotto la pill undo/redo

Verificato col codice attuale (dock già corretto, nessuna modifica
necessaria):

- **Scelta dock**: SOTTO la pill — `toggleFonti()` calcola in modo
  dinamico `top = max(bottom(.fn-pill-left), bottom(.fn-zoom)) + 10px`
  (fallback CSS `top:152px`), quindi il pannello non copre mai undo/redo
  e neppure la barra zoom; altezza validata (`0 < top < host.height-40`).
- **z-index**: pannello `.fp21-root` = **11** < pill `.fn-pill` = **12**.
- **Misure DOM T2 (DOPO)**: pannello aperto (`shown=true`),
  `elementFromPoint` sul centro di #btnUndo ritorna il bottone
  (`hit=BUTTON cls=fn-tb`, `hitOk=true`), **overlap rect pannello∩pill =
  0 px²**, gap pannello.top − pill.bottom = **+48px** (≥8px richiesti),
  z_pannello=11 < z_pill=12 ⇒ non-bloccante. `ok=true`.
- **Informativo PRIMA**: il baseline aveva z_pill=9 (z_pannello 11 sopra)
  ma overlap=0 per il `top:152px` fisso ⇒ non-bloccante solo per il
  posizionamento; il DOPO rispetta anche la regola z-index.
- Screenshot: `qa/r22_ink_prima_fonti.png`, `qa/r22_ink_dopo_fonti.png`.

## 5. Esiti test

| Test | Esito | Note |
|---|---|---|
| `tests/u22_reshape_r22.test.js` (NUOVO) | **28/0** | spec a–e tutte raggiunte |
| `qa_browser/qaR22_ink.js` (NUOVO, T2) | **PRIMA 5/5, DOPO 5/5, exit 0** | 0 pageerror |
| `tests/u20_shaping.test.js` | **80/0** | rieseguito in questo round |
| `tests/a14_shaping.test.js` | **42/0** | rieseguito |
| `tests/l14_appunti.test.js` | **10/0** | rieseguito |
| `tests/qaA_appunti.js` | **102/0** | rieseguito |

T1 completa NON lanciata (come da scope); `node --check` OK su
`notes.js`, `tests/u22_reshape_r22.test.js`, `qa_browser/qaR22_ink.js`.

## 6. Cosa resta aperto

1. **`tick=curva ideale` poco discriminante nel T2**: con baseline
   R21 il residuo render-vs-params è ~0 anche senza ricostruzione ex novo
   (Catmull-Rom interpolante). Se serve un gate che separi PRIMA/DOPO,
   promuovere a assert la misura informativa "residuo render vs
   generatore vero" (2.009 → 1.16px) con soglia ≤1.5px.
2. **C aperta**: con C "di qualità" (jitter contenuto, come u20 sezione
   6) il codice — anche R21 baseline — produce `curve`, non `stroke`
   (uscita dichiarata R20, mai forma chiusa). La spec "C → stroke" è
   vera per la C irregolare pesante testata in d.1; resta il principio
   invariante **MAI circle/ellipse/rectangle** (d.0) verificato in T1 e
   T2 (C intatta=true).
3. Il residuo vs generatore vero b.6 (1.267px) è informativo: un gate
   ≤1px sul "fit vs verità" potrebbe essere interessante per jitter più
   alti, ma richiede decisione sulle soglie (non introdotto per non
   alterare le tolleranze dichiarate R20/R22).

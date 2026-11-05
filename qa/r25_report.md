# R25 (PROMPT ROUND 24/25) — Evidenza solo su app reale + pannello Fonti + ink release-swap (report)

**STRATEGIA**: riproduzione V0 bloccante prima di ogni fix (tabella fallimenti da app reale),
poi3 scope FE paralleli con owner unici per file disgiunti (FE-INK = notes.js, FE-FONTI =
fonti_panel.js+test dock/resize, FE-CHURCH = residui schemi/config/test/RSS), chiusura SOLO
con T2 su index.html reale (Chrome/CDP, stessa catena ?v= del BUILD, pointer reali scriptati,
screenshot stesso viewport, contatori letti dal DOM reale). Motivazione: la regola vincolante
vieta chiusure su harness/jsdom — quindi ogni claim ha PRIMA la riproduzione, POI il fix nello
scope owner, POI la matrice reale. Niente DONE su harness: i jsdom restano T1 di non-regressione.

##1. V0/R0 — riproduzione reale (bloccante) → fix → evidenza

Script: `qa_browser/qaR25_v0_repro.js` (8 forme, rilascio SENZA pausa, settle750ms).
Tabella: `qa/r25_v0_table.txt` + `qa/r25_v0_measures.json`.

| Reclamo V0 (PRIMA) | Fix (scope) | Evidenza DOPO (T2 reale) |
|---|---|---|
| Toolbar coperta dal pannello Fonti: in V0 la base era GIÀ a regime (fix dock del round R24 |
  precente): overlap **0px²**, pannello top=150 z=11<12,7/7 bottoni visibili hit (1 non-hit =
  'Elimina selezione' nascosto per design) | FE-FONTI: **0 edit prod** — verifica codice
  (chromeAnchor legge getBoundingClientRect pill+zoom, z dinamico, nessuna costante hardcoded;
  3 nuovi test dock D16-D18) | Matrice B1: elementFromPoint **7/7** con pannello aperto;
  screenshot PRIMA storico `qa/r24_r0_1_pannello_toolbar.png` (pre-fix R24) vs DOPO
  `qa/r25_matrix_b1_toolbar_pannello.png` + `qa/r25_v0_1_toolbar_pannello.png` |
| Tratti grezzi non perfezionati semanticamente: TUTTI gli8 tratti diventavano `shape/curve`
  indistinguibili; contatori V0 nuovi (strokes_live, perfected_on_release, swapped_pixels,
  residual_px) **ASSENTI**; retta+flick → curve NON arrow; classificazione line/arc/freeform/
  closed/arrow assente | FE-INK: motore release-swap V1 (Theil-Sen+PCA line, Kasa/Bézier arc,
  Taubin corner-preserving freeform, closed R20, flick/back-stroke con fallback finestra
  temp+spazio; contatori V1 in UNO swap al rilascio; log [inkV]) | Matrice A1-A7 **27/27**:
  retta→line residuo **0px** + perfected_on_release **+1**; arco→vclass arc residuo vs
  generatore **1.2008px ≤1.5** aperto (tipGap355); S→freeform flessi **2/2**, turn**8.32°**;
  loop NON snap (curve/freeform); C resta **APERTA** (gap99.5px); verticale/diagonale → line
  residuo **0/0**; retta+flick → **kind=arrow classified.arrow+1**; contatori finali
  classified{line4, arc1, freeform3, arrow1} perfected_on_release=9 swapped_pixels=683
  residual_px=0 discarded=0. Screenshot `qa/r25_matrix_a*_{prima,dopo}.png` stesso viewport |
| Spazio morto sotto 'Inserisci nella nota': in V0 **5px** (a regime dal round precedente) |
  FE-FONTI verifica (height auto + padding4) | Matrice B2: dead **5px ≤8**, typo assente; extra
  collapso `qa/r25_fonti_extra` **7/7** (+26px lista, persistito e riacceso su RELOAD) |
| Typo 'l anteprima': assente in V0 (fix precedente) | — | riconfermato B2 + grep0 |

**Bug del QA (non dell'app) emersi e fixati NELLO SCRIPT, dichiarati**: la S del primo V0
cadeva sopra il pannello (down sul pannello → delta0), il generatore arco A2 era un'ellisse
160×70 (→ semicerchio vero), segno y del semicerchio, `kind` vs `vclass`, flick a180° puro
(→ sequenza stile u22), A8 in doc pieno (**`_insideExisting` → scarto** su ogni tratto che
cada in una shape esistente: risolto con doc nuovo nella cella).

##2. Contatori ink reali (regola: perfected_on_release=0 dopo retta = FAIL)

Sessione matrice (`qa/r25_matrix_measures.json`):
`{classified:{line:4, arc:1, freeform:3, closed:0, arrow:1}, total:9, refined:9,
 discarded:0, strokes_live:0, perfected_on_release:9, swapped_pixels:683, residual_px:0}` —
dopo la retta A1: `perfected_on_release` +1 (assert D3-equivalent **PASS**; V0 lo dichiarava
ASSENTE = FAIL confermato e fixato da FE-INK). Log `[inkV]` presenti.

##3. Matrice V4.1 (T2 reale): **33/33 PASS, exit 0**

| Cella | Esito | Misure chiave |
|---|---|---|
| A1 retta ondulata rilasciata senza pausa | PASS | kind=line, residuo e2e **0px**, perfected+1, classified.line+1 |
| A2 arco ondulato | PASS | vclass=arc, residuo vs generatore **1.2008px ≤1.5**, aperto (tipGap355.6), classified.arc+1 |
| A3 S due flessi | PASS | vclass=freeform, flessi **2≥2**, turn max **8.32°**, nessun snap |
| A4 loop | PASS | curve/non-geometrico (NON snap-pato), classificato freeform |
| A5 C aperta | PASS | resta APERTA (tipGap99.5 ≥60), mai forma chiusa |
| A6 verticale+diagonale ondulate | PASS | entrambe line, residuo **0/0px** |
| A7 retta+flick | PASS | kind=arrow, classified.arrow+1; punta: sizes=[4,4] — dettaglio ali/3-4× NON leggibile da lì (vedi PARZIALE §6) |
| A8 zoom245% (popover reale, sc=2.753, path costruito con toWorld inverso) | PASS | line, residuo **0px MONDO**; doc nuovo (per `_insideExisting`) |
| B1 pannello+toolbar | PASS | overlap0, elementFromPoint **7/7** |
| B2 pannello compatto | PASS | dead**5px**, typo assente |
| V4.2 latenza live da `__ink.trace` su app reale | PASS | n=626, p50**0.5ms**, p95**0.7ms**, max2ms (≤33) |

Screenshot:19 file `qa/r25_matrix_*.png` PRIMA/DOPO dallo STESSO viewport1440×900 (frame
interi: toolbar+pannello dove contestati).

##4. V3 — residui (scope FE-CHURCH + FE-INK)

- **V3.1** residuo render-vs-generatore ≤1.5px **assert T2**: A2=**1.2008px** ✓ e
  `perfected_on_release>0` dopo retta ✓ (matrice).
- **V3.2** width Schemi: `normFontiWidth()` intatta; T2 rieseguito `qaR24_church_schemi`
  **16/16** (PRIMA taglio248px → DOPO cut−12, resize R21 `fp21_w_schemi` invariata).
- **V3.3** gate da config: testR15+testR16 **33/33**; config utente non toccata.
- **V3.4** testG1: **3/3 ×2 run**, policy `[flake-retry] max2` nel codice (mai run silenziose).
- **V3.5** RSS pro: probe reale → **4435.1MB** (R24:4435.9; dichiarato4471 → range
  4435-4471, variabilità ~0.8%); floor = pesi3379.3 + KV q8_0@4096 **765.0** + resto290.8 =
  4435.1 (**target≤3.6GB NON raggiungibile**, gap835MB; ctx2048→~4052 ancora sopra;
  `-c4096` confermato applicato dal log `n_ctx_slot=4096`). **Budget draft6144MB
  INVARINATO**:4471(peggiore)+1500=**5971<6144** (margine173MB); commento motivazione
  aggiornato in client.py. `qa/r25_church_rss.json` + `qa/r25_church_report.md`.

##5. V4.2 — regressioni

- **T1**: vedi §7 (re-run finale dopo fix a testH2/testG8). Primo run:3308/2 → fix dei due
  (testH2 assertava il path MiniCPM della config utente — ora accetta la lineup; testG8
  mancava `method.ttft_p95_ms` nell'entry metrics R23) → **re-run concluso in §7**.
- **R20**: `u20_shaping` **80/0**, `u22_reshape_r22` **26/0** (2 aspettative legacy R22
  aggiornate al V1 con dichiarazione: curve aperte ora classificate, freeform = informativo),
  `u24_release_refine` **33/0**, `a14` **42/0**, **`v1_release_swap` (NUOVO) 71/0**.
- **R21**: `qaR21_matrix` **7/7 celle OK** (md/html/libro/search/resize/ins su7 moduli).
- **R16/R18**: T1 `testR16_*` 40/0, `testR18_*` 32/0 (nei totali T1).
- **Streaming/grounding su app reale** (`qa/r18_verify.py`, sidecar reale con Spark-4B pro):
  streaming **VERDE** su4/4 (trunc0, codici citazione0, mojibake0, blocchi unici, guard ok,
  completo, lang it); **depth/grounding: ok=1/4** (v3 locale ok; v1/v2/v4 web: la rigenerazione
  B2/B5 intercetta le violazioni ma la2ª risposta resta corta89-87 parole <120) →
  **PARZIALE dichiarato** (non è una regressione di streaming: è profondità su query web con il
  pro; R16 storico già documentava gate umano parziale).

##6. Cosa resta NON verificato su app reale (PARZIALE, mai DONE)

1. **Geometria punta freccia (ali30-45°,3-4× spessore) su reale**: l'oggetto arrow reale espone
   `sizes=[4,4]` che non contiene angoli/ratio leggibili → assert numerico ali/punta NON
   eseguito su reale (cella A7 chiusa solo per kind+classified). Coperto in T1
   (u20/v1: ali35°/3.2×/tang0). **PARZIALE**.
2. **Impostazione 'perfeziona al rilascio' OFF → hold-still R20 su reale**: il DEFAULT ON è
   confermato su reale (state.releaseRefine=true letto in DIAG A8); la modalità OFF non è stata
   eseguita con pointer reali (T1 u2433/0 la copre in jsdom). **PARZIALE**.
3. **Undo a2 livelli su reale**: non eseguito con pointer su index.html (T1 u20/v1 coprono).
   **PARZIALE**.
4. **R18 depth su query web** ok=1/4 (vedi §5): streaming/encoding/grounding-guard verdi,
   profondità non sempre raggiunta. **PARZIALE**.
5. **Flick in app con pywebview**: tutti i T2 girano su index.html servita con stub
   listSubjects (patch ambiente dichiarata: solo senza pywebview); la finestra pywebview non è
   stata usata. **PARZIALE** (stessa dichiarazione dei round R22-R24).
6. Le2 aspettative u22 (b.1/d.1) sono state RISCritte al comportamento V1 (freeform per l'arco
   irregolare con assert informativo; C sgangherata → curva aperta): il residuo-vs-generatore
   del freeform resta **informativo** (1.91px, input jitter±1.6) — non è un assert richiesto dal
   round (V3.1 vale per line/arc, qui A2=1.2008 ✓).

##7. T1 finale

Re-run concluso in `qa/t1_r13.json` (dopo fix a testH2/testG8):
T1 = **3308 passati / 0 falliti** (JS **2777/0** su39 suite, PY **531/0** su40 file)
— target del round **≥3149/0 RAGGIUNTO** (primo run:3308/2,2 fix dichiarati §5).
Meta-suite escluse legacy:368/6 (qaF pre-H11 ×4, qaB1 baseline ×1, qaV5.24 ×1 — non regresse R25).

##8. File toccati (owner unici)

- **QA-REAL (coordinatore)**: `qa_browser/qaR25_{v0_repro,matrix,fonti_extra}.js`,
  `qa/r25_*` (misure/screenshot/table), `qa/metrics_history.json` (method ttft_p95 R23),
  `tests/testH2_server.py` (assert lineup), report/NOTE/MODIFICHE.
- **FE-INK (delegato + completion coordinatore)**: `web_frontend/html/js/modules/notes.js`
  (contatori V1, classificatore line/arc/freeform/closed, flick fallback back-stroke, log
  [inkV], vclass), `tests/v1_release_swap.test.js` (nuovo), `tests/u22_reshape_r22.test.js`
  (2 aspettative legacy aggiornate), geometria test bow/flick.
- **FE-FONTI (delegato)**: `tests/f22_fonti_dock.test.js` (+D16-D18),
  `tests/f22_fonti_resize.test.js` (+R15/R16); `fonti_panel.js`/`css` NON toccati (a regime).
- **FE-CHURCH (delegato)**: `tools/_r24_rss_probe.py` (output r25), `core/sidecar/client.py`
  (solo commento budget), `tests/testR24_church.py`, `qa/r25_church_{rss.json,report.md}`.

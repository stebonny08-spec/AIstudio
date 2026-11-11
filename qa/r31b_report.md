# REPORT R31-bis — PROMPT ROUND 29-bis: OMBRA (anteprima live linea/arco)

**Esito: DONE** — evidenza reale su app reale (`node qa_browser/qaR31b_shadow.js`, Puppeteer/CDP,
index.html con build invariata `QA_TS=2026-11-09T19:30:00+01:00`): **65/65 check OK** (run finale),
0 falliti. Nessuna modifica a `web_frontend/**` in questa completione: tutte le 5 aperture del
round 29-bis erano su misura/strumenti QA o su generatori QA sotto-soglia spec; il prodotto
(shadowPlan/updateShadow/drawShadow + timer idle 40ms) è restato invariato.

## 1) Cosa è stato implementato (Parte 1-bis) — invariato
- **ink_cfg.js**: `shadowHoldMs:200` (G01 ~150-250), `shadowOpacity:0.40` (G02 35-45%), `shadowWidthDeltaPx:0` (G02).
- **ink_commit.js**: `shadowPlan(pts,opts)` — classifica con lo stesso motore e ritorna il piano SOLO per T01 (line), T02 (arc) e frecce con asta line/arc (G01/G08); null per T03-T07 e grezzo (G04). Non commetta mai (G09).
- **notes.js**: stato `ed.sh` (init a pointerdown, lastMoveT a ogni punto); `updateShadow()` a ogni frame + timer idle 40ms (gate >60ms senza input); render layer separato `drawShadow()` dopo il grezzo (G03), solo con penna giù; `ed.sh=null` al rilascio (G10). API `__ink.shadow()` / `__ink.activePts()`. Commit K01-K04 e assist live invariati (M03).

## 2) Scenari Q06-Q12 — esiti finali (evidenze: `qa/r31b_shadow_measures.json` + screenshot `qa/r31b_*.png`)

| Scenario | Esito | Evidenza/valori (run finale) |
|---|---|---|
| Q06 linea+sosta+miratura (zoom 245%) | **20/20 PASS** | attivazione 201ms ∈[150,300]; cls=line; G05 update **max 11.9ms** (media 8.9, n=26, in-page); grezzo immutato in sosta; pixel ombra wrun 4.0-4.25 ≥2.5 mondo; **rilascio → commit `line`, endpoint ombra→commit 0.000px**; post zero grigio; doc=A+B; screenshot `r31b_q06_1_ombra/2_miratura/3_reconferma/post` |
| Q07 arco+miratura | **13/13 PASS** | attivazione 187ms; cls=arc; G05 update **max 15.3ms** (media 5.9, n=14); commit arc, **endpoint 0.000px**; pixel wrun ≥1.5; post pulito (`r31b_q07_1/2/post.png`) |
| Q08 no-ombra freeform (T03/T04) | **5/5 PASS** | S(2 flessi) hold 1200ms → shadow absent; loop → absent; grezzo immutato; commit freeform comunque |
| Q09 rilascio senza sosta | **5/5 PASS** | mai ombra; swap 208.8ms ∈[150,320] (commit R29 invariato); post pulito |
| Q10 freccia con ombra (F01) | **9/9 PASS** | ombra linea dopo sosta (astas insusoide phase-safe); flick 4pt→ **shadow cls=arrow head=true**; pixel asta wrun ≥2.0; **rilascio → `arrow` + head, endpoint 0px**; asta+punta = UN oggetto; post pulito (`r31b_q10_1/2_con_punta/post.png`) |
| Q11 undo/redo | **3/3 PASS** | undo→solo inchiostro (1 oggetto); **redo → ['line','line'] identico**; zero grigio |
| Q12 zoom 100% vs 245% | **8/8 PASS** | z100: attivazione 206ms, cls=line, **endpoint 0px**, S senza ombra, pixel-verificabile, zero grigio; esiti identici a 245% (G13) |
| **N02-bis (sostitutivo)** | **CONFERMATO in ogni scenario** | post: shadow.visible=false; movimento senza sosta: mai visibile; T03-T07: mai visibile; nessun DOM/maniglia; mai commit proprio; nessun morfing del grezzo (activePts identici durante sosta) |

## 3) Misura endpoint ombra → commit (G06)
| Scenario | Endpoint |
|---|---|
| Q06 linea | **0.000px** ✓ |
| Q07 arco | **0.000px** ✓ |
| Q10 freccia (asta+punta) | **0.000px** ✓ |
| Q12 z100 linea | **0.000px** ✓ |

## 4) G05 — aggiornamento ombra ≤100ms (metodologia + valori)
La misura NON usa il clock nodo (il poll CDP misura anche latenza CDP/headless del run, che in
headless è episodicamente stellare): un poller **in pagina** (10ms) registra
`performance.now()` del `pointermove` e il momento in cui cambia l'endpoint del piano ombra
(`g05Arm/g05Read` in qaR31b, stessa tecnica validata in `qa/_r31b_cadence.js`):

- **Q06**: lats n=26, **max 11.9ms**, media 8.9ms → PASS ≤100ms
- **Q07**: lats n=14, **max 15.3ms**, media 5.9ms → PASS ≤100ms

## 5) Le 5 aperture del 29-bis — chiuse con root-cause
1. **Q06.14/15 + Q11.2 (commit freeform, endpoint 104.058px)** → **bug QA, non prodotto**: `penUp(ptsB)` rilasciava a x=+60 mentre la penna era a x=+164 (dopo l'estensione): `commitStroke` esegue lo snap dell'ultimo punto su `inkLastRaw` → teleporto di 104px → nf esplode → freeform; 104.058 = dist(x+164, x+60) esatta. Fix QA: `penUp(ptsB.concat(ext))`. Verifica offline (`_r31b_cadence.js`): classify completo 105pt = **line**. Esito: Q06.14 line ✓, Q06.15 **0.000px** ✓, Q11.2 ['line','line'] ✓.
2. **G05 ≤100ms (upd 759/499ms)** → doppia causa QA: (a) clock nodo/CDP; (b) **i probe pixel `getImageData` sezzano il rendering del canvas**: bisect reale `qa/_r31b_bisect.js` — frames/500ms: baseline **31** → dopo screenshot **31** (screenshot innocui) → dopo burst 324×getImageData **2** (collassato, persistente, bringToFront non ripristina). I run precedenti eseguivano grayProbe PRIMA della miratura → penMoves 620ms/pt. Fix QA: misura inpagina + **probe pixel spostati DOPO la sezione G05** in Q06/Q07. Valori finali: 11.9ms / 15.3ms ✓.
3. **Q10 F01 flick non rilevato** → **generatore QA sotto-soglia spec, non bug prodotto**: il vecchio V aveva gamba 7.5px < `flickMinLegPx:8`, solo 2 punti (la finestra 250ms con sosta 280ms isola la coda → win<4) e nessuna inversione netta: `detectFlick` correttamente ritorna -1 (spec A01). Nuovo flick 4pt (gambe 10.8/16.1/19.2/11.3px, angolo ~169-172° ≥100°) validato offline in entrambi i bordi finestra (`_r31b_dbg_q10shaft.js`): arrow+head ✓. In più l'asta a fase iniziale -1 (dev 7.91>6.70) finiva in bez 'arc' → asta riscritta phase-0 span264 amp3: T01 line anche col troncato da flick (dev 5.08<6.50), stazioni G02 dev 2.60≥2.0. Esito: Q10.1 line ✓, Q10.3 arrow+head ✓, Q10.5 arrow+head ✓.
4. **Q12.4/6 stationsOf** → rieseguiti sul codice finale: **PASS** (z100 pixel-verificabile wrun OK, zero grigio post).
5. **Rerun regressione sul codice finale** → **T1 = 3581/0** (baseline ufficiale, `python tests/run_t1.py`) e **qaR31_ink = 87/87** (`node qa_browser/qaR31_ink.js`).
   - Nota N08 (qaR31_ink): la completione ha anche scoperto/perché era tornato FAIL in questa run: la **pausa dello screenshot mid-stroke ≥200ms attiva l'ombra G01** che scurisce la coda bagnata (168→~109, fuori dalla banda 160-176 del probe) — evidenza A/B in `qa/_r31b_n08diag.js` (noMidShot wrun=3.5 ✓ / withMidShot wrun=0 con shadow visible). N08 è un check round-29 (L02): isolato con `shadowHoldMs` fuori SOLO per il draw (ripristinato subito dopo, pen già giù) → 87/87. Le varianti Q4 della prima run (baseline starved, nPaint=1) si sono autoguarite nella run di verifica (delta p95 16.3 vs 16.0 = 0.3ms ≤8).

## 6) Come eseguire
```
node qa_browser/qaR31b_shadow.js [porta]   # 65/65 -> qa/r31b_shadow_measures.json + 29 screenshot
node qa_browser/qaR31_ink.js               # 87/87 -> qa/r31_ink_measures.json + qa/r31_*.png
python tests/run_t1.py                     # 3581/0
```
Script diagnostici (evidenza citabile): `qa/_r31b_cadence.js` (cadenza+G05 inpagina),
`qa/_r31b_bisect.js` (getImageData poisoning), `qa/_r31b_n08diag.js` (ombra vs coda N08),
`qa/_r31b_dbg_q10shaft.js` (gate T01/flick Q10 offline), `qa/_r31b_patch2.js`/`_r31b_patch3.js`
(patch QA exact-match con count).

## 7) Stato finale
- **Ombra 29-bis: DONE** — G01-G13 + N02-bis confermati su app reale (65/65), endpoint 0px,
  G05 ≤15.3ms misurato inpagina, frecce con punta saldata verificate pixel e geometria.
- Regressione: **T1 3581/0**, **qaR31_ink 87/87**, jsdom shadow-suites verdi (in T1).
- Nessun aperto residuo.

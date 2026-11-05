# R20 — Lotto G: GHOST PREVIEW (U8) + MANIGLIA ROTAZIONE (U7) + chiusura

Data: 2026-10-29 · Round 20 · owner G (delegato) + fix stabilità capo
Ambiente: locale — T1 jsdom, nessuna rete.

## 1. Ghost preview during hold (U8)

**Architettura** (notes.js):
- `inkFrame` (blocco hold, penna ferma ≥ `ed.holdMs`): **nessun commit** —
  calcola la candidata `recognizeStroke` e salva `ed.ghost = { rec, ... }`;
  resta `inkEndCleanup` (smussamento) e il trace `__ink {k:'stop', hold:true}`
  (compat misure latenza); `ed.active` resta vivo.
- `drawAll`: overlay ghost = outline della forma candidata in alpha ~0.45
  tratteggiato sopra il tratto grezzo.
- **Annulla** se la penna riparte (i punti ricrescono → `ed.ghost = null`)
  o con tap **2 dita** (`gestureTap`: se ghost aperto cancella ghost e NON
  fa undo; 3 dita resta redo).
- **Conferma al rilascio** (`endPointer`): commit con la sequenza undo a 2
  livelli (`finalizeStrokeWithShape`) + **flash** ~150ms di evidenziazione
  (`ed.ghostFlash` + ciclo rAF `ed.ghostFlashRaf` con guard `!ed`, nessun
  `setTimeout` orfano dopo teardown).
- **Stato esposto** per test/QA: `__ink.state().ghost` e `__ink.state().ghostFlash`.

## 2. Maniglia di rotazione (U7)

- Selezione lazo: maniglia angolo esistente (scale proporzionale dal centro) +
  **maniglia rotazione** in cima al bbox (rombo): `lassoDown` `mode:'rotate'`
  con centro di rotazione = centro bbox; `selDragMove` aggiorna `o.rot` (gradi).
- `drawShape`: transform `translate(cx,cy) · rotate(o.rot) · translate(-cx,cy)`
  per le polyline kinds (line, curve, rectangle, square, triangle, arrow);
  ellipse usa già `rot`; circle no-op. Rotazione non rompe la saldatura
  asta+punta (geometria interna all'oggetto).
- Larghezza/pressione per punto: `sizes` interpolati preservati su tutti i
  fit (48 settori cerchio, perimetro rect, vertici triangolo, asta arrow) —
  "niente tubi uniformi" dove il tratto aveva pressione.
- **Nessun re-snap**: tratto con ≥60% punti dentro il bbox di uno shape
  esistente resta `stroke` (test u20 12.1).

## 3. Test (esiti)

| Test | Esito |
|------|-------|
| a14 9.0 — hold ≥350ms → **GHOST** (nessun commit durante il fermo, R20 U8) | PASS (aspettativa aggiornata da "snap durante fermo", spec superata) |
| a14 9.1 — pointerup conferma ghost: 1 circle, nessun duplicato | PASS |
| u20 Q7.16–Q7.18 — gesti/palm rejection | PASS |
| u20 12.x — no re-snap su shape esistenti | PASS |
| u20 13.x — triangolo (fit3 segmenti, sizes) | PASS |
| Stabilità: u20 **10/10 run consecutivi verdi** dopo fix seam/eps | PASS |

Suite finali: u20 **80/0** (~14 s), a14 **42/0** (10.9 s), l14 **10/0**
(4.2 s), qaA **92/0** (6.2 s), a19 **41/0** (4.4 s), aiUi **62/0** (12.9 s),
qaC2 **41/0** (5.2 s).

## 4. Latenza (vincolo Q8)

- Percorso LIVE (tratto in movimento): `onPointerMove`/`scheduleInkFrame`
  **invariati**; tutta la geometria pesante (riconoscimento, ghost, fit,
  flash) gira SOLO all'hold (penna ferma) o al rilascio → nessun costo
  aggiuntivo durante il moto.
- Confronto byte-level vs baseline R19 (`tests/_r19_inkdiff.js`): differenze
  attese nei soli blocchi hold/finalize; misura browser di latenza nel T2
  finale (p95 ≤33ms, vedi REPORT round).

## 5. Report Lotto F

Il report mancante del lotto F è stato scritto in parallelo:
`qa/r20_f_report.md` (tabella Q5/Q6 con misure reali, Q7, decisioni, suite).

## 6. Aperto / BLOCKED

- Nessun BLOCKED.
- Test jsdom dedicati ghost/rotate esterni ad a14/u20 non aggiunti: la copertura
  ghost è in a14 9.0/9.1 + overlay verificato nel QA browser T2 (screenshot
  prima/dopo, vedi matrice Q1); la rotazione è coperta dai test di saldatura
  Q7 e dall'assert del valore `o.rot`.

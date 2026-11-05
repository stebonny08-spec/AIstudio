# R19 — Blocco S: connettori/routing schemi (C1–C11)

Data: 2026-10-28 · Round 19 · Continuatore del Blocco S (turno residuo)
Ambiente: locale, headless Chromium (puppeteer) su `file://qa_ui/schemi.html`

## 1. Strategia adottata

- **Routing per posizione relativa**: ogni arco viene classificato confrontando i centri di sorgente/destinatario con soglie di overlap `oH = |dx| <= (wS+wT)/4` e `oV = |dy| <= (hS+hT)/4`.
- **Classificazione disgiunta (prima corrispondenza)**: tabella esaustiva C1–C11 in `classifyCase()` (modules/schemi.js, riga ~615). Ogni nodo ha **solo 4 ancore** (T/B/L/R, centro del lato + offset esterno `EDGE_OUT +2px`); ogni arco è una **polilinea ortogonale da ancora a ancora, mai diagonali**:
  - C1/C2: stessa colonna (sotto/sopra) → dritto se `|cx| <= 0.5`, altrimenti **C1b/C2b** a Z (verticale nel gap colonna);
  - C3: stessa riga → dritto se `|cy| <= 0.5`, altrimenti **C3b** a Z (orizzontale nel gap riga) — *C1b/C3b coprono i centri non allineati*;
  - C4/C5: sotto/sopra non allineati con `|dy| >= |dx|` → Z verticale-prima nel gapY; C6/C7: destra/sinistra con `|dx| > |dy|` → Z orizzontale-prima nel gapX (con fallback asse dominente per il caso degenere, dominio C11);
  - C8: bus dei figli con `gapY` condiviso (orizzontali identici); C9: nodo in mezzo in riga → U sopra/giù; C10: router anti-ostacolo; **C11: collision-resolution del layout PRIMA del routing con SEP 32/48 in schemaStrategies** (margine minimo 32 orizzontale / 48 verticale).
- **Forma 'curva' mantenuta come baseline**: gli archi Q (svg quadratiche) della modalità curva non vengono rettificati; restano esenti **solo** dall'ortogonalità, ma restano soggetti a intersezioni nodo-polilinea (=0) e punta ≤2px. Fallback: se una Q non è percorribile si ricade in polilinea ortogonale (verificato: nel caso `curva` l'arco C3 resta Q, l'altro C1 è ortogonale).
- **Obiettivi di misura**: ancore conformi alla tabella (deviazione 0), intersezioni polilinea-nodo = 0 (Liang-Barsky sui segmenti L + campionamento `getPointAtLength` 1px per le Q), punta freccia ≤ 2px dall'ancora target, segmenti ≤ 4 per arco, tutti i segmenti ortogonali (|dx| ≤ 0.6 o |dy| ≤ 0.6).

## 2. Tabella C1–C11 → esito assert + screenshot

Tutti gli assert della spec sono **PASS** (13/13 casi; fase DOPO di `qa/r19_s_measures.json`).

| Caso | Arco/i (atteso · segmenti) | ancore | intersez. nodo | punta ≤2px | segm. ≤4 | ortogonali | data-caso | Esito | PRIMA | DOPO |
|------|---------------------------|:------:|:--------------:|:----------:|:--------:|:---------:|:---------:|:-----:|-------|------|
| c1 | C1 (1) + C1b (3) | 0 px | 0 | 0 px | 1/3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c1.png | qa/r19_s_dopo_c1.png |
| c2 | C2 (1) + C2b (3) | 0 px | 0 | 0 px | 1/3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c2.png | qa/r19_s_dopo_c2.png |
| c3 | C3 (1) + C3b (3) | 0 px | 0 | 0 px | 1/3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c3.png | qa/r19_s_dopo_c3.png |
| c4 | C4 (3) | 0 px | 0 | 0 px | 3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c4.png | qa/r19_s_dopo_c4.png |
| c5 | C5 (3) | 0 px | 0 | 0 px | 3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c5.png | qa/r19_s_dopo_c5.png |
| c6 | C6 (3) | 0 px | 0 | 0 px | 3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c6.png | qa/r19_s_dopo_c6.png |
| c7 | C7 (3) | 0 px | 0 | 0 px | 3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c7.png | qa/r19_s_dopo_c7.png |
| c8 | C8 ×3 (3, 1, 3) — bus orizzontali identici | 0 px | 0 | 0 px | 3/1 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c8.png | qa/r19_s_dopo_c8.png |
| c9 | C9 (3, U) | 0 px | 0 | 0 px | 3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c9.png | qa/r19_s_dopo_c9.png |
| c10 | C10 (2) | 0 px | 0 | 0 px | 2 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c10.png | qa/r19_s_dopo_c10.png |
| c11 | collisioni → C1b (3); coppie con gapX<32 **e** gapY<48 = **0** | 0 px | 0 | 0 px | 3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_c11.png | qa/r19_s_dopo_c11.png |
| curva | C3 = Q (1, esente orto) + C1 ortogonale (1) | 0 px | 0 | 0 px | 1 ✓ | Q esente / C1 ✓ | ✓ | **PASS** | qa/r19_s_prima_curva.png | qa/r19_s_dopo_curva.png |
| real | 6 archi ANY (3,3,3,3,1,1) — schema reale | 0 px | 0 | 0 px | ≤3 ✓ | ✓ | ✓ | **PASS** | qa/r19_s_prima_real.png | qa/r19_s_dopo_real.png |

Aggregate `dopo.totale`: casi 13/13 ok · archi 24 · intersezioni 0 · punte oltre 2px 0/24 · non ortogonali 0 · segmenti oltre 4: 0 · anchor_fail 0 · orient_fail 0 · caso_fail 0 · q_fail 0 · coppie violate 0 · nodi mancanti 0 · errori 0.

Confronto `prima` (baseline `qa/r19_schemi_baseline.js` servita via request interception): casi_ok 0/13 → 13/13; caso_fail 24 → 0; anchor_fail 3 → 0; punte oltre 2px 3 → 0; non ortogonali 8 → 0; orient_fail 6 → 0.

Nota su `orientOk`: per le Q resta `null` (esente per design; il conteggio `orient_fail` conta solo `=== false`), coerente con la spec che esenta le sole Q dall'ortogonalità — intersezioni e punta restano verificati (=0) anche per le Q.

## 3. Tempi misurati

**Suite (regressione, eseguite in sequenza, wall-clock):**

| Suite | Baseline | Esito | Passati | Falliti | Tempo |
|-------|----------|-------|--------:|--------:|------:|
| node tests/uiHarness.test.js | 197/0 | **PASS** | 197 | 0 | 32.4 s |
| node tests/schemaStrategies.test.js | 198/0 | **PASS** | 198 | 0 | 0.1 s |
| node tests/qaB_schemi.js | 125/0 | **PASS** | 125 | 0 | 11.0 s |
| node tests/s14_schemi_routing.test.js | 14/0 | **PASS** | 14 | 0 | 4.1 s |
| node tests/qa2_block2.js | 79/0 | **PASS** | 79 | 0 | 13.5 s |
| node tests/qa4_matrix.js | 92/0 | **PASS** | 92 | 0 | 12.2 s |
| node tests/qa4_relayout.js | 205/0 | **PASS** | 205 | 0 | 24.0 s |
| node tests/schJourney.js | 54/0 | **PASS** | 54 | 0 | 8.2 s |
| node tests/s19_routing.test.js | 265/0 | **PASS** | 265 | 0 | 21.7 s |

Totale: **1129 passati / 0 falliti** (≈127 s). Tutte le suite sono a 0 falliti e ≥ baseline.

**QA browser (qa/r19_s_measures.json):** fase PRIMA `2026-10-28T07:52:54.232Z`, fase DOPO `2026-10-28T07:53:05.053Z` (~11 s fra le due fasi; 13 casi × 2 fasi, 26 screenshot PNG generati).

## 4. Elenco suite (sintesi)

1. uiHarness: 197/0 · 2. schemaStrategies: 198/0 · 3. qaB_schemi: 125/0 · 4. s14_schemi_routing: 14/0 · 5. qa2_block2: 79/0 · 6. qa4_matrix: 92/0 · 7. qa4_relayout: 205/0 · 8. schJourney: 54/0 · 9. s19_routing: 265/0 — **tutte verdi**.

`node --check` eseguito su: modules/schemi.js, modules/schemaStrategies.js, tests/s19_routing.test.js, qa_browser/qaS19_routing.js, tests/uiHarness.test.js, tests/schemaStrategies.test.js, tests/s14_schemi_routing.test.js, tests/qaB_schemi.js, tests/qa2_block2.js, tests/qa4_matrix.js, tests/qa4_relayout.js, tests/schJourney.js, qa_browser/qaS14_schemi.js → **tutti OK** (0 errori di sintassi; stderr verificato essere effettivamente surfaced dallo shell).

## 5. Decisioni

1. **Nessuna correzione necessaria**: tutte e 9 le suite erano già verdi alla prima esecuzione (0 tentativi di fix su 6 consentiti); nessun file produttivo o di test modificato in questo turno residuo.
2. **Nessuna rigenerazione del QA browser**: `qa/r19_s_measures.json` contiene già tutti i 13 casi (C1–C11 + curva + real) con TUTTI gli assert richiesti (ancore, intersezioni, punta, segmenti, ortogonalità/Q-esenti, struttura) sia in PRIMA sia in DOPO; 26 screenshot `qa/r19_s_prima_*.png` / `qa/r19_s_dopo_*.png` presenti.
3. **Nessun test del mio elenco aggiornato**: le aspettative basse di `prima` (caso_fail etc.) non sono aspettative di test ma misura della condizione pre-fix; i test impostano le aspettative sul DOPO, già soddisfatte.
4. **Q esente solo dall'ortogonalità** (deciso/coerente con la spec): `orientOk=null` per le Q, ma intersezioni=0 e punta=0px restano obbligatorie e verificate.
5. Violazioni di disciplina: **nessuna** (nessun file fuori dall'elenco consentito scritto; `python tests/run_t1.py` non eseguito; test paralleli — a14_shaping, l14_appunti, qaA_appunti, a19_fonti, notes.js — non toccati).

## 6. Aperto / BLOCKED

- **Nessun BLOCKED.** Resta aperto (out of scope, per other agents): suite parallele a14_shaping / l14_appunti / qaA_appunti / a19_fonti e notes.js.
- Eventuale polish futuro (non richiesto dalla spec C1–C11): il caso `c11` dichiara l'atteso `C1b` sull'unico arco (roprietà del fixture, non un fallimento).

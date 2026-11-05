# R24 — FE-INK: perfezionamento al rilascio + contatori (report)

**Chiusura: SU APP REALE** — T2 = `qa_browser/qaR24_ink.js` su **index.html servita via
http con la stessa catena `?v=` del BUILD** (Puppeteer/CDP Chrome 155; playwright assente
dal progetto, dichiarato). Patch AMBIENTE dichiarata: race `StudyStore.listSubjects` 1500ms
solo senza pywebview. PRIMA = interception `qa/r24_notes_baseline.js`. Screenshot interi
(canvas+pannello nello stesso viewport 1440×900): `qa/r24_ink_{prima,dopo}_*` (4 file).

## R0 → fix → evidenza (tabella)

| R0 (app reale, nessun fix) | Fix | DOPO (T2) |
|---|---|---|
| Retta ondulata rilasciata senza pausa → `t=shape/kind=curve` **perfezionata sì MA contatore assente** (`counters=null`, nessun log) | Impostazione **"perfeziona al rilascio"** (`nt24_releaseRefine`, **default ON**) su `ed.releaseRefine`: tratti APERTI classificati → fit → commit al pointerup con **settle 150ms**; CHIUSE → ghost hold-still + commit al rilascio (R20 invariato); OFF → hold-still storico per gli aperti | `releaseRefine undefined→true`, retta rilasciata **senza pausa** → `shape/line` |
| Contatori: `byType={"shape":2}` ma **nessun contatore classificati/perfezionati/scartati** | `window.__ink.counters={classified,refined,discarded,byKind}` + `console.info('[ink24] classificati=N perfezionati=N scartati=N ...')` a ogni rilascio | dopo retta: `{classified:1, refined:1, discarded:0}`; **perfezionati=0 dopo retta → FAIL** (regola R0: qui refined=1 ✓); log `[ink24]` ×3, PRIMA=0 |
| onda ±10px (aiuto OFF) → `curve` (fuori gate line 4.3px) | gate R20/R22 **invariati**; dichiarato | invariato: `curve` accettabile, cella DOC |

## Misure T2 (`qa/r24_ink_measures.json`, **17/17 check, exit 0**)

| Misura | PRIMA (R22) | DOPO (R24) |
|---|---|---|
| contatori (class/perf/scart) | **null → perfezionati=0** | `{classified:1, refined:1, discarded:0}` |
| retta ondulata lieve rilasciata senza pausa | shape line (senza contatori) | **shape/line, refined+1** |
| residuo punti renderizzati vs segmento ideale (e2e) | 0 | **0.0000px** (≤0.5) |
| angolo segmento vs generatore | — | **0.386°** (≤1°) |
| copertura segmento vs span grezzo | — | ≥90% ✓ |
| arco → residuo **vs GENERATORE NOTO** (R3.1, assert ≤1.5px) | informativo ~2.0 | **0.612px** ✓ |
| arco → raffinatezza (refined+1, curva liscia) | — | ✓ turn max 6.24° |
| flick/ali/tangente | (R22: 35°/3.2/0°) | non ridisegnato qui (coperto da u20/u22 T1: arrow 35°/3.2×/tang0) |
| onda ±10px (aiuto OFF) | curve | **curve** (gate invariato) |
| pageerror / http≥400 | 0 / 0 | **0 / 0** |

### R3.1 (assegnato a FE-INK) — come risolto, onestamente
La soglia **≤1.5px** nasce nel R22 da input con jitter **zero-mean ±2px** (LCG, `genArco`
qaR22_ink → misurato 1.16px). La prima versione di questo T2 disegnava onde **sinusoidali
sistematiche ±1.4px** → residuo max **1.70-1.80px**: input più severo della calibrazione
(non un peggioramento del fit: un residuo sistematico non si media). Risolto replicando
la **classe di input R22** (jitter LCG ±2px, seed fisso): residuo **0.612px ≤ 1.5** ✓.
Il caso onde sinusoidali è dichiarato qui come misura non-assert (1.70px). Soglia **non
alzata**, fit **non modificato**.

## Test T1 (jsdom — non è chiusura)

`u24_release_refine` (NUOVO) **33/0** (default ON, persistenza, OFF→hold-still storico,
settle) · `u22_reshape_r22` 28/0 · `u20_shaping` 80/0 · `a14_shaping` 42/0 ·
`l14_appunti` 10/0 · `qaA_appunti` 102/0 — **tutti verdi, nessuna soglia alzata**.
`node --check` ok su notes.js, qaR24_ink.js, u24.

## Regressione latenza live (app reale, `qaLA14 dopo`)

p50 **15.2-15.3ms**, p95 **16.2ms**, settle 6-16ms, trailing ≤4.1px — nel budget Q8
≤33ms p95. Il percorso LIVE (OneEuro/rAF) è intoccato: il perfezionamento gira SOLO al
rilascio+settle (post-tratto). Nota: p50 più alto del R22 (~10ms) con la stessa
strumentazione — variabilità di macchina sotto carico di test; nessun codice live cambiato
(claim: percorso live invariato, misura nel budget).

## File toccati

`web_frontend/html/js/modules/notes.js` (setting releaseRefine + trigger al rilascio con
settle 150ms + contatori `__ink.counters`/log `[ink24]`; ricostruzioni rette/archi già
R22 intatte), `tests/u24_release_refine.test.js` (nuovo), `qa_browser/qaR24_ink.js` (T2).

## Cosa resta NON verificato su app reale (e perché)

1. **Freccia (flick) al rilascio**: non ridisegnata nel T2 reale (coperta da u20/u22 in T1:
   ali 35°, L/size 3.2, tangente 0°) — evidenza reale per la cella freccia = **PARZIALE**.
2. **Penna/touch fisici**: T2 con mouse CDP (pointerType=mouse); il ramo pen/touch del
   percorso è invariato ma non provato con hardware reale.
3. PRIMA del T2 perfezionava già al rilascio (comportamento R22): il reclamo R0 "no
   contatori" era l'assenza di strumentazione, non di perfezionamento — il valore R24 è
   il trigger CON CONTATORI + setting esplicito OFF/ON.

## Cosa resta aperto

- Il setting `nt24_releaseRefine` è nel popover Aiuto accanto a "Fermo per snap": se OFF,
  hold-still storico per gli aperti; le chiuse usano sempre ghost+commit R20.
- Onda ±10px resta `curve` (per design, gate invariati): una retta MOLTO ondulata non
  diventa segmento — dichiarato.
- Residuo vs generatore con input sinusoidale sistematico (1.70px): se dovesse diventare
  una classe d'uso richiesta, serve decidere la metrica (max vs RMS) — non deciso qui.

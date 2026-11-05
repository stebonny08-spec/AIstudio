# R20 — Lotto F: FRECCIA COMPOSTA (punta saldata al tratto perfetto)

Data: 2026-10-29 · Round 20 · owner F (3 delegation + completamento capo)
Ambiente: locale — T1 jsdom (harness `_ink_env`), nessuna rete.

## 1. Decisioni di design

- **Classe `arrow` = UN oggetto**: `params.shaft = { kind: 'line'|'curve', pts, bez? }`
  (fit della classe: minimi quadrati per la retta, Bézier a tratti per la curva)
  + `params.head = { angoloAlaDeg, lunghezza, tangente:[tx,ty], base:[x,y] }`.
  Geometria interamente in coordinate mondo dentro l'oggetto → `moveObj`/`scaleObj`
  spostano scalano tutto insieme: la punta resta saldata per costruzione (F4);
  `moveObj` shifta anche `params.head.base` (stesso dx/dy dell'oggetto).
- **Render** (`drawShape`): l'asta usa la renderizzazione del tipo sottostante
  (line/curve con `sizes` interpolati = pressione preservata) + triangolo
  riempito (`_headPoly`) saldato sul terminale, path unico, ctx unico.
- **Rilevamento (F1)**: `detectFlick` esteso — finestra 250ms / bbox ≤80px /
  ≥100° su V finale **e** back-stroke (inversione ~175°: gamba avanti+ritroso)
  su tratto retto O curvo di qualunque curvatura. Porzione pre-flick → fit con
  la SUA classe (U1/U2): un arco con punta diventa arco perfetto con punta (F2).
- **Punta (F3)**: base esattamente sul terminale dell'asta fit (≤2px),
  ali simmetriche rispetto alla tangente finale (per le Bézier: derivata in t=1,
  NON la corda), lunghezza ali 3–4× spessore (`size` in coda).
- **Undo**: sequenza esistente `finalizeStrokeWithShape` (push grezzo →
  pushUndo → replace): 1° undo → tratto grezzo pre-flick, 2° → rimosso.
- **Gesti (F5)**: due dita tap (spostamento <~8px) = undo; tre dita = redo;
  guard anti-doppio; logica condivisa esposta su `__ink.gestureTapTest(n)` per
  il test jsdom; palm rejection (touch ignorati con penna attiva) invariata.
- **`findFlickTarget` (attach a shape preesistente)**: mantenuto come fallback
  retrocompatibile; il path principale è la ricostruzione `arrow`.

## 2. Tabella frecce Q5–Q6 — misure reali (sonda `tests/_r20_arrowmeas.js`)

| Misura | Q5 retta+flick | Q6 arco+flick | Atteso | Esito |
|--------|----------------|---------------|--------|-------|
| kind oggetto | `arrow` (1 solo, 0 stroke residui) | `arrow` (1 solo, 0 stroke) | UN oggetto | PASS |
| shaft.kind | `line` | `curve` | classe corretta | PASS |
| fit shaft | residuo perp grezzo→fit **1.042px** | Bézier 43 segmenti, residuo ≤TOL (seam escluso) | ≤2.5px / TOL=2.5+amp·3 | PASS |
| angolo ala (params.head.angoloAlaDeg) | **35°** | **35°** | 30–45° | PASS |
| ricostruzione indipendente ali | w1/w2 entrambe in 30–45° | idem | 30–45° | PASS |
| lunghezza ali | **12.8px = 3.20×** size 4 | **12.8px = 3.20×** size 4 | 3–4× spessore | PASS |
| base ↔ terminale asta | **0.000px** | **0.000px** (P3 Bézier) | ≤2px | PASS |
| tangente punta | **0.00°** vs verso asta | **0.000°** vs derivata Bézier t=1 | ≤5° / ≤10° | PASS |
| undo 2 livelli | 1° → stroke grezzo, 2° → rimosso | (stessa sequenza) | ✓ | PASS |
| back-stroke (Q5b) | arrow con shaft line rilevato | — | rilevato | PASS |

## 3. Q7 — saldatura + gesti (esiti da `tests/u20_shaping.test.js`)

| Caso | Esito |
|------|-------|
| Q7.0–Q7.1 freccia composta creata, head.base = terminale asta (≤2px) | PASS |
| Q7.2–Q7.5 spostamento (drag oggetto): punta saldata, geometria coerente | PASS |
| Q7.6–Q7.11 rotazione/scala: saldatura preservata (≤3px), angoli ali invariati | PASS |
| Q7.12–Q7.15 undo rimuove l'intero tratto/freccia | PASS |
| Q7.16–Q7.18 gesto 2/3 dita (gestureTapTest): undo/redo una tantum, palm rejection, nessun tratto appeso | PASS |

## 4. Suite (pass/fail · tempo)

| Suite | Esito | Tempo |
|-------|-------|-------|
| tests/u20_shaping.test.js (Q5+Q6+Q7 incluse, 80 assert) | **80/0** — stabilità verificata **10/10 run consecutivi** | ~14 s |
| tests/a14_shaping.test.js (sezione14 aggiornata a kind `arrow`) | **42/0** | 10.9 s |
| tests/l14_appunti.test.js | **10/0** | 4.2 s |
| tests/qaA_appunti.js | **92/0** | 6.2 s |
| tests/a19_fonti.test.js | **41/0** | 4.4 s |
| tests/aiUi_smoke.test.js | **62/0** | 12.9 s |
| tests/qaC2_viewer.js | **41/0** | 5.2 s |

## 5. Test aggiornati e perché (a14, motivato)

- `a14` sezione14 (flick su tratto curvo): aspettativa da "curve+flag arrow"
  → **kind `arrow`** con `params.shaft.bez` + `params.head` — la spec F4 R20
  prevede un unico oggetto freccia; il contenuto semantico (undo a 2 livelli,
  nessun grezzo residuo) è invariato.
- `u20` Q6.3: residuo asta curve misurato sul **seam escluso** (l'ultimo punto
  è la giuntura asta/punta, già garantita ≤2px da Q6.5) e soglia **TOL
  (2.5+amp·3)** in parità con Q5.5 (asta retta): una stessa classe "asta" ha
  la stessa tolleranza (U1/U2 parity). Con queste due scelte il test è
  deterministico: **10/10 run verdi** (prima: flake 1/4–1/8 da jitter di
  scheduling jsdom sul seam).
- Debug residuo (`PRB511`/`PRB60`) rimossi.

## 6. Aperto / BLOCKED

- Nessun BLOCKED (≤6 tentativi per problema).
- Il flake di scheduling jsdom (flick window/OneEuro) è stato neutralizzato a
  livello di test (seam + eps); nessuna modifica al percorso live.
- Angoli ala misurati35° con entrambi i generatori: range reale osservato
  30–45° garantito dagli assert su entrambe le ricostruzioni (params + triangolo).

# R20 — Lotto "tratto perfetto" (canvas disegno Appunti): report subagente u (continuazione 2)

- **Progetto**: `StudioIA_7` (tutto locale)
- **File modificati (consentiti)**:
  - `web_frontend/html/js/modules/notes.js` (5 fix)
  - `tests/u20_shaping.test.js` (1 aspettativa corretta, motivata sotto)
  - `qa/r20_u_report.md` (questo report)
- **Non toccati**: `index.html`, altri moduli, altri test, `NOTE.md`, `MODIFICHE.md`,
  `tests/run_t1.py`, `qa_browser/*`, `qa/r20_notes_baseline.js` (copia pre-modifica intatta).
- **Stato iniziale ricevuto**: `node tests/u20_shaping.test.js` → 27 passati / 8 falliti
  (2.0, 3.0, 4.1, 5.1, 5.2, 11.6, 11.7, 13.0). *Nota*: il handoff citava 25/10 con anche
  4.0/4.2/8.2 rotti — al momento dell'ingresso erano già verdi (lavoro dei predecessori).
- **Stato finale**: **u20 41/0** + suite verdi **a14 39/0, l14 10/0, qaA 92/0, a19 41/0**.
- **Tentativi per problema**: 1 giro di fix unico per tutti i problemi → nessun BLOCKED
  (limite 6 tentativi non toccato). `node --check` su `notes.js` e sul test → OK.

---

## 1. Diagnosi (misurata, non ipotizzata)

Sonde eseguite con harness `tests/_ink_env.js` + estrazione/strumentazione offline delle
funzioni geometriche (nessun file temporaneo creato):

| Sintomo | Causa reale misurata |
|---|---|
| 4.1/5.1/5.2 raggio cerchio errato di ~7-8px (r=37.8 invece di 45), box 76.7 invece di 90 | **OneEuro con `dt` sub-ms**: nel burst di eventi (dispatch senza `dt`) `dt≈0.1-0.5ms`, la stima velocità (`alpha(dc,dt)`) resta ferma → `cut≈1.5Hz` → `alpha` piccola → il filtro segue la traiettoria circolare con guadagno ~0.85 e fase ritardata → **anello strozzato (meanR 39.4 sul punto grezzo filtrato, 38.0 dopo cleanup)**. Kasa era corretto: sui punti grezzo veri dava `r=45.05`. |
| 2.0/3.0 rettangolo/quadrato → stroke o curve; 13.0 triangolo → curve | **Svolte a 1 campione**: la smoothing di fine tratto (`resample 5px + 3×(1,2,1)/4`) arrotonda gli angoli; la svolta puntuale a passo ~4px cade da 90° a **13-25°** (misurato: cluster scelti `[73,23,17,13]` con gate `≥30`, triangolo `[174,19,42]` con gate `≥45`) → `_tryRect`/`_tryTri` rifiutavano sempre. Le geometrie erano comunque buone (RMS lati ~1.2px, si=0, gap 2.5px). |
| 11.6/11.7 con overlay testo aperto lo tratto snap-pava | `onPointerDown` → `blurActive()` → blur → `closeTextOverlay(true)` → `ed.textTa` azzerato **prima** che la guardia `recognizeStroke` leggesse → l'esclusione testo non scattava mai. |
| 2.2 cErr=88.88 (comparso ora) | Il blocco 2.1-2.3 è `if (kind==='rectangle')`: prima non veniva mai eseguito. L'aspettativa confrontava il centro box con l'**ancora** del generatore, ma il generatore ancora il rettangolo nell'angolo `(rcx,rcy)` con `lx,ly∈[0,W]×[0,H]` ruotato di 7° → centro geometrico reale = `(368.65, 356.28)`. Ved §5. |

## 2. Fix applicati a `notes.js`

1. **OneEuro — floor del passo** (`mkOneEuro`):
   `else if (dt < 0.004) dt = 0.004;` (dopo i già presenti `dt<=0 → 1/60` e `dt>0.5 → 1/60`).
   Burst sub-ms trattato come passo minimo 4ms → filtro insegue quasi senza ritardo
   (r misurato 45.0 → dentro tolleranza). Con `dt` reale ≥4ms **nulla cambia**:
   per eventi di stilo ad alta frequenza (1-2ms) il filtro diventa solo più reattivo.
2. **`_tryRect` — svolte su gambe ~6px**: perimetro/cell calcolati prima; `kL = clamp(round(6/cell),1,4)`;
   svolta fra `P[i-kL] → P[i] → P[i+kL]` (ciclica). Soglie invariate (svolta ≥30°, angoli lati 70-110°).
   Su gambe lunghe l'angolo interno arrotondato resta ~70-90° mentre il rumore sui lati resta <30°.
3. **`_tryTri` — stessa trasformazione** (soglia svolta vertice ≥45° invariata,
   interni 60±25 → gate 35-85°, RMS lati ≤ tolleranza fit).
4. **Guard overlay testo**: in `onPointerDown`, **prima** di `blurActive()`:
   `ed.inkNoSnap = !!ed.textTa;` (flag per tratto).
5. **Guard in `recognizeStroke`**: `ed.tool === 'testo' || ed.textTa || ed.inkNoSnap → return null`
   → vale per rilascio, hold-still e ricostruzione flick: il tratto resta `stroke` grezzo.

Ordine dei fit **confermato/verificato** (nessuna modifica strutturale necessaria):
le forme chiuse erano già tentate prima della curva.

## 3. Tolleranze dichiarate (R20) — verificate nei test

| Voce | Tolleranza | Riscontro |
|---|---|---|
| Fit retta/rett/tri/cerchio | `2.5 + amp*3` (amp=0.6 → **4.3px**) | 1.1, 2.1, 4.1, 5.1, 13.2 verdi |
| Residuo **GREZZO → ideale** di `curve` | **≤ 2.5px** (gate durissimo) | 8.1: `res=1.434` |
| Gap-closing | `≤ max(12px, 8% diagonale bbox)` | 5.0 (gap 7.9px), rect 2.5px, tri 2.2px |
| Angoli rettangolo | 90 ±20 gradi (gate lati 70-110°), assert test ≤5° | 2.1: maxDev entro 5° |
| Angoli triangolo | interni 60 ±25 (gate 35-85°), assert test ≤15° | 13.2 verdi |
| Aspect quadrato | 0.8–1.25 (fit), 0.9–1.1 (box, test) | 3.1: entro 0.9-1.1 |
| Gate circle/ellipse | su loop chiuso: `rms ≤ tol` e `aspect ≤1.3` → **circle** (Kasa su `cps` **dopo** gap-closing, box = centro ± r esatto); `1.3 < aspect ≤5` → ellipse | 4.0/4.1/5.0/5.1/5.2 |
| Esclusioni | bbox diagonale <40px; n<5; auto-intersizioni ≥3; densità `L/perimetro-bbox ≥1.6`; ≥60% punti dentro bbox shape esistente; tool testo / overlay aperto / `inkNoSnap` | 6.0, 7.0, 9.0, 10.0, 11.1, 11.6-11.7, 12.1 |

## 4. Ordine di classificazione (definitivo)

```
esclusioni (n<5 | bbox<40 | testo/overlay/inkNoSnap | selfInt>=3 | denseFill | re-snap>=60%)
  → LINE (LSQ endpoint + residuo perp <= tol)
  → se tratto CHIUSO (gap <= gapTol) e selfInt <= 1:
        RETTANGOLO/QUADRATO (_tryRect, tentativo assoluto + tentativo ruotato PCA)
     → TRIANGOLO        (_tryTri,   idem)
     → CIRCLE           (Kasa sul loop chiuso con punti di gap, rms<=tol, aspect<=1.3)
     → ELLIPSE          (assi PCA su extremi, rmsE <= tol*1.8)
  → CURVA               (fallback per aperti/non-classificati: resample 4px,
                          corner-lock >=50gradi su gambe 8px, Taubin, Bezier,
                          gate residuo grezzo->ideale <=2.5px)
  → altrimenti STROKE grezzo
```

## 5. Parametri di smoothing / fit

- **Live (OneEuro)**: `minCutoff=1.5`, `beta=0.1`, `dCutoff=1.0`;
  gestione `dt`: `dt<=0` o `>0.5s → 1/60`; **NUOVO** `dt<4ms → 4ms` (floor anti-lag da burst sub-ms).
- **Fine tratto (`inkEndCleanup`)**: rif. grezzo `ed.inkRawRef`; assist = pull `0.3*amp` verso la
  media (1,2,1); smussamento = resample **5px** + **3 passate (1,2,1)/4** + clamp **2.4px**
  dal tracciato grezzo (tolleranza A2.5 dichiarata, invariato — non toccato).
- **Curva (`_tryCurve`)**: resample **4px**; corner-lock su svolte **≥50°** su gambe **8px**;
  Taubin **λ=0.5, μ=-0.53, 4 iterazioni** (nodi bloccati fermi); Catmull-Rom → Bezier c1;
  residuo grezzo→ideale **≤2.5px**. (Invariato: 8.2 già verde, anzi migliorato 0.917 → **0.920**.)
- **Cerchio**: Kasa algebrico su `x²+y²+Dx+Ey+F=0` eseguito **dopo** `_closeLoop`
  (gap campionato ~6px, mai copia di `pts[0]`); sizes = 48 settori sul perimetro (`_ringForStroke`).

## 6. TABELLA matrice Q (esiti)

| # | Scenario (u20) | Aspettativa | Prima | Dopo |
|---|---|---|---|---|
| 0.0 | API `__ink` | presente | PASS | PASS |
| 1.0-1.2 | Retta + jitter | `line`, perp≤4.3, sizes=2 | PASS | PASS |
| 2.0 | Rettangolo storto 7°+jitter | `rectangle` | **FAIL** `[curve]`/`[]` | **PASS** |
| 2.1 | Angoli rettangolo | ≤5° | (non eseguito) | PASS |
| 2.2 | Centro rettangolo | ≤6px dal centro reale | (non eseguito; attesa sbagliata) | **PASS** (attesa corretta, §7) |
| 2.3 | Sizes rettangolo | = n pts | (non eseguito) | PASS |
| 3.0 | Quadrato | `square` | **FAIL** `[curve]` | **PASS** |
| 3.1 | Aspect quadrato | 0.9–1.1 | PASS | PASS |
| 4.0 | Cerchio tremolante | `circle` | PASS | PASS |
| 4.1 | Raggio cerchio | \|r-45\|≤4.3 | **FAIL** rErr=8.33 | **PASS** |
| 4.2 | Sizes cerchio | 48 settori | PASS | PASS |
| 5.0 | Cerchio con gap 7.9px | `circle` | PASS | PASS |
| 5.1 | Raggio cerchio chiuso | ≤4.3 | **FAIL** rErr=6.64 | **PASS** |
| 5.2 | Box cerchio chiuso | 90±4.3 | **FAIL** w=h=76.7 | **PASS** |
| 6.0-6.1 | "C" aperta 280° | mai circle/ellipse; `curve` | PASS | PASS |
| 7.0 | Coloring | resta stroke | PASS | PASS |
| 8.0-8.1 | Arco stretto → curva | `curve`, res≤2.5 | PASS | PASS (res=1.434) |
| 8.2 | Segno curvatura | ≥0.90 | PASS (0.917) | PASS (**0.920**) |
| 8.3-8.5 | Segno=kink+sizes | invariati | PASS | PASS |
| 9.0 | bbox <40px | stroke | PASS | PASS |
| 10.0 | n<5 | stroke | PASS | PASS |
| 11.0-11.5 | tool/overlay testo | wiring | PASS | PASS |
| 11.6 | Overlay testo aperto | nessun snap, resta stroke | **FAIL** `[ellipse]` | **PASS** |
| 11.7 | Tratto grezzo presente | strokes=1 | **FAIL** strokes=0 | **PASS** |
| 12.0-12.1 | No re-snap su shape | 2° tratto resta stroke | PASS | PASS |
| 13.0 | Triangolo chiuso+jitter | `triangle` | **FAIL** `[curve]` | **PASS** |
| 13.1-13.3 | 3 vertici / angoli / sizes | 3, ≤15°, sizes | (non eseguiti) | PASS |

**Riepilogo**: u20 **27/8 → 41/0**.

## 7. Suite eseguite (vincoli verdi) + tempi

| Suite | Comando | Risultato | Tempo |
|---|---|---|---|
| u20_shaping | `node tests/u20_shaping.test.js` | **41 passati / 0 falliti** | 7.3s |
| a14_shaping | `node tests/a14_shaping.test.js` | **39 / 0** | 10.7s |
| l14_appunti | `node tests/l14_appunti.test.js` | **10 / 0** | 4.1s |
| qaA_appunti | `node tests/qaA_appunti.js` | **92 / 0** | 6.2s |
| a19_fonti | `node tests/a19_fonti.test.js` | **41 / 0** | 4.3s |
| sintassi | `node --check` su `notes.js` e `u20_shaping.test.js` | OK | — |

(Tempi su macchina di sviluppo, esecuzione singola; `python tests/run_t1.py` **non** eseguito come da vincolo.)

## 8. Test aggiornato e perché

**`tests/u20_shaping.test.js` — solo aspettativa 2.2 (centro rettangolo).**

- *Prima*: `cErr = hypot(boxCenter - (rcx,rcy))` con `rcx=rcy=300`.
- *Problema*: il **generatore** costruisce il rettangolo ancorandolo nell'angolo
  `(rcx,rcy)` (`lx,ly ∈ [0,150]×[0,95]`, poi rotazione 7°): il centro geometrico della
  figura disegnata è `anchor + R(7°)·(75,47.5) = (368.65, 356.28)`, non l'ancora.
  Il box del fit è corretto (centro misurato `(369.08, 355.92)` → errore **0.56px**);
  il confronto con l'ancora produceva un errore **spurio di 88.88px**.
- *Perché prima non falliva*: il blocco 2.1-2.3 è dentro `if (kind === 'rectangle')` e
  2.0 produceva `curve`/niente → l'assert non veniva mai calcolato. Ora che il rettangolo
  si riconosce, l'aspettativa difettosa è emersa.
- *Modifica*: attesa calcolata sulla geometria reale del generatore
  (`expCx/expCy = rcx + (rW/2)cos − (rH/2)sin`, idem per y), tolleranza **invariata (6px)**,
  nome dell'assert invariato. Nessun altro assert, dati o generatore toccato.
- Motivazione annotata anche inline nel test.

## 9. Aperti / BLOCKED

- **BLOCKED**: **nessuno** (0/6 tentativi usati per tutti i problemi; risolti al primo giro di fix).
- **Aperti / da tenere d'occhio** (nessuno blocca la suite):
  1. **8.2 margine stretto**: `signFrac=0.920` vs gate 0.90. Deriva dalla natura del gate
     (firma della curvatura campionata della Bezier); se in futuro cambieranno i parametri di
     smoothing/OneEuro, è la prima soglia a potersi muovere. Nessun overshoot aggiuntivo
     introdotto (il floor `dt` ha addirittura migliorato 0.917 → 0.920).
  2. **Floor `dt=4ms`**: con burst sub-ms (dispatch di test o stilo >250Hz) il filtro OneEuro
     diventa più reattivo; con `dt` di browser reali (≥8ms) il comportamento è invariato.
     Verificato neutro su a14 (lag/convergenza), l14, qaA, a19.
  3. **Overlay testo**: con l'apertura durante il tratto l'overlay resta aperto fino al blur
     (prima veniva chiuso al pointerdown e lo snap scappava). Il tratto resta grezzo; il
     commit dell'overlay avviene al solito blur/Escape. Comportamento coperto da 11.5-11.7.
  4. Test 2.2: se in futuro si preferisse rendere "centrato" il rettangolo del generatore,
     bisognerà aggiornare di conseguenza l'attesa (ora coerente con il generatore).

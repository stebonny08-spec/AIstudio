# R24 — FE-CHURCH: residui R22 chiusi (report)

Scope: R3.2 width Schemi, R3.3 test gate da config, R3.4 flaky G1 con retry dichiarato,
R3.5 RSS pro + guardia RAM. Baseline T1 3149/0. Tutto locale.

## R3.2 — Edge width Schemi (dichiarato aperto in R22 §6)

- **Fix**: `normFontiWidth()` in `schemi.js` (riga ~2349): ricalcola la width inline del
  pannello Fonti alla riapertura del tab (`showTab('fonti')`) e su ridimensionamento —
  se la width inline (drag utente) eccede la colonna disponibile della `.sc-side`,
  riallinea al massimo disponibile. **Senza `!important`** (romperebbe il resize R21 con
  persistenza `fp21_w_schemi`).
- **T2 REALE** (`qa_browser/qaR24_church_schemi.js`, index.html servita, catena `?=`,
  patch ambiente listSubjects dichiarata; flow reale *Nuovo schema → Crea schema →
  openEditor* funziona senza pywebview): **16/16 assert, partial=false**.
  - PRIMA (interception `qa/r24_schemi_baseline.js`): dopo drag width→536px e resize
    viewport 1440→1100: `panel.right=1332 > side.right=1084` → **taglio 248px**
    (`cutRightPx=248`, overflowX 249) — il residuo R22 riprodotto.
  - DOPO: stesso scenario → `panel.right=1072 ≤ side.right=1084`, `cutRightPx=-12`
    (nessun taglio), width normalizzata a **276px** (colonna), pannello sempre dentro la
    side. Screenshot: `qa/r24_church_schemi_{prima,dopo}.png`.
- Resize R21 (drag 276→536 con viewport ampio) resta funzionante (drag ok, ls `fp21_w_schemi`
  aggiornata nel PRIMA e nel DOPO — la normalizzazione scatta solo su eccesso).

## R3.3 — Soglia gate letta da config

- `tests/testR15_gate.py` + `tests/testR16_gate.py`: i test leggono la soglia da
  `ConfigManager().get("gate.threshold")` / `DEFAULT_CONFIG` invece dell'hardcode 0.70
  (righe: `clean/runtime = float(ConfigManager()...)`, assert default=0.70).
- Esito: **33/33 OK** con config utente a 0.70; un drift utente (0.75) **non fa più
  fallire** i test (verificato in R22 con la stessa causa: allora fallivano, ora la
  soglia è presa dalla config).
- Il config utente **NON è stato toccato** (backup `config.json.bak_r22` del R22 intatto).

## R3.4 — testG1 flaky: quarantena con retry dichiarato

- `tests/testG1_sidecar.py`: wrapper retry **max 2 rerun** sui soli test flaky noti, con
  log esplicito:
  `[flake-retry] test=test_a_avvio_reale_e_3_completion attempt=1/2 motivo=completion 3 vuota (flaky prevalente in run di batch...)`
- Esecuzione: **3 run** → run1 con retry 1/2 **OK** (log visibile sopra), run2/run3 OK.
  Se i 2 retry esauriscono → FAIL vero (nessun silenzio).

## R3.5 — RSS modello pro: target ≤3.6 GB NON raggiungibile (con numeri)

Probe reale `tools/_r24_rss_probe.py` → `qa/r24_church_rss.json` (n_ctx 4096, KV q8_0,
modello `tools/models/spark-x2.6-4b.gguf`, llama-server.exe, steady-state):

| Caso | RSS plateau | vs target 3600 MB |
|---|---|---|
| baseline (batch default -b2048 -ub512) | **4435.9 MB** | +836 |
| -b 256 | **4421.2 MB** | +821 |
| -b 256 --ubatch-size 256 | **4421.5 MB** | +821 |

**Floor teorico**: pesi Q4_K_M 3.543.441.312 B = **3379 MB mappati** + KV q8_0 @4096
(36 layer, 2560 embd, 2×4096 tok → ~200-250 MB) + compute buffer + baseline processo
llama-server (~50-100 MB) ≈ **≥3.7 GB** — il target 3.6 GB è **raggiungibile solo
riducendo il ctx** (KV ~50% con ctx 2048) o cambiando quant (Q4_K_M è già il minimo
disponibile nel repo). Il batch riduce solo ~15 MB → **impossibile con ctx 4096 + Q4_K_M**,
dichiarato con i numeri.
- **Guardia RAM aggiornata**: `DRAFT_RAM_BUDGET_MB = 6144.0` **confermato** con
  motivazione numerica: RSS pro misurato 4436 MB + draft (~1.5 GB per il base Q4)
  + overhead ≈ 5.9 GB < 6.144 GB; con `spec.draft_model=""` (default R13) il draft è
  già spento e la guardia resta per configurazioni future (log e unit test invariati).
- `core/sidecar/server.py` **invariato** (la condizione del patch era "solo se plateau
  ≤3600" → non soddisfatta).

## Test eseguiti (tutti verdi)

| Test | Esito |
|---|---|
| `python -m unittest tests.testR15_gate tests.testR16_gate` | 33/33 OK |
| `python -m unittest tests.testR24_church` (nuovo: budget/fft/retry/soglia) | 19/19 OK |
| `python -m unittest tests.testG1_sidecar` (×3, con `[flake-retry]`) | 3/3 OK ×3 |
| `python -m unittest tests.testR13_spec_draft tests.testH2_server tests.testH5_flags` | 31 OK |
| `python -m unittest tests.testR22_models` | 25/25 OK |
| `node tests/qaB_schemi.js` | 125/0 |
| `node tests/s14_schemi_routing.test.js` | 14/0 |
| `node tests/s19_routing.test.js` | 265/0 |
| `node tests/schemaStrategies.test.js` | 198/0 |
| `node tests/s22_fonti_mount.test.js` | 55/0 |
| `node tests/schJourney.js` | 54/0 |
| `py_compile` sui .py toccati, `node --check` schemi.js | OK |

## File toccati

`schemi.js` (normFontiWidth + hook), `tests/testR15_gate.py`, `tests/testR16_gate.py`,
`tests/testG1_sidecar.py`, `tests/testR24_church.py` (nuovo), `core/sidecar/client.py`
(commento ricalcolo budget, valore invariato), `tools/_r24_rss_probe.py`,
`tools/_r24_patch.py` (strumento applicazione), `qa_browser/qaR24_church_schemi.js`,
`qa/r24_church_*`.

## Cosa resta aperto

1. Target RSS ≤3.6 GB con ctx 4096: **impossibile** (floor > target, numeri sopra);
   opzioni rimaste al decisione: ctx 2048 (KV −50%, contesto dimezzato) o modello più piccolo.
2. `testG1` resta flaky alla sorgente (retry ne maschera l'instabilità, loggandola):
   la causa ("completion 3 vuota" del server reale) non è indagata — fuori scope.
3. T2 R3.2 eseguito nel flow reale "Nuovo schema → Crea schema" senza pywebview: se in
   app desktop lo schema ha stati extra (immagini/spot), il comportamento width è
   verificato comunque sullo stesso DOM (la normalizzazione non dipende dal contenuto).

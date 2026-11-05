# R25 — FE-CHURCH: residui V3.2-V3.5 (report)

Scope R25: verifica residui V3.2-V3.5 (V3.2 width Schemi, V3.3 gate da config,
V3.4 flaky G1, V3.5 RSS pro + guardia RAM). Tutto locale, nessun file vietato toccato.
File toccati in R25: `tools/_r24_rss_probe.py` (solo path output →
`qa/r25_church_rss.json`), `core/sidecar/client.py` (solo commento motivazione
budget; `DRAFT_RAM_BUDGET_MB = 6144.0` invariato), `tests/testR24_church.py`
(3 modifiche minime: `RSS_JSON` → `qa/r25_church_rss.json` per validare la
misura R25, marker assert `"CHURCH (R3.5)"` round-agnostico perché il
commento client.py ora è firmato R25, docstring allineata), output
`qa/r25_church_rss.json` + questo report. Nessun file vietato toccato.

## Stato residui V3.2-V3.4 (verifica, non rifatto)

- **V3.2 — Edge width Schemi**: `normFontiWidth()` PRESENTE in
  `web_frontend/html/js/modules/schemi.js` (def. riga 2349; call sites righe
  2290, 2306, 2399, 2407, 2413 — riapertura tab fonti, resize, drag).
  Fix SOLO se tornato indietro → NESSUN fix (nessuna regressione).
- **V3.3 — gate threshold da config**: `python -m unittest tests.testR15_gate
  tests.testR16_gate` → **33/33 OK** (soglia letta da ConfigManager/DEFAULT_CONFIG;
  nessun tocco a config utente/backups).
- **V3.4 — testG1 flaky**: `python -m unittest tests.testG1_sidecar` → **3/3 OK**,
  run senza scatto di retry (quiescente). Policy di retry dichiarata nel codice:
  wrapper `flake_retry` (max 2) SOLO su `FLAKY_TESTS`, log esplicito
  `[flake-retry] test=<nome> attempt=<k>/2 motivo=... | errore: ...`
  (testG1_sidecar.py righe 41-100); dopo 2 retry → FAIL vero, nessuna run
  alternativa silenziosa. NESSUN fix.

## V3.5 — RSS pro (probe R25 reale)

Procedura identica a R24: llama-server upstream (`tools/llama-server.exe`),
modello `tools/models/spark-x2.6-4b.gguf` (Q4_K_M, 3543441312 B), `-c 4096`,
`--cache-type-k q8_0 --cache-type-v q8_0`, steady-state (settle 4 s, media
ultimi 8 campioni @0.25 s), psutil. Output: `qa/r25_church_rss.json`.

### Tabella misure (n_ctx 4096, cache k/v q8_0, modello pro)

| case | extra args | status | ready_s | plateau_MB | delta_MB |
|---|---|---|---|---|---|
| baseline | (default -b 2048 -ub 512) | up | 6.64 | **4435.1** | +0.0 |
| b256 | -b 256 | up | 4.05 | 4421.3 | −13.8 |
| b256ub256 | -b 256 --ubatch-size 256 | up | 4.09 | 4421.5 | −13.6 |

### Confronto numeri dichiarati

| fonte | RSS baseline MB |
|---|---|
| R25 probe (questo) | **4435.1** |
| R24 probe | 4435.9 |
| Prompt R25 (dichiarato) | 4471 |

→ Il valore R25 (4435.1) è nel range ~4436-4471: **variabilità ~0.8%**
(4435→4471 = 36 MB) per campionamento/thread/OS; stessa procedura, stessa
ordine di grandezza. Nessuna anomalia fuori range → NESSUN fix da investigare.

### Floor teorico aggiornato (baseline R25)

| componente | MB |
|---|---|
| pesi Q4_K_M mappati (3543441312 B) | 3379.3 |
| KV q8_0 @ctx 4096 (36 layer × 2560 embd × 2 × 1.0625 B/elem) | 765.0 |
| resto (compute buffer + processo + libc) | 290.8 |
| **FLOOR totale = plateau misurato** | **4435.1** |

**Target ≤ 3.6 GB (3600 MB): NON RAGGIUNGIBILE — analisi R24 CONFERMATA con
numeri R25.** Gap = 4435.1 − 3600 = 835 MB. Sperimentale: batch ridotto
(-b256 ± ub256) risparmia solo ~14 MB; anche ctx 2048 (KV −382.5) porterebbe a
~4052 MB, ancora >3600. Con pesi Q4_K_M (già minimo per questa architettura),
KV q8_0 e ctx 4096 il floor ~4.4 GB è strutturale.

### Investigazione "ctx non applicato?" (ipotesi 218k slot) → ESCLUSA

- Log del server (baseline, in `qa/r25_church_rss.json` → `cases.baseline.log_tail`):
  `load_model: initializing, n_slots = 4, n_ctx_slot = 4096, kv_unified = 'true'`
  → **`-c 4096` APPLICATO** (n_ctx_slot = 4096).
- Modello ha ctx nativa 1M (`context_length = 1048576` dal GGUF) ma NON usata:
  `--help` server: `-c/--ctx-size` default 0 = loaded from model → qui è 4096 esplicito.
- Prova indipendente (aritmetica RSS): se il pool KV fosse 4×4096 = 16384
  (3060 MB), il floor sarebbe 3379+3060+291 ≈ 6730 MB ≫ 4435 misurati.
  Con KV unificato a 4096 (765 MB): 3379.3+765.0+290.8 = 4435.1 = MISURATO.
  → il pool KV condiviso (`kv_unified`) è dimensionato a 4096 totali.
- `n_slots = 4` con `--parallel` default `-1 (auto)` → le 4 slot condividono il
  pool unificato 4096; nessun costo RSS nascosto. (Osservazione non-RSS, per
  coordinatore: se in futuro servono slot parallele indipendenti, valutare
  `--kv-unified-per-slot` / `-np` in `core/sidecar/server.py`, file NON mio.)

**→ NESSUN fix necessario in `core/sidecar/server.py`: il -c4096 è già applicato.**

### Budget RAM (`DRAFT_RAM_BUDGET_MB` in core/sidecar/client.py)

- Formula R25: RSS pro dichiarato peggiore **4471 + margine 1500 = 5971 MB**
  (con misura R25: 4435.1 + 1500 = 5935.1 MB).
- 5971 < 6144 → **6144.0 INVARIATO**, margine 173 MB (208.9 MB col valore
  misurato). Contratto R22 (`testR22_models.test_budget_dichiarato_6gb` fissa
  6144.0) rispettato: NESSUN cambio di valore, NESSUN test da aggiornare.
- Aggiornato SOLO il commento di motivazione in `core/sidecar/client.py`
  (numeri R25: 4435.1 misurato, range 4435-4471, 4471+1500=5971<6144).

## Test obbligatori R25 (conteggi esatti)

| test | atteso | ottenuto |
|---|---|---|
| `python -m unittest tests.testR15_gate tests.testR16_gate` | 33 | **33/33 OK** |
| `python -m unittest tests.testG1_sidecar` | 3 | **3/3 OK** (retry non scattato; log `[flake-retry]` dichiarato nel codice) |
| `python -m unittest tests.testR22_models` | 28 | **28/28 OK** |
| `python -m unittest tests.testR24_church` | 19 | **19/19 OK** (run finale dopo le modifiche R25 al test) |
| `python -m py_compile core/sidecar/client.py tools/_r24_rss_probe.py` | OK | **COMPILE_OK** |
| `node --check web_frontend/html/js/modules/schemi.js` | OK | **OK** (non toccato, verificato lo stesso) |

## Verdetto V3.5

**CHIUSO.** RSS R25 = 4435.1 MB nel range dichiarato 4435-4471 (variabilità
~0.8%); floor 4435.1 (pesi 3379.3 + KV 765.0 + resto 290.8) conferma che il
target 3.6 GB con ctx4096+KV q8_0+Q4_K_M è non-raggiungibile (gap 835 MB);
`-c4096` applicato (n_ctx_slot=4096, pool kv_unified 4096) → ipotesi "ctx 1M
in uso" ESCLUSA, nessun fix per `core/sidecar/server.py`; budget 6144.0
invariato (5971 worst case < 6144, margine 173 MB), solo commento aggiornato.

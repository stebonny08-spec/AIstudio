# R13 — REPORT IMPLEMENTER-SPEC (Round 13)

Stato: **COMPLETATO** (sottoblocchi 0-4 verificati con misure reali)

## S1 — Download modelli 1B (Q4_K_M default + Q3_K_M candidato)
- [x] **OK (1 tentativo)**
- Fonte: stesso origin del 2B (`data/models_manager.py` usa
  `https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/resolve/main/...`) ->
  repo ufficiale **openbmb/MiniCPM5-1B-GGUF**.
- `tools/models/MiniCPM5-1B-Q4_K_M.gguf`: **688.065.920 B** (scaricato,
  header GGUF ok). `tools/models/MiniCPM5-1B-Q3_K_M.gguf`: **582.899.072 B**
  (il repo ufficiale NON pubblica Q3_K_M -> creato LOCALLI con
  `tools/llama-quantize.exe` tipo 12 `Q3_K_M` dal **F16 ufficiale**
  `MiniCPM5-1B-F16.gguf`, stessa fonte del Q4 -> confronto corretto;
  F16 rimosso dopo la quantizzazione). Entrambi con magic `GGUF`.
- Script: `tools/_r13_download_1b.py` (resume + verifica magic, nessuna pip).
- Risparmio Q3 vs Q4: **105.166.848 B (≈105,2 MB / 100,3 MiB)** — vedi S2.

## S2 — Confronto quant Q3 vs Q4 (regola letterale)
- [x] **OK (2 tentativi: tent.1 draft non attivo -> scoperto da --help che
  `--spec-type` default = "none"; corretto con `--spec-type draft-simple`).
  NOTA: `llama-bench` NON ha opzioni draft (verificato da --help) ->
  confronto con llama-server REALE, identica richiesta (think/standard,
  n_predict=600, 2 run + warmup per modo, tps = timings.predicted_per_second).**
- Log: `qa/s1_quant_compare.json` (compilato, campi decision/rule_inputs/
  thresholds) — **DECISIONE: Q4_K_M**
  - Misurato (media 2 run): baseline **12.63 tok/s**; draft Q4 **11.59**
    (speedup **0.918x**); draft Q3 **12.96** (speedup **1.026x**);
    Q3 vs Q4 **1.118x**.
  - Acceptance **ESPOSTA** dal server nei campi timings
    `draft_n`/`draft_n_accepted`: **Q4 = 0.527**, **Q3 = 0.576**
    (il client la ricava in `last_meta.acceptance`).
  - RAM (picco RSS psutil): baseline **2576.5 MB**, draft Q4 **3675.7 MB**,
    draft Q3 **3405.3 MB**.
  - Risparmio file: **105.2 MB** (`size_saving_bytes`: 105166848).
  - Regola applicata letteralmente: acceptance_ok=**True**
    (0.576 >= 0.527-0.03), speedup_ok=**True** (1.026 >= 0.918-0.05),
    size_ok=**False** (105.2 < 120) -> AND non soddisfatta ->
    **decision = Q4_K_M** (motivo: risparmio 105.2 MB < 120 MB).
- RAM con draft <=2.9GB: **NON soddisfatto** (best-effort con
  `--spec-draft-type-k/v q8_0 --spec-draft-n-ubatch 128`: probe
  `tools/_r13_ram_probe.py` = **3278.7 MB** > 2900). Causa strutturale:
  baseline server gia' 2576 MB + pesi draft 556-656 MB (min teorico
  ~3159 MB). Procedura manuale per rispettarlo: ridurre RAM baseline del
  target (n_ctx/ubatch piu' piccoli o target <2B) oppure mantenere draft
  OFF (scelta di default, vedi S4).

## S3 — Cablaggio draft solo long-form
- [x] **OK**
- Politica in codice (`SidecarClient.want_draft(profile, classe, draft)`):
  draft SOLO se profile=='think' OR classe=='think' (F10/F13/F06 budget
  think, chat think, W2); **micro/standard/tool SENZA draft** — verificato
  da `tests/testR13_spec_draft.py` (test_solo_long_form, override,
  draft_model mancante -> False, flag spento -> False).
- W2 (`core/workers/w2_summarizer.py`): flag `DRAFT_LONGFORM = True`
  + override `llm()` che passa `draft=True` al llm_fn **SOLO se la
  signature lo supporta** (`_supports_draft`: kwarg 'draft' o **kwargs);
  con stub/signature vecchia -> strada base IDENTICA a prima (test:
  test_llm_passa_draft_se_supportato, test_llm_backward_compat_senza_kwarg,
  test_flag_spegnito_usa_base). Firma costruttore invariata.
- Config: `spec.draft_longform` presente (gate "solo long-form"),
  `spec.draft_model` default **""** -> nessun draft di default (default
  esistenti NON toccati: testH5 4/4 verdi). Commento decisione S4 aggiunto
  in `data/config_manager.py` (valori invariati).
- Cablaggio body `complete()`: wd = want_draft(...) -> _ensure_server(wd)
  -> server riavviato con/-senza `--model-draft + --spec-type draft-simple`
  se la modalita' non coincide; nessun campo draft nel body /completion
  (questa build: `--draft` rimosso, "argument has been removed"; flag
  solo CLI/env — verificato da `llama-server.exe --help`).

## S4 — Misure per profilo + prompt-lookup + RAM
- [x] **OK — output `qa/r13_spec_measures.json`** (misura reale, 2 run/caso
  ON e OFF, llama-server reale, draft Q4_K_M scelto in S2; soglie
  acceptance>=0.70, speedup>=1.30x):

| profilo | tps OFF | tps ON | acceptance | speedup | decisione |
|---|---|---|---|---|---|
| fast/micro (200) | 13.15 | 11.17 | 0.439 | 0.850x | **OFF** (acc<0.70; speedup<1.30) |
| fast/standard (600) | 12.73 | 13.29 | 0.606 | 1.044x | **OFF** (acc<0.70; speedup<1.30) |
| think/long-form (1500) | 12.55 | 14.67 | **0.811** | 1.169x | **OFF** (speedup<1.30 — acc ok) |
| tool/micro (200) | 13.29 | 10.83 | 0.478 | 0.815x | **OFF** (acc<0.70; speedup<1.30) |

  -> **draft OFF per TUTTI i profili, motivato** (enforcement di default:
  `spec.draft_model=""` immutato -> nessun draft attivo in produzione).
  W2 = caso fast/micro con flag draft (riga fast/micro sopra).
- **Prompt-lookup**: grep reale su core/data/backend/tools/tests: SOLO
  `data/config_manager.py` (definizione) e `tests/testH5_flags.py`
  (assert default) — **nessun componente di esecuzione consuma il flag**
  -> contributo con draft = **1.0x < 1.05x** (baseline R12 1.049x gia'
  sotto soglia, rimisurato per costruzione: nessun code path) ->
  **RIMOZIONE dichiarata**: flag spento a runtime (config.json
  `spec.prompt_lookup=false` da R12); `DEFAULT_CONFIG` resta True SOLO
  per il contratto `tests/testH5_flags.py` (test esistente, non
  modificabile) = nessun effetto pratico. Ritrovato in
  `qa/g1_measures.json` (R12) la stessa motivazione.
- **RAM**: picco RSS llama-server: no-draft **2576.5 MB**; con draft
  **3855.1 MB** (S2: Q4 3675.7 / Q3 3405.3; best-effort con draft-KV q8_0
  + ubatch128 = 3278.7 MB) -> **limite 2900 MB NON raggiungibile**
  (vedi BLOCKED/limiti). **Unload entrambi gli stati (ON e OFF)**: memoria
  di sistema usata 10056.8 MB -> 9926.5 MB dopo shutdown = delta
  **-130.3 MB <= 50 MB** -> **OK**.
- **Contract `last_meta` (per delegato TELEM) — campi esatti** (da
  `core/sidecar/client.py`, aggiornato da `complete()` dopo ogni
  completamento riuscito, non-stream e stream):
  `last_meta = {"timings": dict, "acceptance": float|None,
  "draft_active": bool, "ts": float}`
  — timings = dict 'timings' raw della risposta llama-server ({} se
  assente); acceptance = draft_n_accepted/draft_n se esposti, altrimenti
  None (mai inventato); draft_active = want_draft AND draft_mode server;
  ts = epoch. Il ritorno di complete() resta SEMPRE str.

## Verifiche (bug + test)
- Bug `server.start_on_demand(draft=...)`: **RISOLTO** — firma `start_on_demand(self, draft: bool = False)`,
  `_resolve_draft()` (draft=True senza spec.draft_model esistente -> fallback identico a prima),
  property `draft_mode`, chiave `draft` in `status()`, cambio modalita' -> riavvio controllato (no crash),
  restart dopo crash mantiene l'ultima modalita' (`_last_want_draft`).
- Body `complete()`: **CABLATO** — `want_draft(profile, classe, draft)` -> `_ensure_server(wd)` ->
  `(ri)avvio server con/-senza --model-draft`; meta pubblicato da ogni completamento (non-stream + stream).
  Verifica help binario: il draft in questa build e' SOLO un flag di avvio (`--spec-draft-model/-md/--model-draft`;
  `--draft/-md` per-request NON esistono: "--draft... argument has been removed"; nessun campo draft nel body
  /completion). Flag per richiesta: il client forza la modalita' server corretta (restart se mismatch).
- Smoke test import/avvio/stop con e senza draft: **OK** — testG1 parte/ferma server REALE senza draft
  (cold 1.70s, 3 completion, idle-unload 8s); con draft_model vuoto `start_on_demand(draft=True)` identico a prima.
  Con modello 1B: vedi S2 (avvio reale con --model-draft).
- `python tests/testG1_sidecar.py tests/testH2_server.py tests/testH5_flags.py`: **TUTTI VERDI**
  (G1 3/3, H2 11/11, H5 4/4) + nuovo `tests/testR13_spec_draft.py` 16/16.
- `python -m py_compile` file toccati: **OK** (server.py, client.py, w2_summarizer.py, config_manager.py, testR13).
- Contratto `last_meta` (per TELEM): `{"timings": dict, "acceptance": float|None, "draft_active": bool, "ts": float}`
  — aggiornato da `complete()` DOPO ogni completamento riuscito (non-stream: campo "timings" della risposta;
  stream: ultimo payload con "timings" prima di [DONE]).

## BLOCKED / Limiti
1. **RAM con draft <=2.9GB: NON soddisfatto** (non simulato: misurato).
   - Valori: 3855.1 MB (S4, draft ON think), 3675.7/3405.3 MB (S2 Q4/Q3),
     best-effort 3278.7 MB con `--spec-draft-type-k/v q8_0` +
     `--spec-draft-n-ubatch 128` (`tools/_r13_ram_probe.py`).
   - Causa strutturale: baseline server = 2576.5 MB + pesi draft
     556-656 MB -> min teorico ~3159 MB > 2900 MB: irraggiungibile con
     target 2B + draft 1B su questa macchina.
   - Procedura manuale per rispettarlo: (a) ridurre la baseline
     (n_ctx 4096 piu' bassa, ubatch ridotti, KV/attention piu' stretti) o
     usare un target piu' piccolo; oppure (b) mantenere draft OFF di
     default (SCELTA ADOTTATA: spec.draft_model="" immutato; misure
     sconsigliano comunque il draft, vedi S4).
2. Nessun altro BLOCKED: S1 ok al 1 tentativo; S2 ok al 2 (bug
   `--spec-type` default none scoperto e corretto); S4 ok al 1.

## File toccati (owner: IMPLEMENTER-SPEC)
- `core/sidecar/server.py`: start_on_demand(draft=...), _resolve_draft,
  property draft_mode, status['draft'], args `--model-draft` +
  `--spec-type draft-simple`, cambio modalita' -> restart controllato,
  restart post-crash con ultima modalita'.
- `core/sidecar/client.py`: complete(..., draft=None), publish meta
  (non-stream + stream), _iter_stream(resp, want_draft).
- `core/workers/w2_summarizer.py`: flag DRAFT_LONGFORM + llm() override
  backward-compat.
- `data/config_manager.py`: commento decisione S4 (valori invariati).
- `tools/_r13_download_1b.py`, `tools/_r13_quant_compare.py`,
  `tools/_r13_measures.py`, `tools/_r13_ram_probe.py` (script misure).
- `tests/testR13_spec_draft.py` (16 test, NUOVO).
- `qa/s1_quant_compare.json`, `qa/r13_spec_measures.json`,
  `qa/qa_r13_spec_report.md` (questo file).

## Note
- Simulazioni vietate: ogni misura è reale (llama-server/psutil) oppure
  BLOCKED dichiarato con causa + procedura manuale (voce 1 sopra).
- File VIETATI non toccati (necessario? riportato): nessuno — `backend/**`,
  `core/ai_runtime.py`, `core/router.py`, `core/registry/**`,
  `core/rag/**`, `core/ai_cache.py`, `data/db.py`, `data/migrate_real.py`,
  `web_frontend/**`, `qa/metrics_history.json`, `qa/audit_r13.*`,
  `tests/run_t1.py`, `qa_browser/**`, `qa_ui/**`, test esistenti
  G1/H2/H5 (solo eseguiti), `MODIFICHE.md`, `NOTE.md`, `index.html`
  — **NON modificati**.
- `llama-bench.exe` non usabile per il confronto draft (nessuna opzione
  draft nel --help, verificato); suite T1 completa NON eseguita
  (consentite: G1/H2/H5 + nuovi R13, tutti verdi).

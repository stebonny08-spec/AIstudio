# R23 — Lineup Spark coerente: base 1.7B + pro 4B + draft nativo XHToken (report)

**STRATEGIA**: fasi a dipendenze dichiarate (C ibrido): R0 ricognizione → X1 fork&build ∥
X2 download modelli → X3 benchmark matrice (motore×modello) → X4 draft + X5 dual-engine +
X6 registro (dipendono da X3) → QA reale + regressione + docs. Tutto locale, owner unici
per file (delegati X5/X6 su file disgiunti), nessuna simulazione: tutti i numeri vengono da
binari/file reali in qa/. Numerazione dichiarata: contatore Round repo = 25, prompt = 23.

## Tabella PRIMA → DOPO

| | PRIMA (baseline R22) | DOPO (R23) |
|---|---|---|
| Modelli | MiniCPM5-2B come base + pro Spark-4B a catalogo | **base Spark-1.7B** (Q4_K_M, sha MATCH), **pro Spark-4B**, **fallback MiniCPM5-2B** (3 voci, ordine pro>base>fallback) |
| Engine | upstream solo (tools/llama-server.exe) | **dual-engine**: upstream (DEFAULT, regola X3.3) + **fork XHToken buildato** (HEAD 22c0ae1, clang 23.1.4) con switch llama.engine=upstream/xhtoken/auto |
| Draft 1.7B→4B | non disponibile (solo MiniCPM5-1B locale) | **disponibile e misurato**: acceptance **0.8402**, speedup up **1.272×** / xt **1.240×** → **OFF di default** (regola X4.2: speedup < 1.30), flag nel dropdown |
| Caricamento Spark | **falliva** in-process (llama-cpp-python 0.3.35 non sa Spark) → fallback silenzioso MiniCPM5 | caricamento/validazione via **sidecar reale** (fix proxy) + config refresh a ogni avvio sidecar → Spark gira davvero nell'app |
| Fallback | apply_fallback → 'base' | **Spark non disponibile → MiniCPM5-2B** con log esplicito; **XHToken KO → upstream** con message UI |

## Tok/s per modello e motore (llama-bench -p 512 -n 128, 8 thread, stessi argomenti)

| modello | pp512 upstream | pp512 xhtoken | tg128 upstream | tg128 xhtoken |
|---|---|---|---|---|
| **1.7B (base)** | 147.43 ± 1.57 | **153.79 ± 2.48** | 15.30 ± 0.27 | **15.82 ± 0.30** |
| **4B (pro)** | 55.80 ± 1.07 | **56.35 ± 0.64** | 6.70 ± 0.06 | **6.76 ± 0.07** |

Server reale (ctx4096, KV q8_0, n_predict=200, temp 0): tg 4B: up 6.13 → **7.80** con draft
(1.272×), xt 6.43 → **7.97** con draft (1.240×).

## Draft acceptance (1.7B → 4B, --spec-type draft-simple)

| motore | acceptance | speedup pro | soglia X4.2 (acc≥0.70 ∧ speedup≥1.30) | esito |
|---|---|---|---|---|
| upstream | **0.8402** | 1.272× | acc ✓ / speed ✗ | — |
| xhtoken | **0.8402** | 1.240× | acc ✓ / speed ✗ | **draft OFF di default**, motivato |

Regola selezione X3.3: acceptance xhtoken 0.8402 ≥ 0.70 ✓ MA speedup 1.240 < 1.30 ✗ →
**engine default = UPSTREAM** (log esatto nello sidecar, qa/x3_compare.json).

## RSS steady (ctx4096, KV q8_0, psutil)

| modello | upstream | xhtoken |
|---|---|---|
| pro 4B | **4435.8 MB** | **4426.6 MB** |
| base 1.7B | **1876.8 MB** | **1868.0 MB** |

## Evidenze T2 (app reale) e T1

| Claim | Evidenza | Esito |
|---|---|---|
| Switch base→pro (xhtoken)→base funzionante | qa/x_qa1_switch.py su **StudioIAAPI reale** (stub webview): cmdline binario fork + modello atteso + generazioni non vuote | **28/28 PASS** |
| Fallback kill XHToken → upstream | rinomina binario fork → status engine=upstream, xhtoken_fallback=true, message utente | PASS |
| Fallback kill Spark → MiniCPM5-2B | gguf corrotto → local_model_key='fallback', path MiniCPM5, log '[models] fallback al modello MiniCPM5-2B', generazione ok, restore size 3543441312 | PASS |
| Dropdown 3 voci + flag draft + Scarica | qa_browser/qaR23_models.js, dati = **list_models REALE** via python, Chrome/CDP, screenshot qa/r23_models_{default,drafton,scarica}.png | **10/10 PASS** |
| SLO TTFT con motore scelto | qa/x_qa2_slo.py (client sidecar reale): **miss p50 998.5 ≤ 4000**, **hit p50 94.8 ≤ 1500**, streaming 60/60 chunk ×11/11, risposte complete | **PASS** |
| T1 regressione | tests/run_t1.py → qa/t1_r13.json | **3224/0** (baseline 3205/0, +19; meta escluse 368/6 = bug legacy R11/R12) |
| Test engine/registro | testR23_engine 16/16, testR22_models 28/28, testR23_draftflag 4/4, H2/H5 20/20, testG7_stats 12/12 | tutti verdi |
| metrics | entry 'round 23' in qa/metrics_history.json (valori letti da file qa/* a runtime) | testG7 12/12 |

## I due fix emersi dal QA reale (senza i quali la lineup non funzionava)

1. **Spark non caricava**: SidecarLLMProxy.load_model_blocking delegava a llama-cpp-python
   (arch Spark non supportato, probe qa/_x_loadprobe.py) → ogni switch Spark cascava in
   fallback silenzioso MiniCPM5 (QA-1 pre-fix: 2 falliti). Ora: caricamento via sidecar reale.
2. **Config sidecar stale**: start_on_demand non rileggeva il config da disco (istanza
   separata da quella di backend/api.py) → switch modello/engine invisibili. Ora:
   self._config.load() a ogni avvio (dict dei test invariati).

## Cosa resta APERTO

1. **QA-2 SLO eseguito sulla config reale utente (MiniCPM5-2B)**, non sullo Spark: confronto
   diretto con R16/R18; Spark validato da QA-1+bench. Secondo run SLO switchato = non fatto.
2. **TTFT e2e RAG ≤2000ms**: BLOCKED R13 invariato (fuori scope).
3. **Progress bar caricamento**: RSS monitor sul padre mentre il modello ora vive nel
   figlio → barra che salta a 100% (miglioramento rimandato, NOTE.md).
4. **Draft OFF**: per riattivarlo servono speedup ≥1.30 (misurabile con qa/_x_draftbench.py)
   o decisione esplicita via spec.draft_model.
5. **Meta-suite T1 6 fail legacy** (qaF/qaB1/qaV): escluse dalla baseline dal R11, non toccate.
6. **Fork XHToken 14 stelle** (vs upstream 132.958): rischio manutenzione dichiarato;
   **mitigato dal dual-engine con fallback upstream + MiniCPM5-2B** (kill-test 28/28) e dal
   fatto che il default operativo resti upstream.
7. **1 patch locale nel fork** (1 riga, #include <algorithm> per libc++ 23): al prossimo
   rebase upstream va verificata/rimossa; loggata in qa/x1_build.json.

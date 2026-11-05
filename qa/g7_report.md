# G7 — Osservabilità statistiche: esiti (round 11 → metrics_history)

Data: 2026-10-23T16:0x:00+02:00 · Build riferimento: `2026-10-23T16:00:00+02:00`

## 7.1 qa/metrics_history.json — CREATO

- Path: `qa/metrics_history.json`
- Struttura: `{schema_version, schema:{description, append, metrics_required, null_allowed, extra_allowed, test}, rounds:[entry]}`
- Entry round11: `{round:"11", timestamp, build:"2026-10-23T16:00:00+02:00", metrics:{...}, method:{metrica -> comando/strumento}}`
- Valori round11 (TUTTI letti da file qa/* reali, nessun valore inventato):

| Metrica | Valore | Sorgente |
|---|---|---|
| rss_before / load / 30req (MB) | 24.5 / 2093.4 / 2578.2 | qa/t2a_measures.json `sections.rss_mb` |
| load_sec | 2.01 | `sections.model_load_sec.sec` |
| tok_s fast/think/tool | 10.32 / 9.11 / 11.78 | `sections.tok_s.profili.*.mediana_tok_s` |
| latency p50/p95 (ms) | 3941.7 / 4044.9 | `sections.latency_ms` |
| ttft_p50/p95 | **null** (non misurato round11) | — |
| prompt_cache_hit_rate | 0.45 | `sections.prompt_cache.hit_rate` |
| kv_delta_mb | **null** (non misurato) | — |
| gate total/ok | 60 / 45 (F01 15/15, F04 15/15, F10 10/15, F13 5/15) | qa/gate_outputs.json (ricontato dal test) |
| recall5 hybrid / vector | 1.000 / 0.900 | qa/h8_eval.json |
| parity | 1.000 (50 query, overlap medio top-10) | `python tests/testH1_parity.py` |
| router_p95_ms | 0.0107 | qa/h7_cache_measures.json `h9_router.p95_ms` |
| t1_total | 10 (Ran 10 tests OK) | `python tests/testH1_parity.py` |

- Append round futuri: **manuale** (nessuno script tools/) — append oggetto in `rounds`
  copiando i campi SOLO da qa/* reali, poi `window.StatsAI.pushRound(entry)` a runtime.
  Schema documentato nel campo `schema` del file; validato da `tests/testG7_stats.py`.

## 7.2 Vista dev "Statistiche AI"

- Modulo NUOVO: `web_frontend/html/js/modules/statistiche.js` (IIFE
  `App.registerModule({id:'statistiche', ...})`, **NON** inserito in `App.ORDER`
  → nessuna 9ª .home-card).
- Accesso: link discreto `<div class="dev-link"><a>Statistiche AI</a></div>` aggiunto
  in `app.js renderHome` **dopo** `homeEl.appendChild(wrap)` (NON un button,
  fuori da `.home-grid`) → click → `App.go('statistiche')`.
- Contenuto: tabella PRIMA→DOPO con 23 righe metriche, colonna round11 "(prima)",
  colonna "Target R12" (load ≤3s, TTFT p50 ≤1500 / p95 ≤2500, hit-rate ≥0,70,
  KV ≤50MB, gate ≥54/60) e colonna Δ con celle verdi/rosse
  (`.stats-better` / `.stats-worse`); colonne rounds futuri via pushRound.
- `window.StatsAI = {rounds(), pushRound(entry)}` per i round successivi.
- index.html: aggiunta ESATTAMENTE 1 riga
  `<script src="js/modules/statistiche.js?v=2026-10-23T16:00:00+02:00"></script>`
  (subito dopo calendario.js). QA_TS/BUILD e altri tag NON toccati.

## 7.3 Telemetria runtime — core/ai_runtime.py

- Contatori module-level `_STATS`: per fid `{calls, ok, fails, tokens_est, ms_total}`
  + globali `{calls_total, cache_hits{exact,semantic,delta}, tutor_judgments{corretto,parziale,errato}}`.
- Incrementi: wrapper pubblico `run_ai_function()` (chiamate/esito/durata),
  `_call_llm` (tokens ≈ max(1, len/4)), ramo HIT (cache_hits per strato).
- API esposte in `__all__`: `get_stats()` (dict JSON-serializzabile, include
  `ai_cache` = `AiCache.stats()` **già esistente**, non duplicata),
  `reset_stats()` (flag azzerabile), `record_tutor_judgment(verdict)` (hook per
  tutor_step, tutor.py non toccato).
- `core/ai_cache.py` invariato (stats() esistente riportata da get_stats).
- Contratto invariato: run_ai_function MAI eccezioni (wrapper cattura e ritorna
  `_fallback`); comportamento per i caller identico.

## Verifiche eseguite

| Test | Esito |
|---|---|
| `python tests/testG7_stats.py` | **12/12 OK, 0 fail** (schema, round11==disco, gate ricalcolato, get_stats/reset/tutor) |
| `node --check app.js` + `node --check statistiche.js` | **OK** |
| `node tests/testG7_fe.test.js` | **25/25, 0 fail** (8 .home-card, 0 extra, dev-link, click→vista, tabella ≥8 righe, pushRound) |
| `node tests/qaD_home.js` | **41/41, 0 falliti** (INVARIATO — nessuna 9ª card) |
| `node tests/aiUi_smoke.test.js` | **62/62, 0 falliti** (INVARIATO) |
| `python tests/test_runtime_ai.py` (regressione H13 dopo refactor) | **13/13 OK** |

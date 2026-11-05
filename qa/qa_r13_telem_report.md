# R13 — REPORT IMPLEMENTER-TELEM (subagente 20261024_5)

Stato: **IN CORSO** — T1 ✅ | T2 da fare | T3 core ✅, FE da fare

## T1 — api.ai_stats() / ai_stats_reset()
- Stato: **OK (codice + test verdi)**
- `backend/api.py`: import protetti `_ai_runtime_get_stats/_ai_runtime_reset_stats` (stesso try di `_run_ai_function`); metodi `ai_stats()` (~riga 1163) e `ai_stats_reset()` (~1181) stile H13: docstring + wrapper difensivo, delegano a `core.ai_runtime.get_stats()/reset_stats()`, MAI eccezione verso JS.
- `tests/testR13_telem.py`: stub `webview` PRIMA di import backend.api (modello testC_rag), `StudioIAAPI.__new__` senza `__init__` pesante; verifica chiavi base invariate (snapshot struttura prima/dopo, core vs api), reset, JSON-serializzabile.

## T2 — Sonda TTFT end-to-end (pywebview bridge incluso)
- Stato: NON INIZIATO
- File: `tests/t13_ttft_pywebview.py`, output `qa/t_probe_pywebview.json`
- Risultato: da misurare

## T3 — Telemetria runtime persistente + wiring Statistiche (aspetto invariato)
- Stato: **CORE OK (test verdi)**; FE statistiche.js da fare
- `core/ai_runtime.py`:
  - persistenza `%APPDATA%\NovaStudio\ai_stats.json` (`_telem_dir()` = env `STUDIOIA_TELEM_DIR` per i test, altrimenti `get_app_data_dir()` in LETTURA; `data/config_manager.py` NON modificato); scrittura atomica tmp+os.replace con lock; lazy-load prima di ogni mutazione; `reset_stats()` prevale sul disco.
  - chiavi NUOVE in `get_stats()`: `live` {ttft_p50_ms, ttft_p95_ms, ttft_n, ttft_source, tok_per_s, tok_per_s_source, prefix_hit_rate(+hits/misses/source), acceptance, acceptance_source, draft_active, tutor_judgments} + `persist` {path, ok, writes, loaded, error}. Chiavi G7 esistenti: INVARIATE (verificato da test_02).
  - `record_ttft(ms)`: campioni reali max 200, p50/p95 nearest-rank; fallback in lettura da `qa/t_probe_pywebview.json` se nessun campione runtime.
  - `register_sidecar_client()`: osservatore in LETTURA di `last_meta` (contratto TELEM), installato via monkey-patch runtime in backend/api.py; `core/sidecar/**` intoccato.
- Fonti dichiarate (nessuna simulazione):
  - tok/s = `last_meta['timings'].predicted_per_second` se raggiungibile, ALTRIMENTI stima `sum(tokens_est)/sum(ms_total)` dai contatori `_add_tokens/_record_call` (source dichiarato nel payload);
  - acceptance = `last_meta['acceptance']` quando presente, ALTRIMENTI `null` + `acceptance_source` che dichiara l'assenza (client per-chiamata in `stream_via_sidecar`);
  - hit-rate = `core.prefix_cache.get_prefix_cache().stats()` in sola lettura (reale);
  - giudizi tutor = contatori esistenti `tutor_judgments`;
  - token/tempo per F01-F17 = `fids{tokens_est, ms_total}` già tracciati (invariati).

## Verifiche (test verdi SENZA modifiche)
- tests/testG7_stats.py: **12/12 OK**
- tests/test_runtime_ai.py: **13/13 OK**
- tests/testR13_telem.py: **9/9 OK**
- tests/telemStatsR13.test.js: da creare/eseguire

## Limiti / BLOCKED
- Nessuno finora.

## Note
- Carico macchina: altri 3 delegati in parallelo sullo stesso cwd.

---

## AGGIORNAMENTO FINALE (coordinatore R13, dopo unità TTFT)

### T2 — Stato finale: **COMPLETATO, unità con verdict BLOCKED** (vedi `qa/qa_r13_ttft_report.md`)
- Sonda `tests/t13_ttft_pywebview.py` (pywebview 6.2.1 reale, `create_window(hidden=True)`, bridge incluso, metodo dichiarato nel json).
- Risultati: run originale (sotto carico 3 delegati, preservato in `qa/r13_ttft_prev_load.json`): **n=5 p50=91.962 ms**; run quiet con fasi (tent.1): fasi py-first-token 25,2-64,9 s (tabella nel report TTFT, p50 ~56,8 s); **run finale tent.6 `qa/t_probe_pywebview.json`: n=2 p50=95.972 ms, p95=140.964 ms** (m1/m3 JS end-to-end reali; m2 timeout 120s; m4 crash nativo ucrtbase 0xc0000005; m5 non eseguito; run dichiarato NON-QUIET per server orfano rilevato da env_scan).
- **target p50 ≤2000 ms: NON RAGGIUNTO -> BLOCKED** (6 tentativi, cause + procedura manuale nel report TTFT). Fix di catena applicati durante l'unita': watchdog hard-exit sonda; `CONNECTION_TIMEOUT` 8→60 s; `llama.n_ctx` 4096→8192 (rollback documentato).
- 0 processi orfani a fine unità (2 llama-server orfani killati dichiarati).

### T3 — Stato finale: **COMPLETATO**
- `core/ai_runtime.py`: persistenza telemetria (`ai_stats.json` in `%APPDATA%\NovaStudio\`) + chiavi estese; payload preesistente INVARIATO.
- `backend/api.py`: `ai_stats()` / `ai_stats_reset()` su js_api (stile H13).
- `web_frontend/html/js/modules/statistiche.js`: valori LIVE da `window.pywebview.api.ai_stats()` con fallback prudente; **aspetto/struttura storica invariati** (verificato dal test).
- Verifiche eseguite e verdi (oggi): `python tests/testR13_telem.py` **9/9**, `node tests/telemStatsR13.test.js` **19/19**, `python tests/testG7_stats.py` **12/12** (payload/telemetria invariati), `python tests/test_runtime_ai.py` **13/13**, `python tests/testG8_metrics.py` **5/5**.

# QA-1 R15b — Matrice fallimenti (Round 15b, subagent 20261024_16)

**STATUS: COMPLETATO** — 3 OK · 3 BLOCKED (con causa+procedura) · nessun BLOCKED ambientale
**Data run**: 2026-10-24 23:54 → 2026-10-25 01:00 (+02:00) · wall run = 2.860.858 ms (~47,7 min)
**Script rerunnable**: `qa/r15_qa1.py` → output `qa/r15_qa1.json` + `qa/r15_qa1.log`
**Fixup dichiarato**: `qa/tmp/fixup_qa1.py` ha ricostruito `network_log` (11 entry) e le `query` dei campioni (vi) dalle righe misurate `[RETE DICHIARATA]`/`E2E` di `qa/r15_qa1.log` — nessun dato inventato.

## Dichiarazioni di protocollo

- **Backend (DICHIARATO)**: `core.router.Router.process_query_stream` a livello Router — wiring identico a `backend/api.py::_run_generation` (`mode="automatica"` come il frontend `web_frontend/html/index.html:1997`, `history_turns=[]`, `stop_event`, `topic=""`). `backend.*` NON importato → **stub webview registrato comunque** prima di ogni import (schema di `tests/testC_rag.py`, dichiarato nel JSON).
- **Config**: SOLO LETTURA (mai scritta). Valori letti a runtime: `rag.progress_events=True`, `gate.threshold=0.70`, `web.mode=auto`, `llm.backend=sidecar`, `web.wikipedia=True`, `web.searxng_url=""`. Web OFF/ON ottenuto col parametro runtime `web_override` (`mai`/`auto`) del contratto P.
- **Answer cache**: rediretta a `qa/tmp/r15_qa1_ac.jsonl` + `clear()` dichiarato prima di OGNI sample (nessun HIT di misura; `%APPDATA%\answer_cache.jsonl` intoccato).
- **Spy `generate_stream`**: `functools.wraps` — **firma preservata = True**, `sig.bind(..., outcome=...)` OK (misurato nel JSON).
- **Sidecar**: `llm.backend=sidecar` → **state=up** dopo warmup (prima chiamata cold 202.212 ms totali, 600 token); shutdown a fine run → state=down. **0 processi llama-server residui** (tasklist: nessuna attività; kill dichiarato: nessuno necessario), **0 processi python residui miei** (altri processi non toccati).
- **Nessuna pip aggiunta**, nessun file di produzione modificato; toccati solo: `qa/r15_qa1.py`, `qa/r15_qa1.json`, `qa/r15_qa1.log`, questo report, `qa/tmp/fixup_qa1.py`.

## Tabella dei 6 punti

| # | Punto | Esito | Tempi/Misure | Metodo |
|---|-------|-------|--------------|--------|
| i | Positivo con anchor (p1 `+2870`, p4 `Plastocianina`) | ✅ **OK** (2/2 tentativi) | anchor in top-5 ibrido: **True/True** (hybrid 15.573 ms cold / 82 ms warm); E2E: source=**locale**, tokens=600/600, sources ≥1 `appunti`, **0 righe astensioni**; total 67.361 / 171.799 ms; primo progresso 2,02 / 28,19 ms | retrieval-level `local_search.search(hybrid=True)` + E2E `process_query_stream(web_override="mai")` |
| ii | Parziale → astensioni + formula | ❌ **BLOCKED** (6/6 tentativi) | astensioni `outcome=parziale`: **OK su x2 e x2-auto** (gate `esito=parziale`, riga presente); tokens OK (600) su tutti; **formula "Ho trovato solo questo" = FALSE su 6/6**; spy `outcome_kwargs=[None×6]` | E2E `mode=automatica`, web=`mai` (4 tent.) + `auto` (2 tent. diagnostici) su x1–x4 |
| iii | Negativo + web ON | ✅ **OK** (1° tentativo: n1, `web_override=auto`) | sources: **5 item `stage=web` con url http(s)** (Treccani/Sapere, guardati nel JSON); tokens=600; **net log = 1 chiamata** ddgs trusted 2.559 ms ok n=5; total 196.852 ms; primo progresso 2,03 ms | E2E con escalation gate→`web_stage.escalate` (config `web.mode=auto` invariata) |
| iv | Senza copertura + web OFF → esito (c) | ❌ **BLOCKED** (6/6 tentativi: n3,n2,n5,n4,x1,n1) | gate **`esito=nulla` su 6/6** + riga astensioni `outcome=nulla, web_attempted=False` su 6/6 ✅; ma **esito(c)=FALSE su 6/6** e **`llm_calls=1` su 6/6** (mai 0); pre-screen: max_sim candidati 0,74–0,84 (tutti ≥0,35 → fused H8 non vuoto) | E2E `web_override="mai"`; contenuto informativa verificato sul testo REALE completo |
| v(a) | p95 esito(c) senza web ≤3000 ms (n=5) | ❌ **BLOCKED — TEMPO MANCANTE (dichiarato)** | **p95 = null** (nessun sample: esito(c) non raggiungibile, vedi iv) | — |
| v(b) | p95 esito(c) con web ≤8000 ms (n=5) | ❌ **BLOCKED — TEMPO MANCANTE (dichiarato)** | **p95 = null**; pre-screen 4 stringhe senza senso: max_sim 0,739–0,833 → `fused_vuoto_previsto=False` per tutte → abort dichiarato senza campioni | — |
| vi | Tempo al primo feedback ≤2000 ms | ✅ **OK** | **p95 = 28,19 ms** (target 2000) · **n=9 campioni** su 3+ casi (i_p1 2,02 · i_p4 28,19 · iii_n1 2,03 · iv×6 1,76–2,06 ms) · nearest-rank `sorted[ceil(0.95·n)-1]`; progress ON (`rag.progress_events=True`) → primo evento `progress` usato (non primo token) | t0 (`perf_counter` prima di `process_query_stream`) → PRIMO evento `type=progress` |

### Target vs misurati

| Target | Misurato | n campioni | Esito |
|---|---|---|---|
| v(a) p95 ≤ 3000 ms | **null (MANCANTE)** | 0 | BLOCKED |
| v(b) p95 ≤ 8000 ms | **null (MANCANTE)** | 0 | BLOCKED |
| vi p95 ≤ 2000 ms | **28,19 ms** | 9 (casi i, iii, iv) | ✅ |

## RETE DICHIARATA (tutte le chiamate loggate, 11 totali → `network_log` nel JSON)

| caso | provider/endpoint | n | ms osservati | ok |
|---|---|---|---|---|
| ii_x1_auto (diagnostica) | ddgs `ddgs://text?q=Chi ha scoperto la fotosintesi…` (4 batch site: + 1 generico) | 5 | 1.298–2.251 (tot ~8,2 s) | ✓ (4 batch n=0 "normale", generico n=5) |
| ii_x2_auto (diagnostica) | ddgs `ddgs://text?q=Che differenza c'è tra un enzima e un ormone?` (4 site: + 1 generico) | 5 | 1.220–2.140 (tot ~7,4 s) | ✓ (4× n=0, generico n=5) |
| iii_n1_auto | ddgs trusted `site:treccani/sapere/britannica…` | 1 | 2.559 | ✓ n=5 (early-stop, nessun altro batch) |

- **Wikipedia: 0 chiamate** (non servita: ddgs ha coperto k). **SearXNG: 0 chiamate** (`web.searxng_url=""` → off, dichiarato). **Fetch pagine: 0** (nessuna entry web_stage). **Nessuna LLM cloud**, HF offline forzato (0 download).
- Casi i, iv, v: **0 rete** (`web_override="mai"`, verificato: `net=0` su tutti i campioni). Le 10 chiamate dei casi ii provengono dai 2 tentativi diagnostici con `web_override="auto"` (dichiarati a runtime con stampa `[RETE DICHIARATA]`).

## BLOCKED — cause + procedure

**ii — formula parziale mai emessa (6 tentativi)**
- **Causa**: spy su `generate_stream` (firma preservata) registra `outcome=None` su 6/6 chiamate → `Router._emit_level/_emit_single_level` **non passa `decision.outcome`** al client; il flag `_PARTIAL_OUTCOME_INSTRUCTION` (`core/local_llm_client.py`, applicato solo se `outcome=="parziale"`) resta disattivato in E2E. Le unità `tests/testR15_gate.py` lo testano solo passandolo esplicitamente. La riga astensioni `outcome=parziale` **funziona** (x2 misurato).
- **Procedura**: passare `outcome=<decision.outcome>` dal gate a `generate_stream` in `Router._emit_level`/`_emit_single_level` (kwarg `outcome` già esiste nella firma: `generate_stream(..., outcome=None)`), poi `PYTHONIOENCODING=utf-8 python qa/r15_qa1.py`.
- **Osservazione extra (misurata)**: gate live dà `esito=nulla` per x1/x3/x4 (GT li aveva tarati `parziale`): il supporto lessicale calcola `lex` sulla query RAW completa (più lunga → denominatore più grande) vs `query_norm` del GT — discordanza di taratura da investigare in G.

**iv — esito (c) non raggiungibile (6 tentativi)**
- **Causa**: `build_informativa` viene emesso SOLO se `outcome.fused` è vuoto (`router.py`: `if not outcome.fused`), cioè quando **tutte** le righe ibride sono <0,35 (H8). Su questo corpus (17 chunk E5) ogni negativo/stringa senza senso ha max_sim **0,74–0,84** (pre-screen misurato) → `fused` non vuoto → **1 `generate_stream`** (tokens=600 di risposta LLM) invece dell'informativa, **nonostante gate `esito=nulla` + astensioni `outcome=nulla, web_attempted=False` registrate correttamente** (6/6).
- **Procedura**: in `Router._stream_rag_pipeline` instradare a `build_informativa(decision)` anche quando `decision.outcome==OUTCOME_NULLA` con fused non vuoto (oppure filtrare `fused` in base all'esito di gate); poi ripetere `PYTHONIOENCODING=utf-8 python qa/r15_qa1.py`.

**v — tempi esito(c) mancanti (dichiarati)**
- **Causa**: dipende da iv (nessun sample esito(c) ottenibile); per v(b) anche le 4 stringhe senza senso hanno `max_sim ≥0,35` → fused non vuoto → nessun campione. **p95 null (tempo MANCANTE, non stimato)**.
- **Procedura**: sbloccare iv e riprodurre v(a) n=5 e v(b) n=5 (stesso script, campioni già strutturati).

## Note esecuzione
- Warmup (fuori misura): 202.212 ms cold (avvio llama-server + modello), 600 token, source=locale, gate piena; cache chiuduta dopo.
- Generazioni E2E ferme a **600 token ciascuna** (cap) → total per query 67–205 s: non rilevante per i target (nessun target su total generativo), ma spiega la durata del run.
- File `qa/metrics_history.json`, `qa/gt_set_r15.json`, tests/*, run_t1.py, MODIFICHE/NOTE, t_probe/g4/g2: **non toccati** (mtime invariata).

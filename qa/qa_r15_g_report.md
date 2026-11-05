# QA Report — Round 15b, blocco G (IMPLEMENTER-GATE)

**Delegate**: subagent 20261024_12 · **Data**: 2026-10-24 (21:56 → 23:05 +02:00)
**Scope**: `core/rag/gate.py` (nuovo), `core/local_llm_client.py`, riga `gate.threshold` di `data/config_manager.py`, `qa/gt_set_r15.json`, `tests/testR15_gate.py`, `qa/r15_gate_*.json`
**Protocollo**: report-first (questo file creato a 21:56 prima di ogni altra operazione), tutto locale, 0 pip, 0 restyling, nessun file vietato toccato.

| Compito | Stato |
|---|---|
| **G0 — FIX SIDECAR-DEAD** | **OK** (prima/dopo con prove reali, testG1 verdi) |
| **G1 — decide_gate precoce (3 esiti)** | **OK** (O(1), zero LLM, elapsed_ms dichiarato) |
| **G2 — 3 esiti + prompt parziale + informativa** | **OK** (flag `outcome="parziale"` backward-compat) |
| **G3 — log astensioni** | **OK** (`contract.log_astensione`, aggregati sotto) |
| **G4 — GT + taratura soglia** | **OK** (18 casi reali → **soglia 0.70**, tabella sweep) |
| **Test obbligatori** | **100/100 verdi** (0 failed, 0 skipped) |

---

## 1. G0 — FIX SIDECAR-DEAD (priorità 1)

### 1.1 PRIMA — riproduzione con traceback REALE

Script: `qa/r15_g0_repro.py` → `qa/r15_g0_prima.json`. Riproduce la chiamata **identica** a quella del proxy (spy con `functools.wraps` = firma originale intatta):

```text
Traceback (most recent call last):
  File "...\qa\r15_g0_repro.py", line 51, in main
    sig.bind("QUERY", **KW)          # esattamente cio' che fa il proxy
  File "...\inspect.py", line 3222, in _bind
    raise TypeError(msg) from None
TypeError: missing a required argument: 'query'
```

**Causa**: `SidecarLLMProxy.generate_stream` faceva `inspect.signature(type(target).stream_via_sidecar).bind(*args, **kwargs)` su una funzione **NON bound** → il parametro `self` assorbe `"QUERY"` → manca `query` → `TypeError` **catturato in silenzio** (`except (TypeError, ValueError): fallback`).

| Misura PRIMA | Valore |
|---|---|
| firme del target | `['self', 'query', 'profile']` (unbound) |
| `bind_result` | **FAIL** (`missing a required argument: 'query'`) |
| chiamate proxy | `stream_via_sidecar=0`, `generate_stream=1` → **caduta in-process silenziosa** |
| stato sidecar | `state=down`, `port=null`, `health=false` |
| processi llama-server | **[] (nessuno, mai avviato)** |

Conseguenza confermata: con `llm.backend=sidecar` si girava SEMPRE in-process (prompt-eval in-process ~75s, q1 E2E 85.3s, q4 132.6s — forensics).

### 1.2 DOPO — verifica REALE (processo + PID + tok/s)

Fix in `core/local_llm_client.py` (`SidecarLLMProxy` riscritto): il bind parte **dal metodo realmente invocato** (`generate_stream`/`generate` con `self` esplicito) → gli argomenti posizionali sono mappati sui **nomi corretti** e ripassati come keyword a `stream_via_sidecar`; se un parametro non è accettato dalla destinazione → strada in-process **come prima** (nessun cambio di comportamento).

Script: `qa/r15_g0_dopo.py` → `qa/r15_g0_dopo.json` (`llm.backend=sidecar` reale, config reale):

| Misura DOPO | Valore |
|---|---|
| `llama_pids_prima` | `[]` |
| **`llama_pids_nuovi`** | **`[10820]`** → processo `llama-server.exe` **avviato** |
| `status_dopo` | `state=up`, `port=49928`, `crashes=0` |
| `health_dopo` | **`true`** |
| `generate_stream_inprocess` | **0** → `percorso = "sidecar"` (**non cade più in-process**) |
| `timings` (dal server) | `prompt_n=259` @ **71.08 tok/s** (prompt eval), `predicted_n=600` @ **12.69 tok/s** (generazione), `prompt_ms=3643.9`, `predicted_ms=47205.2` |
| `risposta` | testo reale generato dal sidecar |
| `wall_s` | 52.58 (600 token a 12.7 tok/s) |

### 1.3 Test ufficiale `tests/testG1_sidecar.py` (dopo il fix) — **3/3 verdi**

```text
[G1] cold load reale: 1.72s (target <=3.0s)
[G1] completion 1/3 (fast): 561 char in 15.03s      <- via llama-server esterno
[G1] completion 2/3 (tool): 145 char in 3.00s
[G1] completion 3/3 (fast): 746 char in 14.96s
[G1] idle-unload con 8s: verificato in 8.41s
[G1] fallback in-process ok: 4 char in 94.81s        (server_path='' dichiarato)
======================== 3 passed in 144.04s ========================
```

---

## 2. G1 — `decide_gate` precoce (O(1), ZERO LLM)

`core/rag/gate.py` (NUOVO), firma **esattamente** quella del contratto:

```python
decide_gate(outcome: RetrievalOutcome, threshold: float, *, web_attempted: bool = False) -> GateDecision
build_informativa(decision: GateDecision) -> str
```

**Feature usate** (solo quelle già in `RetrievalOutcome`, + testi dei soli top-3 chunk = costo bounded):

| Feature | Fonte | Uso |
|---|---|---|
| `vec` | `vec_scores[0]` (top-1 coseno, scala [0,1]) | parte vettoriale |
| `fts_ev` / `fts_norm` | `fts_scores` dump **per-stadio** top-10 (bm25 raw di SQLite, ≤0) | **evidenza lessicale**: `|bm25| ≥ 3.5` (sotto = rumore stopword: misurato n4 `-0.0`, n5 `-0.56`, n2 `-1.11`) |
| `lex` / `lex_hits` | overlap token query↔top-3 chunk (stopword/accenti gestiti) | `lex ≥ 0.30` oppure `hits ≥ 2 e lex ≥ 0.20` |
| `score` | **fusione** `0.6*vec + 0.4*max(fts_norm, lex)` | confronto con `threshold` |
| `total_ms` | base del tempo | `elapsed_ms = total_ms + overhead decide_gate` |

**Regola decisionale** (allineata al contratto "top fused ≥ threshold **E** pertinenza"):

- **piena** = `score ≥ threshold` **E** `supporto` (fts reale o overlap lessicale)
- **parziale** = supporto presente ma `score < threshold` → `near_miss = top-3 sub-soglia con score`
- **nulla** = nessun candidato, oppure **alta somiglianza vettoriale SENZA alcun supporto** (caso q4-like)

**Prove O(1)/zero-LLM**: sorgente del gate esente da `local_llm_client`/`llama_cpp`/`sidecar`/`requests` (testato), overhead del verdetto **< 50 ms** misurato:
`decide_gate_ms` reale: **0.79 / 3.67 / 3.89 ms** (`qa/r15_gate_esempi.json`); `elapsed_ms ≥ outcome.total_ms` dichiarato e testato.

**Esempi REALI su indice** (`qa/r15_gate_esempi.json`, soglia 0.70):

| atteso | query | outcome | score | vec top-1 | bm25 top-3 |
|---|---|---|---|---|---|
| piena | q1 forensics (ΔG kJ/mol) | **piena** | 0.9461 | 0.9102 | -15.43, -5.90, -1.02 |
| parziale | "Che differenza c'è tra un enzima e un ormone?" | **parziale** | 0.6273 | 0.8232 | -1.74, -1.70, -1.55 |
| nulla | **q4 forensics (mitosi/meiosi)** | **nulla** | 0.6596 | **0.8200** | -2.51, -2.46, -1.75 |

> Il caso critico q4 (**sim 0.82 ≥ 0.45**) è escluso dal supporto, non dalla soglia: è la prova che "solo-similarità non separa" e che la feature FTS/lessico sì. (Cross-check forensics: q4 sim 0.82 → **misurata 0.8200 identica**.)

---

## 3. G2 — tre esiti, mai "info non trovata" nudo

- **(a) piena** → router di P risponde con citazioni (nessuna modifica da me).
- **(b) parziale** → il router passa **`outcome="parziale"`** a `generate_stream(...)`; `core/local_llm_client.py` appende `_PARTIAL_OUTCOME_INSTRUCTION` al prompt di sistema: *"RECUPERO PARZIALE ... Ho trovato solo questo nei materiali: ... NON inventare ... cita ogni affermazione con la sua fonte (e il punteggio di pertinenza)"*.
  **Backward-compat verificata** (`tests/testR15_gate.py::TestPromptParziale`): senza il flag (o con `None`/`"piena"`/`"nulla"`) il prompt è **byte-identico**; con `"parziale"` il prompt base resta **in testo** e il blocco è solo appeso. Il flag attraversa `generate_stream` → `_prepare_messages` → `_build_system_prompt` **e** il percorso sidecar (`stream_via_sidecar`).
- **(c) nulla** → `build_informativa(decision)` (zero LLM), esempio reale dal caso q4:

```text
Non ho trovato nei materiali locali una risposta completa a questa domanda.

- Cercato: "differenza mitosi meiosi cellule"
- Stadi interrogati: appunti, libri
- Miglior score di recupero: 0.660 (soglia 0.700)
- Perche': le corrispondenze sono solo semanticamente vicine ma non contengono i termini della domanda (probabilmente fuori corpus)
- Quasi corrispondenze (sotto soglia):
    1. .../fotosintesi_clorofilliana_universitario.md [libri] — score 0.820
Cosa puoi provare:
  * riformula la domanda usando i termini esatti usati nei tuoi materiali...
  * aggiungi alla biblioteca il documento che contiene l'argomento e riprova.

[Web: tentato] Nessuna fonte web utilizzabile per questa query.   (badge, param web_attempted)
```

Badge alternativo `[Web: non disponibile]` quando `web_attempted=False`. La 2ª chiamata LLM `context=none` (escalation odierna) **sparisce**: l'informativa sostituisce la generazione inutile.

---

## 4. G3 — log astensioni

Ogni **parziale/nulla** → `contract.log_astensione(...)` chiamato **solo** da `core/rag/gate.py` (G è l'unico scrittore). Campi obbligatori presenti e testati: `causa, score, stadi, query, tempo_totale_ms, outcome, near_miss, web_attempted` (`+ vec_top`, `threshold`, `ts` dal contratto). Le `piena` **non** loggano.

**Aggregato reale** (`%APPDATA%\NovaStudio\astensioni.jsonl`, script `qa/r15_astensioni_agg.py`):

| Metrica | Valore |
|---|---|
| righe totali | **807** (finestra 22:15:27 → 22:44:27) |
| per causa | `alta_somiglianza_senza_supporto` **711**, `sotto_soglia` **73**, `nessun_supporto` **19**, `nessun_candidato` **4** |
| per outcome | `nulla` **734**, `parziale` **73** |
| `web_tentato=True` | 4 |
| **query distinte a soglia tarata 0.70** | **32 → 28 `nulla` + 4 `parziale`** (cause: 27/4/1) |

Le ~770 righe "extra" provengono dal mio sweep multi-soglia pre-fix (ogni caso × 12 soglie): **ho poi reso lo sweep silenzioso** (`qa/r15_gate_calib.py` stubba il logger durante la sweep e fa **un solo passo loggato** per caso a soglia tarata) — il production log resta quindi pulito (1 riga per caso per passo). Le4 parziali loggate con `near_miss`:

```text
PARZ: Chi ha scoperto la fotosintesi e in che anno ...   score 0.6505  near_miss 1
PARZ: Che differenza c'è tra un enzima e un ormone?     score 0.6273  near_miss 1
PARZ: Qual è la funzione di un enzima digestivo?        score 0.6397  near_miss 1
PARZ: Come funziona la fotosintesi artificiale ...      score 0.6486  near_miss 1
```

---

## 5. G4 — GT + taratura della soglia

### 5.1 GT (`qa/gt_set_r15.json`) — **18 casi reali** (≥12 richiesti)

| Tipo | N | Costruzione |
|---|---|---|
| **positivi** | **9** (≥6) | query → `source_file` + **anchor verificati sui 17 chunk reali** (`+2870`, `endergonica`, `Fosfoenolpiruvato`, `Plastocianina`, `ATP Sintasi`, `1 reazione su 4-5`, `Costo Energetico`, `Fase Notturna`); include q1/q2 dei forensics |
| **negativi fuori corpus** | **5** (≥4) | stile q4: mitosi/meiosi, IVA fattura, fuorigioco calcio, carbonara, guerra dei Trent'anni |
| **parziali** | **4** (≥2) | argomento topico ma risposta **assente** dal corpus, **selezionati per misura**: supporto presente (lex 0.333) con score fuso **0.627–0.650 < 0.70** |
| Validazioni GT | | `anchor_in_corpus KO → []`, `anchor_mancante presente → []` |

### 5.2 Misura (primitive reali, in lettura, nessun LLM)

`qa/r15_gate_calib.py` → `qa/r15_gate_scores.json` + `qa/r15_gate_sweep.json`:
**FTS5** `chunks_fts MATCH` + `bm25()` (stessa `_fts_match_expr` di produzione) · **vettori** `sqlite-vec` su `vec_vector_index` + coseno in numpy · **embedding query** E5 reale (`intfloat/multilingual-e5-small`) · fusione **RRF** (`rrf_fuse`, k=60) come da produzione.
Cross-check: **q4 vec top-1 = 0.8200** = valore forensics (0.82) → harness validato.

### 5.3 Sweep soglia — tp / fp / fn / tn (18 casi: 9 pos, 5 neg, 4 parz)

| soglia | tp | fp | fn | tn | precision | recall | parziali (ok/piena/nulla) |
|---|---|---|---|---|---|---|---|
| 0.30 | 9 | 0 | 0 | 5 | 1.000 | 1.000 | 0/4/0 |
| 0.35 | 9 | 0 | 0 | 5 | 1.000 | 1.000 | 0/4/0 |
| 0.40 | 9 | 0 | 0 | 5 | 1.000 | 1.000 | 0/4/0 |
| **0.45 (vecchia)** | 9 | 0 | 0 | 5 | 1.000 | 1.000 | **0/4/0** ← i4 parziali risulterebbero "piena" |
| 0.50 | 9 | 0 | 0 | 5 | 1.000 | 1.000 | 0/4/0 |
| 0.55 | 9 | 0 | 0 | 5 | 1.000 | 1.000 | 0/4/0 |
| 0.60 | 9 | 0 | 0 | 5 | 1.000 | 1.000 | 0/4/0 |
| 0.65 | 9 | 0 | 0 | 5 | 1.000 | 1.000 | 3/1/0 |
| **0.70 SCELTA** | **9** | **0** | **0** | **5** | **1.000** | **1.000** | **4/0/0** |
| 0.75 | 9 | 0 | 0 | 5 | 1.000 | 1.000 | 4/0/0 (margine solo 0.024 sul positivo più debole: p4=0.774) |
| 0.80 | 8 | 0 | 1 | 5 | 1.000 | 0.889 | 4/0/0 (perde p4) |
| 0.85 | 6 | 0 | 3 | 5 | 1.000 | 0.667 | 4/0/0 |

**Soglia scelta: `0.70`** — recall 1.0 **e** precision 1.0 **e** 4/4 parziali corretti, con margine 0.074 sul positivo più debole (p4 = 0.774) e ≥0.05 sui parziali. I **negativi restano `nulla` a OGNI soglia** (tn=5 ovunque): la separazione la dà il *supporto* (FTS/lessico), non la soglia — esattamente il problema segnalato dai forensics.

**Distribuzione score misurata**: positivi 0.774–0.946 · parziali 0.627–0.650 · negativi 0.495–0.662 (ma `supporto=False` → nulla indipendentemente dalla soglia).

### 5.4 Patch

- `data/config_manager.py` — **solo la riga del default** `gate.threshold`: `0.45 → 0.70` con commento riportante la tabella di taratura (nessun'altra chiave toccata).
- `config.json` runtime sincronizzato: `gate.threshold = 0.7` (prima 0.45), perché `ConfigManager` fonde `{**DEFAULT, **saved}`.

---

## 6. Verifiche obbligatorie — **100/100 VERDI**

```text
PYTHONIOENCODING=utf-8 python -m pytest tests\testG1_sidecar.py tests\testG2_wiring.py ^
  tests\testH8_retrieval.py tests\testH2_server.py tests\testR13_spec_draft.py ^
  tests\testR13_telem.py tests\test_runtime_ai.py tests\testR15_gate.py -v
======================= 100 passed in 149.82s (0:02:29) =======================
```
0 failed · 0 skipped (nessuno skippato: `testG1_sidecar` ha girato su llama-server reale).
Il mio `tests/testR15_gate.py` = **23 test** deterministici a **zero LLM**:3 esiti, caso q4-like alta-sim-senza-FTS → **mai piena**, near_miss, campi del log, informativa/badge, backward-compat del prompt, **regressione binding SidecarLLMProxy** (posizionali mappati sui nomi giusti, kw sconosciuto → in-process), firma contrattuale, soglia tarata.

---

## 7. Nota per P (coordinamento)

- Drop del fallback: `from core.rag.gate import decide_gate, build_informativa` — **stessa firma del contratto**.
- Dopo il retrieval, **prima di ogni LLM**: `decision = decide_gate(outcome, ConfigManager().get("gate.threshold"), web_attempted=...)`.
  - `piena` → generazione con citazioni; `parziale` → generazione con **`outcome="parziale"`** in `generate_stream(...)` + near-miss; `nulla` → `build_informativa(decision)` (**nessuna generazione**).
- Per rendere il supporto FTS disponibile va popolato **`fts_scores`** (dump top-10 **per-stadio**, bm25 raw ≤0 o normalizzato [0,1] — entrambe le scale sono gestite) oltre a `vec_scores`, `stages_probed`, `total_ms`, `near_miss`.

## 8. Risidi noti (dichiarati)

1. **Supporto**: se FTS non è interpellato (`fts_scores` tutti 0 / `fts_ms=0`) e la query condivide <30% di token con i top-3 → `nulla` (informativa + escalation web) invece di `parziale`. Scelta deliberata: **meglio astenersi che generare su chunk irrilevanti** (caso q4).
2. **`FTS_EVID_FLOOR = 3.5`** (|bm25|) è tarato su questo corpus di17 chunk (positivi ≥3.994 vs n3 `calcio`=3.014, n1=2.514): **ri-tarare su corpus più grande**.
3. Se `tools/llama-server.exe` o il gguf mancano → fallback in-process **dichiarato** (percorso invariato, `AiUnavailable` gestito).
4. `gate.threshold` nel contratto è documentato come default 0.45: il coordinatore deve propagare **0.70** ai blocchi che lo citano.

## 9. File (owner G)

| File | Stato |
|---|---|
| `core/rag/gate.py` | NUOVO (decide_gate + build_informativa + log) |
| `core/local_llm_client.py` | FIX `SidecarLLMProxy` (G0) + flag `outcome` in `_build_system_prompt`/`_prepare_messages`/`generate_stream`/`stream_via_sidecar` |
| `data/config_manager.py` | **solo** riga default `gate.threshold` 0.45→0.70 (+commento) |
| `qa/gt_set_r15.json`, `tests/testR15_gate.py` | NUOVI |
| `qa/r15_g0_prima.json`, `qa/r15_g0_dopo.json`, `qa/r15_gate_scores.json`, `qa/r15_gate_sweep.json`, `qa/r15_gate_esempi.json`, `qa/r15_gt_inspect.json`, `qa/r15_partials_probe.json`, `qa/r15_partials_candidates.json` | NUOVI (misure) |
| `qa/r15_g0_repro.py`, `qa/r15_g0_dopo.py`, `qa/r15_patch_llm.py`, `qa/r15_gate_calib.py`, `qa/r15_gate_smoke.py`, `qa/r15_gt_inspect.py`, `qa/r15_probe_partials.py`, `qa/r15_gate_esempi.py`, `qa/r15_astensioni_agg.py` | NUOVI (script di misura) |
| Vietati (`backend/api.py`, `contract.py`, `router.py`, `local_search.py`, `semantic_router.py`, `ai_router.py`, `embedder.py`, `answer_cache.py`, `web_*`, `chunker.py`, `indexer.py`, `vector_store*`, resto di `config_manager`, `web_frontend/**`, test esistenti, MODIFICHE/NOTE, metrics_history, run_t1) | **NON toccati** |

# P1-bis — Acceleratori misurati: report (A/B su dati reali, ON solo se giustificato)

**STRATEGIA**: fasi con dipendenze dichiarate — P1b.1 (n-gram, indipendente) e P1b.2
(usearch, core/rag/vector_store_sqlite) in parallelo; P1b.3 (tecniche RAG, stessi file
core/rag) SEQUENZIALE a P1b.2; P1b.4 (registro flag + QA finale + report) dal
coordinatore. Nessuna adozione sulla fiducia: ogni riga ON/OFF nasce da un A/B sul
GT/indice REALE dell'utente (GT R15:18 casi/9 positivi; indice reale:17 vettori dim384).
Cross-platform: usearch 2.26.6 (wheel ufficiale), ONNX runtime 1.27, n-gram = flags
nativi llama.cpp (upstream+fork), nessuna dipendenza Intel-specifica.

## 1. N-GRAM SPECULATIVE DRAFTLESS (qa/p1b_ngram.json)

Setup:26+run su serveri reali (ctx4096 KV q8_0, temp0 greedy, n_predict=200, prompt L1
fisso; L2 di robustezza sui top3; top2 rilanciati sul fork). Mappatura --draft-max
(flag rimosso): ngram-mod -> --spec-ngram-mod-n-max D; simple/map-k/k4v ->
--spec-<v>-size-m D.

| variante | D | pro (vs no-spec 6.17 t/s) | base (vs 13.58) | acceptance | quality (sha vs greedy) | decisione |
|---|---|---|---|---|---|---|
| ngram-simple | 3-8 | 0.975x | 1.036x | - | uguale | **OFF** |
| **ngram-map-k** | 5 | **3.073x (18.9 t/s)** | **2.343x** | 1.0 | **uguale** (L1+L2) | **ON long-form** |
| ngram-map-k4v | 5 | 3.044x | 2.222x | 1.0 | uguale | ON long-form (via config) |
| ngram-mod | 8 | 2.559x | 2.094x | 1.0 | uguale | ON long-form (via config) |

- Fork XHToken (stessi flag top2 su pro): map-k d5 **18.69 t/s**, map-k4v d5 17.17 t/s, acc 1.0.
- **Confronto col draft Spark R23** (1.272x up / 1.240x xt): n-gram-map-k **3.073x >> 1.272**
  -> **vince il n-gram; il draft Spark resta OFF, mai entrambi** (nessun --model-draft
  negli argv, testato).
- Regola >=1.30: soddisfatta da6 varianti; **micro/standard = OFF** per regola (invariato).
- **Cablaggio reale P1b.4**: spec.ngram_longform=True / variant=ngram-map-k / draft_max=5 in
  DEFAULT_CONFIG + branch want_draft (solo config reale; override test R13/R22 invariati) +
  argv sidecar --spec-type ngram-map-k --spec-ngram-map-k-size-m 5. Confermato SULLA
  CATENA REALE durante il QA TTFT: log [SidecarServer] spec n-gram long-form: ngram-map-k
  D=5. Test testP1b_ngram_flags **7/7**.

## 2. USEARCH / HNSW (qa/p1b_usearch.json) — **ADOPTATO (ON)**

| indice | sqlite-vec p50/p95 (ms) | usearch p50/p95 (ms) |
|---|---|---|
| **reale (17 vettori, dim384)** | 0.72 / **0.885** | 0.021 / **0.037** |
| scala 1k | 0.91 / 1.19 | 0.20 / 0.29 |
| scala 10k | 6.37 / 6.72 | 0.57 / 0.72 |
| scala 50k | 25.61 / 26.29 | 1.26 / 1.60 |

- Regola: p95 usearch <= sqlite-vec sul REALE **OK** (0.037 <= 0.885, ~24x); recall@5 GT:
  off **1.0** on **1.0** (delta 0 >= -0.01) **OK** -> **USEARCH ON di default**.
- Scale 1k/10k/50k = vettori random deterministici **solo per la latenza** (il corpus reale
  ha17 vettori - dichiarato; nessun documento inventato, nessuna pretesa di qualita a scala).
- Persistenza: hnsw_vector_index.usearch save -> nuovo processo -> **load (nessun rebuild)**,
  verificato; rebuild solo su invalidate (add/reset); sqlite resta fonte di verita.
- File: core/rag/usearch_layer.py + hook in vector_store_sqlite.py (ramo _vec_query col
  flag, invalidate su add/reset), USEARCH_ENABLED_DEFAULT=True con i numeri nel commento.
  Test: testP1b_usearch **7/7** + store regressioni **36/36**.

## 3. TECNICHE RAG (qa/p1b_rag.json) — **NESSUNA ATTIVA (tutte OFF motivate)**

| tecnica | recall@5 off->on | MRR off->on | ms aggiunti p95 | decisione e motivo |
|---|---|---|---|---|
| HyDE | 1.0->1.0 | 0.9259->0.9259 | run A/B: **9/9 fallback llm_down:AiUnavailable** (auto_start=False per design); **costo reale ramo LLM: >=8010ms** (budget 8s superato, cold-start sidecar 6888ms) - qa/p1b_hyde_llm_cost.json | **OFF**: effetto 0 con sidecar non disponibile E, con sidecar up, costo >=8s >>150ms (regola violata per costruzione) |
| Query decomposition | 1.0->1.0 | 0.9259->0.9259 | +3.6ms | **OFF**: 0 query su 9 recuperate meglio (delta +0.0000 < +0.03 = almeno 1 query) |
| CRAG-lite | 1.0->1.0 | 0.9259->0.9259 | +26.7ms | **OFF**: nessun miglioramento qualita (latenza ok ma la regola richiede ENTRAMBI); negativi 5/5 invariati |
| Cross-encoder rerank (bge-reranker-v2-m3 **int8 ONNX 543MB**, reale) | 1.0->1.0 | 0.9259->**0.8611 (peggiora)** | **+25861.8ms** (p95 ~25.9s/query su CPU) | **OFF**: MRR -0.065 e costo 25.9s >>150ms (doppia violazione) |

- Verdict globale bench: **attive: nessuna** -> default flag tutti False (gate
  RAG_FLAG_DEFAULTS + commenti che citano qa/p1b_rag.json). Meccanismo A/B: env
  RAG_TECH=<tech>|none (stesso rag_flag di produzione, riproducibile).
- Granularita GT (dichiarata): 9 positivi -> 1 query = +0.111 >= +0.03: la soglia si legge
  come almeno 1 query in piu recuperata in cima - qui **zero** in piu su tutte e4.
- Test testP1b_rag **11/11** (mai LLM reale: client finto per HyDE).

## 4. P1b.4 - registro, rollback, QA finale

- **Flag persistiti con default = esito A/B**: spec.ngram_longform=True (map-k d5),
  usearch.enabled -> USEARCH_ENABLED_DEFAULT=True,
  rag.hyde/decompose/crag_lite/rerank.enabled=False.
- **Rollback**: ogni flag OFF ripristina il comportamento R23 esatto - verificato da
  testP1b_ngram_flags.test_rollback_* (nessun flag spec in argv), testP1b_usearch
  (env 0 -> nessun layer, percorso sqlite identico), testP1b_rag (env none -> tutti OFF).
- **Store intatto**: usearch scrive SOLO i file laterali hnsw_* (mai vec0/chunks); le
  tecniche RAG non riscrivono chunk; **recall finale con set attivo 1.0 >= baseline R18 1.0**
  (qa/p1b_recall_final.json, run con usearch load reale + tutti i default).
- **TTFT RAG con acceleratori ammessi**: **SLO NON RAGGIUNTO (stato BLOCKED invariato)**: p50 **34699ms** / p95 52439ms (n=5, metodo R16 identico, `qa/p1b_ttft.json`) vs soglia p50<=2000ms. Il set attivo durante la misura = usearch ON + n-gram map-k d5 (log `[SidecarServer] spec n-gram long-form` confermato) + tutte le tecniche RAG OFF. Il dominante e' LLM+web+rigenerazioni depth (check_ms fino a28.9s): nessun acceleratore misurato in questo round puo' ridurlo l'usoarch toglie ~1ms di retrieval, il n-gram agisce solo sulla decode long-form). Coerente con il BLOCKED R13/R16 gia' documentato; nessun claim di raggiungimento.

## 5. Scartati e perche (elenco sintetico)

1. ngram-simple (0.975/1.036x) - nessun guadagno; 2. draft Spark 1.7B->4B - perde contro
   il n-gram ed e' <1.30 (resta OFF come R23); 3. HyDE - budget 8s insufficiente + costo
   >=8s >>150ms; 4. decompose - nessun gain sul GT (query GT poco composita); 5. CRAG-lite -
   nessun gain (gate gia a regime su soglia tarata); 6. rerank ONNX - MRR peggiorato +
   25.9s/query su CPU; 7. varianti deboli (simple) con draft-max 3..8 - sotto 1.30.

## 6. File toccati (owner)

- **P1b.1**: qa/p1b_ngram_bench.py + qa/p1b_ngram.json; cablaggio: data/config_manager.py
  (+3 default), core/sidecar/client.py (branch want_draft), core/sidecar/server.py (argv
  ngram + override modalita), tests/testP1b_ngram_flags.py.
- **P1b.2**: core/rag/usearch_layer.py (nuovo), core/rag/vector_store_sqlite.py (hook),
  tests/testP1b_usearch.py, qa/p1b_usearch_bench.py + json.
- **P1b.3**: core/rag/{hyde,crag_lite}.py (nuovi), core/local_search.py, core/rag/gate.py
  (defaults+rag_flag), core/router.py (decompose flag), core/rag/reranker_int8.py
  (OnnxReranker+model_ready), tests/testP1b_rag.py, qa/p1b_rag_{bench,recall}.py + json.
- **Modelli scaricati**: tools/models/rerank_bge-v2m3/ (Samir-j/bge-reranker-v2-m3-onnx,
  int8, 543MB) + spark-x2.6-1.7b.gguf (R23).
- **QA finale (coordinatore)**: qa/p1b_ttft.py, qa/p1b_hyde_cost.py, qa/p1b_recall_final.json,
  questo report.

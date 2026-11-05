# QA R15 Round 15b — Blocco P (IMPLEMENTER-PIPE)

Stato finale: **COMPLETATO** (2026-10-24, subagent 20261024_15)
Tentativi per unità: P1=2, P2=2, P3=3, P4=2 — nessuna unità BLOCKED operazionale (max 6).

## Scope
- **P1** — UNA chiamata LLM di default (1 `generate_stream` per query, anche in escalation web)
- **P2** — embedder warmup + cache query LRU (query, model_id) + semantic_router in background
- **P3** — retrieve ibrido time-boxed + gate subito + progress/sources + web_override + orchestrazione escalation
- **P4** — answer cache persistente (AppData, JSONL, TTL 7gg)

## File (owner)
| File | Azione |
|---|---|
| `core/router.py` | RISCRITTO: pipeline P1/P3/P4 (cache → semantic → retrieve ibrido → gate → web → UNA generazione), `web_override`, progress/sources, gate lazy import + shim |
| `core/local_search.py` | EDIT: `last_probe` strumentato (embed/fts/vec/total ms, liste vec/fts, candidati), param `variants`, warmup engine, default `hybrid=False` INVARIATO |
| `core/semantic_router.py` | EDIT: `ready`, `warmup()` thread daemon (background), nessun blocco |
| `core/ai_router.py` | EDIT: connector `"tutto su"` (regola decompose esplicita P1) |
| `core/rag/embedder.py` | EDIT: `model_id`, `warmup()->None` best-effort, `warm`, chiave LRU = (query, model_id) |
| `core/rag/answer_cache.py` | NUOVO: cache risposte JSONL AppData, TTL 7gg, fingerprint corpus |
| `tests/testR15_pipe.py` | NUOVO: 30 test (tutti verdi) + runner `--measures` per le misure reali |
| `qa/r15_pipe_*.json` | NUOVI: p1_calls, p2_embed, p2_semantic, p3_retrieve, p1_feedback |

Nessuna modifica ai file vietati (api.py, contract.py, gate.py, local_llm_client.py,
web_search/web_stage/chunker, indexer/vector_store*, config_manager, web_frontend,
test esistenti, MODIFICHE/NOTE, metrics_history, run_t1).

## Stato per unità
| Unità | Stato | Tentativi | Note |
|---|---|---|---|
| P1 | OK | 2 | conteggio reale==1 su tutti i casi (v. misure) |
| P2 | OK | 2 | p95 encode warm 28,8ms ≤100; semantic in background |
| P3 | OK | 3 | gate reale G integrato; retrieve p95 29,8ms ≤1s (soft 1s loggato) |
| P4 | OK | 2 | HIT=0 LLM; scrittura solo completa+con fonti; TTL+fingerprint |

## Misure (protocollo dichiarato; sorgente `qa/r15_pipe_*.json`)

### P1 — chiamate LLM reali per caso (`r15_pipe_p1_calls.json`)
Metodo: percorso REALE `Router.process_query_stream` con `LocalLLMClient` sostituito da
un client contatore (conta le invocazioni reali di `generate_stream`), embedder
deterministico + store SQLite temporanei, **web STUBBATO (zero rete)**, Gate REALE (G).

| Caso | generate_stream |
|---|---|
| locale forte (`web_override=mai`) | **1** |
| escalation auto (gate≠piena → web stub → contesto web finale) | **1** |
| locale VUOTO + auto → escalation web (il caso forensics "context=none") | **1** |
| `sempre` → locale+web fusi in UNA chiamata | **1** |
| chitchat (semantic → no-rag) | **1** |
| gate NULLA + nessun web → informativa `build_informativa` | **0** (zero-LLM dichiarato) |
| cache HIT | **0** (stream da cache) |
| query decomposta (regole esplicithe ai_router, sub-query solo al retrieval) | **1** |

`gate_ok: true`. La 2ª chiamata "locale-irrilevante-poi-web" è eliminata: il contesto
finale (locale OPPURE web fuso) è deciso PRIMA della generazione; il retry su
fallback-marker è rimosso (decide il gate). Unica eccezione a "1" resta la queue
multi-part per contesti oltre il tetto (feature esistente H2, mai usata nei casi P1).

### P2 — embed query warm (`r15_pipe_p2_embed.json`)
Metodo: `Embedder.warmup()` + attesa flag `.warm`; LRU svuotata (`clear_query_cache`);
24 query DISTINTE; `time.perf_counter` su `embed_one(kind="query")`; run con
`HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1` (100% locale).
- encode warm: **p50 = 20,5ms, p95 = 28,8ms, max = 34,6ms → gate p95 ≤ 100ms ✓**
- cache-hit LRU: p50/p95 = 0,002ms
- caricamento modello da disco (primo uso, offline): 15,9s — avviato in BACKGROUND
  (thread daemon, mai nel path della query)

### P2 — semantic_router prima/dopo (`r15_pipe_p2_semantic.json`)
Metodo: **PRIMA** = `release_model()` (rimette l'E5 freddo) + nuovo `SemanticRouter`
privo di warmup → tempo della PRIMA `should_use_rag` (caricamento E5 + embedding
esempi). **DOPO** = nuovo `SemanticRouter.warmup()` (thread background, attesa
`ready`) → 20 query.
- prima (cold reale): **2.486,2ms** (run precedente non-offline: 6.222ms; forensics
  43,6s = primo avvio con modello non in cache — qui il .gguf/HF sono già su disco)
- dopo: **p50 = 19,7ms, p95 = 23,0ms** (warmup esempi: 402ms in background)
- fallback regole H9 se non pronto/freddo: **0,008ms/query** (0-LLM, nessun blocco)

### P3 — retrieve ibrido (`r15_pipe_p3_retrieve.json`)
Metodo: corpus REALE `file_AIstudio/rag_stage2/*.md` chunked (22 chunk) indicizzato
con E5 reale; 20 query; `search(hybrid=True)` (vec+FTS5+RRF) con `perf_counter`.
- wall: **p50 = 27,0ms, p95 = 29,8ms, max = 53,1ms → ≤ 1s ✓**
- split per stadio nel JSON (embed/fts/vec/total).
- time-box SOFT 1000ms dichiarato (`RETRIEVE_SOFT_TIMEBOX_MS`): in produzione ha
  scritto `[R15P] retrieve time-box SOFT superato: 5193ms > 1000ms — log dichiarato,
  continuo senza abort` durante il primo utilizzo a freddo del modello post-reindex
  (comportamento soft corretto: log + continua).

### P3 — primo feedback UI (`r15_pipe_p1_feedback.json`)
Metodo: modello WARM, indice costruito, Router reale, tempo da
`process_query_stream()` al PRIMO evento (progress `gate/start`), n=5, mediana.
- **p50 = 22,7ms (max 25,9ms) → ≤ 2s ✓** (i progress "gate"+"appunti" start sono i
  primi yield, prima di ogni lavoro lungo)

### Integrazione gate / cache / web
- **gate**: `core/rag/gate.py` di G è atterrato → import LAZY usato a ogni query
  (test_03b verifica con il gate REALE: esito `nulla` → escalation). Lo shim di pari
  firma resta in `router.py` come fallback se il modulo non esiste. `fts_scores` del
  dump = **bm25 raw** (scala che G si aspetta: negativo = match forte; 0 = stadio non
  interpellato), `vec_scores` = coseno reale top-10; `near_miss` top-3 sub-soglia.
  Config utente: G ha tarato `gate.threshold=0.7`.
- **web**: `core.rag.web_stage` (W) atterrato → chiamata esplicita
  `escalate(query, gate_outcome, mode)` (W4 rispetta auto/sempre/mai); assente →
  NESSUN web (dichiarato); i test stubbano `_fetch_web_stage` (zero rete).
- **cache**: attiva PRIMA di tutto; HIT = 0 LLM (progress `cache` + fonti salvate);
  scrittura solo con testo completo NON splittato e fonti; invalidazione =
  fingerprint `doc_versions`/conteggio chunks (lettura ro) → fallback `indexed_files`
  → altrimenti TTL 7gg + `clear()` dichiarato.

## Verifiche obbligatorie (tutte verdi, eseguite dopo le modifiche finali)
| Suite | Esito |
|---|---|
| tests/testH1_parity.py | 10/10 OK (search() default ibrido=False invariato) |
| tests/testH8_retrieval.py | 20/20 OK |
| tests/testG2_wiring.py | 5/5 OK |
| tests/testH9_router.py | 13/13 OK (router 0-LLM p95<5ms, source pura) |
| tests/testR13_rag.py | 7/7 OK |
| tests/testR15_pipe.py (nuovo) | **30/30 OK** |

## T1 (baseline)
- Snapshot **prima dei miei test** (implementazione P già completa, testR15_pipe non
  ancora creato): **2176/5** — 4 rossi transitori (`fogliUi` 1, `qaA_appunti` 3) da
  edit frontend W CONCORRENTI durante il run (riverificati verdi subito dopo:
  135/0 e 92/0) + `testG8_metrics` già rotto (vedi BLOCKED).
  Nota: la baseline storica 2146/0 è anteriore all'atterraggio dei blocchi
  G/I/W (+51 test verdi loro: testR15_gate 23, testR15_index 16, testR15_web 15).
- Snapshot **FINALE con i miei test**: **2230 passati / 1 fallito**
  (JS 1856/0 su 22 suite; PY 374/1 su 30 file; `testR15_pipe` 30/0 → i miei test
  aggiungono SOLO verde). `testG1_sidecar` (rosso transitorio nel run intermedio)
  è 3/0 verde sia standalone sia nel T1 finale.

## BLOCKED (1) — causa + procedura
**tests/testG8_metrics.py — `test_e_round13_valori_da_disco` (1/6).**
- **Causa**: l'artefatto `qa/t_probe_pywebview.json` (sonda TTFT, owner TELEM) è
  stato riscritto da una sonda CONCORRENTE (`tmp/r15_probe_full.py`, evidenza
  env_scan nella stessa JSON: `p50_ms=null`, motivo warmup sidecar >120s con
  `AMBIENTE NON-QUIET ... python tests/run_t1.py`) durante la mia baseline T1 —
  il test confronta (uguaglianza ESATTA) `metrics_history.json` (95972.0, file
  VIETATO per me) col probe. Il contenuto originale del probe non è su disco/git.
- **Tentativo 1 (mio)**: rilancio `tests/t13_ttft_pywebview.py` (esecuzione
  consentita) → crash NATIVO llama.cpp (`ggml-cpu/repack.cpp:4238 GGML_ASSERT`,
  codice 0xC0000409) dopo 1 campione → probe parziale `n=1, p50=92980.5 ≠ 95972.0`
  → test resta rosso. Nessun processo orfano residuo verificato.
- **Procedura per il proprietario (TELEM/G)**: ripristinare il probe identico alla
  sorgente di `metrics_history.ttft_p50_ms=95972.0` (o riallineare
  `metrics_history.json` al probe rigenerato) e far girare la sonda su macchina
  quieta (nessun T1/probe concorrente); il crash llama.cpp repack è nel layer
  dipendenze G (`local_llm_client`/llama-cpp-python), fuori dallo scope P.
- **Non è causato dal blocco P**: P non tocca metrics_history, la sonda TTFT, il
  sidecar o il modello LLM.

## Limiti dichiarati
1. **Chiave cache** = query normalizzata + model_id + set stadi attivi (come da
   contratto P4): `study_mode`/`topic` NON sono nella chiave → stessa query con
   mode/studio diversi condivide l'entry (invalidata da fingerprint/TTL). Scelta
   conforme allo spec; da valutare in taratura.
2. **Attribuzione stadi nei chunk fusi**: le righe dello store non espongono
   `chunk.meta["stage"]` (API row invariata) → stadio = identità dell'engine
   (appunti/libri) + `web` per W; il default contratto "assente ⇒ appunti" vale
   per righe ambigue. Pesi `web.weight_*` applicati nella RRF cross-stadio qui.
3. **Fuso locale+web** passato al client come `context_kind="locale"` con chunk
   pseudo-web (source_file=url): il client formatta locale OPPURE web → una sola
   chiamata (limite del contratto `_prepare_messages`, non modificabile).
4. **Astensione** (gate nulla e nessun web): informativa `build_informativa` con
   **0 chiamate LLM** (forensics #8: niente generazione locale inutile) — il
   target "esattamente 1" vale per i percorsi locali/escalation/chitchat (tutti
   misurati = 1).
5. **Caricamento E5**: sentence-transformers emette HEAD/GET verso
   huggingface.co al load (comportamento preesistente dell'app); tutte le misure
   P sono state riconfermate con `HF_HUB_OFFLINE=1` → identiche, 100% locali.
6. **Semantic non pronto o E5 freddo** (post-`release_model` dell'indicizzazione):
   fallback deterministico H9 (~8µs) invece di bloccare la prima query.
7. I progress sono attivi se `rag.progress_events=True` (config reale verificata:
   True); le misure di feedback usano la config reale.
